'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

const STORAGE_KEY = 'adminToken';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);

  // ตรวจสอบ token ตอน mount — ถ้ามี token ที่ยังไม่หมดอายุ redirect ไป dashboard
  useEffect(() => {
    const token = localStorage.getItem(STORAGE_KEY);
    if (token) {
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
          const decoded = JSON.parse(atob(payload));
          if (decoded.exp && decoded.exp * 1000 > Date.now()) {
            // Token ยังไม่หมดอายุ → redirect ไป dashboard
            router.replace('/admin/dashboard');
            return;
          }
        }
        // Token หมดอายุหรือผิด format → ลบทิ้ง
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    setChecked(true);
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(process.env.NEXT_PUBLIC_API_URL + '/api/v1/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        const { token } = await res.json();
        localStorage.setItem(STORAGE_KEY, token);
        router.push('/admin/dashboard');
      } else {
        alert('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
      }
    } catch {
      alert('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
    } finally {
      setLoading(false);
    }
  };

  // ป้องกัน flash content ก่อนตรวจ token เสร็จ
  if (!checked) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-slate-500">กำลังโหลด...</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center bg-slate-50">
      <Card className="w-[400px]">
        <CardHeader>
          <CardTitle className="text-2xl text-center">SAO Admin Login</CardTitle>
        </CardHeader>
        <form onSubmit={handleLogin}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">อีเมล</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">รหัสผ่าน</Label>
              <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}