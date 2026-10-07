'use client';

import { useAdminAuth } from '@/lib/useAdminAuth';

/**
 * AdminGuard - Client-side route protection for /admin/* pages
 *
 * Usage: Wrap children with <AdminGuard>...</AdminGuard>
 * The login page (/admin/login) should NOT use this component.
 */
export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { isChecking, isAuthenticated } = useAdminAuth();

  // Show loading while checking auth
  if (isChecking) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-slate-500">กำลังตรวจสอบสิทธิ์...</div>
      </div>
    );
  }

  // Auth failed - redirect will happen via the hook
  if (!isAuthenticated) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-slate-500">กำลังเข้าสู่ระบบ...</div>
      </div>
    );
  }

  // Auth successful - render children
  return <>{children}</>;
}