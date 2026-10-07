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
      router.replace('/admin/login');
      return;
    }

    try {
      const payload = parseJwt(token);
      if (!payload || (payload.exp && payload.exp * 1000 < Date.now())) {
        localStorage.removeItem(STORAGE_KEY);
        setIsChecking(false);
        setIsAuthenticated(false);
        router.replace('/admin/login');
        return;
      }
      setIsAuthenticated(true);
      setIsChecking(false);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      setIsChecking(false);
      setIsAuthenticated(false);
      router.replace('/admin/login');
      return;
    }
  }, [pathname, router]);

  function logout() {
    localStorage.removeItem(STORAGE_KEY);
    setIsAuthenticated(false);
    setIsChecking(false);
    router.replace('/admin/login');
  }

  return { isChecking, isAuthenticated, logout };
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
    window.location.href = '/admin/login';
  }

  return res;
}