'use client';

import { usePathname, useRouter } from 'next/navigation';
import { AdminGuard } from '@/components/AdminGuard';
import { useAdminAuth } from '@/lib/useAdminAuth';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { logout } = useAdminAuth();

  // Safety net: /admin/login should be in (admin-auth) route group
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
              <a href="/admin/organizations" className="hover:text-blue-300">หน่วยงาน</a>
              <a href="/admin/job-families" className="hover:text-blue-300">Job Family</a>
              <a href="/admin/position-levels" className="hover:text-blue-300">Position Level</a>
              <a href="/admin/positions" className="hover:text-blue-300">Positions</a>
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