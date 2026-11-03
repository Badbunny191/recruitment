/**
 * Round Visibility — แหล่งความจริงเดียวของ "รอบนี้อยู่สถานะไหน"
 * =============================================================
 * เดิมกติกานี้กระจายอยู่ 3 ที่ และไม่ตรงกัน:
 *   1. backend/src/routes/public.routes.ts      → evaluateRound()  (gate ตอน submit)
 *   2. frontend/src/app/(public)/page.tsx       → computeLifecycle() (badge หน้าแรก)
 *   3. frontend/src/lib/round-lifecycle.ts      → resolveRoundLifecycle() (การ์ด admin)
 *
 * อาการที่เกิด: section "รอบรับสมัครที่เปิดอยู่" มีรอบที่ปิดไปแล้วปนอยู่
 * เพราะ endpoint /rounds/active กรองแค่ status = 'ACTIVE' ไม่ได้เทียบ closeDate
 *
 * ไฟล์นี้รวมกติกาไว้ที่เดียว โดยไม่แตะ schema:
 *   ใช้เฉพาะ column ที่มีอยู่แล้ว — status, openDate, closeDate, deletedAt
 *
 * นิยาม (ตรงตามที่อนุมัติ):
 *   OPEN      = status = ACTIVE  และ  openDate <= now <= closeDate
 *   UPCOMING  = status = ACTIVE  และ  now < openDate
 *   CLOSED    = status = CLOSED  หรือ  (status = ACTIVE และ now > closeDate)
 *   DRAFT     = status = DRAFT   → ไม่แสดงบนหน้า public เลย (ไม่ใช่ 1 ใน 3 กลุ่ม)
 *
 * ⚠️ เรื่องเขตเวลา
 *   `open_date` / `close_date` ถูกเก็บเป็น integer (unixepoch) ของค่าที่แอดมินกรอก
 *   ผ่าน <input type="datetime-local"> ซึ่งเบราว์เซอร์ตีความเป็นเวลาไทย → ค่าที่เก็บ
 *   จึงเป็น "UTC instant" ที่ถูกต้องอยู่แล้ว (ไม่ใช่ wall clock ล้วน)
 *   การเทียบจึงทำบน UTC ms ตรง ๆ ได้ ไม่ต้องบวก offset
 *   (โค้ดเดิมบวก +7h ทั้งสองฝั่ง ซึ่งตัดกันเอง — ผลลัพธ์เท่ากันทุกกรณี)
 */

export type RoundPhase = 'OPEN' | 'UPCOMING' | 'CLOSED' | 'DRAFT';

/** ค่าที่ drizzle mode:'timestamp' / JSON / unix seconds ส่งมาได้ */
export type DateLike = Date | number | string | null | undefined;

/**
 * แปลงทุกทรงของวันที่ → epoch ms (UTC)
 * - number < 1e12 = unix seconds, >= 1e12 = ms
 * - string = ISO หรือตัวเลข
 * - ค่าที่อ่านไม่ได้ → null
 */
export const toEpochMs = (value: DateLike): number | null => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return value < 1e12 ? value * 1000 : value;
  }
  const trimmed = String(value).trim();
  if (trimmed === '') return null;
  // numeric string (unix seconds / ms) — new Date('1762000000') จะได้ Invalid Date
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    return n < 1e12 ? n * 1000 : n;
  }
  const parsed = new Date(trimmed).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

export interface RoundVisibilityInput {
  status: string | null | undefined;
  openDate: DateLike;
  closeDate: DateLike;
}

/**
 * ตัดสิน phase ของรอบ 1 แถว ณ เวลา nowMs (UTC ms)
 *
 * ขอบเขตเวลาเป็นแบบ inclusive ทั้งสองด้าน:
 *   now === openDate  → OPEN
 *   now === closeDate → OPEN  (ยังสมัครได้จนถึงวินาทีปิด)
 *   now === closeDate + 1ms → CLOSED
 *
 * fail-closed: ACTIVE ที่อ่านวันที่ไม่ได้ → CLOSED (สมัครไม่ได้ ตรงกับ gate เดิม)
 * status ที่ไม่รู้จัก → CLOSED (ไม่ให้แถวหลุดไปโผล่ใน OPEN)
 */
export function resolveRoundPhase(
  round: RoundVisibilityInput,
  nowMs: number,
): RoundPhase {
  const status = (round.status ?? '').toUpperCase();

  // 1. status ที่ตัดสินได้ทันทีโดยไม่ต้องดูวันที่
  if (status === 'DRAFT') return 'DRAFT';
  if (status === 'CLOSED') return 'CLOSED';
  if (status !== 'ACTIVE') return 'CLOSED'; // fail-closed

  // 2. ACTIVE → เทียบช่วงเวลา
  const open = toEpochMs(round.openDate);
  const close = toEpochMs(round.closeDate);
  if (open === null || close === null) return 'CLOSED';

  if (nowMs < open) return 'UPCOMING';
  if (nowMs > close) return 'CLOSED';
  return 'OPEN';
}

export interface RoundGroups<T> {
  open: T[];
  upcoming: T[];
  closed: T[];
}

/**
 * แบ่งรอบเป็น 3 กลุ่ม + จัดลำดับให้ผู้ใช้เห็นสิ่งที่ต้องตัดสินใจก่อน
 *
 *   OPEN      → closeDate ASC   (ใกล้ปิดก่อน = เร่งด่วนสุด)
 *   UPCOMING  → openDate ASC    (เปิดเร็วสุดก่อน)
 *   CLOSED    → closeDate DESC  (ปิดล่าสุดก่อน = ยังเกี่ยวข้องที่สุด)
 *
 * รอบ DRAFT ถูกตัดออกทั้งหมด (ยังไม่ประกาศ — ห้ามหลุดขึ้นหน้า public)
 * แถวที่อ่านวันที่ไม่ได้จะถูกจัดไว้ท้ายกลุ่มของตัวเอง (ไม่ทำให้ sort พัง)
 */
export function groupRounds<T extends RoundVisibilityInput>(
  rounds: T[],
  nowMs: number,
): RoundGroups<T> {
  const groups: RoundGroups<T> = { open: [], upcoming: [], closed: [] };

  for (const round of rounds) {
    const phase = resolveRoundPhase(round, nowMs);
    if (phase === 'OPEN') groups.open.push(round);
    else if (phase === 'UPCOMING') groups.upcoming.push(round);
    else if (phase === 'CLOSED') groups.closed.push(round);
    // DRAFT → ไม่ใส่กลุ่มใดเลย
  }

  const byMs = (
    pick: (r: T) => number | null,
    dir: 'asc' | 'desc',
  ) => (a: T, b: T): number => {
    const av = pick(a);
    const bv = pick(b);
    // แถวที่ไม่มีวันที่ → ท้ายเสมอ ไม่ว่าจะ sort ทิศไหน
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return dir === 'asc' ? av - bv : bv - av;
  };

  groups.open.sort(byMs((r) => toEpochMs(r.closeDate), 'asc'));
  groups.upcoming.sort(byMs((r) => toEpochMs(r.openDate), 'asc'));
  groups.closed.sort(byMs((r) => toEpochMs(r.closeDate), 'desc'));

  return groups;
}

/** ป้ายภาษาไทยของแต่ละ phase (ใช้ให้คำตรงกันทั้งระบบ) */
export const ROUND_PHASE_LABEL: Record<RoundPhase, string> = {
  OPEN: 'กำลังเปิดรับสมัคร',
  UPCOMING: 'กำหนดเปิดรับสมัคร',
  CLOSED: 'ปิดรับสมัครแล้ว',
  DRAFT: 'ร่าง',
};
