import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ระบบรับสมัครคัดเลือกบุคลากร',
  description: 'หน้าแรก - ระบบรับสมัครงานออนไลน์',
};

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-blue-800 text-white p-4 shadow-md">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-2xl font-bold">สำนักงานการตรวจเงินแผ่นดิน (สตง.)</h1>
          <p className="text-blue-200 text-sm">ระบบรับสมัครคัดเลือกบุคลากร</p>
        </div>
      </header>
      <main className="py-8">{children}</main>
      <footer className="bg-slate-800 text-white p-4 text-center text-sm">
        © 2569 สำนักงานการตรวจเงินแผ่นดิน
      </footer>
    </div>
  );
}
