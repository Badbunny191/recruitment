'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAdminAuth } from '@/lib/useAdminAuth';
import {
  CHANGE_PASSWORD_PATH,
  installMustChangePasswordFetchInterceptor,
  readMustChangePasswordFlag,
} from '@/lib/must-change-password';

/**
 * AdminGuard - Client-side route protection for /admin/* pages
 *
 * This component MUST be rendered AFTER the layout-level pathname check.
 * The layout is responsible for not rendering this on /admin/login.
 *
 * R9 (mustChangePassword enforcement):
 * - ถ้า flag ค้างจาก login (localStorage) ให้ redirect ทันทีก่อนหน้าโหลดข้อมูล
 *   — ไม่ปล่อยให้หน้า admin แสดง "โหลดข้อมูลไม่สำเร็จ" แทน security error
 * - ติดตั้ง fetch interceptor ดัก 403 MUST_CHANGE_PASSWORD จากทุก endpoint
 *   (ครอบคลุมหน้าที่เรียก raw fetch เอง) — กันกรณี admin force flag ขณะ
 *   ผู้ใช้กำลังใช้งานอยู่ (localStorage flag ยังไม่รู้ตัว)
 * - ไม่ redirect ซ้ำเมื่ออยู่หน้า /admin/change-password เอง (กัน loop)
 */
export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { isChecking, isAuthenticated } = useAdminAuth();
  const router = useRouter();
  const pathname = usePathname();

  // ติดตั้งครั้งเดียวตอน mount — idempotent + uninstall ตอน unmount (StrictMode safe)
  useEffect(() => {
    return installMustChangePasswordFetchInterceptor();
  }, []);

  useEffect(() => {
    if (isChecking || !isAuthenticated) return;
    if (pathname === CHANGE_PASSWORD_PATH) return;
    if (readMustChangePasswordFlag()) {
      router.replace(CHANGE_PASSWORD_PATH);
    }
  }, [isChecking, isAuthenticated, pathname, router]);

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
