/**
 * User Management Types
 * ---------------------
 * Types สำหรับ User Management API
 */

export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'VIEWER';

export interface AdminUser {
  id: string;
  email: string;
  role: UserRole;
  passwordMigrated: boolean;
  passwordChangedAt: number | null;
  mustChangePassword: boolean;
  failedLoginAttempts: number;
  lockedUntil: number | null;
  isActive?: boolean;
  createdAt: number;
}

export interface CreateUserRequest {
  email: string;
  role: UserRole;
  mustChangePassword?: boolean;
}

export interface UpdateUserRequest {
  email?: string;
  role?: UserRole;
  isActive?: boolean;
}

export interface CreateUserResponse {
  success: boolean;
  id: string;
  temporaryPassword: string; // Plaintext temp password (returned ONCE)
  message: string;
}

export interface ResetPasswordResponse {
  success: boolean;
  temporaryPassword: string; // Plaintext temp password (returned ONCE)
  message: string;
}

export interface ApiError {
  error: string;
  message: string;
  remainingAttempts?: number;
  retryAfter?: number;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  VIEWER: 'Viewer',
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  SUPER_ADMIN: 'สิทธิ์สูงสุด จัดการทุกอย่างได้ รวมถึงจัดการผู้ใช้อื่น',
  ADMIN: 'จัดการข้อมูลหลักและผู้ใช้ (ยกเว้น Super Admin)',
  VIEWER: 'ดูข้อมูลอย่างเดียว ไม่สามารถแก้ไขได้',
};

/**
 * Role Badge Colors (RBAC v1)
 * - SUPER_ADMIN → แดง (สิทธิ์สูงสุด)
 * - ADMIN       → น้ำเงิน (สิทธิ์จัดการ)
 * - VIEWER      → เทา (อ่านอย่างเดียว)
 */
export const ROLE_COLORS: Record<UserRole, string> = {
  SUPER_ADMIN: 'bg-red-100 text-red-800 border-red-200',
  ADMIN: 'bg-blue-100 text-blue-800 border-blue-200',
  VIEWER: 'bg-slate-100 text-slate-700 border-slate-200',
};

/** Role Badge variants สำหรับ Header (icon + label) */
export const ROLE_BADGE: Record<UserRole, { emoji: string; label: string }> = {
  SUPER_ADMIN: { emoji: '🛡️', label: 'SUPER_ADMIN' },
  ADMIN: { emoji: '👤', label: 'ADMIN' },
  VIEWER: { emoji: '👁️', label: 'VIEWER' },
};
