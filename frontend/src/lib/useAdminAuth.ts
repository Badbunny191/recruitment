'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { handleMustChangePasswordResponse } from '@/lib/must-change-password';

const STORAGE_KEY = 'adminToken';
const STORAGE_KEY_USER = 'adminUser';

export type AdminUserRole = 'SUPER_ADMIN' | 'ADMIN' | 'VIEWER';

export interface AdminAuthUser {
  id: string;
  email: string;
  role: AdminUserRole;
}

interface JwtPayload {
  id?: string;
  email?: string;
  role?: string;
  exp?: number;
}

export function useAdminAuth() {
  const router = useRouter();
  const pathname = usePathname();
  const [isChecking, setIsChecking] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<AdminAuthUser | null>(null);

  useEffect(() => {
    // หน้า login: ไม่ทำอะไร (ไม่ต้อง check token)
    if (pathname === '/admin/login') {
      setIsChecking(false);
      // isAuthenticated คงเป็น false → AdminGuard จะ redirect ถ้าถูกเรียก
      return;
    }

    const token = localStorage.getItem(STORAGE_KEY);

    if (!token) {
      setIsChecking(false);
      setIsAuthenticated(false);
      setUser(null);
      router.replace('/admin/login');
      return;
    }

    try {
      const payload = parseJwt(token);
      if (!payload || !payload.role || (payload.exp && payload.exp * 1000 < Date.now())) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_KEY_USER);
        setIsChecking(false);
        setIsAuthenticated(false);
        setUser(null);
        router.replace('/admin/login');
        return;
      }
      const normalizedRole = normalizeRole(payload.role);
      if (!normalizedRole) {
        // Unknown role → force re-login
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_KEY_USER);
        setIsChecking(false);
        setIsAuthenticated(false);
        setUser(null);
        router.replace('/admin/login');
        return;
      }
      const nextUser: AdminAuthUser = {
        id: payload.id || '',
        email: payload.email || '',
        role: normalizedRole,
      };
      setUser(nextUser);
      setIsAuthenticated(true);
      setIsChecking(false);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_KEY_USER);
      setIsChecking(false);
      setIsAuthenticated(false);
      setUser(null);
      router.replace('/admin/login');
      return;
    }
  }, [pathname, router]);

  function logout() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY_USER);
    setIsAuthenticated(false);
    setIsChecking(false);
    setUser(null);
    router.replace('/admin/login');
  }

  return { isChecking, isAuthenticated, user, logout };
}

function parseJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(payload));
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Normalize role string from JWT/DB to the canonical RBAC v1 set.
 * Accepts: SUPER_ADMIN, ADMIN, VIEWER.
 * Maps legacy values to ADMIN (per migration 020).
 * Returns null for unknown values.
 */
export function normalizeRole(role: string | undefined | null): AdminUserRole | null {
  if (!role) return null;
  const upper = String(role).toUpperCase();
  if (upper === 'SUPER_ADMIN') return 'SUPER_ADMIN';
  if (upper === 'ADMIN') return 'ADMIN';
  if (upper === 'VIEWER') return 'VIEWER';
  // Legacy values — migration 020 maps them to ADMIN at DB level.
  if (upper === 'HR_ADMIN' || upper === 'HR_OFFICER' || upper === 'REVIEWER') {
    return 'ADMIN';
  }
  return null;
}

export async function adminFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem(STORAGE_KEY);

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY_USER);
    window.location.href = '/admin/login';
  }

  // R9: 403 MUST_CHANGE_PASSWORD → พาไปหน้าเปลี่ยนรหัสผ่าน ก่อน caller
  // จะแสดง "โหลดข้อมูลไม่สำเร็จ" แทน security error
  if (res.status === 403) {
    await handleMustChangePasswordResponse(res);
  }

  return res;
}
