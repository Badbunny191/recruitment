import { ClockIcon } from './ui/icons';
import {
  CLOSED_COUNTDOWN_TEXT,
  formatCountdown,
  formatThaiClock,
  formatThaiCloseTime,
  type DeadlineBannerState,
} from '@/lib/public-rounds';

/**
 * Deadline banner บนหน้าฟอร์มสมัคร — แสดงเฉพาะเมื่อเหลือ <= 1 ชั่วโมง
 * =====================================================================
 * ผู้สมัครกรอกฟอร์ม + อัปโหลดเอกสารกินเวลา 10-30+ นาที แต่เดิมฟอร์มที่
 * เปิดอยู่ไม่แสดงข้อมูลเวลาคงเหลือใด ๆ — ผู้ใช้รู้ตัวอีกทีตอน submit
 * โดน 403 ปิดรับสมัคร (gate ฝั่ง server ปิดสนิทอยู่แล้ว หน้าฟอร์มจึงมี
 * หน้าที่เตือนให้ทัน ไม่ใช่ปล่อยให้ gate ตัดสินแทน)
 *
 * สถานะ (deadlineBannerState):
 *   info    → 15 นาที < เหลือ <= 1 ชม.   โทนสงบ (amber) บอกเวลาปิด
 *   warning → 5 นาที < เหลือ <= 15 นาที  เร่งเตือน (orange)
 *   final   → 0 < เหลือ <= 5 นาที        countdown วินาที + เวลาระบบวินาที
 *   closed  → เหลือ <= 0                   "ปิดรับสมัครแล้ว" — ไม่มีนาฬิกา
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
}: {
  state: DeadlineBannerState;
  remainingMs: number | null;
  closeMs: number | null;
  /** เวลา server ปัจจุบัน (นาฬิกาเครื่อง + offset) — ใช้เทียบ "วันเดียวกัน" */
  nowMs: number;
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
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
      >
        <p className="flex items-center gap-1.5 font-semibold">
          <span aria-hidden="true">⚠️</span>
          เหลือเวลารับสมัครอีก
        </p>
        <p className="mt-1 text-2xl font-bold leading-tight tabular-nums">
          {remainingMs !== null ? formatCountdown(remainingMs) : '—'}
        </p>
        <p className="mt-1.5 flex items-center gap-1 text-xs font-medium tabular-nums">
          <ClockIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>เวลาระบบ {formatThaiClock(nowMs, { seconds: true })}</span>
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
        <p className="mt-0.5 text-orange-800">
          กรุณาตรวจสอบข้อมูลและส่งใบสมัคร ก่อน{closeMs !== null ? formatThaiCloseTime(closeMs, nowMs) : '—'}
        </p>
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
        ระบบจะปิดรับสมัครอัตโนมัติ {closeMs !== null ? formatThaiCloseTime(closeMs, nowMs) : '—'} ตามเวลาระบบ
      </p>
    </div>
  );
}
