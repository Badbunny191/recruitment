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
 */
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
  return `${day} ${month} ${year} เวลา ${hh}:${mm} น.`;
};

// =============================================================
//  Countdown
// =============================================================

export interface Countdown {
  /** "เหลือเวลาสมัครอีก" | "เปิดรับสมัครในอีก" */
  label: string;
  /** "2 วัน 13 ชั่วโมง" */
  text: string;
  /** true = เร่งด่วน (เหลือ < 24 ชม.) ใช้ปรับสีการ์ด */
  urgent: boolean;
}

/**
 * จัดรูปช่วงเวลาเป็นข้อความสั้น — เอา 2 หน่วยใหญ่ที่สุด
 * ค่าที่ <= 0 คืน 'น้อยกว่า 1 นาที' ไม่ใช่ null
 * (เดิมคืน null ทำให้ countdown หายทั้งที่ badge ยังบอกว่าเปิดรับสมัคร)
 */
export const formatCountdown = (ms: number): string => {
  if (!Number.isFinite(ms) || ms <= 0) return 'น้อยกว่า 1 นาที';
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  if (days > 0) return `${days} วัน ${hours} ชั่วโมง`;
  if (hours > 0) return `${hours} ชั่วโมง ${minutes} นาที`;
  if (minutes > 0) return `${minutes} นาที`;
  return 'น้อยกว่า 1 นาที';
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
    return { label, text: '', urgent: false };
  }

  const remaining = target - nowMs;
  return {
    label,
    text: formatCountdown(remaining),
    urgent: phase === 'OPEN' && remaining > 0 && remaining < 24 * 60 * 60 * 1000,
  };
};

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
