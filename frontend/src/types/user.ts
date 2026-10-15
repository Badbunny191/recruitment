/**
 * User Management Types
 * ---------------------
 * Types สำหรับ User Management API
 */

export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'REVIEWER' | 'VIEWER';

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
  tempPassword?: string; // Only returned in demo/development
  message: string;
}

export interface ResetPasswordResponse {
  success: boolean;
  tempPassword?: string;
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
  REVIEWER: 'Reviewer',
  VIEWER: 'Viewer',
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  SUPER_ADMIN: 'สิทธิ์สูงสุด จัดการทุกอย่างได้ รวมถึงจัดการผู้ใช้อื่น',
  ADMIN: 'จัดการข้อมูลหลักและผู้ใช้ (ยกเว้น Super Admin)',
  REVIEWER: 'ตรวจสอบและอนุมัติใบสมัคร',
  VIEWER: 'ดูข้อมูลอย่างเดียว ไม่สามารถแก้ไขได้',
};

export const ROLE_COLORS: Record<UserRole, string> = {
  SUPER_ADMIN: 'bg-red-100 text-red-800 border-red-200',
  ADMIN: 'bg-orange-100 text-orange-800 border-orange-200',
  REVIEWER: 'bg-blue-100 text-blue-800 border-blue-200',
  VIEWER: 'bg-slate-100 text-slate-700 border-slate-200',
};
