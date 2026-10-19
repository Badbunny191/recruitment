'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAdminAuth } from '@/lib/useAdminAuth';
import { adminFetch } from '@/lib/useAdminAuth';

const STORAGE_KEY_MUST_CHANGE_PASSWORD = 'mustChangePassword';

export default function ChangePasswordPage() {
  const router = useRouter();
  const { user } = useAdminAuth();
  const [mounted, setMounted] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!currentPassword.trim()) {
      setError('กรุณากรอกรหัสผ่านปัจจุบัน');
      return;
    }
    if (newPassword.length < 8) {
      setError('รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');
      return;
    }
    if (!/[A-Z]/.test(newPassword)) {
      setError('รหัสผ่านใหม่ต้องมีตัวพิมพ์ใหญ่อย่างน้อย 1 ตัว');
      return;
    }
    if (!/[a-z]/.test(newPassword)) {
      setError('รหัสผ่านใหม่ต้องมีตัวพิมพ์เล็กอย่างน้อย 1 ตัว');
      return;
    }
    if (!/[0-9]/.test(newPassword)) {
      setError('รหัสผ่านใหม่ต้องมีตัวเลขอย่างน้อย 1 ตัว');
      return;
    }
    if (!/[!@#$%^&*()_+\-=\[\]{}|;':",.\/<>?\\]/.test(newPassword)) {
      setError('รหัสผ่านใหม่ต้องมีอักขระพิเศษอย่างน้อย 1 ตัว');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('รหัสผ่านใหม่และยืนยันรหัสผ่านไม่ตรงกัน');
      return;
    }

    setSubmitting(true);
    try {
      const res = await adminFetch(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/auth/change-password`,
        {
          method: 'POST',
          body: JSON.stringify({
            currentPassword,
            newPassword,
            confirmPassword,
          }),
        }
      );

      if (res.ok) {
        setSuccess(true);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        
        // Clear mustChangePassword flag
        localStorage.removeItem(STORAGE_KEY_MUST_CHANGE_PASSWORD);
        
        // Redirect to dashboard after 2 seconds
        setTimeout(() => {
          router.push('/admin/dashboard');
        }, 2000);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.message || 'ไม่สามารถเปลี่ยนรหัสผ่านได้');
      }
    } catch {
      setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🔑</span>
          <div>
            <h1 className="text-2xl font-bold">เปลี่ยนรหัสผ่าน</h1>
            <p className="text-sm text-slate-500">
              เปลี่ยนรหัสผ่านสำหรับบัญชี {user.email}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          ← กลับ
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>ตั้งรหัสผ่านใหม่</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert className="border-red-200 bg-red-50">
                <AlertDescription className="text-red-800">{error}</AlertDescription>
              </Alert>
            )}
            {success && (
              <Alert className="border-emerald-200 bg-emerald-50">
                <AlertDescription className="text-emerald-800">
                  ✅ เปลี่ยนรหัสผ่านสำเร็จ — กรุณา login ใหม่อีกครั้งเพื่อความปลอดภัย
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="current">รหัสผ่านปัจจุบัน *</Label>
              <Input
                id="current"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new">รหัสผ่านใหม่ *</Label>
              <Input
                id="new"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
              <p className="text-xs text-slate-500">อย่างน้อย 8 ตัวอักษร</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm">ยืนยันรหัสผ่านใหม่ *</Label>
              <Input
                id="confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'กำลังเปลี่ยน...' : 'เปลี่ยนรหัสผ่าน'}
              </Button>
              <Button type="button" variant="outline" onClick={() => router.back()} disabled={submitting}>
                ยกเลิก
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
