'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';

const STORAGE_KEY = 'adminToken';

export function useAdminAuth() {
  const router = useRouter();
  const pathname = usePathname();
  const [isChecking, setIsChecking] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    // หน้า login ไม่ต้องตรวจ token
    if (pathname === '/admin/login') {
      setIsChecking(false);
      setIsAuthenticated(false);
      return;
    }

    const token = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;

    if (!token) {
      router.replace('/admin/login');
      return;
    }

    // ตรวจสอบ token เบื้องต้น (decode JWT payload เพื่อดูว่า expire หรือยัง)
    try {
      const payload = parseJwt(token);
      if (!payload || (payload.exp && payload.exp * 1000 < Date.now())) {
        // Token หมดอายุ
        logout();
        return;
      }
      setIsAuthenticated(true);
    } catch {
      // Token ไม่ถูกต้อง
      logout();
      return;
    }

    setIsChecking(false);
  }, [pathname, router]);

  function logout() {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
    setIsAuthenticated(false);
    setIsChecking(false);
    router.replace('/admin/login');
  }

  return { isChecking, isAuthenticated, logout, token: typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null };
}

function parseJwt(token: string): { exp?: number } | null {
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

// Helper: fetch wrapper ที่จัดการ 401 ให้ logout อัตโนมัติ
export async function adminFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;

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

  // ถ้า 401 → token หมดอายุหรือไม่ถูกต้อง → logout
  if (res.status === 401 && typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
    window.location.href = '/admin/login';
  }

  return res;
}