'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface RecruitmentRound {
  id: string;
  title: string;
  positionLevel: string;
  status: string;
  openDate: string | number | Date;
  closeDate: string | number | Date;
}

// =================================================================
//  Asia/Bangkok (UTC+7) helpers — client-side.
//
//  IMPORTANT: The backend stores `openDate` / `closeDate` as `unixepoch()`
//  seconds of the wall-clock value the admin entered in Thai time. That
//  means the stored integer is *already* the Bangkok wall clock (shifted
//  by -7h relative to the true UTC instant). To recover the value the
//  admin entered, we shift +7h and read the result as if it were UTC.
//
//  We never read the client machine's local timezone. We also never
//  compare against UTC directly — the gate logic lives on the server
//  side (see backend/src/routes/public.routes.ts) and is the only
//  authoritative source for whether an applicant can submit.
// =================================================================
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

const toDate = (value: string | number | Date | null | undefined): Date | null => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value;
  const d = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
  return isNaN(d.getTime()) ? null : d;
};

// "10 ต.ค. 2569 09:00" — admin's original Thai wall clock, no client TZ.
const formatThaiDateTime = (value: string | number | Date | null | undefined): string => {
  const d = toDate(value);
  if (!d) return 'ไม่กำหนด';
  const dThai = new Date(d.getTime() + BANGKOK_OFFSET_MS);
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const day = dThai.getUTCDate();
  const month = months[dThai.getUTCMonth()];
  const year = dThai.getUTCFullYear() + 543;
  const hh = String(dThai.getUTCHours()).padStart(2, '0');
  const mm = String(dThai.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${year} ${hh}:${mm}`;
};

// Now as a "Bangkok wall clock" Date (in the +7h-shifted scale). Same
// pattern as the server gate so client and server agree.
const nowBangkok = (): number => Date.now() + BANGKOK_OFFSET_MS;

type Lifecycle = 'OPEN' | 'NOT_OPEN_YET' | 'ALREADY_CLOSED' | 'CLOSED' | 'DRAFT';

// Mirror the server gate so we can render a friendly badge on the
// landing page. The server gate (backend/public.routes.ts) remains the
// authoritative source for whether a /submit call succeeds.
const computeLifecycle = (round: RecruitmentRound): Lifecycle => {
  const status = (round.status ?? 'DRAFT').toUpperCase();
  if (status === 'CLOSED') return 'CLOSED';
  if (status === 'DRAFT') return 'DRAFT';
  const open = toDate(round.openDate);
  const close = toDate(round.closeDate);
  if (!open || !close) return 'ALREADY_CLOSED';
  const now = nowBangkok();
  if (now < open.getTime() + BANGKOK_OFFSET_MS) return 'NOT_OPEN_YET';
  if (now > close.getTime() + BANGKOK_OFFSET_MS) return 'ALREADY_CLOSED';
  return 'OPEN';
};

const BADGE: Record<Lifecycle, { label: string; cls: string; dot: string }> = {
  OPEN:           { label: 'เปิดรับสมัคร',           cls: 'bg-emerald-100 text-emerald-800 border-emerald-300', dot: 'bg-emerald-500' },
  NOT_OPEN_YET:   { label: 'ยังไม่เปิดรับสมัคร',     cls: 'bg-amber-100 text-amber-800 border-amber-300',     dot: 'bg-amber-500' },
  ALREADY_CLOSED: { label: 'ปิดรับสมัครแล้ว',         cls: 'bg-rose-100 text-rose-800 border-rose-300',         dot: 'bg-rose-500' },
  CLOSED:         { label: 'ปิดรับสมัครแล้ว',         cls: 'bg-rose-100 text-rose-800 border-rose-300',         dot: 'bg-rose-500' },
  DRAFT:          { label: 'ยังไม่เปิดรับสมัคร',     cls: 'bg-amber-100 text-amber-800 border-amber-300',     dot: 'bg-amber-500' },
};

// "เหลือเวลาสมัครอีก 2 วัน 13 ชั่วโมง 45 นาที" — collapses to the
// largest two non-zero units so the line stays short. Returns null
// for past times.
const formatCountdown = (ms: number): string | null => {
  if (ms <= 0) return null;
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  if (days > 0)   return `${days} วัน ${hours} ชั่วโมง`;
  if (hours > 0)  return `${hours} ชั่วโมง ${minutes} นาที`;
  if (minutes > 0) return `${minutes} นาที`;
  return 'น้อยกว่า 1 นาที';
};

const useNow = (): number => {
  // Re-render every 30s so the countdown ticks visibly without thrashing.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  // tick is read so React tracks it.
  void tick;
  return Date.now();
};

export default function HomePage() {
  const [rounds, setRounds] = useState<RecruitmentRound[]>([]);
  const [loading, setLoading] = useState(true);
  const now = useNow();

  useEffect(() => {
    fetch((process.env.NEXT_PUBLIC_API_URL || '') + '/public/rounds/active')
      .then((res) => res.json())
      .then((res) => {
        setRounds(res.data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // The header is already in the global layout (สำนักงานฯ). Don't repeat
  // the same title in the page body — only show what users came for: the
  // list of currently open rounds.
  return (
    <div className="max-w-5xl mx-auto p-8 space-y-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">รอบรับสมัครที่เปิดอยู่</h1>
        <p className="text-slate-500 mt-1 text-sm">เลือกรอบที่ต้องการสมัครเพื่อเข้าสู่ระบบรับสมัครออนไลน์</p>
      </div>

      {loading ? (
        <Card className="p-12 text-center text-slate-500">กำลังโหลดข้อมูล...</Card>
      ) : rounds.length === 0 ? (
        <Card className="p-12 text-center text-slate-500">
          ไม่มีรอบการรับสมัครที่เปิดอยู่ ณ ขณะนี้
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {rounds.map((round) => {
            const life = computeLifecycle(round);
            const badge = BADGE[life];
            const close = toDate(round.closeDate);
            const open  = toDate(round.openDate);
            // Countdown always anchors to the next boundary (open or close)
            // so users get a useful "เหลืออีก..." number regardless of
            // which phase the round is in.
            let countdownTarget: Date | null = null;
            let countdownLabel: 'เหลือเวลาสมัครอีก' | 'เปิดรับสมัครในอีก' = 'เหลือเวลาสมัครอีก';
            if (life === 'NOT_OPEN_YET' && open) {
              countdownTarget = open;
              countdownLabel = 'เปิดรับสมัครในอีก';
            } else if (life === 'OPEN' && close) {
              countdownTarget = close;
              countdownLabel = 'เหลือเวลาสมัครอีก';
            }
            const countdownText = countdownTarget
              ? formatCountdown(countdownTarget.getTime() - now)
              : null;
            const ctaDisabled = life !== 'OPEN';

            return (
              <Card key={round.id} className="hover:shadow-md transition-shadow flex flex-col">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-xl text-blue-900">{round.title}</CardTitle>
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap ${badge.cls}`}
                    >
                      <span className={`w-2 h-2 rounded-full ${badge.dot}`} />
                      {badge.label}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-slate-600 flex-1">
                  <div>
                    <span className="font-medium">ระดับตำแหน่ง:</span>{' '}
                    <span className="font-semibold text-slate-800">{round.positionLevel}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span aria-hidden>📅</span>
                    <div>
                      <span className="font-medium">เปิดรับสมัคร:</span>{' '}
                      <span className="font-semibold text-slate-800">
                        {formatThaiDateTime(round.openDate)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <span aria-hidden>📅</span>
                    <div>
                      <span className="font-medium">ปิดรับสมัคร:</span>{' '}
                      <span className="font-semibold text-slate-800">
                        {formatThaiDateTime(round.closeDate)}
                      </span>
                    </div>
                  </div>
                  {countdownText && (
                    <div className="flex items-center gap-2 pt-1 text-blue-700">
                      <span aria-hidden>⏳</span>
                      <span className="font-medium">{countdownLabel} {countdownText}</span>
                    </div>
                  )}
                </CardContent>
                <CardFooter>
                  {ctaDisabled ? (
                    <Button
                      className="w-full"
                      variant="secondary"
                      disabled
                      aria-disabled="true"
                    >
                      {life === 'NOT_OPEN_YET' || life === 'DRAFT'
                        ? 'ยังไม่เปิดรับสมัคร'
                        : 'ปิดรับสมัครแล้ว'}
                    </Button>
                  ) : (
                    <Link href={`/apply?id=${round.id}`} className="w-full">
                      <Button className="w-full bg-blue-600 hover:bg-blue-700">
                        สมัครเข้ารับการคัดเลือก
                      </Button>
                    </Link>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
