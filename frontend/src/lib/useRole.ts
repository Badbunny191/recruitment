'use client';

import { useAdminAuth, type AdminUserRole } from '@/lib/useAdminAuth';

export interface UseRoleResult {
  role: AdminUserRole | null;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isViewer: boolean;
  /**
   * True if the user can perform any write action (Create / Edit / Delete / Archive / Restore / Publish / Change Status / Bulk).
   * - SUPER_ADMIN → true
   * - ADMIN       → true
   * - VIEWER      → false
   * - null/unknown → false (defensive)
   */
  canWrite: boolean;
  /**
   * True if the user can manage users (create / edit / disable / reset password).
   * - SUPER_ADMIN → true
   * - ADMIN       → false
   * - VIEWER      → false
   */
  canManageUsers: boolean;
}

/**
 * Centralized RBAC helper for the frontend.
 *
 * Source of truth: the role encoded in the JWT by the backend.
 * Backend role set: ['SUPER_ADMIN', 'ADMIN', 'VIEWER'] (see backend/src/types.ts).
 *
 * This hook must only be used inside client components. For server-side
 * authorization, the backend still enforces middleware on every endpoint.
 */
export function useRole(): UseRoleResult {
  const { user } = useAdminAuth();

  const role: AdminUserRole | null = user?.role ?? null;
  const isSuperAdmin = role === 'SUPER_ADMIN';
  const isAdmin = role === 'ADMIN';
  const isViewer = role === 'VIEWER';

  // RBAC v1 matrix:
  //   SUPER_ADMIN → canWrite = true (full access)
  //   ADMIN       → canWrite = true (จัดการข้อมูลทั่วไป ยกเว้น User Management)
  //   VIEWER      → canWrite = false (read-only ทุกเมนู)
  const canWrite = isSuperAdmin || isAdmin;

  // RBAC v1: เฉพาะ SUPER_ADMIN เท่านั้นที่จัดการผู้ใช้ได้ (สร้าง/แก้ไข/ปิดใช้งาน/รีเซ็ตรหัสผ่าน)
  const canManageUsers = isSuperAdmin;

  return {
    role,
    isSuperAdmin,
    isAdmin,
    isViewer,
    canWrite,
    canManageUsers,
  };
}
