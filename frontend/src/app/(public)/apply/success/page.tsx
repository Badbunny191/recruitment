'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface SubmittedApplicationInfo {
  appNo: string;
  email: string;
  phone: string;
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
            หากท่านได้ส่งใบสมัครแล้ว ท่านสามารถตรวจสอบสถานะได้ผ่านเมนู &quot;ค้นหาใบสมัคร&quot;
          </p>
        </CardContent>
        <CardFooter className="flex flex-col gap-2.5 pb-8 pt-2">
          <Link href="/lookup" className="w-full">
            <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 shadow-sm">
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

  return (
    <Card className="w-full max-w-md text-center shadow-lg border-t-4 border-t-green-500">
      <CardHeader className="pt-8">
        <CardTitle className="text-2xl text-slate-800">✅ ส่งใบสมัครเรียบร้อยแล้ว</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 pb-4">
        <div className="bg-slate-50 rounded-lg p-4 border border-slate-200 text-center">
          <p className="text-sm text-slate-500 mb-1">เลขที่ใบสมัคร</p>
          <p className="text-2xl font-mono font-bold text-slate-900">{application.appNo}</p>
          <div className="mt-3 pt-3 border-t border-slate-200 text-sm text-slate-600 space-y-1">
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

        <div className="space-y-2.5 text-slate-600 bg-blue-50/60 border border-blue-100 rounded-lg p-4 text-left">
          <p className="font-medium text-slate-800 text-sm">
            คำแนะนำสำหรับการค้นหาใบสมัคร:
          </p>
          <p className="text-xs text-slate-500 leading-relaxed">
            ท่านสามารถใช้ข้อมูลต่อไปนี้
          </p>
          <ul className="text-sm text-slate-700 list-disc list-inside space-y-1 pl-1">
            <li><span className="font-medium text-slate-900">รอบรับสมัคร</span></li>
            <li><span className="font-medium text-slate-900">อีเมล</span></li>
            <li><span className="font-medium text-slate-900">เบอร์โทรศัพท์</span></li>
          </ul>
          <p className="text-xs text-slate-600 leading-relaxed pt-2 border-t border-blue-100">
            ในการ<strong>ค้นหาใบสมัคร</strong> <strong>ตรวจสอบสถานะ</strong> และ<strong>ดาวน์โหลดใบสมัคร PDF</strong> ได้ในภายหลังผ่านเมนู &quot;ค้นหาใบสมัคร&quot;
          </p>
        </div>
      </CardContent>
      <CardFooter className="flex flex-col gap-2.5 pb-8 pt-2">
        <Link href="/lookup" className="w-full">
          <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 shadow-sm">
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
