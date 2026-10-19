'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

const STORAGE_KEY = 'adminToken';
const STORAGE_KEY_MUST_CHANGE_PASSWORD = 'mustChangePassword';

interface LoginResponse {
  token: string;
  user: {
    id: string;
    email: string;
    role: string;
    mustChangePassword: boolean;
  };
}

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
            // Token ยังไม่หมดอายุ → redirect based on mustChangePassword
            const mustChange = localStorage.getItem(STORAGE_KEY_MUST_CHANGE_PASSWORD);
            if (mustChange === 'true') {
              router.replace('/admin/change-password');
            } else {
              router.replace('/admin/dashboard');
            }
            return;
          }
        }
        // Token หมดอายุหรือผิด format → ลบทิ้ง
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_KEY_MUST_CHANGE_PASSWORD);
      } catch {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_KEY_MUST_CHANGE_PASSWORD);
      }
    }
    setChecked(true);
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(process.env.NEXT_PUBLIC_API_URL + '/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      
      if (res.ok) {
        const data: LoginResponse = await res.json();
        
        // เก็บ token
        localStorage.setItem(STORAGE_KEY, data.token);
        
        // เก็บ mustChangePassword flag เพื่อใช้ในการ redirect
        localStorage.setItem(STORAGE_KEY_MUST_CHANGE_PASSWORD, String(data.user.mustChangePassword));
        
        // Redirect based on mustChangePassword flag
        if (data.user.mustChangePassword) {
          router.push('/admin/change-password');
        } else {
          router.push('/admin/dashboard');
        }
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.message || 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
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