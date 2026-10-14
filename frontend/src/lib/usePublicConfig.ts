/**
 * usePublicConfig — runtime config hook
 * --------------------------------------------
 * PR #1 backend added `GET /api/v1/public/config` which returns
 * non-secret environment values the frontend needs at runtime (e.g. the
 * Cloudflare Turnstile site key, when the widget is enabled).
 *
 * This hook fetches that endpoint once and exposes the typed result.
 * Per the PR #2 spec we are NOT implementing Turnstile yet — we just
 * need the structure in place so PR #3 can flip the switch without a
 * frontend refactor.
 *
 * Behavior:
 *   - On first mount: fetch `/public/config`, cache the result in
 *     `useState`.
 *   - On error: keep `config === null`, surface `error` for the caller.
 *   - On a 5xx: do NOT block the page. Render as if Turnstile is
 *     disabled — the safest fallback.
 *   - Cache-friendly: we set `cache: 'no-store'` to avoid Next.js data
 *     cache confusing the runtime nature of the values, but the
 *     backend sends `Cache-Control: public, max-age=60` so the network
 *     layer can coalesce.
 */

'use client';

import { useEffect, useState } from 'react';

export type PublicConfig = {
  turnstile: {
    enabled: boolean;
    siteKey: string;
  };
};

type State =
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: PublicConfig; error: null }
  | { status: 'error'; data: PublicConfig; error: string };

/**
 * Default config used when the endpoint is unreachable. The whole point
 * of the public-config endpoint is that the *backend* decides whether
 * Turnstile is enabled; if the network call fails we deliberately
 * treat Turnstile as disabled to keep the page functional. Failing
 * closed (forcing all users to pass Turnstile) would lock legitimate
 * users out during a backend incident.
 */
const FALLBACK_CONFIG: PublicConfig = {
  turnstile: { enabled: false, siteKey: '' },
};

function getApiBase(): string {
  // Mirror the convention used elsewhere in the codebase.
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787/api/v1';
}

export function usePublicConfig(): State {
  const [state, setState] = useState<State>({ status: 'loading', data: null, error: null });

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    fetch(`${getApiBase()}/public/config`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((body: { success: boolean; data?: PublicConfig }) => {
        if (cancelled) return;
        if (body && body.success && body.data && body.data.turnstile) {
          // Trust the backend's notion of "effectively enabled" (it
          // already checks that siteKey is non-empty).
          setState({ status: 'ready', data: body.data, error: null });
        } else {
          // Unexpected shape — fall back to safe defaults.
          setState({ status: 'ready', data: FALLBACK_CONFIG, error: null });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message = err instanceof Error ? err.message : 'Failed to load public config';
        // Fall back to safe defaults so the rest of the page still works.
        // Surface the error so the page *can* opt to show a banner.
        setState({ status: 'error', data: FALLBACK_CONFIG, error: message });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return state;
}
