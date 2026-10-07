import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export default function DashboardPage() {
  return (
    <div className="p-8 space-y-6">
      <h1 className="text-3xl font-bold">Executive Dashboard</h1>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">ใบสมัครทั้งหมด</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">รอเชื่อมต่อ API</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">รอบที่เปิดรับ</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">-</div></CardContent>
        </Card>
      </div>
    </div>
  );
}