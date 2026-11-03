// =============================================================
//  Round Lifecycle — แหล่งความจริงเดียวของ "สถานะที่ผู้ใช้เห็น"
//
//  ทำไมต้องมีไฟล์นี้
//  หน้า admin/rounds เดิมนับ "ใช้งานอยู่" ด้วย status === 'ACTIVE' ล้วน
//  แต่ backend (public.routes.ts → evaluateRound) ตัดสินว่า "เปิดรับสมัคร"
//  ก็ต่อเมื่อ status === 'ACTIVE' **และ** เวลาปัจจุบันอยู่ในช่วง openDate..closeDate
//  ตามเวลา Asia/Bangkok
//
//  ผลคือรอบที่เลย closeDate ไปแล้วยังถูกนับเป็น "ใช้งานอยู่" ทั้งที่ผู้สมัคร
//  สมัครไม่ได้แล้ว — ตัวเลขบนจอแอดมินไม่ตรงกับความจริงที่ระบบบังคับใช้
//
//  ไฟล์นี้ mirror กติกาเดียวกับ:
//    - backend/src/routes/public.routes.ts  (evaluateRound)
//    - frontend/src/app/(public)/page.tsx   (computeLifecycle)
//
//  ⚠️ ถ้าแก้กติกาเปิด/ปิดที่ backend ต้องแก้ไฟล์นี้และหน้า public พร้อมกัน
// =============================================================

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * สถานะ lifecycle ที่ผู้ใช้เห็นบน Summary Card
 * - OPEN      = ACTIVE + อยู่ในช่วงวันเปิด/ปิด → สมัครได้จริงตอนนี้
 * - SCHEDULED = ACTIVE + ยังไม่ถึงวันเปิด → ประกาศแล้วแต่ยังรับไม่ได้
 * - DRAFT     = ยังไม่ประกาศ
 * - CLOSED    = ปิดรับแล้ว (รวม ACTIVE ที่เลย closeDate และแถวที่อ่านสถานะไม่ได้)
 */
export type RoundLifecycle = 'OPEN' | 'DRAFT' | 'CLOSED' | 'SCHEDULED';

/** รูปร่างขั้นต่ำที่ต้องใช้ตัดสิน lifecycle (ไม่ผูกกับ interface ของหน้าใดหน้าหนึ่ง) */
export interface RoundLifecycleInput {
  status: string | null | undefined;
  openDate: string | number | Date | null | undefined;
  closeDate: string | number | Date | null | undefined;
}

const toEpochMs = (value: string | number | Date | null | undefined): number | null => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

/**
 * แปลงรอบ 1 แถว → lifecycle ที่ผู้ใช้เห็น
 *
 * - DRAFT / CLOSED มาจาก status ตรง ๆ (short-circuit ก่อนเทียบวันที่ เหมือน backend)
 * - ACTIVE ต้องเทียบช่วงเวลา: ก่อน openDate = SCHEDULED, หลัง closeDate = CLOSED
 * - status แปลก/null → CLOSED (defensive: ให้ผลรวมยังครบ ไม่มีแถวหลุดจากทุก Card)
 */
export function resolveRoundLifecycle(
  round: RoundLifecycleInput,
  nowMs: number,
): RoundLifecycle {
  const status = (round.status ?? '').toUpperCase();
  if (status === 'DRAFT') return 'DRAFT';
  if (status === 'CLOSED') return 'CLOSED';
  // status ที่ไม่ใช่ 3 ค่าที่รู้จัก → ถือว่าปิดรับ (fail-closed ต่อการรับสมัคร)
  if (status !== 'ACTIVE') return 'CLOSED';

  const open = toEpochMs(round.openDate);
  const close = toEpochMs(round.closeDate);
  // ไม่มีวันที่ = เปิดไม่ได้ (ตรงกับ backend ที่คืน ALREADY_CLOSED)
  if (open === null || close === null) return 'CLOSED';

  const nowBangkok = nowMs + BANGKOK_OFFSET_MS;
  if (nowBangkok < open + BANGKOK_OFFSET_MS) return 'SCHEDULED';
  if (nowBangkok > close + BANGKOK_OFFSET_MS) return 'CLOSED';
  return 'OPEN';
}

/** ป้ายภาษาไทยของแต่ละ lifecycle (ใช้กับ Card / Pill / badge ให้คำตรงกัน) */
export const ROUND_LIFECYCLE_LABEL: Record<RoundLifecycle, string> = {
  OPEN: 'เปิดรับ',
  DRAFT: 'ร่าง',
  CLOSED: 'ปิดรับ',
  SCHEDULED: 'กำหนดไว้',
};
