'use client';

import { Button } from '@/components/ui/button';

/**
 * Back bar for the application form header (/apply).
 *
 * Navigates back to the round list page (`/`) — the closest thing to a
 * "round detail" page in this app (there is no dedicated
 * /rounds/[id] route; the round card on the home page IS the detail).
 * The parent owns the handler: it saves the draft with the SAME
 * mechanism as "ตรวจสอบข้อมูล" before navigating, so nothing the user
 * typed is lost.
 *
 * Exported (not inline in the page) so the markup contract — icon,
 * Thai label, aria-label, disabled state, error alert — is testable
 * with plain SSR rendering, following the repo's test conventions.
 */
export function ApplyBackBar({
  onBack,
  disabled = false,
  error = null,
}: {
  onBack: () => void;
  disabled?: boolean;
  error?: string | null;
}) {
  return (
    <div className="mb-4 space-y-2">
      <Button
        type="button"
        variant="outline"
        onClick={onBack}
        disabled={disabled}
        aria-label="กลับไปหน้ารายการรอบรับสมัคร"
        className="h-10 gap-2 px-3"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
          />
        </svg>
        กลับ
      </Button>
      {error && (
        <div
          role="alert"
          className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800"
        >
          {error}
        </div>
      )}
    </div>
  );
}
