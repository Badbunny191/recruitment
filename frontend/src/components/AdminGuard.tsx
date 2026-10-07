'use client';

import { useAdminAuth } from '@/lib/useAdminAuth';

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
    // กำลัง redirect อยู่ — แสดง loading ป้องกัน flash content
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-slate-500">กำลังเข้าสู่ระบบ...</div>
      </div>
    );
  }

  return <>{children}</>;
}