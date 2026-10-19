/**
 * User Management API Client
 * --------------------------
 * API client for user management endpoints
 */

import { adminFetch } from '@/lib/useAdminAuth';
import type {
  AdminUser,
  CreateUserRequest,
  CreateUserResponse,
  UpdateUserRequest,
  ResetPasswordResponse,
} from '@/types/user';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

/**
 * Safe JSON parser - handles both JSON and plain text responses.
 * 
 * Backend may return:
 * - application/json: {"error": "...", "message": "..."}
 * - text/plain: "Internal Server Error"
 * - empty response
 * 
 * This function handles all cases gracefully.
 */
async function safeParseErrorResponse(res: Response): Promise<{ error?: string; message?: string; [key: string]: unknown }> {
  const contentType = res.headers.get('content-type') || '';
  
  // If Content-Type indicates JSON, try to parse as JSON
  if (contentType.includes('application/json')) {
    try {
      return await res.json();
    } catch {
      // Fall through to text parsing
    }
  }
  
  // Try to read as text
  const text = await res.text();
  
  // If text looks like JSON, try to parse it
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Fall through to error message
    }
  }
  
  // Return error object with the plain text message
  // This is the typical case when backend returns "Internal Server Error" as plain text
  return {
    error: 'SERVER_ERROR',
    message: trimmed || 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์',
  };
}

/**
 * Get all users
 */
export async function listUsers(): Promise<AdminUser[]> {
  const res = await adminFetch(`${API_BASE}/admin/users`);
  if (!res.ok) {
    const error = await safeParseErrorResponse(res);
    throw new Error(error.message || 'Failed to fetch users');
  }
  const json = await res.json();
  return json.data || [];
}

/**
 * Get a single user by ID
 */
export async function getUser(userId: string): Promise<AdminUser> {
  const res = await adminFetch(`${API_BASE}/admin/users/${userId}`);
  if (!res.ok) {
    const error = await safeParseErrorResponse(res);
    throw new Error(error.message || 'Failed to fetch user');
  }
  const json = await res.json();
  return json.data;
}

/**
 * Create a new user
 */
export async function createUser(data: CreateUserRequest): Promise<CreateUserResponse> {
  const res = await adminFetch(`${API_BASE}/admin/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await safeParseErrorResponse(res);
    throw new Error(error.message || 'ไม่สามารถสร้างผู้ใช้ได้');
  }
  return res.json();
}

/**
 * Update a user
 */
export async function updateUser(userId: string, data: UpdateUserRequest): Promise<void> {
  const res = await adminFetch(`${API_BASE}/admin/users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await safeParseErrorResponse(res);
    throw new Error(error.message || 'ไม่สามารถแก้ไขผู้ใช้ได้');
  }
}

/**
 * Reset a user's password
 */
export async function resetUserPassword(userId: string): Promise<ResetPasswordResponse> {
  const res = await adminFetch(`${API_BASE}/admin/users/${userId}/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) {
    const error = await safeParseErrorResponse(res);
    throw new Error(error.message || 'ไม่สามารถรีเซ็ตรหัสผ่านได้');
  }
  return res.json();
}

/**
 * Force a user to change password on next login
 */
export async function forceChangePassword(
  userId: string,
  mustChangePassword: boolean
): Promise<void> {
  const res = await adminFetch(`${API_BASE}/admin/users/${userId}/force-change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, mustChangePassword }),
  });
  if (!res.ok) {
    const error = await safeParseErrorResponse(res);
    throw new Error(error.message || 'ไม่สามารถบังคับเปลี่ยนรหัสผ่านได้');
  }
}

/**
 * Disable a user
 */
export async function disableUser(userId: string, reason: string): Promise<void> {
  const res = await adminFetch(`${API_BASE}/admin/users/${userId}/disable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, reason }),
  });
  if (!res.ok) {
    const error = await safeParseErrorResponse(res);
    throw new Error(error.message || 'ไม่สามารถปิดใช้งานผู้ใช้ได้');
  }
}

/**
 * Get current user info
 */
export async function getCurrentUser(): Promise<AdminUser> {
  const res = await adminFetch(`${API_BASE}/admin/auth/me`);
  if (!res.ok) {
    const error = await safeParseErrorResponse(res);
    throw new Error(error.message || 'Failed to fetch current user');
  }
  const json = await res.json();
  return json.data;
}
