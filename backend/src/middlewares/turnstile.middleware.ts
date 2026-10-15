/**
 * Turnstile Verification Middleware
 * --------------------------------------------
 * PR #3 — Cloudflare Turnstile verification on the public application
 * submit endpoint. Sits behind the existing idempotency / rate-limit /
 * honeypot middleware chain so cheap layers stay cheap and only
 * legitimate-looking traffic reaches the (relatively expensive)
 * siteverify round-trip.
 *
 * ## Behavior
 *
 * The middleware has four observable states driven by the env flag
 * `TURNSTILE_ENABLED`:
 *
 *   - **`TURNSTILE_ENABLED=false`** (default) → no-op. Pass through.
 *     The form submits as before. This is the PR contract: flipping the
 *     env to `true` is the *only* change required to turn the gate on.
 *
 *   - **`TURNSTILE_ENABLED=true` and the request lacks a `turnstileToken`**
 *     → respond **HTTP 403** with `{ success: false, error: "Human
 *     verification failed" }`. This is the same shape the PR spec asks
 *     for so the frontend's existing submit-error surface picks it up
 *     without special-casing.
 *
 *   - **`TURNSTILE_ENABLED=true`, token present, verification SUCCESS**
 *     → pass through. The downstream `idempotencyMiddleware` and the
 *     submit handler run as if the flag were off.
 *
 *   - **`TURNSTILE_ENABLED=true`, token present, verification FAIL**
 *     → also **HTTP 403** with the same error message. We deliberately
 *     do NOT distinguish between "missing token" and "bad token" to
 *     the client — that's a side-channel that helps attackers tune
 *     their bots.
 *
 * ## Why we fail closed here
 *
 * Even though the default state is fail-open (`TURNSTILE_ENABLED=false`),
 * the *moment* the operator flips the switch to `true`, every request
 * MUST carry a valid token. We never want a regression where the env
 * says "enabled" but the middleware accepts unverified submissions.
 * That's how logs get filled with junk data later.
 *
 * ## Token name
 *
 * The frontend widget calls our callback with a `cf-turnstile-response`
 * by default. We deliberately accept both `turnstileToken` (PR spec) and
 * `cf-turnstile-response` (Cloudflare default) so the rendered widget
 * works whether or not we rename the POST field.
 *
 * ## Failure handling on Cloudflare 5xx
 *
 * Cloudflare's siteverify is rock-solid in practice, but we still
 * defend against transient failures. If the siteverify round-trip itself
 * throws (network error, 5xx, timeout), we respond 403 with a slightly
 * different log message but the same body shape, so the user retries
 * without us having built a complex "site is down, please try later"
 * UX. A flaky Turnstile is an operational issue, not something we try to
 * paper over at the submit boundary.
 */

import { createMiddleware } from 'hono/factory';
import { Bindings, AppVariables, envFlag } from '../types';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Try to read the JSON body without consuming the original stream for
 * downstream handlers. We need `turnstileToken` AND we need the
 * downstream `zValidator` to be able to parse the body, so cloning
 * the Request is the safe pattern.
 *
 * If the body is not JSON (e.g. multipart upload) we return null and
 * let downstream decide. In practice the submit endpoint is JSON-only
 * because all file attachments are URL-based, but we don't rely on it.
 */
async function readBody(c: { req: { raw: Request; header: (name: string) => string | undefined } }): Promise<unknown> {
  const contentType = c.req.header('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) return null;
  try {
    const cloned = c.req.raw.clone();
    return await cloned.json();
  } catch {
    return null;
  }
}

function extractToken(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const obj = body as Record<string, unknown>;
  // PR spec key first; Cloudflare's default callback key second.
  const candidates: unknown[] = [obj.turnstileToken, obj['cf-turnstile-response']];
  for (const v of candidates) {
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}

function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    ''
  );
}

type SiteverifyResponse = {
  success: boolean;
  /** ISO timestamps for the challenge, if any. */
  challenge_ts?: string;
  /** Hostname of the page that served the challenge. */
  hostname?: string;
  /** Action that triggered the challenge (when the widget was rendered with one). */
  action?: string;
  /** Client-side data the widget passed back (cData). */
  cdata?: string;
  /** Error codes returned by Cloudflare, if any. */
  'error-codes'?: string[];
};

/**
 * Run the actual siteverify round-trip. Kept as a small exported helper
 * so we (or a future test) can stub it without spinning up Hono.
 *
 * Cloudflare's siteverify accepts `application/x-www-form-urlencoded`
 * per their docs. We use `URLSearchParams` which produces exactly that
 * wire format.
 */
export async function verifyTurnstileToken(args: {
  secret: string;
  token: string;
  remoteIp?: string;
  fetchImpl?: typeof fetch;
}): Promise<SiteverifyResponse> {
  const doFetch = args.fetchImpl ?? fetch;
  const form = new URLSearchParams();
  form.set('secret', args.secret);
  form.set('response', args.token);
  if (args.remoteIp) form.set('remoteip', args.remoteIp);

  const res = await doFetch(SITEVERIFY_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });

  if (!res.ok) {
    // Treat any non-2xx from siteverify as a hard failure. We don't
    // distinguish "challenge service temporarily down" from "bad token"
    // in the response body — that's an ops vs security trade-off and
    // security wins here.
    throw new Error(`siteverify HTTP ${res.status}`);
  }

  return (await res.json()) as SiteverifyResponse;
}

/**
 * Turnstile verification middleware factory.
 *
 * Usage:
 *   import { turnstileMiddleware } from '../middlewares/turnstile.middleware';
 *   publicRoutes.post(
 *     '/applications/submit',
 *     honeypotMiddleware(),
 *     rateLimitMiddleware(),
 *     idempotencyMiddleware(),
 *     turnstileMiddleware(),
 *     zValidator('json', ApplicationSubmitSchema),
 *     handler,
 *   );
 *
 * Disabled-by-default semantics: if `TURNSTILE_ENABLED` is unset / `false`,
 * the middleware is a no-op and downstream code runs unchanged. This is
 * the contract that lets operators roll the gate on / off via the
 * Cloudflare Dashboard without redeploying.
 */
export const turnstileMiddleware = () =>
  createMiddleware<{ Bindings: Bindings; Variables: AppVariables }>(async (c, next) => {
    const enabled = envFlag(c.env.TURNSTILE_ENABLED, false);
    if (!enabled) {
      await next();
      return;
    }

    const secret = (c.env.TURNSTILE_SECRET_KEY ?? '').trim();
    // If the operator enabled the flag but forgot to set the secret,
    // fail closed. We *cannot* verify anything without the secret, and
    // silently passing the request would defeat the point of the flag.
    if (!secret) {
      console.error('turnstileMiddleware: TURNSTILE_ENABLED=true but TURNSTILE_SECRET_KEY is empty');
      return c.json(
        { success: false, error: 'Human verification failed' },
        403,
      );
    }

    const body = await readBody(c);
    const token = extractToken(body);

    if (!token) {
      return c.json(
        { success: false, error: 'Human verification failed' },
        403,
      );
    }

    let result: SiteverifyResponse;
    try {
      result = await verifyTurnstileToken({
        secret,
        token,
        remoteIp: clientIp(c),
      });
    } catch (err) {
      console.error('turnstileMiddleware: siteverify error', err);
      return c.json(
        { success: false, error: 'Human verification failed' },
        403,
      );
    }

    if (!result.success) {
      console.warn('turnstileMiddleware: token rejected', {
        errorCodes: result['error-codes'] ?? [],
      });
      return c.json(
        { success: false, error: 'Human verification failed' },
        403,
      );
    }

    await next();
  });
