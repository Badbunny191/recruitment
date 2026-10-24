/**
 * Rate Limit Middleware
 * --------------------------------------------
 * Lightweight per-IP, fixed-window rate limiter for hot public endpoints.
 *
 * The defaults are tuned for application submission: 5 requests / minute
 * per IP. This is plenty for legitimate users (form submit + a couple of
 * retries) and stops a single IP from hammering the API.
 *
 * ## How it works
 *
 * - In-memory `Map<ip, { count, windowStart }>`
 * - Fixed window of 60s
 * - On each request, look up the bucket for the client IP. If the window
 *   has expired, reset. If the count exceeds the limit, respond 429.
 * - The client IP is read from `cf-connecting-ip` (Cloudflare's edge
 *   header). This is set by Cloudflare and cannot be spoofed by the
 *   client.
 *
 * ## Configuration (via env)
 *
 * - RATE_LIMIT_ENABLED       master switch (default: true)
 * - RATE_LIMIT_PER_MINUTE    max requests per minute (default: 5)
 *
 * ## Limitations
 *
 * - In-memory state is per-isolate. Under high concurrency a determined
 *   attacker can spread across many isolates. Cloudflare Workers isolates
 *   are plentiful, but in practice this is the right trade-off for a
 *   foundation layer: the goal is to stop naive abuse, not to be a
 *   bullet-proof WAF.
 * - No per-route quotas yet. The factory accepts an `options` arg so we
 *   can add per-route overrides later.
 *
 * ## Future work
 *
 * - Move the bucket store to a Durable Object for global consistency.
 * - Add per-route limits (uploads vs submits).
 * - Add `Retry-After` header.
 */

import { createMiddleware } from 'hono/factory';
import { Bindings, AppVariables, envFlag, envInt } from '../types';

type Bucket = {
  count: number;
  /** UTC ms when the current window started. */
  windowStart: number;
};

const WINDOW_MS = 60 * 1000; // 1 minute fixed window

const DEFAULT_LIMIT = 5;
const DEFAULT_ENABLED = true;

const buckets: Map<string, Bucket> = new Map();

/**
 * Probabilistic cleanup so the map doesn't grow unbounded for a long
 * uptime.
 */
let lastSweepAt = 0;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const sweepExpiredBuckets = (now: number) => {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [ip, bucket] of buckets) {
    if (now - bucket.windowStart > WINDOW_MS) {
      buckets.delete(ip);
    }
  }
};

function getClientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  // Cloudflare edge sets this. Fall back to a constant if absent so
  // the limiter still works in local dev.
  const ip =
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
  return ip || 'unknown';
}

export type RateLimitOptions = {
  /** Optional per-route override; falls back to env. */
  perMinute?: number;
  /** Optional override for the env flag. */
  enabled?: boolean;
  /** Optional key prefix for per-route bucket isolation (e.g. 'lookup', 'submit'). */
  keyPrefix?: string;
};

/**
 * Rate limit middleware factory.
 *
 * Usage:
 *   import { rateLimitMiddleware } from '../middlewares/rate-limit.middleware';
 *   publicRoutes.post('/applications/submit', rateLimitMiddleware(), handler);
 */
export const rateLimitMiddleware = (options: RateLimitOptions = {}) =>
  createMiddleware<{ Bindings: Bindings; Variables: AppVariables }>(async (c, next) => {
    const enabled = options.enabled ?? envFlag(c.env.RATE_LIMIT_ENABLED, DEFAULT_ENABLED);
    if (!enabled) {
      await next();
      return;
    }

    const defaultLimit = options.keyPrefix === 'lookup'
      ? envInt(c.env.RATE_LIMIT_LOOKUP_PER_MINUTE, 30)
      : options.keyPrefix === 'admin-login'
        ? envInt(c.env.RATE_LIMIT_ADMIN_LOGIN_PER_MINUTE, 10)
        : envInt(c.env.RATE_LIMIT_PER_MINUTE, DEFAULT_LIMIT);
    const limit = options.perMinute ?? defaultLimit;
    const now = Date.now();

    sweepExpiredBuckets(now);

    const ip = getClientIp(c);
    const bucketKey = options.keyPrefix ? `${options.keyPrefix}:${ip}` : ip;
    const bucket = buckets.get(bucketKey);

    if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
      buckets.set(bucketKey, { count: 1, windowStart: now });
      await next();
      return;
    }

    if (bucket.count >= limit) {
      const retryAfter = Math.max(1, Math.ceil((WINDOW_MS - (now - bucket.windowStart)) / 1000));
      c.header('Retry-After', String(retryAfter));
      return c.json(
        {
          success: false,
          error: 'Too many requests. Please try again later.',
        },
        429,
      );
    }

    bucket.count += 1;
    await next();
  });

/**
 * Test-only helper.
 */
export function __resetRateLimitStoreForTests(): void {
  buckets.clear();
  lastSweepAt = 0;
}
