'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface RecruitmentRound {
  id: string;
  title: string;
  positionLevel: string;
  openDate: number;
  closeDate: number;
}

export default function HomePage() {
  const [rounds, setRounds] = useState<RecruitmentRound[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(process.env.NEXT_PUBLIC_API_URL + '/public/rounds/active')
      .then((res) => res.json())
      .then((res) => {
        setRounds(res.data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-center">กำลังโหลดข้อมูล...</div>;

  return (
    <div className="max-w-5xl mx-auto p-8 space-y-6">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-slate-900">ระบบรับสมัครคัดเลือกบุคลากร</h1>
        <p className="text-slate-500 mt-2">สำนักงานการตรวจเงินแผ่นดิน (สตง.)</p>
      </div>

      {rounds.length === 0 ? (
        <Card className="p-12 text-center text-slate-500">
          ไม่มีรอบการรับสมัครที่เปิดอยู่ ณ ขณะนี้
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {rounds.map((round) => (
            <Card key={round.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="text-xl text-blue-900">{round.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-slate-600">
                <div>ระดับตำแหน่ง: <span className="font-semibold">{round.positionLevel}</span></div>
                <div>ปิดรับสมัคร: <span className="font-semibold text-red-600">
                  {new Date(round.closeDate * 1000).toLocaleDateString('th-TH')}
                </span></div>
              </CardContent>
              <CardFooter>
                <Link href={`/apply?id=${round.id}`} className="w-full">
                  <Button className="w-full bg-blue-600 hover:bg-blue-700">สมัครเข้ารับการคัดเลือก</Button>
                </Link>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}