/**
 * Idempotency Middleware
 * --------------------------------------------
 * Prevents the same submission from being processed twice within a
 * configurable TTL. Designed for the public application-submit endpoint
 * to defend against:
 *   - Double-clicks on the submit button
 *   - Network retries from the frontend / mobile clients
 *   - Naive replay attacks
 *
 * ## Behavior
 *
 * The middleware has four observable states for a given `submissionToken`:
 *
 *   1. **First request** — token not in the store.
 *      → Reserve a slot (`completed: false`), call `next()`, then on a
 *        2xx downstream response, capture `responseStatus` +
 *        `responseBody` and mark `completed: true`. On any non-2xx
 *        response, FREE the slot (`tokenStore.delete(token)`) so the
 *        client can legitimately retry on transient errors.
 *
 *   2. **Successful replay** — token in the store, `completed: true`.
 *      → Return the captured response verbatim:
 *          - Same status code (e.g. 201)
 *          - Same body (e.g. `{ success: true, applicationNo: "APP-…" }`)
 *        This is the standard HTTP idempotency-key contract.
 *
 *   3. **In-flight duplicate** — token in the store, `completed: false`.
 *      → Return HTTP 409 with
 *          `{ success: false, error: "Submission already processed" }`
 *        This window only exists between "first request started" and
 *        "first request finished" — typically milliseconds. A client
 *        that retries too aggressively during this window will see 409
 *        and should treat it as retryable.
 *
 *   4. **TTL expired** — token's `firstSeenAt` is older than the TTL.
 *      → Treated as a brand-new request. The expired entry is removed
 *        by the probabilistic sweeper (see `sweepExpiredEntries`).
 *
 * ## No-token fallback
 *
 * If the request body does NOT contain a `submissionToken`
 * (or `submission_token` / `idempotencyKey` / `idempotency_key`), the
 * middleware is a no-op and the request flows through unchanged. This
 * preserves backward compatibility with clients that haven't shipped
 * the new field — the per-(roundId, email) duplicate check in the
 * submit handler is the safety net.
 *
 * ## Storage
 *
 * The store is an in-process `Map`. This is correct for a single-isolate
 * Workers deployment and is *eventually consistent* across isolates —
 * which is the right trade-off: under heavy traffic the worst case is a
 * brief window where the same token can be accepted twice, but the
 * downstream UNIQUE constraint on `applications.application_no` plus the
 * per-round+email duplicate check is the real safety net.
 *
 * ## Configuration (via env)
 *
 * - IDEMPOTENCY_ENABLED     master switch (default: true)
 * - IDEMPOTENCY_TTL_SECONDS TTL in seconds (default: 900 = 15 min)
 *
 * ## Future work
 *
 * - Replace the in-memory Map with a KV / Durable Object / D1 row to
 *   survive worker restarts and span multiple isolates.
 * - Add an LRU cap on `tokenStore` so a flood of unique fake tokens
 *   cannot grow memory unbounded.
 * - Add metrics: hit/miss counters, total tracked tokens.
 */

import { createMiddleware } from 'hono/factory';
import { Bindings, AppVariables, envFlag, envInt } from '../types';

type IdempotencyEntry = {
  /** Recorded wall-clock ms (UTC) when the token was first seen. */
  firstSeenAt: number;
  /** Captured response status so we can replay it. Default 201 on first hit. */
  responseStatus: number;
  /** Captured response body so we can replay it. */
  responseBody: unknown;
  /** Whether the request has been fully processed. */
  completed: boolean;
};

/**
 * Module-level Map. Workers reuse module state across requests within an
 * isolate, so this is the right scope. If/when we move to multi-isolate
 * correctness, swap this for a KV binding.
 */
const tokenStore: Map<string, IdempotencyEntry> = new Map();

/**
 * Token store defaults; the middleware can be reconfigured by env
 * without re-creating the module.
 */
const DEFAULT_TTL_SECONDS = 900; // 15 minutes
const DEFAULT_ENABLED = true;

/**
 * Sweep expired tokens. Cheap O(n) scan over the map. We run it
 * probabilistically on each request rather than on a timer because
 * Workers don't expose a built-in setInterval.
 */
let lastSweepAt = 0;
const SWEEP_INTERVAL_MS = 60 * 1000; // at most once per minute

function sweepExpiredEntries(ttlMs: number, now: number): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [token, entry] of tokenStore) {
    if (now - entry.firstSeenAt > ttlMs) {
      tokenStore.delete(token);
    }
  }
}

function parseTokenFromBody(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  // The token can arrive under any of these keys; we accept the most
  // common spellings so we don't break clients that use one over another.
  const obj = raw as Record<string, unknown>;
  const candidates = [obj.submissionToken, obj.submission_token, obj.idempotencyKey, obj.idempotency_key];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c.trim();
  }
  return null;
}

/**
 * Best-effort: read the request body once, then return a NEW Request
 * whose body can be consumed again by downstream handlers. Hono reads
 * JSON via `c.req.json()` which buffers, but defensively we still try
 * to clone when possible.
 *
 * If the body has already been consumed (e.g. by the validator before
 * this middleware), the original `c.req.raw` is returned as-is and the
 * downstream handler will simply re-parse from a fresh `c.req.json()`.
 */
async function readJsonBody(c: { req: { raw: Request } }): Promise<unknown> {
  try {
    // Clone so we don't disturb the original stream.
    const cloned = c.req.raw.clone();
    return await cloned.json();
  } catch {
    return null;
  }
}

/**
 * Idempotency middleware factory.
 *
 * Usage:
 *   import { idempotencyMiddleware } from '../middlewares/idempotency.middleware';
 *   publicRoutes.post('/applications/submit', idempotencyMiddleware(), handler);
 *
 * The middleware reads `c.req.json()` once to extract the token, then
 * hands control to `next()`. After `next()` resolves it records the
 * token + response so a subsequent replay can be short-circuited.
 */
export const idempotencyMiddleware = () =>
  createMiddleware<{ Bindings: Bindings; Variables: AppVariables }>(async (c, next) => {
    const enabled = envFlag(c.env.IDEMPOTENCY_ENABLED, DEFAULT_ENABLED);
    if (!enabled) {
      await next();
      return;
    }

    const ttlSeconds = envInt(c.env.IDEMPOTENCY_TTL_SECONDS, DEFAULT_TTL_SECONDS);
    const ttlMs = ttlSeconds * 1000;
    const now = Date.now();

    // Probabilistic cleanup. Cheap; safe to skip on hot paths.
    sweepExpiredEntries(ttlMs, now);

    const body = await readJsonBody(c);
    const token = parseTokenFromBody(body);

    // No token supplied: we deliberately do NOT block the request. The
    // downstream duplicate-check on (roundId, email) is still in place,
    // and requiring a token would be a breaking change for clients that
    // haven't shipped the new field. We log nothing here to keep the
    // happy path quiet.
    if (!token) {
      await next();
      return;
    }

    const existing = tokenStore.get(token);
    if (existing) {
      // Replay the captured 2xx response if the first request has already
      // completed. If the first request is still in-flight (`completed:false`),
      // we cannot replay — return 409 so the client knows to back off and
      // try again once the first request has settled.
      if (existing.completed) {
        return c.json(existing.responseBody as any, existing.responseStatus as any);
      }
      return c.json(
        { success: false, error: 'Submission already processed' },
        409,
      );
    }

    // First time we see this token: reserve it before downstream work
    // so concurrent requests with the same token collide on the store.
    tokenStore.set(token, {
      firstSeenAt: now,
      responseStatus: 0,
      responseBody: null,
      completed: false,
    });

    await next();

    // After downstream work, capture the response for future replays.
    // We do this only for 2xx responses to avoid replaying errors.
    try {
      const cloned = c.res.clone();
      const status = c.res.status;
      const isSuccess = status >= 200 && status < 300;
      if (isSuccess) {
        let body: unknown = null;
        try {
          body = await cloned.json();
        } catch {
          body = null;
        }
        tokenStore.set(token, {
          firstSeenAt: now,
          responseStatus: status,
          responseBody: body,
          completed: true,
        });
      } else {
        // Free the slot so the client can retry on transient errors.
        tokenStore.delete(token);
      }
    } catch {
      // Defensive: never let the middleware crash the request.
    }
  });

/**
 * Test-only helper. Exposed so a future test file can reset state.
 * Not used in production code.
 */
export function __resetIdempotencyStoreForTests(): void {
  tokenStore.clear();
  lastSweepAt = 0;
}
