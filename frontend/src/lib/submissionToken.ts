/**
 * Submission Token — sessionStorage helper
 * --------------------------------------------
 * PR #1 backend (idempotency middleware) expects a `submissionToken` field
 * on `POST /public/applications/submit`. The token must:
 *   - be generated exactly once per "apply session" (i.e. per browser tab)
 *   - survive navigation between /apply and /apply/review
 *   - be cleared on a successful submit
 *   - be reused on retry (so the backend can dedupe)
 *
 * `sessionStorage` is the right scope:
 *   - it survives same-tab navigation (unlike `useState`)
 *   - it is per-tab (unlike `localStorage`) — closing the tab clears it,
 *     which is what the spec wants
 *   - it does NOT survive across tabs — a different tab generating a new
 *     token is the correct UX
 *
 * If the browser is blocking sessionStorage (e.g. third-party iframe,
 * Safari private mode) we silently fall back to a module-level Map so
 * the page still works. The token is still scoped to the JS context.
 */

const STORAGE_KEY = 'submissionToken';
const memoryFallback: Map<string, string> = new Map();

function isStorageAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const probe = '__probe__';
    window.sessionStorage.setItem(probe, probe);
    window.sessionStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

const useFallback = !isStorageAvailable();

/**
 * UUID v4 generator. Uses `crypto.randomUUID` when available (all modern
 * browsers + Cloudflare Workers), falls back to a manual v4 implementation
 * for older runtimes. We intentionally avoid pulling in the `uuid` package
 * for a 10-line function.
 */
function uuidv4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC 4122 v4 fallback. `getRandomValues` is available everywhere we
  // care about (browsers + Workers).
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') + '-' +
    hex.slice(4, 6).join('') + '-' +
    hex.slice(6, 8).join('') + '-' +
    hex.slice(8, 10).join('') + '-' +
    hex.slice(10, 16).join('')
  );
}

/**
 * Read the existing token from sessionStorage, or create a new one and
 * store it. The token is generated **once** per browser tab and reused
 * on every subsequent call within the same tab.
 *
 * Safe to call from React `useEffect` (no-op on the server during SSR).
 */
export function getOrCreateSubmissionToken(): string {
  if (typeof window === 'undefined') return '';
  const existing = readSubmissionToken();
  if (existing) return existing;
  const fresh = uuidv4();
  writeSubmissionToken(fresh);
  return fresh;
}

/**
 * Read the existing token. Returns null if none has been generated.
 * Use `getOrCreateSubmissionToken` if you need a guaranteed token.
 */
export function readSubmissionToken(): string | null {
  if (typeof window === 'undefined') return null;
  if (useFallback) {
    return memoryFallback.get(STORAGE_KEY) ?? null;
  }
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Write a token. Most callers should use `getOrCreateSubmissionToken`
 * instead — this is exposed for tests and for the (rare) case where the
 * server returns a token the client should adopt.
 */
export function writeSubmissionToken(token: string): void {
  if (typeof window === 'undefined') return;
  if (useFallback) {
    memoryFallback.set(STORAGE_KEY, token);
    return;
  }
  try {
    window.sessionStorage.setItem(STORAGE_KEY, token);
  } catch {
    memoryFallback.set(STORAGE_KEY, token);
  }
}

/**
 * Remove the token. Call this on a successful submit, or when the user
 * cancels the apply flow.
 */
export function clearSubmissionToken(): void {
  if (typeof window === 'undefined') return;
  if (useFallback) {
    memoryFallback.delete(STORAGE_KEY);
    return;
  }
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    memoryFallback.delete(STORAGE_KEY);
  }
}

/**
 * Test-only helper. Not used in production code.
 */
export function __resetSubmissionTokenForTests(): void {
  memoryFallback.clear();
  if (typeof window !== 'undefined' && !useFallback) {
    try { window.sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }
}
