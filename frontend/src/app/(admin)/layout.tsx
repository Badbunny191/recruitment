'use client';

import dynamic from 'next/dynamic';
import { usePathname, useRouter } from 'next/navigation';
import { useAdminAuth } from '@/lib/useAdminAuth';

// Dynamically import AdminGuard with SSR disabled to prevent
// it from being pre-rendered as "loading" state in static HTML
const AdminGuard = dynamic(
  () => import('@/components/AdminGuard').then((mod) => mod.AdminGuard),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-slate-500">กำลังโหลด...</div>
      </div>
    ),
  }
);

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { logout } = useAdminAuth();

  // หน้า login ไม่ต้องห่อด้วย AdminGuard
  if (pathname === '/admin/login') {
    return <>{children}</>;
  }

  return (
    <AdminGuard>
      <div className="min-h-screen bg-slate-100">
        <nav className="bg-slate-800 text-white p-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <h1 className="text-xl font-bold">SAO Admin</h1>
            <div className="flex gap-4 items-center">
              <a href="/admin/dashboard" className="hover:text-blue-300">Dashboard</a>
              <a href="/admin/rounds" className="hover:text-blue-300">รอบรับสมัคร</a>
              <a href="/admin/fields" className="hover:text-blue-300">Field Master</a>
              <a href="/admin/templates" className="hover:text-blue-300">Templates</a>
              <a href="/admin/applications" className="hover:text-blue-300">ใบสมัคร</a>
              <a href="/admin/audit-logs" className="hover:text-blue-300">Audit Logs</a>
              <button
                onClick={() => {
                  logout();
                  router.push('/admin/login');
                }}
                className="ml-4 px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-sm"
              >
                ออกจากระบบ
              </button>
            </div>
          </div>
        </nav>
        {children}
      </div>
    </AdminGuard>
  );
}