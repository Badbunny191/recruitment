'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function SuccessPage() {
  const searchParams = useSearchParams();
  const appNo = searchParams.get('appNo');

  return (
    <div className="min-h-[80vh] flex items-center justify-center p-4">
      <Card className="w-full max-w-md text-center shadow-lg border-t-4 border-t-green-500">
        <CardHeader className="pt-8">
          <CardTitle className="text-2xl text-slate-800">ส่งใบสมัครสำเร็จ!</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pb-6">
          <p className="text-slate-600">
            ระบบได้รับข้อมูลการสมัครของคุณเรียบร้อยแล้ว<br />
          </p>
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <p className="text-sm text-slate-500 mb-1">เลขที่อ้างอิงใบสมัครของคุณคือ</p>
            <p className="text-2xl font-mono font-bold text-slate-900">{appNo || 'N/A'}</p>
          </div>
        </CardContent>
        <CardFooter className="flex justify-center pb-8">
          <Link href="/">
            <Button variant="outline" className="w-full px-8">กลับสู่หน้าหลัก</Button>
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}