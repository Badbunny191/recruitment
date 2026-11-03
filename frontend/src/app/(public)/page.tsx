'use client';

import { useEffect, useMemo, useState } from 'react';
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
  formatThaiDateTime,
  PHASE_STYLE,
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

/** เดินนาฬิกาทุก 30 วิ ให้ countdown ขยับโดยไม่ re-render ถี่เกินไป */
const useTick = (): number => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  void tick;
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
  const cd = computeCountdown(phase, round, nowMs);
  if (!cd) return null;

  const tone =
    phase === 'UPCOMING'
      ? 'bg-amber-50 border-amber-200 text-amber-900'
      : cd.urgent
        ? 'bg-rose-50 border-rose-200 text-rose-900'
        : 'bg-emerald-50 border-emerald-200 text-emerald-900';

  const iconTone =
    phase === 'UPCOMING'
      ? 'text-amber-600'
      : cd.urgent
        ? 'text-rose-600'
        : 'text-emerald-600';

  return (
    <div className={`rounded-lg border px-3.5 py-3 ${tone}`}>
      <div className="flex items-center gap-2">
        <ClockIcon className={`h-4 w-4 shrink-0 ${iconTone}`} />
        <span className="text-xs font-medium opacity-80">{cd.label}</span>
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
    <article className="flex flex-col rounded-lg border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-blue-500/40">
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-bold leading-snug text-slate-900">
            {round.title}
          </h3>
          <PhaseBadge phase="OPEN" />
        </div>

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

      <div className="px-5 pb-5">
        <Link href={`/apply?id=${round.id}`} className="block">
          <Button size="lg" className="w-full gap-2 text-base font-semibold">
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
  return (
    <article className="flex flex-col rounded-lg border border-amber-200 bg-white shadow-sm">
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold leading-snug text-slate-800">
            {round.title}
          </h3>
          <PhaseBadge phase="UPCOMING" />
        </div>

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

      <div className="px-5 pb-5">
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
  count,
  tone = 'default',
}: {
  id: string;
  title: string;
  description?: string;
  count?: number;
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
      {typeof count === 'number' && count > 0 && (
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
          {count} รอบ
        </span>
      )}
    </div>
  );
}

// =================================================================
//  Page
// =================================================================

export default function HomePage() {
  const [payload, setPayload] = useState<PublicRoundsPayload>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const tick = useTick();

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
    const requestedAt = Date.now();

    fetch(`${apiUrl}/public/rounds/active`)
      .then((res) => res.json())
      .then((json) => {
        setPayload(parseRoundsResponse(json, requestedAt));
        setLoading(false);
      })
      .catch(() => {
        setFailed(true);
        setLoading(false);
      });
  }, []);

  // เวลาอ้างอิง = นาฬิกาเครื่อง + offset ของเซิร์ฟเวอร์
  // → countdown ตรงกับเวลาจริงแม้เครื่องผู้ใช้ตั้งเวลาเพี้ยน
  const nowMs = useMemo(
    () => tick + payload.serverOffsetMs,
    [tick, payload.serverOffsetMs],
  );

  const { open, upcoming, closed } = payload;

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-4 py-8">
      {/* ============================================================
          PRIMARY — กำลังเปิดรับสมัคร (มีเฉพาะรอบที่สมัครได้จริง)
          ============================================================ */}
      <section aria-labelledby="open-rounds-heading">
        <SectionHeading
          id="open-rounds-heading"
          tone="primary"
          title="กำลังเปิดรับสมัคร"
          description="เลือกรอบที่ต้องการแล้วสมัครออนไลน์ได้ทันที"
          count={open.length}
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
        ) : open.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-10 text-center">
            <p className="font-medium text-slate-700">ขณะนี้ยังไม่มีรอบที่เปิดรับสมัคร</p>
            <p className="mt-1 text-sm text-slate-500">
              {upcoming.length > 0
                ? 'ดูกำหนดการเปิดรับสมัครรอบถัดไปได้ด้านล่าง'
                : 'กรุณาติดตามประกาศจากสำนักงานฯ อีกครั้ง'}
            </p>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {open.map((round) => (
              <OpenRoundCard key={round.id} round={round} nowMs={nowMs} />
            ))}
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
            description="รอบที่ประกาศแล้ว แต่ยังไม่ถึงวันเปิดรับสมัคร"
            count={upcoming.length}
          />
          <div className="grid gap-5 md:grid-cols-2">
            {upcoming.map((round) => (
              <UpcomingRoundCard key={round.id} round={round} nowMs={nowMs} />
            ))}
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
            count={closed.length}
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
