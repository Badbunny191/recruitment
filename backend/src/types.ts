import { D1Database, R2Bucket } from '@cloudflare/workers-types';

/**
 * Cloudflare Workers bindings + vars.
 *
 * The `DB`/`R2_BUCKET`/`JWT_SECRET` fields are required existing
 * bindings. The new fields are optional plain-vars (all default to safe
 * values in the middlewares/utils that read them), so the worker keeps
 * booting even when an environment has not yet configured them.
 *
 * Each "feature flag" env var follows the pattern: `<NAME>_ENABLED`
 * with a safe default of "off", so a fresh environment is the most
 * permissive while still respecting the application's blast radius.
 */
export type Bindings = {
  DB: D1Database;
  R2_BUCKET: R2Bucket;
  JWT_SECRET: string;

  // ============================================================
  //  Anti-bot / hardening feature flags (PR #1)
  //  All optional — safe defaults applied at the call site.
  // ============================================================

  /** Honeypot form field name. Defaults to "website_url" in the middleware. */
  HONEYPOT_FIELD_NAME?: string;

  /** Master switch for the per-IP rate limiter. Default: "true". */
  RATE_LIMIT_ENABLED?: string;
  /** Max requests per window per IP. Default: 5. */
  RATE_LIMIT_PER_MINUTE?: string;

  /** Master switch for the idempotency layer. Default: "true". */
  IDEMPOTENCY_ENABLED?: string;
  /** TTL for idempotency tokens in seconds. Default: 900 (15 min). */
  IDEMPOTENCY_TTL_SECONDS?: string;

  // Cloudflare Turnstile (foundation only — verification not implemented yet)
  /** Master switch for the Turnstile widget on the frontend. Default: "false". */
  TURNSTILE_ENABLED?: string;
  /** Public site key sent to the browser via /public/config. Default: "". */
  TURNSTILE_SITE_KEY?: string;
  /** Server-side secret used to verify tokens. Default: "". */
  TURNSTILE_SECRET_KEY?: string;
};

export type AppVariables = {
  jwtPayload: {
    id: string;
    email: string;
    role: string;
    mustChangePassword?: boolean;
  };
};

/**
 * User roles enum - for type safety
 */
export const USER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'REVIEWER', 'VIEWER'] as const;
export type UserRole = typeof USER_ROLES[number];

/**
 * JWT payload type
 */
export interface JWTPayload {
  id: string;
  email: string;
  role: string;
  mustChangePassword?: boolean;
  iat?: number;
  exp?: number;
}

/**
 * Returns a boolean env flag with a default value. Accepts the usual
 * "true"/"1"/"yes" set as truthy and everything else as falsy. We keep
 * the parser tiny and inline so workers don't pay the cost of an extra
 * import for a one-liner.
 */
export function envFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === null) return defaultValue;
  const v = String(value).trim().toLowerCase();
  if (v === '' ) return defaultValue;
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

/**
 * Returns an integer env var with a default value. Returns the default
 * if the value is missing or not a valid positive integer.
 */
export function envInt(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value === null) return defaultValue;
  const n = Number.parseInt(String(value).trim(), 10);
  return Number.isFinite(n) ? n : defaultValue;
}
