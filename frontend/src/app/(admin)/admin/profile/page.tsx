'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAdminAuth } from '@/lib/useAdminAuth';
import { useRole } from '@/lib/useRole';
import { ROLE_BADGE } from '@/types/user';

export default function ProfilePage() {
  const router = useRouter();
  const { user } = useAdminAuth();
  const { role } = useRole();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-slate-500">กำลังโหลด...</div>
      </div>
    );
  }

  const badge = role ? ROLE_BADGE[role] : null;

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">👤</span>
          <div>
            <h1 className="text-2xl font-bold">โปรไฟล์ (Profile)</h1>
            <p className="text-sm text-slate-500">
              ข้อมูลบัญชีผู้ใช้ของคุณ
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          ← กลับ
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>ข้อมูลผู้ใช้</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              อีเมล
            </label>
            <p className="text-sm font-medium text-slate-900 break-all">
              {user.email}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Role
            </label>
            {badge && role && (
              <div className="flex items-center gap-2">
                <span className="text-base">{badge.emoji}</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold border bg-slate-100 text-slate-700 border-slate-200">
                  {badge.label}
                </span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              รหัสผู้ใช้
            </label>
            <p className="text-xs font-mono text-slate-600 break-all">
              {user.id || '-'}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
