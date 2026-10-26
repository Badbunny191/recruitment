'use client';

import { Button } from '@/components/ui/button';

/**
 * "ล้างข้อมูลทั้งหมด" สำหรับหน้าสมัคร (/apply) — วางใต้ปุ่ม "ตรวจสอบข้อมูล"
 *
 * ปุ่มนี้เป็นแค่ presentational: caller เป็นเจ้าของการยืนยัน (confirm) และ
 * การล้างจริง (resetApplySession + React state) เพื่อให้ markup contract —
 * ข้อความ, aria-label, disabled, busy — ทดสอบด้วย SSR ได้ตามรูปแบบ
 * ApplyBackBar ของ repo
 */
export function ApplyResetBar({
  onReset,
  disabled = false,
  busy = false,
}: {
  onReset: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <div className="mt-3">
      <Button
        type="button"
        variant="outline"
        onClick={onReset}
        disabled={disabled || busy}
        aria-label="ล้างข้อมูลทั้งหมด"
        aria-busy={busy}
        className="w-full h-11 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
      >
        {busy ? (
          <span className="flex items-center gap-2">
            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            กำลังล้างข้อมูล...
          </span>
        ) : (
          'ล้างข้อมูลทั้งหมด'
        )}
      </Button>
    </div>
  );
}
