'use client';

/**
 * TurnstileWidget — Cloudflare Turnstile widget host
 * --------------------------------------------
 * PR #3 — renders the Cloudflare Turnstile widget ONLY when the
 * `usePublicConfig()` hook reports `turnstile.enabled === true`. When
 * the flag is off (the default) the component renders nothing and the
 * submit flow runs as before.
 *
 * ## Behavior
 *
 *   - On mount, if the feature flag says "enabled" AND we have a
 *     `siteKey`, we lazy-load
 *     `https://challenges.cloudflare.com/turnstile/v0/api.js` (idempotent
 *     — idempotency guards against double-loading in StrictMode).
 *   - After the script is loaded, we call `window.turnstile.render(...)`
 *     with our site key and an explicit callback that captures the
 *     issued token back into the parent component.
 *   - On `expired-callback`, we clear the parent's `turnstileToken` so
 *     the user is forced to interact with the widget again before
 *     submit.
 *   - On unmount, we call `window.turnstile.remove(widgetId)` to free
 *     the DOM slot. This matters in React StrictMode where effects
 *     run twice in dev.
 *
 * ## Render location
 *
 * The Review page places this widget *above* the "ยืนยันข้อมูล"
 * checkbox so the user encounters verification BEFORE the final
 * confirmation step, matching the PR spec.
 *
 * ## Why "implicit" rendering
 *
 * Cloudflare Turnstile supports both explicit (`render()`) and implicit
 * (`<div class="cf-turnstile" data-sitekey="..." />`) modes. We use
 * explicit so we can:
 *   - Pass our `onVerify` callback without Data-CF-* attributes leaking
 *     into the rendered HTML.
 *   - Wire `expired-callback` and `error-callback` cleanly.
 *   - Tear down the widget on unmount.
 */

import { useEffect, useId, useRef } from 'react';
import { usePublicConfig } from '@/lib/usePublicConfig';

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback?: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: () => void;
          action?: string;
          cdata?: string;
          theme?: 'light' | 'dark' | 'auto';
          language?: 'th' | 'en' | 'auto';
        },
      ) => string;
      remove: (widgetId: string) => void;
      reset: (widgetId?: string) => void;
    };
  }
}

const TURNSTILE_SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type Props = {
  /**
   * Called with the issued token when the user passes verification.
   * In `TURNSTILE_ENABLED=false` mode this is never invoked, so the
   * caller may leave it as `() => {}`.
   */
  onVerify: (token: string) => void;
  /** Called when the token expires; the caller should clear its state. */
  onExpire?: () => void;
  /** Called when the widget reports an error (network, bad key, …). */
  onError?: () => void;
};

export function TurnstileWidget({ onVerify, onExpire, onError }: Props) {
  const publicConfig = usePublicConfig();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  // Use React's useId so each widget instance has a stable container id,
  // even if a future caller mounts more than one (we don't, but cheap
  // future-proofing).
  const reactId = useId();
  const containerId = `cf-turnstile-${reactId.replace(/:/g, '')}`;

  // Script load — runs once. Multiple calls in StrictMode are guarded
  // by the `loaded` flag stored on `window`, which also guards against
  // double-loading if a different component also pulls it in later.
  useEffect(() => {
    if (publicConfig.status === 'loading' || publicConfig.status === 'error') {
      // Don't attempt to render until config resolves. Public config
      // hook defaults to safe (turn-disabled) values, so we can render
      // safely without mounting the widget.
      return;
    }
    if (!publicConfig.data.turnstile.enabled) return;
    const siteKey = publicConfig.data.turnstile.siteKey;
    if (!siteKey) return;

    let cancelled = false;

    const renderWidget = () => {
      if (cancelled) return;
      if (!window.turnstile || !containerRef.current) return;
      // If we already rendered (StrictMode double-invoke), don't render
      // again. The widget id is our proof.
      if (widgetIdRef.current) return;
      const id = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token) => onVerify(token),
        'expired-callback': () => onExpire?.(),
        'error-callback': () => onError?.(),
        // Pin the action string so analytics / Cloudflare dashboard can
        // segment "apply submit" challenges from anything else.
        action: 'apply_submit',
        theme: 'auto',
        language: 'auto',
      });
      widgetIdRef.current = id;
    };

    type WinWithLoader = Window & { __turnstileScriptPromise?: Promise<void> };
    const w = window as WinWithLoader;
    if (w.__turnstileScriptPromise) {
      // Already in-flight or already loaded.
      w.__turnstileScriptPromise.then(renderWidget).catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }

    if (window.turnstile) {
      // Script already loaded by someone else (cached across HMR? rare).
      w.__turnstileScriptPromise = Promise.resolve();
      renderWidget();
      return () => {
        cancelled = true;
      };
    }

    w.__turnstileScriptPromise = new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(
        `script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]`,
      );
      if (existing) {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('script load error')));
        return;
      }
      const script = document.createElement('script');
      script.src = TURNSTILE_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('script load error'));
      document.head.appendChild(script);
    });

    w.__turnstileScriptPromise.then(renderWidget).catch(() => undefined);

    return () => {
      cancelled = true;
    };
    // The verify / expire / error callbacks are captured by reference.
    // We deliberately do NOT re-render the widget when those change —
    // if a parent passes new function refs (common in React) we don't
    // want to clobber the user's in-progress challenge.
    // We pull the values out of the discriminated union so TypeScript
    // knows they're defined inside the body.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    publicConfig.status,
    publicConfig.status === 'ready' ? publicConfig.data.turnstile.enabled : false,
    publicConfig.status === 'ready' ? publicConfig.data.turnstile.siteKey : '',
  ]);

  // Tear down on unmount (StrictMode dev double-call included).
  useEffect(() => {
    return () => {
      const id = widgetIdRef.current;
      if (id && window.turnstile) {
        try {
          window.turnstile.remove(id);
        } catch {
          /* ignore */
        }
        widgetIdRef.current = null;
      }
    };
  }, []);

  // Decide whether to render anything.
  if (publicConfig.status === 'loading') {
    // While config is still in flight, render a placeholder so the
    // layout doesn't jump. We do NOT show a Turnstile placeholder
    // (which Cloudflare would call an "invisible container") because
    // the script is not loaded yet.
    return (
      <div
        aria-hidden="true"
        className="h-[65px] rounded-md border border-dashed border-slate-200 bg-slate-50 animate-pulse"
      />
    );
  }

  if (!publicConfig.data.turnstile.enabled || !publicConfig.data.turnstile.siteKey) {
    return null;
  }

  return (
    <div className="space-y-1">
      <div id={containerId} ref={containerRef} />
      <p className="text-xs text-slate-500">
        ระบบจะตรวจสอบว่าท่านไม่ใช่โปรแกรมอัตโนมัติก่อนส่งใบสมัคร
      </p>
    </div>
  );
}
