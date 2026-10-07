'use client';

import { useAdminAuth } from '@/lib/useAdminAuth';

/**
 * AdminGuard - Client-side route protection for /admin/* pages
 *
 * This component MUST be rendered AFTER the layout-level pathname check.
 * The layout is responsible for not rendering this on /admin/login.
 */
export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { isChecking, isAuthenticated } = useAdminAuth();

  if (isChecking) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-slate-500">กำลังตรวจสอบสิทธิ์...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-slate-500">กำลังเข้าสู่ระบบ...</div>
      </div>
    );
  }

  return <>{children}</>;
}