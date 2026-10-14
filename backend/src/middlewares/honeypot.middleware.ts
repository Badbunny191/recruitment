/**
 * Honeypot Middleware
 * --------------------------------------------
 * The most basic anti-bot layer: a hidden form field that should *never*
 * be filled in by a real user. If the field is present and non-empty in
 * the request body, the request is dropped with HTTP 400.
 *
 * Why this works:
 *   - Real users never see the field, so they never fill it in.
 *   - Most naive bots auto-fill every input on the page.
 *
 * This is *not* a substitute for proper bot protection (Turnstile, etc.)
 * but it filters the noise cheaply and has zero impact on real users.
 *
 * ## Configuration (via env)
 *
 * - HONEYPOT_FIELD_NAME  the field name to look for (default: "website_url")
 *
 * The frontend intentionally does NOT render this field; the spec is for
 * the backend to be the authority. The field name is configurable so we
 * can rotate it without a code change.
 *
 * ## Behavior
 *
 * - Field absent OR empty string: pass through.
 * - Field present and non-empty: respond 400 with `{ success: false, error: "Bot detected" }`.
 *
 * Notes:
 * - The middleware reads `c.req.json()` *only* when the body looks like
 *   JSON. Multipart bodies (uploads) are passed through untouched so
 *   the existing upload route keeps working.
 */

import { createMiddleware } from 'hono/factory';
import { Bindings, AppVariables } from '../types';

const DEFAULT_HONEYPOT_FIELD = 'website_url';

async function tryReadJson(c: { req: { raw: Request; header: (name: string) => string | undefined } }): Promise<unknown> {
  const contentType = c.req.header('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) return null;
  try {
    const cloned = c.req.raw.clone();
    return await cloned.json();
  } catch {
    return null;
  }
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export const honeypotMiddleware = () =>
  createMiddleware<{ Bindings: Bindings; Variables: AppVariables }>(async (c, next) => {
    const fieldName = (c.env.HONEYPOT_FIELD_NAME || DEFAULT_HONEYPOT_FIELD).trim() || DEFAULT_HONEYPOT_FIELD;

    // Only inspect JSON bodies. For multipart (uploads) we skip; uploads
    // are not the bot-magnet that the form submission is.
    const body = await tryReadJson(c);
    if (!body || typeof body !== 'object') {
      await next();
      return;
    }

    const value = (body as Record<string, unknown>)[fieldName];
    if (!isEmpty(value)) {
      return c.json(
        {
          success: false,
          error: 'Bot detected',
        },
        400,
      );
    }

    await next();
  });
