/**
 * Public Rounds — สัญญาข้อมูลของหน้าแรก (ฝั่ง frontend)
 * =====================================================
 * หลักการ: **backend ตัดสินสถานะ** frontend แค่แสดง
 *
 * ปัญหาเดิมที่แก้ที่นี่
 * --------------------
 * เดิมหน้าแรกคำนวณ lifecycle เอง (computeLifecycle) แล้วคำนวณ countdown แยกอีกที่
 * ด้วย `Date.now()` คนละค่า → มีช่วงที่ badge บอก "เปิดรับสมัคร" แต่ countdown หาย
 * (เกิดขึ้นจริงตอน now ชน closeDate พอดี หรือตอนสองฟังก์ชันอ่านนาฬิกาต่างกันเสี้ยววินาที)
 *
 * ตอนนี้ทั้ง badge และ countdown มาจาก **phase เดียวกัน** ที่ backend ส่งมา
 * (คีย์ของ groups.open / groups.upcoming / groups.closed)
 * → ไม่มีทางที่สองอย่างนี้จะขัดกันเอง
 *
 * เวลาที่ใช้ทำ countdown อ้าง `serverTime` จาก API + offset กับนาฬิกาเครื่อง
 * → เครื่องผู้ใช้ตั้งเวลาเพี้ยนก็ยังนับถูก
 */

export type RoundPhase = 'OPEN' | 'UPCOMING' | 'CLOSED';

export interface PublicRound {
  id: string;
  title: string;
  positionLevel: string;
  status: string;
  openDate: string | number | Date;
  closeDate: string | number | Date;
}

export interface PublicRoundsPayload {
  open: PublicRound[];
  upcoming: PublicRound[];
  closed: PublicRound[];
  /** offset (ms) ที่ต้องบวกกับ Date.now() เพื่อให้ได้เวลาเซิร์ฟเวอร์ */
  serverOffsetMs: number;
}

// =============================================================
//  วันที่
// =============================================================

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** แปลงทุกทรงวันที่ → epoch ms (UTC) */
export const toEpochMs = (value: string | number | Date | null | undefined): number | null => {
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
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    return n < 1e12 ? n * 1000 : n;
  }
  const parsed = new Date(trimmed).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

/**
 * "10 ต.ค. 2569 เวลา 09:00 น." — เวลากรุงเทพฯ ตามที่แอดมินกรอก
 * อ่านจาก UTC แล้วบวก offset เพื่อไม่ให้ขึ้นกับ timezone ของเครื่องผู้ใช้
 *
 * รูปแบบภาษาไทยเต็ม: มีคำว่า "เวลา" คั่น และปิดท้ายด้วย "น."
 * ใช้มาตรฐานเดียวกันทุกจุดที่แสดงวันเวลาในหน้า public
 *
 * ⚠️ ช่องว่างใน "เวลา 09:00 น." เป็น NBSP (U+00A0) ไม่ใช่ space ปกติ
 *    space ปกติเป็นจุดตัดบรรทัด ทำให้ "น." ตกไปบรรทัดใหม่เมื่อการ์ดแคบ
 *    NBSP ผูกสามส่วนนี้ไว้ด้วยกัน → "09:00 น." อยู่บรรทัดเดียวกันเสมอ
 *    ส่วนช่องว่างระหว่างวัน/เดือน/ปี ยังเป็น space ปกติ เพื่อให้ตัดบรรทัดได้ตามธรรมชาติ
 */

/** non-breaking space (U+00A0) */
const NBSP = '\u00A0';

export const formatThaiDateTime = (
  value: string | number | Date | null | undefined,
): string => {
  const ms = toEpochMs(value);
  if (ms === null) return 'ไม่กำหนด';
  const d = new Date(ms + BANGKOK_OFFSET_MS);
  const months = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
  ];
  const day = d.getUTCDate();
  const month = months[d.getUTCMonth()];
  const year = d.getUTCFullYear() + 543;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${year} เวลา${NBSP}${hh}:${mm}${NBSP}น.`;
};

// =============================================================
//  Countdown
// =============================================================

export interface Countdown {
  /** "เหลือเวลาสมัครอีก" | "เปิดรับสมัครในอีก" | "" (ปิดแล้ว) */
  label: string;
  /** "2 วัน 13 ชั่วโมง" | "4 นาที 52 วินาที" | "ปิดรับสมัครแล้ว" */
  text: string;
  /** true = เร่งด่วน (เหลือ < 24 ชม.) ใช้ปรับสีการ์ด */
  urgent: boolean;
  /** true = รอบนี้เลยกำหนดปิดแล้ว — แสดงเป็นสถานะ ไม่ใช่การนับถอยหลัง */
  closed: boolean;
}

/** ข้อความเมื่อเลยกำหนดปิดแล้ว — ใช้ที่เดียวทั้งระบบ */
export const CLOSED_COUNTDOWN_TEXT = 'ปิดรับสมัครแล้ว';

/** ช่วงเวลาที่ต้องแสดง "วินาที" (5 นาทีสุดท้าย) */
const SECONDS_DISPLAY_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * จัดรูปช่วงเวลาเป็นข้อความสั้น
 *
 *   >= 1 วัน        → "2 วัน 13 ชั่วโมง"   (2 หน่วยใหญ่)
 *   >= 1 ชั่วโมง    → "5 ชั่วโมง 20 นาที"
 *   >= 5 นาที       → "45 นาที"
 *   <  5 นาที       → "4 นาที 52 วินาที" / "1 นาที 15 วินาที" / "23 วินาที"
 *   <= 0            → "ปิดรับสมัครแล้ว"
 *
 * ⚠️ ช่วง 5 นาทีสุดท้ายคือช่วงที่ผู้ใช้ตัดสินใจจริง — เดิมยุบทั้ง 59 วินาที
 *    สุดท้ายเป็น "น้อยกว่า 1 นาที" (และค้างข้อความเดิมต่อแม้เลยกำหนดไปแล้ว)
 *    ทำให้ช่วงสำคัญที่สุดไม่มีข้อมูลที่มีประโยชน์เลย
 *
 * ค่าที่ไม่ใช่ตัวเลข (NaN/Infinity) ถือว่า "ไม่รู้เวลา" → คืน '' ให้ผู้เรียก
 * แสดง '—' เอง (ไม่โกหกว่าเปิดอยู่หรือปิดแล้ว)
 */
export const formatCountdown = (ms: number): string => {
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return CLOSED_COUNTDOWN_TEXT;

  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  if (days > 0) return `${days} วัน ${hours} ชั่วโมง`;
  if (hours > 0) return `${hours} ชั่วโมง ${minutes} นาที`;

  // 5 นาทีสุดท้าย — ต้องเห็นวินาทีที่ขยับจริง
  if (ms < SECONDS_DISPLAY_THRESHOLD_MS) {
    if (minutes > 0) return `${minutes} นาที ${seconds} วินาที`;
    // กัน edge: totalSec = 0 แต่ ms > 0 (เหลือ < 1 วินาที) → ยังไม่ปิด
    return seconds > 0 ? `${seconds} วินาที` : '1 วินาที';
  }

  return `${minutes} นาที`;
};

/**
 * Countdown ของรอบ 1 แถว — อิง phase ที่ backend ตัดสินแล้วเท่านั้น
 *
 *   OPEN     → นับถึง closeDate  ("เหลือเวลาสมัครอีก")
 *   UPCOMING → นับถึง openDate   ("เปิดรับสมัครในอีก")
 *   CLOSED   → null (ไม่ต้องนับ)
 *
 * คืน null เฉพาะกรณีที่ **ไม่ควรมี countdown จริง ๆ** เท่านั้น
 * ถ้า phase = OPEN แต่หา closeDate ไม่ได้ → คืน label ไว้โดยไม่มีตัวเลข
 * (ดีกว่าปล่อยให้ badge เปิดรับสมัครแล้วเงียบ)
 *
 * ⚠️ phase มาจาก snapshot ที่โหลดไว้ — ระหว่างที่ยังไม่ refetch รอบที่เลย
 *    closeDate ไปแล้วจะยังเป็น OPEN อยู่ ค่าที่คืนจึงต้องบอกความจริงว่า
 *    "ปิดรับสมัครแล้ว" (closed = true) ไม่ใช่ค้างที่ "น้อยกว่า 1 นาที"
 */
export const computeCountdown = (
  phase: RoundPhase,
  round: Pick<PublicRound, 'openDate' | 'closeDate'>,
  nowMs: number,
): Countdown | null => {
  if (phase === 'CLOSED') return null;

  const target = phase === 'OPEN'
    ? toEpochMs(round.closeDate)
    : toEpochMs(round.openDate);

  const label = phase === 'OPEN' ? 'เหลือเวลาสมัครอีก' : 'เปิดรับสมัครในอีก';

  if (target === null) {
    return { label, text: '', urgent: false, closed: false };
  }

  const remaining = target - nowMs;
  const closed = remaining <= 0;

  return {
    label,
    text: formatCountdown(remaining),
    urgent: phase === 'OPEN' && remaining > 0 && remaining < 24 * 60 * 60 * 1000,
    closed,
  };
};

// =============================================================
//  ความสดของข้อมูล (staleness)
// =============================================================

/**
 * หน้าแรกโหลด /public/rounds/active ครั้งเดียวตอน mount — ถ้าเปิดแท็บทิ้งไว้
 * badge "เปิดรับสมัคร" / groups.open / countdown จะค้างไม่จำกัดเวลา
 * แม้รอบจะปิดจริงไปแล้ว (backend จะปฏิเสธตอนกดสมัคร) = UI โกหกผู้ใช้
 *
 * ทางเลือกที่พิจารณา
 * ------------------
 *   1. polling ทุก N วินาที           → สิ้นเปลือง quota/แบต เต็มที่ตลอดเวลา
 *                                       แม้ผู้ใช้ไม่ได้ดูหน้า (แท็บ background)
 *   2. refetch ตอน focus เท่านั้น      → พลาดเคสที่ผู้ใช้ "จ้องอยู่" ตอนรอบปิด
 *                                       (แท็บ active แต่ไม่มีการโฟกัสใหม่)
 *   3. near-deadline refresh เท่านั้น  → ต้องรู้ deadline ล่วงหน้า + พลาดเคส
 *                                       admin เปลี่ยน closeDate ระหว่างเปิดหน้า
 *   4. visibilitychange + focus +      → ครอบคลุมทั้ง "กลับมาดู" และ "จ้องอยู่"
 *      near-deadline timer               โดยยิง network เฉพาะเมื่อจำเป็น
 *
 * เลือก (4) — สมดุลที่สุด: ไม่มี network เลยเมื่อไม่มีอะไรเปลี่ยน และมี
 * timer ตัวเดียวที่ทำงานเฉพาะช่วงใกล้ปิด (ใกล้ deadline = ต้องแม่น)
 */

/** ระยะที่ถือว่า "ใกล้ปิด" — ใช้ปรับความถี่ของ tick (ไม่ใช่ของ network) */
export const NEAR_DEADLINE_MS = 5 * 60 * 1000;

/** เพดานการรอ timer — กัน timer ยาวเกินไปเมื่อ deadline ไกล */
export const MAX_REFRESH_DELAY_MS = 5 * 60 * 1000;

/** กันการยิงซ้ำถี่ ๆ (focus + visibilitychange มาพร้อมกัน) */
export const MIN_REFETCH_INTERVAL_MS = 15 * 1000;

/** ตื่นหลัง deadline เล็กน้อย เพื่อให้ฝั่งเซิร์ฟเวอร์เลยเวลาไปแล้วจริง */
const DEADLINE_GRACE_MS = 1 * 1000;

export interface RefreshPlan {
  /** true = ควรยิง fetch เลยตอนนี้ */
  refetch: boolean;
  /** ms ที่ควรตั้ง timer ไว้ (null = ไม่ต้องตั้ง) */
  delayMs: number | null;
  /** เหตุผล — ใช้ debug/อธิบาย ไม่ใช่ logic */
  reason: 'first-load' | 'throttled' | 'deadline-passed' | 'next-deadline' | 'idle';
}

/**
 * ผู้ใช้กลับมาดูหน้า (focus / visibilitychange) — ควรยิง fetch ไหม
 *
 * คำถามนี้มีคำตอบเดียว: **พ้น throttle หรือยัง** ไม่เกี่ยวกับ deadline
 * (ถ้าเอา deadline มาผสม จะได้บั๊กตรงข้าม: ผู้ใช้กดกลับเข้าแท็บแล้วหน้า
 *  ไม่ยอมดึงข้อมูลใหม่เพราะ "ยังไม่ถึง deadline")
 */
export const shouldRefetchOnEvent = (
  nowMs: number,
  lastFetchAt: number | null,
): boolean => {
  if (lastFetchAt === null) return true;
  return nowMs - lastFetchAt >= MIN_REFETCH_INTERVAL_MS;
};

/**
 * ควรตั้ง timer ไว้ตื่นเมื่อไร เพื่อให้หน้าที่จ้องอยู่เปลี่ยนสถานะเอง
 *
 *   - ไม่มี deadline เลย                          → null (ไม่ต้องตั้ง)
 *   - มี deadline ในอนาคต                         → ตื่นที่ deadline นั้น
 *                                                   (ไม่เกินเพดาน)
 *   - มี deadline ที่เลยไปแล้วแต่ยังไม่เคยจัดการ  → 0 (ยิงเดี๋ยวนี้)
 *
 * ⚠️ `handled` = deadline ที่ดึงข้อมูลใหม่ไปแล้วหลังมันเลยเวลา
 *    จำเป็นมาก: ถ้า backend ยังคืนรอบเดิมใน groups.open (เช่น business rule
 *    หรือ clock skew) แล้วเราไม่จำว่า "จัดการแล้ว" → timer จะยิงซ้ำ 0ms
 *    ไม่มีที่สิ้นสุด = ยิง API รัว ๆ ใส่เซิร์ฟเวอร์
 *    deadline หนึ่งตัว → refetch หนึ่งครั้ง เท่านั้น
 */
export const planDeadlineTimer = (
  nowMs: number,
  deadlines: number[],
  handled: readonly number[] = [],
): { delayMs: number | null; reason: RefreshPlan['reason'] } => {
  const handledSet = new Set(handled);
  const valid = deadlines.filter((d) => Number.isFinite(d));

  // deadline ที่เลยไปแล้วและยังไม่เคยจัดการ → ต้องดึงใหม่ทันที
  if (valid.some((d) => d <= nowMs && !handledSet.has(d))) {
    return { delayMs: 0, reason: 'deadline-passed' };
  }

  const future = valid.filter((d) => d > nowMs);
  if (future.length === 0) {
    return { delayMs: null, reason: 'idle' };
  }

  const untilNext = Math.min(...future) - nowMs;
  return {
    delayMs: Math.min(untilNext + DEADLINE_GRACE_MS, MAX_REFRESH_DELAY_MS),
    reason: 'next-deadline',
  };
};

/**
 * deadline ที่ควรบันทึกว่า "จัดการแล้ว" หลังดึงข้อมูลสำเร็จ
 * = deadline ที่เลยเวลามาแล้ว ณ ตอนที่ได้ payload มา
 *
 * เหตุผล: เราเพิ่งได้ข้อมูลสดจากเซิร์ฟเวอร์แล้ว ถ้าเซิร์ฟเวอร์ยังบอกว่า
 * รอบนี้เปิดอยู่ ก็ไม่ใช่หน้าที่ของหน้านี้ที่จะไปเถียง — แค่แสดงผลตาม
 * effectivePhase (ซึ่งจะบอกว่าปิดแล้ว) และรอ event ถัดไป
 */
export const deadlinesToMarkHandled = (
  nowMs: number,
  deadlines: number[],
): number[] => deadlines.filter((d) => Number.isFinite(d) && d <= nowMs);

/**
 * ตัดสินแบบครบวงจร (event + timer) — ใช้เมื่อต้องการคำตอบเดียว
 * ผู้เรียกส่วนใหญ่ใช้สองฟังก์ชันข้างบนแยกกันชัดกว่า
 */
export const planRefresh = (
  nowMs: number,
  lastFetchAt: number | null,
  deadlines: number[],
): RefreshPlan => {
  if (lastFetchAt === null) {
    return { refetch: true, delayMs: null, reason: 'first-load' };
  }

  const throttleRemaining = MIN_REFETCH_INTERVAL_MS - (nowMs - lastFetchAt);
  if (throttleRemaining > 0) {
    return { refetch: false, delayMs: throttleRemaining, reason: 'throttled' };
  }

  const timer = planDeadlineTimer(nowMs, deadlines);
  if (timer.reason === 'deadline-passed') {
    return { refetch: true, delayMs: null, reason: 'deadline-passed' };
  }
  return { refetch: false, delayMs: timer.delayMs, reason: timer.reason };
};

/**
 * deadline ที่ต้องเฝ้าจาก payload ปัจจุบัน
 *   OPEN     → closeDate (badge ต้องเปลี่ยนเป็นปิดเมื่อถึงเวลา)
 *   UPCOMING → openDate  (badge ต้องเปลี่ยนเป็นเปิดเมื่อถึงเวลา)
 * CLOSED ไม่ต้องเฝ้า (จบแล้ว)
 */
export const collectDeadlines = (payload: PublicRoundsPayload): number[] => {
  const out: number[] = [];
  for (const r of payload.open) {
    const t = toEpochMs(r.closeDate);
    if (t !== null) out.push(t);
  }
  for (const r of payload.upcoming) {
    const t = toEpochMs(r.openDate);
    if (t !== null) out.push(t);
  }
  return out;
};

/**
 * phase ที่ใช้ **แสดงผล** ณ เวลาปัจจุบัน — ไม่ใช่ phase ที่ใช้จัดกลุ่ม
 *
 * ทำไมต้องมี: ระหว่างที่ snapshot ยังไม่ถูก refetch รอบที่เลย closeDate ไปแล้ว
 * ยังอยู่ใน groups.open → badge จะบอก "เปิดรับสมัคร" ขณะที่ countdown
 * บอก "ปิดรับสมัครแล้ว" = การ์ดขัดกันเอง (คลาสบั๊กเดียวกับที่ไฟล์นี้เคยแก้)
 *
 * กติกาเดียวกับ backend (round-visibility.ts resolveRoundPhase):
 *   OPEN     + now >  closeDate → CLOSED
 *   UPCOMING + now >= openDate  → OPEN
 * ขอบเขต inclusive เหมือนกัน (now === closeDate ยัง OPEN)
 *
 * ⚠️ เป็นการ "ลดระดับ" เท่านั้น (OPEN→CLOSED, UPCOMING→OPEN)
 *    ห้ามอัปเกรด CLOSED→OPEN — ถ้า backend บอกปิดแล้ว ต้องเชื่อ backend
 *    และไม่แตะการจัดกลุ่ม (รอบยังอยู่ section เดิมจนกว่า refetch จะเสร็จ
 *    ซึ่งเกิดภายในไม่กี่วินาทีจาก timer ที่ deadline)
 */
export const effectivePhase = (
  phase: RoundPhase,
  round: Pick<PublicRound, 'openDate' | 'closeDate'>,
  nowMs: number,
): RoundPhase => {
  if (phase === 'OPEN') {
    const close = toEpochMs(round.closeDate);
    if (close !== null && nowMs > close) return 'CLOSED';
    return 'OPEN';
  }
  if (phase === 'UPCOMING') {
    const open = toEpochMs(round.openDate);
    if (open !== null && nowMs >= open) return 'OPEN';
    return 'UPCOMING';
  }
  return phase;
};

// =============================================================
//  กติกา layout ของกริดรอบรับสมัคร
// =============================================================

/**
 * ใบสุดท้ายของจำนวนคี่ = การ์ดที่ "เหลือใบเดียวในแถวสุดท้าย"
 *   1 รอบ (index 0)  → true  (แถวเดียว เหลือใบเดียว)
 *   3 รอบ (index 2)  → true  (แถวแรก 2 ใบ, แถวสุดท้าย 1 ใบ)
 *   2/4/6 รอบ        → false (ทุกแถวเต็ม 2 ใบ)
 * การ์ดใบนี้ต้องจัดกึ่งกลาง (หน้าแรกครอบด้วย div max-w-3xl mx-auto)
 */
export const isLoneLastCard = (index: number, total: number): boolean =>
  total % 2 === 1 && index === total - 1;

// =============================================================
//  ป้ายสถานะ
// =============================================================

export interface PhaseStyle {
  label: string;
  /** คลาสของ badge */
  badge: string;
  /** สีจุดหน้า badge */
  dot: string;
}

export const PHASE_STYLE: Record<RoundPhase, PhaseStyle> = {
  OPEN: {
    label: 'เปิดรับสมัคร',
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    dot: 'bg-emerald-500',
  },
  UPCOMING: {
    label: 'ยังไม่เปิดรับสมัคร',
    badge: 'bg-amber-100 text-amber-800 border-amber-300',
    dot: 'bg-amber-500',
  },
  CLOSED: {
    label: 'ปิดรับสมัครแล้ว',
    badge: 'bg-slate-100 text-slate-600 border-slate-300',
    dot: 'bg-slate-400',
  },
};

// =============================================================
//  แปลง response → payload ที่หน้าแรกใช้
// =============================================================

/**
 * อ่าน response ของ GET /public/rounds/active
 *
 * รองรับทั้ง shape ใหม่ (groups) และ shape เดิม (data = array)
 * กรณีได้ shape เดิม (deploy เก่า/แคช) จะจัดกลุ่มเองด้วยกติกาเดียวกับ backend
 * เพื่อให้หน้าแรกยังถูกต้องระหว่างที่ backend ใหม่ยังไม่ขึ้น
 */
export const parseRoundsResponse = (
  json: any,
  nowMs: number,
): PublicRoundsPayload => {
  const serverTime = typeof json?.serverTime === 'number' ? json.serverTime : nowMs;
  const serverOffsetMs = serverTime - nowMs;

  const groups = json?.groups;
  if (groups && Array.isArray(groups.open) && Array.isArray(groups.upcoming) && Array.isArray(groups.closed)) {
    return {
      open: groups.open,
      upcoming: groups.upcoming,
      closed: groups.closed,
      serverOffsetMs,
    };
  }

  // fallback: shape เดิม (data เป็น array ของ ACTIVE) → จัดกลุ่มเอง
  const rows: PublicRound[] = Array.isArray(json?.data) ? json.data : [];
  const open: PublicRound[] = [];
  const upcoming: PublicRound[] = [];
  const closed: PublicRound[] = [];

  for (const r of rows) {
    const status = String(r?.status ?? '').toUpperCase();
    if (status === 'DRAFT') continue;
    if (status === 'CLOSED') {
      closed.push(r);
      continue;
    }
    const o = toEpochMs(r.openDate);
    const c = toEpochMs(r.closeDate);
    if (o === null || c === null) {
      closed.push(r);
    } else if (nowMs < o) {
      upcoming.push(r);
    } else if (nowMs > c) {
      closed.push(r);
    } else {
      open.push(r);
    }
  }

  const byClose = (a: PublicRound, b: PublicRound) =>
    (toEpochMs(a.closeDate) ?? Infinity) - (toEpochMs(b.closeDate) ?? Infinity);
  const byOpen = (a: PublicRound, b: PublicRound) =>
    (toEpochMs(a.openDate) ?? Infinity) - (toEpochMs(b.openDate) ?? Infinity);
  const byCloseDesc = (a: PublicRound, b: PublicRound) =>
    (toEpochMs(b.closeDate) ?? -Infinity) - (toEpochMs(a.closeDate) ?? -Infinity);

  open.sort(byClose);
  upcoming.sort(byOpen);
  closed.sort(byCloseDesc);

  return { open, upcoming, closed, serverOffsetMs };
};
