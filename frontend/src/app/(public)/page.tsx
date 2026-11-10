'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  SearchIcon,
  CalendarIcon,
  ClockIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  BellIcon,
  LockIcon,
  BadgeIcon,
} from '@/components/ui/icons';
import {
  parseRoundsResponse,
  computeCountdown,
  collectDeadlines,
  planDeadlineTimer,
  shouldRefetchOnEvent,
  deadlinesToMarkHandled,
  effectivePhase,
  formatThaiDateTime,
  isLoneLastCard,
  PHASE_STYLE,
  NEAR_DEADLINE_MS,
  type PublicRound,
  type PublicRoundsPayload,
  type RoundPhase,
} from '@/lib/public-rounds';

// =================================================================
//  หน้าแรก — ลำดับความสำคัญ: สมัครงาน > ค้นหาใบสมัคร
//
//  หลักการ: backend ตัดสินสถานะ (open / upcoming / closed) แล้ว
//  หน้านี้แค่แสดงตามกลุ่มที่ได้รับ — ไม่คำนวณ lifecycle เองอีก
//  (เดิมคำนวณเองแล้วทำให้รอบที่ปิดแล้วหลุดเข้ามาอยู่ใต้หัวข้อ "เปิดอยู่")
//
//  หัวข้อ "กำลังเปิดรับสมัคร" แสดงเฉพาะ groups.open เท่านั้น
//  → ไม่มีทางมีรอบที่ปิดแล้วอยู่ใน section นี้อีก
// =================================================================

/** เดินนาฬิกา: ปกติ 30 วิ / ใกล้ปิด (< 5 นาที) 1 วิ เพื่อให้วินาทีขยับจริง */
const TICK_NORMAL_MS = 30_000;
const TICK_NEAR_DEADLINE_MS = 1_000;

const useTick = (nearDeadline: boolean): number => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = nearDeadline ? TICK_NEAR_DEADLINE_MS : TICK_NORMAL_MS;
    const id = setInterval(() => setTick((t) => t + 1), interval);
    return () => clearInterval(id);
  }, [nearDeadline]);
  return Date.now();
};

const EMPTY: PublicRoundsPayload = {
  open: [],
  upcoming: [],
  closed: [],
  serverOffsetMs: 0,
};

// =================================================================
//  Badge
// =================================================================

function PhaseBadge({ phase }: { phase: RoundPhase }) {
  const style = PHASE_STYLE[phase];
  const Icon =
    phase === 'OPEN' ? CheckCircleIcon : phase === 'UPCOMING' ? BellIcon : LockIcon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border whitespace-nowrap ${style.badge}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {style.label}
    </span>
  );
}

// =================================================================
//  Countdown block — องค์ประกอบที่เด่นที่สุดของการ์ด
// =================================================================

function CountdownBlock({
  phase,
  round,
  nowMs,
}: {
  phase: RoundPhase;
  round: PublicRound;
  nowMs: number;
}) {
  // phase ที่ใช้แสดงผล — ลดระดับได้เมื่อเลย deadline ไปแล้วแต่ snapshot ยังเก่า
  // (กันการ์ดขัดกันเอง: badge "เปิดรับสมัคร" + countdown "ปิดรับสมัครแล้ว")
  const shownPhase = effectivePhase(phase, round, nowMs);
  const cd = computeCountdown(shownPhase, round, nowMs);
  if (!cd) return null;

  // ปิดแล้ว = สถานะ ไม่ใช่การนับถอยหลัง → โทนสีกลาง ไม่เร่งเร้า
  const isClosed = cd.closed;

  const tone = isClosed
    ? 'bg-slate-50 border-slate-200 text-slate-700'
    : phase === 'UPCOMING'
      ? 'bg-amber-50 border-amber-200 text-amber-900'
      : cd.urgent
        ? 'bg-rose-50 border-rose-200 text-rose-900'
        : 'bg-emerald-50 border-emerald-200 text-emerald-900';

  const iconTone = isClosed
    ? 'text-slate-500'
    : phase === 'UPCOMING'
      ? 'text-amber-600'
      : cd.urgent
        ? 'text-rose-600'
        : 'text-emerald-600';

  return (
    <div className={`rounded-lg border px-3.5 py-3 ${tone}`}>
      <div className="flex items-center gap-2">
        {isClosed ? (
          <LockIcon className={`h-4 w-4 shrink-0 ${iconTone}`} />
        ) : (
          <ClockIcon className={`h-4 w-4 shrink-0 ${iconTone}`} />
        )}
        {!isClosed && (
          <span className="text-xs font-medium opacity-80">{cd.label}</span>
        )}
      </div>
      <p className="mt-1 text-lg font-bold leading-tight tabular-nums">
        {cd.text || '—'}
      </p>
    </div>
  );
}

// =================================================================
//  วันที่ + เวลา — "6 พ.ย. 2569 เวลา 16:30 น."
//
//  ปัญหา: "น." ตกบรรทัดใหม่เมื่อการ์ดแคบ เพราะช่องว่างปกติเป็นจุดตัดบรรทัด
//  แก้ 2 ชั้น:
//    1. formatter ใช้ NBSP ผูก "เวลา / 16:30 / น." ไว้ด้วยกันแล้ว
//    2. span นี้ใส่ whitespace-nowrap ครอบส่วนเวลา → กันการตัดบรรทัดซ้ำอีกชั้น
//       แม้ฟอนต์หรือเบราว์เซอร์จะยุบ NBSP ก็ยังไม่แตก
//
//  ส่วนวันที่ (6 พ.ย. 2569) ยังตัดบรรทัดได้ตามธรรมชาติ ไม่ล้นการ์ด
// =================================================================

function ThaiDateTime({ value }: { value: PublicRound['closeDate'] }) {
  const full = formatThaiDateTime(value);
  const timeIndex = full.indexOf('เวลา');
  if (timeIndex === -1) return <span>{full}</span>;

  return (
    <span>
      {full.slice(0, timeIndex)}
      <span className="whitespace-nowrap">{full.slice(timeIndex)}</span>
    </span>
  );
}

// =================================================================
//  การ์ดรอบที่เปิดอยู่ — ต้องตอบ 3 คำถามให้จบในการ์ดเดียว
//    1. สมัครได้ไหม   → badge + ปุ่มที่กดได้จริง
//    2. เหลือเวลาเท่าไร → countdown ตัวใหญ่
//    3. สมัครตรงไหน    → ปุ่ม CTA เต็มความกว้าง
// =================================================================

function OpenRoundCard({ round, nowMs }: { round: PublicRound; nowMs: number }) {
  return (
    // โครงการ์ด: หัวการ์ด (ชื่อรอบ) โตตามยาวของข้อความ ส่วนที่เหลือยึดขอบล่าง
    // → เนื้อหาหลัก + ปุ่มอยู่ระดับเดียวกันทุกการ์ดใน grid แม้ชื่อรอบจะ
    //   กินจำนวนบรรทัดต่างกัน (แก้ด้วย layout ล้วน ไม่ truncate ข้อความ)
    <article className="flex flex-col rounded-lg border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-brand/40">
      <div className="flex items-start justify-between gap-3 p-5 pb-0">
        <h3 className="text-lg font-bold leading-snug text-slate-900">
          {round.title}
        </h3>
        <PhaseBadge phase="OPEN" />
      </div>

      {/* เนื้อหาหลัก — flex-1 + justify-end ดันกลุ่มนี้ไปชิดล่างของพื้นที่ที่เหลือ */}
      <div className="flex flex-1 flex-col justify-end gap-4 px-5 pt-5">
        <div className="flex items-center gap-1.5 text-sm text-slate-600">
          <BadgeIcon className="h-4 w-4 shrink-0 text-slate-400" />
          <span>
            ระดับตำแหน่ง:{' '}
            <span className="font-semibold text-slate-800">{round.positionLevel}</span>
          </span>
        </div>

        {/* Deadline + countdown = หัวใจของการ์ด */}
        <div className="grid gap-2.5 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3">
            <div className="flex items-center gap-2">
              <CalendarIcon className="h-4 w-4 shrink-0 text-slate-500" />
              <span className="text-xs font-medium text-slate-500">ปิดรับสมัคร</span>
            </div>
            <p className="mt-1 text-base font-bold leading-tight text-slate-900">
              <ThaiDateTime value={round.closeDate} />
            </p>
          </div>
          <CountdownBlock phase="OPEN" round={round} nowMs={nowMs} />
        </div>

        {/* วันเปิดรับสมัคร — ลดความเด่นลงเพราะรอบเปิดอยู่แล้ว */}
        <p className="text-xs text-slate-400">
          เปิดรับสมัครตั้งแต่ <ThaiDateTime value={round.openDate} />
        </p>
      </div>

      <div className="px-5 pb-5 pt-4">
        <Link href={`/apply?id=${round.id}`} className="block">
          <Button variant="brand" size="lg" className="w-full gap-2 text-base font-semibold">
            สมัครเข้ารับการคัดเลือก
            <ArrowRightIcon className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    </article>
  );
}

// =================================================================
//  การ์ดรอบที่ยังไม่เปิด — บอกวันเปิดให้ชัด แต่ยังกดสมัครไม่ได้
// =================================================================

function UpcomingRoundCard({ round, nowMs }: { round: PublicRound; nowMs: number }) {
  // ถ้าเลย openDate ไปแล้ว (snapshot ยังเก่า) → phase เปลี่ยนเป็น OPEN
  // badge ต้องไม่บอก "ยังไม่เปิดรับสมัคร" ทั้งที่เปิดแล้ว
  const shownPhase = effectivePhase('UPCOMING', round, nowMs);
  return (
    // โครงเดียวกับ OpenRoundCard — ชื่อรอบโตด้านบน เนื้อหาหลักยึดขอบล่าง
    <article className="flex flex-col rounded-lg border border-amber-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 p-5 pb-0">
        <h3 className="text-base font-semibold leading-snug text-slate-800">
          {round.title}
        </h3>
        <PhaseBadge phase={shownPhase} />
      </div>

      <div className="flex flex-1 flex-col justify-end gap-4 px-5 pt-5">
        <div className="flex items-center gap-1.5 text-sm text-slate-600">
          <BadgeIcon className="h-4 w-4 shrink-0 text-slate-400" />
          <span>
            ระดับตำแหน่ง:{' '}
            <span className="font-medium text-slate-800">{round.positionLevel}</span>
          </span>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3">
            <div className="flex items-center gap-2">
              <CalendarIcon className="h-4 w-4 shrink-0 text-slate-500" />
              <span className="text-xs font-medium text-slate-500">เปิดรับสมัคร</span>
            </div>
            <p className="mt-1 text-base font-bold leading-tight text-slate-900">
              <ThaiDateTime value={round.openDate} />
            </p>
          </div>
          <CountdownBlock phase="UPCOMING" round={round} nowMs={nowMs} />
        </div>
      </div>

      <div className="px-5 pb-5 pt-4">
        {shownPhase === 'OPEN' ? (
          <Link href={`/apply?id=${round.id}`} className="block">
            <Button variant="brand" size="lg" className="w-full gap-2 text-base font-semibold">
              สมัครเข้ารับการคัดเลือก
              <ArrowRightIcon className="h-4 w-4" />
            </Button>
          </Link>
        ) : (
          <Button
            size="lg"
            variant="secondary"
            className="w-full gap-2"
            disabled
            aria-disabled="true"
          >
            <LockIcon className="h-4 w-4" />
            ยังไม่เปิดรับสมัคร
          </Button>
        )}
      </div>
    </article>
  );
}

// =================================================================
//  การ์ดรอบที่ปิดแล้ว — แถวเดียว เบาที่สุด ไม่แย่งความสนใจ
// =================================================================

function ClosedRoundRow({ round }: { round: PublicRound }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border border-slate-200 bg-white px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-700">{round.title}</p>
        <p className="text-xs text-slate-500">ระดับตำแหน่ง: {round.positionLevel}</p>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-500">
          ปิดเมื่อ <ThaiDateTime value={round.closeDate} />
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
          <LockIcon className="h-3 w-3" />
          ปิดรับแล้ว
        </span>
      </div>
    </li>
  );
}

// =================================================================
//  Section shell
// =================================================================

function SectionHeading({
  id,
  title,
  description,
  tone = 'default',
}: {
  id: string;
  title: string;
  description?: string;
  tone?: 'primary' | 'default';
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2
          id={id}
          className={
            tone === 'primary'
              ? 'text-2xl font-bold tracking-tight text-slate-900 md:text-3xl'
              : 'text-lg font-semibold tracking-tight text-slate-700'
          }
        >
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        )}
      </div>
    </div>
  );
}

// =================================================================
//  ผังการจัดการ์ดในกริด — กฎเดียวกันทั้ง section "กำลังเปิดรับสมัคร"
//  และ "กำหนดเปิดรับสมัคร"
//
//    1 รอบ        → การ์ดใบเดียวกึ่งกลาง (max-w-3xl, mx-auto)
//    2/4/… รอบ    → grid 2 คอลัมน์ตามเดิม (การ์ดเป็นลูกกริดตรง ๆ
//                   เหมือนเดิมทุกไบต์ → ความสูงเท่ากันต่อแถวไม่เปลี่ยน)
//    3/5/… รอบ    → แถวสุดท้ายเหลือใบเดียว → กึ่งกลาง "แต่ห้ามขยายขนาด"
//                   กว้างเท่าการ์ดปกติทุกประการ (กฎ: มีมากกว่า 1 รอบ
//                   การ์ดทุกใบต้องกว้างเท่ากัน)
//
//  ห้ามใช้ 3 คอลัมน์ (กล่องวันที่/countdown แคบเกิน) และห้ามแตะ
//  component การ์ด — ครอบด้วย div เท่านั้น
//
//  เทคนิคกึ่งกลาง: auto margin (mx-auto) บน grid item ดูดพื้นที่
//  ที่เหลือสองข้างตาม CSS Box Alignment (มีลำดับความสำคัญสูงกว่า
//  justify-self) จึงกึ่งกลางแนวนอนได้แม้ grid ยังยืด item
// =================================================================

function renderRoundCards(
  rounds: PublicRound[],
  nowMs: number,
  Card: ComponentType<{ round: PublicRound; nowMs: number }>,
) {
  return rounds.map((round, index) => {
    if (isLoneLastCard(index, rounds.length)) {
      // เคส 1 รอบ: กึ่งกลางด้วย max-w-3xl (การ์ดใบเดียวมีสิทธิ์ใหญ่พิเศษ)
      //
      // เคส n คี่ > 1: กึ่งกลางโดยไม่ขยายขนาด
      //   - md:w-[calc((100%_-_20px)/2)] = กว้างเท่าคอลัมน์ปกติพอดี
      //     (1fr ของกริด 2 คอลัมน์ gap-5 = (100% − 20px) / 2 — เลข 20px
      //     ผูกกับ gap-5 ของกริดด้านล่าง ห้ามแก้แยกฝั่งเดียว)
      //   - md:col-span-2 ทำให้ grid area เป็นแถวเต็ม mx-auto จึงกึ่งกลาง
      //     ของหน้าได้ (เคส 1 รอบกริดเป็นคอลัมน์เดียว การ span 2 จะสร้าง
      //     implicit track เกินจำเป็น จึงใส่เฉพาะ n > 1)
      //   - mobile: w-full เท่านั้น (คลาส md:* ไม่ทำงาน) = เหมือนเดิม
      return (
        <div
          key={round.id}
          className={
            rounds.length > 1
              ? 'mx-auto w-full md:w-[calc((100%_-_20px)/2)] md:col-span-2'
              : 'mx-auto w-full max-w-3xl'
          }
        >
          <Card round={round} nowMs={nowMs} />
        </div>
      );
    }
    return <Card key={round.id} round={round} nowMs={nowMs} />;
  });
}

// =================================================================
//  Page
// =================================================================

export default function HomePage() {
  const [payload, setPayload] = useState<PublicRoundsPayload>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // เวลาที่ยิงสำเร็จครั้งล่าสุด (ms) — ใช้ throttle การ refetch
  const lastFetchAtRef = useRef<number | null>(null);
  // กัน overlapping request (focus + visibility + timer มาพร้อมกัน)
  const inFlightRef = useRef(false);
  // deadline ที่ดึงข้อมูลใหม่ไปแล้วหลังเลยเวลา — กัน timer ยิงซ้ำไม่รู้จบ
  const handledDeadlinesRef = useRef<number[]>([]);

  /**
   * โหลดข้อมูลรอบ — เรียกได้หลายครั้ง (mount / focus / กลับเข้าแท็บ / timer)
   *
   * `silent` = ไม่แตะ loading/failed: การ refresh เบื้องหลังต้องไม่ทำให้
   * การ์ดที่แสดงอยู่กระพริบเป็น skeleton หรือทับด้วย error state
   * (ถ้า refresh ล้ม ผู้ใช้ยังเห็นข้อมูลเดิมซึ่งดีกว่าหน้า error)
   */
  const loadRounds = useCallback((opts: { silent?: boolean } = {}) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
    const requestedAt = Date.now();

    fetch(`${apiUrl}/public/rounds/active`)
      .then((res) => res.json())
      .then((json) => {
        const parsed = parseRoundsResponse(json, requestedAt);
        setPayload(parsed);
        lastFetchAtRef.current = requestedAt;
        // บันทึก deadline ที่เลยเวลาแล้วว่า "จัดการแล้ว" — กัน timer ยิงซ้ำ
        // (ถ้าเซิร์ฟเวอร์ยังคืนรอบเดิม การแสดงผลใช้ effectivePhase จัดการแทน)
        handledDeadlinesRef.current = deadlinesToMarkHandled(
          requestedAt,
          collectDeadlines(parsed),
        );
        setFailed(false);
        setLoading(false);
      })
      .catch(() => {
        if (!opts.silent) {
          setFailed(true);
          setLoading(false);
        }
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  }, []);

  // ── 1) โหลดครั้งแรก ────────────────────────────────────────────────
  useEffect(() => {
    loadRounds();
  }, [loadRounds]);

  // ── 2) กลับเข้าแท็บ / หน้าต่างได้ focus → ข้อมูลอาจเก่า ─────────────
  // ไม่ poll: ยิงเฉพาะตอนมีสัญญาณว่าผู้ใช้กำลังดูอยู่จริง
  // คำถามเดียวที่ต้องตอบ: พ้น throttle หรือยัง (ไม่เกี่ยวกับ deadline)
  useEffect(() => {
    const refreshIfDue = () => {
      if (shouldRefetchOnEvent(Date.now(), lastFetchAtRef.current)) {
        loadRounds({ silent: true });
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshIfDue();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', refreshIfDue);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', refreshIfDue);
    };
  }, [loadRounds]);

  // ── 3) timer ตื่นที่ deadline ถัดไป ────────────────────────────────
  // ผู้ใช้ที่จ้องหน้าอยู่จะเห็น badge เปลี่ยนเองตอนรอบปิด/เปิด
  // โดยไม่ต้อง poll ตลอด (ตั้ง timer ใหม่ทุกครั้งที่ payload เปลี่ยน)
  // handledDeadlines กันการยิงซ้ำไม่รู้จบเมื่อ backend ยังคืนรอบเดิม
  useEffect(() => {
    const { delayMs } = planDeadlineTimer(
      Date.now(),
      collectDeadlines(payload),
      handledDeadlinesRef.current,
    );
    if (delayMs === null) return;
    const id = setTimeout(() => loadRounds({ silent: true }), delayMs);
    return () => clearTimeout(id);
  }, [payload, loadRounds]);

  // เวลาอ้างอิง = นาฬิกาเครื่อง + offset ของเซิร์ฟเวอร์
  // → countdown ตรงกับเวลาจริงแม้เครื่องผู้ใช้ตั้งเวลาเพี้ยน
  const serverNowMs = Date.now() + payload.serverOffsetMs;

  // ใกล้ปิด (< 5 นาที) → เดินนาฬิกาทุก 1 วิ เพื่อให้วินาทีขยับจริง
  const nearDeadline = useMemo(
    () => collectDeadlines(payload).some((d) => d - serverNowMs <= NEAR_DEADLINE_MS),
    [payload, serverNowMs],
  );

  const tick = useTick(nearDeadline);

  const nowMs = useMemo(
    () => tick + payload.serverOffsetMs,
    [tick, payload.serverOffsetMs],
  );

  const { open, upcoming, closed } = payload;

  // รอบที่เลย closeDate แล้วแต่ยังอยู่ใน groups.open (snapshot ยังไม่ refresh)
  // → ไม่แสดงในหัวข้อ "กำลังเปิดรับสมัคร" อีก เพราะสมัครไม่ได้จริงแล้ว
  const openLive = open.filter((r) => effectivePhase('OPEN', r, nowMs) === 'OPEN');
  const justClosed = open.length - openLive.length;

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-4 py-8">
      {/* ============================================================
          PRIMARY — กำลังเปิดรับสมัคร (มีเฉพาะรอบที่สมัครได้จริง)
          จำนวนรอบอยู่ในหัวข้อ ("กำลังเปิดรับสมัคร 2 รอบ") ไม่ใช่ badge ลอย
          การ์ด: 1 รอบ = กึ่งกลาง (max-w-3xl), 2+ รอบ = grid 2 คอลัมน์
          บน desktop — จำนวนคี่ใบสุดท้ายกึ่งกลางไม่ขยายขนาด
          (renderRoundCards)
          ============================================================ */}
      <section aria-labelledby="open-rounds-heading">
        <SectionHeading
          id="open-rounds-heading"
          tone="primary"
          title={openLive.length > 0 ? `กำลังเปิดรับสมัคร ${openLive.length} รอบ` : 'กำลังเปิดรับสมัคร'}
          description="เลือกรอบที่ต้องการแล้วสมัครออนไลน์ได้ทันที"
        />

        {loading ? (
          <div className="grid gap-5 md:grid-cols-2">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="h-64 animate-pulse rounded-lg border border-slate-200 bg-white"
              />
            ))}
          </div>
        ) : failed ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-8 text-center">
            <p className="font-medium text-rose-800">โหลดข้อมูลรอบรับสมัครไม่สำเร็จ</p>
            <p className="mt-1 text-sm text-rose-700">
              กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่อีกครั้ง
            </p>
          </div>
        ) : openLive.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-10 text-center">
            <p className="font-medium text-slate-700">
              {justClosed > 0
                ? 'ปิดรับสมัครแล้ว'
                : 'ขณะนี้ยังไม่มีรอบที่เปิดรับสมัคร'}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {justClosed > 0
                ? 'รอบที่เปิดอยู่เพิ่งปิดรับสมัคร ระบบกำลังอัปเดตรายการ'
                : upcoming.length > 0
                  ? 'ดูกำหนดการเปิดรับสมัครรอบถัดไปได้ด้านล่าง'
                  : 'กรุณาติดตามประกาศจากสำนักงานฯ อีกครั้ง'}
            </p>
          </div>
        ) : (
          <div className={`grid gap-5 ${openLive.length > 1 ? 'md:grid-cols-2' : ''}`}>
            {renderRoundCards(openLive, nowMs, OpenRoundCard)}
          </div>
        )}
      </section>

      {/* ============================================================
          SECONDARY — กำหนดเปิดรับสมัคร
          ============================================================ */}
      {!loading && upcoming.length > 0 && (
        <section aria-labelledby="upcoming-rounds-heading">
          <SectionHeading
            id="upcoming-rounds-heading"
            title="กำหนดเปิดรับสมัคร"
            description="ประกาศแล้ว รอวันเปิดรับสมัคร"
          />
          <div className={`grid gap-5 ${upcoming.length > 1 ? 'md:grid-cols-2' : ''}`}>
            {renderRoundCards(upcoming, nowMs, UpcomingRoundCard)}
          </div>
        </section>
      )}

      {/* ============================================================
          TERTIARY — ปิดรับสมัครแล้ว (รายการเบา ๆ ไม่แย่งความสนใจ)
          ============================================================ */}
      {!loading && closed.length > 0 && (
        <section aria-labelledby="closed-rounds-heading">
          <SectionHeading
            id="closed-rounds-heading"
            title="ปิดรับสมัครแล้ว"
          />
          <ul className="space-y-2">
            {closed.map((round) => (
              <ClosedRoundRow key={round.id} round={round} />
            ))}
          </ul>
        </section>
      )}

      {/* ============================================================
          SECONDARY ACTION — ค้นหาใบสมัคร
          ไม่ลบ แต่ย่อขนาดและลดน้ำหนักลง (เดิมเป็น Card ใหญ่บนสุด)
          ============================================================ */}
      <section
        aria-labelledby="lookup-heading"
        className="border-t border-slate-200 pt-6"
      >
        <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <SearchIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <div>
              <h2 id="lookup-heading" className="text-sm font-semibold text-slate-800">
                สมัครแล้วต้องการตรวจสอบสถานะ?
              </h2>
              <p className="text-xs text-slate-500">
                ค้นหาใบสมัครย้อนหลังด้วยอีเมลและเบอร์โทรศัพท์
              </p>
            </div>
          </div>
          <Link href="/lookup" className="shrink-0">
            <Button variant="outline" size="sm" className="w-full gap-1.5 sm:w-auto">
              <SearchIcon className="h-3.5 w-3.5" />
              ค้นหาใบสมัคร
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
