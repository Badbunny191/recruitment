'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

function SuccessContent() {
  const searchParams = useSearchParams();
  const appNo = searchParams.get('appNo') || searchParams.get('applicationNo') || '';
  const email = searchParams.get('email') || '';
  const phone = searchParams.get('phone') || searchParams.get('tel') || '';

  return (
    <Card className="w-full max-w-md text-center shadow-lg border-t-4 border-t-green-500">
      <CardHeader className="pt-8">
        <CardTitle className="text-2xl text-slate-800">✅ ส่งใบสมัครเรียบร้อยแล้ว</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 pb-6">
        <div className="bg-slate-50 rounded-lg p-4 border border-slate-200 text-center">
          <p className="text-sm text-slate-500 mb-1">เลขที่ใบสมัคร</p>
          <p className="text-2xl font-mono font-bold text-slate-900">{appNo || 'N/A'}</p>
          <div className="mt-3 pt-3 border-t border-slate-200 text-sm text-slate-600 space-y-1">
            <p>
              <span className="text-slate-500">อีเมล: </span>
              <span className="font-medium text-slate-900">{email || '-'}</span>
            </p>
            <p>
              <span className="text-slate-500">เบอร์โทรศัพท์: </span>
              <span className="font-medium text-slate-900">{phone || '-'}</span>
            </p>
          </div>
        </div>

        <div className="space-y-2 text-slate-600">
          <p className="font-medium text-slate-800">
            กรุณาบันทึกอีเมลและเบอร์โทรศัพท์ที่ใช้ในการสมัครครั้งนี้ไว้
          </p>
          <p className="text-sm text-slate-500 leading-relaxed">
            หากปิดหน้านี้แล้ว ท่านสามารถใช้ข้อมูลดังกล่าว<br />
            เพื่อค้นหาใบสมัคร ตรวจสอบสถานะ<br />
            และดาวน์โหลดเอกสารใบสมัครได้ภายหลัง<br />
            ผ่านเมนู &quot;ค้นหาใบสมัคร&quot;
          </p>
        </div>
      </CardContent>
      <CardFooter className="flex justify-center pb-8">
        <Link href="/" className="w-full">
          <Button variant="outline" className="w-full px-8">
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
