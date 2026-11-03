'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface SubmittedApplicationInfo {
  appNo: string;
  email: string;
  phone: string;
  // Success Page UX (FE-only) — เขียนโดย review page หลัง submit สำเร็จ:
  //   · fullname       ← draft.formData['field-fullname'] (backend บังคับ field นี้
  //                      จึงมีเสมอในใบที่ submit สำเร็จ)
  //   · roundId        ← draft.roundId
  //   · roundTitle / positionLevel ← GET /public/rounds/:id/detail (endpoint เดิม)
  // Record ที่เขียนโดยโค้ดรุ่นก่อน (แท็บค้างก่อน deploy) อาจไม่มี field เหล่านี้ —
  // ทุก field ต้อง render แบบ optional (แถวไหนไม่มีค่า → ซ่อนแถวนั้น)
  fullname?: string;
  roundId?: string;
  roundTitle?: string;
  positionLevel?: string;
}

function SuccessContent() {
  const [application, setApplication] = useState<SubmittedApplicationInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = sessionStorage.getItem('lastSubmittedApplication');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && parsed.appNo) {
            setApplication({
              appNo: String(parsed.appNo || ''),
              email: String(parsed.email || ''),
              phone: String(parsed.phone || ''),
              fullname: String(parsed.fullname ?? ''),
              roundId: String(parsed.roundId ?? ''),
              roundTitle: String(parsed.roundTitle ?? ''),
              positionLevel: String(parsed.positionLevel ?? ''),
            });
            setLoading(false);
            return;
          }
        }
      } catch {
        // ignore parse error
      }
    }
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-500">
        กำลังโหลด...
      </div>
    );
  }

  if (!application) {
    return (
      <Card className="w-full max-w-md text-center shadow-lg border-t-4 border-t-amber-500">
        <CardHeader className="pt-8">
          <CardTitle className="text-xl text-slate-800">⚠️ ไม่พบข้อมูลการสมัครล่าสุด</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pb-4">
          <p className="text-sm text-slate-600 leading-relaxed">
            ไม่พบข้อมูลการส่งใบสมัครในเซสชันปัจจุบัน<br />
            หากท่านได้ส่งใบสมัครแล้ว ท่านสามารถตรวจสอบสถานะได้ผ่านหน้า &quot;ค้นหาใบสมัคร&quot;
          </p>
        </CardContent>
        <CardFooter className="flex flex-col gap-2.5 pb-8 pt-2">
          <Link href="/lookup" className="w-full">
            <Button variant="brand" className="w-full font-medium py-2.5 shadow-sm">
              ค้นหาใบสมัคร
            </Button>
          </Link>
          <Link href="/" className="w-full">
            <Button variant="outline" className="w-full py-2.5 text-slate-700 border-slate-300 hover:bg-slate-50">
              กลับหน้าแรก
            </Button>
          </Link>
        </CardFooter>
      </Card>
    );
  }

  // ตำแหน่ง fallback เป็นชื่อรอบเมื่อ positionLevel ว่าง — parity กับฝั่ง backend
  // (applicant-lookup.service.ts: positionTitle = round.positionLevel || round.title)
  const positionDisplay = application.positionLevel || application.roundTitle;
  // รอบในกล่องคำแนะนำต้องแสดง format เดียวกับ dropdown หน้า /lookup
  // (lookup/page.tsx: "{title} ({positionLevel})") เพื่อให้ผู้สมัครจดจำแล้ว
  // เลือกถูกต้องตอนค้นหา (recognition transfer) — ค่าใดว่างจึงหล่นทิ้ง ไม่มีวงเล็บเปล่า
  const roundDisplay = application.roundTitle && application.positionLevel
    ? `${application.roundTitle} (${application.positionLevel})`
    : application.roundTitle || application.positionLevel || '';

  return (
    <Card className="w-full max-w-md text-center shadow-lg border-t-4 border-t-green-500">
      <CardHeader className="pt-8">
        <CardTitle className="text-2xl text-slate-800">✅ ส่งใบสมัครเรียบร้อยแล้ว</CardTitle>
        {application.fullname && (
          <p className="text-sm text-slate-600 mt-1">
            ใบสมัครของ {application.fullname} ถูกบันทึกเรียบร้อยแล้ว
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-5 pb-4">
        {/* สรุปใบสมัคร — ตัวตนที่ผู้สมัครต้องเห็นว่า "สมัครอะไร รอบไหน" */}
        <div className="bg-slate-50 rounded-lg p-4 border border-slate-200 text-center">
          <p className="text-sm text-slate-500 mb-1">เลขที่ใบสมัคร</p>
          <p className="text-2xl font-mono font-bold text-slate-900">{application.appNo}</p>
          <div className="mt-3 pt-3 border-t border-slate-200 text-sm text-slate-600 space-y-1 text-left break-words">
            {application.fullname && (
              <p>
                <span className="text-slate-500">ชื่อผู้สมัคร: </span>
                <span className="font-medium text-slate-900">{application.fullname}</span>
              </p>
            )}
            {positionDisplay && (
              <p>
                <span className="text-slate-500">ตำแหน่งที่สมัคร: </span>
                <span className="font-medium text-slate-900">{positionDisplay}</span>
              </p>
            )}
            {application.roundTitle && (
              <p>
                <span className="text-slate-500">รอบรับสมัคร: </span>
                <span className="font-medium text-slate-900">{application.roundTitle}</span>
              </p>
            )}
            <p>
              <span className="text-slate-500">อีเมล: </span>
              <span className="font-medium text-slate-900">{application.email || '-'}</span>
            </p>
            <p>
              <span className="text-slate-500">เบอร์โทรศัพท์: </span>
              <span className="font-medium text-slate-900">{application.phone || '-'}</span>
            </p>
          </div>
        </div>

        {/* คีย์ค้นหาภายหลัง — lookup ต้องมีครบทั้ง 3 (รอบ + อีเมล + เบอร์)
            จึงแสดง "ค่าจริง" เป็น checklist แทนชื่อ field อย่างเดียว */}
        <div className="space-y-2.5 text-slate-600 bg-brand/5 border border-brand/20 rounded-lg p-4 text-left">
          <p className="font-medium text-slate-800 text-sm">
            ค้นหาใบสมัครในภายหลัง ต้องใช้ข้อมูล 3 อย่างนี้
          </p>
          <div className="text-sm text-slate-700 space-y-1.5 pl-1">
            <p>
              <span className="font-medium text-slate-900">1. รอบรับสมัคร</span>
              {roundDisplay && (
                <>
                  {': '}
                  <span className="font-medium text-slate-900 break-words">{roundDisplay}</span>
                </>
              )}
            </p>
            <p>
              <span className="font-medium text-slate-900">2. อีเมล: </span>
              <span className="font-medium text-slate-900 break-words">{application.email || '—'}</span>
            </p>
            <p>
              <span className="font-medium text-slate-900">3. เบอร์โทรศัพท์: </span>
              <span className="font-medium text-slate-900">{application.phone || '—'}</span>
            </p>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed pt-2 border-t border-brand/20">
            อีเมลและเบอร์โทรศัพท์ต้องเป็นข้อมูลเดียวกับที่กรอกในใบสมัคร จึงจะค้นหาได้
          </p>
        </div>

        <p className="text-xs text-slate-600 leading-relaxed">
          ตรวจสอบสถานะและดาวน์โหลดใบสมัคร (PDF) ได้ที่หน้า &quot;ค้นหาใบสมัคร&quot;
        </p>
      </CardContent>
      <CardFooter className="flex flex-col gap-2.5 pb-8 pt-2">
        <Link href="/lookup" className="w-full">
          <Button variant="brand" className="w-full font-medium py-2.5 shadow-sm">
            ค้นหาใบสมัคร
          </Button>
        </Link>
        <Link href="/" className="w-full">
          <Button variant="outline" className="w-full py-2.5 text-slate-700 border-slate-300 hover:bg-slate-50">
            กลับหน้าแรก
          </Button>
        </Link>
      </CardFooter>
    </Card>
  );
}

export default function SuccessPage() {
  return (
    <div className="min-h-[80vh] flex items-center justify-center p-4">
      <Suspense fallback={<div className="p-8 text-center">กำลังโหลด...</div>}>
        <SuccessContent />
      </Suspense>
    </div>
  );
}
