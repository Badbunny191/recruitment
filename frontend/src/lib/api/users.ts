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
 * Get all users
 */
export async function listUsers(): Promise<AdminUser[]> {
  const res = await adminFetch(`${API_BASE}/api/v1/admin/users`);
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.message || 'Failed to fetch users');
  }
  const json = await res.json();
  return json.data || [];
}

/**
 * Get a single user by ID
 */
export async function getUser(userId: string): Promise<AdminUser> {
  const res = await adminFetch(`${API_BASE}/api/v1/admin/users/${userId}`);
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.message || 'Failed to fetch user');
  }
  const json = await res.json();
  return json.data;
}

/**
 * Create a new user
 */
export async function createUser(data: CreateUserRequest): Promise<CreateUserResponse> {
  const res = await adminFetch(`${API_BASE}/api/v1/admin/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.message || 'Failed to create user');
  }
  return res.json();
}

/**
 * Update a user
 */
export async function updateUser(userId: string, data: UpdateUserRequest): Promise<void> {
  const res = await adminFetch(`${API_BASE}/api/v1/admin/users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.message || 'Failed to update user');
  }
}

/**
 * Reset a user's password
 */
export async function resetUserPassword(userId: string): Promise<ResetPasswordResponse> {
  const res = await adminFetch(`${API_BASE}/api/v1/admin/users/${userId}/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.message || 'Failed to reset password');
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
  const res = await adminFetch(`${API_BASE}/api/v1/admin/users/${userId}/force-change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, mustChangePassword }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.message || 'Failed to force change password');
  }
}

/**
 * Disable a user
 */
export async function disableUser(userId: string, reason: string): Promise<void> {
  const res = await adminFetch(`${API_BASE}/api/v1/admin/users/${userId}/disable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, reason }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.message || 'Failed to disable user');
  }
}

/**
 * Get current user info
 */
export async function getCurrentUser(): Promise<AdminUser> {
  const res = await adminFetch(`${API_BASE}/api/v1/admin/auth/me`);
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.message || 'Failed to fetch current user');
  }
  const json = await res.json();
  return json.data;
}
