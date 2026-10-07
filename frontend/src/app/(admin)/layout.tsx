import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Admin - ระบบรับสมัครคัดเลือกบุคลากร',
  description: 'หน้าผู้ดูแลระบบ',
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-100">
      <nav className="bg-slate-800 text-white p-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold">SAO Admin</h1>
          <div className="flex gap-4">
            <a href="/admin/dashboard" className="hover:text-blue-300">Dashboard</a>
            <a href="/admin/rounds" className="hover:text-blue-300">รอบรับสมัคร</a>
            <a href="/admin/fields" className="hover:text-blue-300">Field Master</a>
            <a href="/admin/templates" className="hover:text-blue-300">Templates</a>
            <a href="/admin/applications" className="hover:text-blue-300">ใบสมัคร</a>
            <a href="/admin/audit-logs" className="hover:text-blue-300">Audit Logs</a>
          </div>
        </div>
      </nav>
      {children}
    </div>
  );
}
