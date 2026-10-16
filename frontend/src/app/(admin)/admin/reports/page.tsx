'use client';

import { useRole } from '@/lib/useRole';

/**
 * Reports Page (RBAC v1)
 * ----------------------
 * - SUPER_ADMIN: เข้าถึงได้
 * - ADMIN: เข้าถึงได้
 * - VIEWER: เข้าถึงได้ (read-only)
 *
 * หน้านี้เป็น placeholder — ใช้สำหรับ RBAC UI consistency
 * เมื่อถึง phase ถัดไปจะเชื่อมกับ API รายงานจริง
 */
export default function ReportsPage() {
  const { role } = useRole();

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex items-center gap-2">
        <span className="text-2xl">📈</span>
        <div>
          <h1 className="text-2xl font-bold">รายงาน (Reports)</h1>
          <p className="text-sm text-slate-500">
            ภาพรวมและสถิติของระบบรับสมัคร
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center">
        <span className="text-5xl">📊</span>
        <h2 className="text-lg font-semibold mt-4 text-slate-700">
          กำลังเตรียมหน้ารายงาน
        </h2>
        <p className="text-sm text-slate-500 mt-2">
          หน้ารายงานจะพร้อมใช้งานเร็วๆ นี้
        </p>
        {role && (
          <p className="text-xs text-slate-400 mt-4">
            สิทธิ์ปัจจุบัน: <span className="font-mono font-bold">{role}</span>
          </p>
        )}
      </div>
    </div>
  );
}
