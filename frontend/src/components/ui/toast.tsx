'use client';

/**
 * Toast Component (Lightweight)
 * --------------------------------
 * Simple Toast notification ที่ไม่ต้องพึ่ง external package
 *
 * ใช้งาน:
 *   - ใน root layout: <Toaster />
 *   - ใน component: const { showToast } = useToast();
 *                   showToast({ title: 'Saved', variant: 'success' });
 *
 * Features:
 *   - 4 variants: success, error, info, warning
 *   - auto-dismiss (default 4000ms)
 *   - multiple toasts stacked
 *   - animated (slide-in from top-right)
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

// =============================================================================
// Types
// =============================================================================

export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  duration?: number;
}

interface ToastContextValue {
  toasts: ToastItem[];
  showToast: (toast: Omit<ToastItem, 'id'>) => string;
  dismissToast: (id: string) => void;
}

// =============================================================================
// Context
// =============================================================================

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within <ToastProvider>');
  }
  return ctx;
}

/**
 * Toast แบบ optional — ไม่ throw ถ้าไม่มี ToastProvider
 *
 * ใช้ใน component ที่อาจถูก render นอก <ToastProvider> (เช่น unit test
 * หรือ preview ที่ mount เดี่ยว ๆ) → ถ้ามี provider ให้ใช้ได้ปกติ
 * ถ้าไม่มี → คืน null แล้วผู้เรียก fallback ไปใช้ inline feedback แทน
 */
export function useOptionalToast(): ToastContextValue | null {
  return React.useContext(ToastContext);
}

// =============================================================================
// Provider
// =============================================================================

let toastCounter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);

  const showToast = React.useCallback(
    (toast: Omit<ToastItem, 'id'>): string => {
      const id = `toast-${++toastCounter}-${Date.now()}`;
      const item: ToastItem = { id, duration: 4000, ...toast };
      setToasts((prev) => [...prev, item]);
      return id;
    },
    []
  );

  const dismissToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Auto-dismiss timers
  React.useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) => {
      return setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, t.duration ?? 4000);
    });
    return () => {
      timers.forEach((tm) => clearTimeout(tm));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toasts.map((t) => t.id).join('|')]);

  return (
    <ToastContext.Provider value={{ toasts, showToast, dismissToast }}>
      {children}
    </ToastContext.Provider>
  );
}

// =============================================================================
// Toaster (visual renderer)
// =============================================================================

const VARIANT_STYLES: Record<ToastVariant, { bg: string; border: string; text: string; icon: string }> = {
  success: {
    bg: 'bg-emerald-50',
    border: 'border-emerald-300',
    text: 'text-emerald-900',
    icon: '✅',
  },
  error: {
    bg: 'bg-red-50',
    border: 'border-red-300',
    text: 'text-red-900',
    icon: '❌',
  },
  info: {
    bg: 'bg-blue-50',
    border: 'border-blue-300',
    text: 'text-blue-900',
    icon: 'ℹ️',
  },
  warning: {
    bg: 'bg-amber-50',
    border: 'border-amber-300',
    text: 'text-amber-900',
    icon: '⚠️',
  },
};

export function Toaster() {
  const { toasts, dismissToast } = useToast();

  return (
    <div
      className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none"
      aria-live="polite"
      aria-atomic="true"
    >
      {toasts.map((t) => {
        const style = VARIANT_STYLES[t.variant];
        return (
          <div
            key={t.id}
            role="alert"
            className={cn(
              'pointer-events-auto rounded-lg border-2 shadow-lg overflow-hidden',
              'animate-in slide-in-from-top-5 fade-in duration-200',
              style.bg,
              style.border
            )}
          >
            <div className="flex items-start gap-3 p-3">
              <span className="text-lg shrink-0 leading-none mt-0.5">{style.icon}</span>
              <div className="flex-1 min-w-0">
                <p className={cn('font-semibold text-sm', style.text)}>{t.title}</p>
                {t.description && (
                  <p className={cn('text-xs mt-1 opacity-90', style.text)}>
                    {t.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismissToast(t.id)}
                className="shrink-0 text-slate-400 hover:text-slate-600 transition-colors"
                aria-label="Close"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}