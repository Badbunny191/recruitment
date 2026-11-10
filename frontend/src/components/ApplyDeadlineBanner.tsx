import { ClockIcon } from './ui/icons';
import {
  CLOSED_COUNTDOWN_TEXT,
  formatCountdown,
  formatCountdownMmSs,
  formatThaiCloseTime,
  type DeadlineBannerState,
} from '@/lib/public-rounds';

/**
 * Deadline banner — "เหลือเวลารับสมัครอีก" (ไม่มีนาฬิการะบบ)
 * =====================================================================
 * ผู้สมัครสนใจ "เหลือเวลาอีกเท่าไร" มากกว่า "ตอนนี้กี่โมง" (decision
 * 2026-11-11 หลังทดสอบจริง) — banner จึงแสดงเฉพาะ countdown + เวลาปิด
 * และ "เวลาระบบ" คงเหลือเฉพาะ error evidence block เป็นหลักฐาน
 *
 * แสดง 2 ที่:
 *   - หน้า /apply (context="apply")      ด้านบนฟอร์ม
 *   - หน้า /apply/review (context="review") เหนือปุ่ม "ยืนยันส่งใบสมัคร"
 *     (จุดสำคัญที่สุด — ผู้ใช้กำลังจะกดส่ง ต้องรู้ก่อนว่าเวลาเหลือเท่าไร)
 *
 * สถานะ (deadlineBannerState):
 *   info    → 15 นาที < เหลือ <= 1 ชม.   โทนสงบ (amber) บอกเวลาปิด
 *   warning → 5 นาที < เหลือ <= 15 นาที  เร่งเตือน (orange) ข้อความต่างกันตามหน้า
 *   final   → 0 < เหลือ <= 5 นาที        ตัวเลข MM:SS ใหญ่ (review ใหญ่กว่า)
 *   closed  → เหลือ <= 0                   "ปิดรับสมัครแล้ว"
 *   hidden  → ผู้เรียกไม่ควร render component นี้เลย (กันลืม: คืน null)
 *
 * เวลาทั้งหมดอิง server time (ผู้เรียกส่ง nowMs = นาฬิกาเครื่อง + offset
 * ที่ได้จาก serverTime ของ /rounds/:id/detail) — ห้ามคำนวณจาก browser time
 * ลอย ๆ และถ้า serverTime ไม่รู้ (fallback) ผู้เรียกต้องไม่ render ตัวนี้เลย
 */
export function ApplyDeadlineBanner({
  state,
  remainingMs,
  closeMs,
  nowMs,
  context = 'apply',
}: {
  state: DeadlineBannerState;
  remainingMs: number | null;
  closeMs: number | null;
  /** เวลา server ปัจจุบัน (นาฬิกาเครื่อง + offset) — ใช้เทียบ "วันเดียวกัน" */
  nowMs: number;
  /** apply = หน้าฟอร์ม, review = หน้าตรวจสอบก่อนส่ง (สลับข้อความ/ขนาด) */
  context?: 'apply' | 'review';
}) {
  if (state === 'hidden') return null;

  if (state === 'closed') {
    return (
      <div
        role="status"
        className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
      >
        <p className="flex items-center gap-1.5 font-semibold">
          <span aria-hidden="true">⚠️</span>
          {CLOSED_COUNTDOWN_TEXT}
        </p>
        <p className="mt-0.5 text-red-800">
          ระบบจะไม่รับใบสมัครที่ส่งหลังเวลาปิด — กรุณาตรวจสอบรอบรับสมัครถัดไป
        </p>
      </div>
    );
  }

  if (state === 'final') {
    // ตัวเลข MM:SS — สัญลักษณ์นาฬิกาถอยหลังอ่านเร็วกว่าข้อความในช่วงเร่งด่วน
    // review = จุดตัดสินใจสุดท้ายก่อนกดส่ง → ใหญ่กว่าสถานะอื่นชัดเจน
    const numberClass = context === 'review' ? 'text-3xl' : 'text-2xl';
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
      >
        <p className="flex items-center gap-1.5 font-semibold">
          <span aria-hidden="true">⚠️</span>
          เหลือเวลารับสมัครอีก
        </p>
        <p className={`mt-1 font-bold leading-none tabular-nums ${numberClass}`}>
          {remainingMs !== null ? formatCountdownMmSs(remainingMs) : '00:00'}
        </p>
      </div>
    );
  }

  if (state === 'warning') {
    return (
      <div
        role="alert"
        className="rounded-lg border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-900"
      >
        <p className="flex items-center gap-1.5 font-semibold">
          <span aria-hidden="true">⚠️</span>
          เหลือเวลารับสมัครอีก {remainingMs !== null ? formatCountdown(remainingMs) : '—'}
        </p>
        {context === 'review' ? (
          <p className="mt-0.5 text-orange-800">
            กรุณาตรวจสอบข้อมูลให้เรียบร้อย ก่อนกดยืนยันส่งใบสมัคร
          </p>
        ) : (
          <p className="mt-0.5 text-orange-800">
            กรุณาตรวจสอบข้อมูลให้ครบถ้วน ก่อน{closeMs !== null ? formatThaiCloseTime(closeMs, nowMs) : '—'}
          </p>
        )}
      </div>
    );
  }

  // info — 15 นาที < เหลือ <= 1 ชม. — โทนสงบ ไม่เร่งเร้า
  return (
    <div
      role="status"
      className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <p className="flex items-center gap-1.5 font-medium">
        <ClockIcon className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
        เหลือเวลารับสมัครอีก {remainingMs !== null ? formatCountdown(remainingMs) : '—'}
      </p>
      <p className="mt-0.5 text-amber-800">
        ระบบจะปิดรับสมัครอัตโนมัติ {closeMs !== null ? formatThaiCloseTime(closeMs, nowMs) : '—'}
      </p>
    </div>
  );
}
