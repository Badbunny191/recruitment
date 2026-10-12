'use client';

import { usePathname } from 'next/navigation';
import { AdminGuard } from '@/components/AdminGuard';
import { AdminNavbar } from '@/components/admin/AdminNavbar';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  // Safety net: /admin/login should be in (admin-auth) route group
  if (pathname === '/admin/login') {
    return <>{children}</>;
  }

  return (
    <AdminGuard>
      <div className="min-h-screen bg-slate-100">
        <AdminNavbar />
        {children}
      </div>
    </AdminGuard>
  );
}
