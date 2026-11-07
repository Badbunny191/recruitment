'use client';

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
 * UX standard (public flow): back navigation is a Text Link
 * "← กลับหน้ารอบรับสมัคร" — same pattern as the /lookup back link —
 * not an outlined button, so it takes less space and does not compete
 * with the primary form actions. It stays a <button> element (not a
 * <Link>) because it runs the draft-save handler before navigating and
 * supports the disabled state while submitting.
 *
 * Exported (not inline in the page) so the markup contract — arrow,
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
      <button
        type="button"
        onClick={onBack}
        disabled={disabled}
        aria-label="กลับไปหน้ารายการรอบรับสมัคร"
        className="inline-flex items-center gap-1.5 text-sm text-brand hover:text-brand-hover font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none"
      >
        <span aria-hidden="true">←</span> กลับหน้ารอบรับสมัคร
      </button>
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
