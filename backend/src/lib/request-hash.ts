/**
 * Request Hash Utilities (Idempotency Replay Guard)
 * --------------------------------------------
 * Computes a deterministic SHA-256 fingerprint of a JSON request payload
 * so the idempotency middleware can tell an exact replay apart from a
 * *different* request that reuses the same submissionToken.
 *
 * ## Stable JSON serialization
 *
 * Object keys are sorted recursively before serialization, so the same
 * logical payload always produces the same hash regardless of the order
 * the client serialized its keys in. Array order is preserved —
 * `[1, 2]` and `[2, 1]` are different payloads, which matches the
 * semantics of form data arrays (e.g. ordered rows).
 *
 * `undefined` object values are skipped (same as JSON.stringify).
 * Inside arrays `undefined` becomes `null` to keep positions stable.
 *
 * ## Runtime
 *
 * Uses the Web Crypto `crypto.subtle` global, which exists both in the
 * Workers runtime (workerd) and in Node >= 19, so the same code path is
 * exercised in unit tests without shims.
 */

/** Keys that carry the idempotency token itself; excluded from the hash. */
export const IDEMPOTENCY_TOKEN_KEYS = [
  'submissionToken',
  'submission_token',
  'idempotencyKey',
  'idempotency_key',
] as const;

/**
 * Serialize a JSON-like value with object keys sorted recursively.
 * The output is valid JSON and deterministic for a given logical value.
 */
export function stableStringify(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => (item === undefined ? null : serialize(item)));
    return `[${items.join(',')}]`;
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${serialize(obj[k])}`);
    return `{${parts.join(',')}}`;
  }
  // Functions / symbols / bigint cannot appear in a parsed JSON body.
  // Fall back to a stable string form rather than throwing.
  return JSON.stringify(String(value));
}

/**
 * SHA-256 of the stable serialization, hex-encoded.
 */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Strip idempotency token fields from the payload before hashing so the
 * fingerprint describes the *submission content* only. This keeps the
 * hash comparable even if a client moves the token between the
 * camelCase and snake_case spellings across retries.
 */
export function stripIdempotencyTokenFields(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if ((IDEMPOTENCY_TOKEN_KEYS as readonly string[]).includes(key)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Full pipeline used by the idempotency middleware:
 * payload → (strip token fields) → stable stringify → SHA-256 hex.
 * Returns `null` when no hashable payload is available (e.g. the body
 * could not be parsed as JSON); callers treat `null` as "unknown".
 */
export async function computeRequestHash(payload: unknown): Promise<string | null> {
  if (payload === null || payload === undefined) return null;
  try {
    const normalized = stripIdempotencyTokenFields(payload);
    return await sha256Hex(stableStringify(normalized));
  } catch {
    return null;
  }
}
