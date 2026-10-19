'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAdminAuth } from '@/lib/useAdminAuth';
import { adminFetch } from '@/lib/useAdminAuth';

const STORAGE_KEY_MUST_CHANGE_PASSWORD = 'mustChangePassword';

// ============================================================================
// Password policy — must mirror backend exactly:
// backend/src/schemas/validators.ts (ChangePasswordSchema)
// backend/src/utils/password.ts (validatePassword + isCommonPassword)
// backend/src/routes/admin.routes.ts (POST /admin/auth/change-password)
// ============================================================================
const PASSWORD_MIN_LENGTH = 8;
// Special-char class MUST match backend exactly (escape carefully):
// /[!@#$%^&*()_+\-=\[\]{}|;':",.\/<>?\\]/
const SPECIAL_CHAR_REGEX = /[!@#$%^&*()_+\-=\[\]{}|;':",./<>?\\]/;
const UPPERCASE_REGEX = /[A-Z]/;
const LOWERCASE_REGEX = /[a-z]/;
const NUMBER_REGEX = /[0-9]/;

type RuleKey =
  | 'minLength'
  | 'uppercase'
  | 'lowercase'
  | 'number'
  | 'special'
  | 'notSameAsCurrent'
  | 'confirmMatch';

interface PasswordRule {
  key: RuleKey;
  label: string;
}

const PASSWORD_RULES: PasswordRule[] = [
  { key: 'minLength', label: 'มีความยาวอย่างน้อย 8 ตัวอักษร' },
  { key: 'uppercase', label: 'มีตัวอักษรพิมพ์ใหญ่' },
  { key: 'lowercase', label: 'มีตัวอักษรพิมพ์เล็ก' },
  { key: 'number', label: 'มีตัวเลข' },
  { key: 'special', label: 'มีอักขระพิเศษ' },
  { key: 'notSameAsCurrent', label: 'ไม่เหมือนรหัสผ่านปัจจุบัน' },
  { key: 'confirmMatch', label: 'ตรงกับช่องยืนยันรหัสผ่าน' },
];

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

  // Independent visibility toggles per field
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Trim helper — match backend "min(1)" semantics: any non-empty string
  const trimmedCurrent = currentPassword.trim();
  const hasCurrent = trimmedCurrent.length > 0;
  const hasNew = newPassword.length > 0;
  const hasConfirm = confirmPassword.length > 0;

  // Per-rule status: 'pending' | 'pass' | 'fail'
  // For confirmMatch: only evaluate once user has typed something into confirm
  // (so an empty confirm doesn't immediately show a red ✕).
  const ruleStatus = useMemo<Record<RuleKey, 'pending' | 'pass' | 'fail'>>(() => {
    const status: Record<RuleKey, 'pending' | 'pass' | 'fail'> = {
      minLength: !hasNew ? 'pending' : (newPassword.length >= PASSWORD_MIN_LENGTH ? 'pass' : 'fail'),
      uppercase: !hasNew ? 'pending' : (UPPERCASE_REGEX.test(newPassword) ? 'pass' : 'fail'),
      lowercase: !hasNew ? 'pending' : (LOWERCASE_REGEX.test(newPassword) ? 'pass' : 'fail'),
      number: !hasNew ? 'pending' : (NUMBER_REGEX.test(newPassword) ? 'pass' : 'fail'),
      special: !hasNew ? 'pending' : (SPECIAL_CHAR_REGEX.test(newPassword) ? 'pass' : 'fail'),
      notSameAsCurrent: !hasNew || !hasCurrent
        ? 'pending'
        : (newPassword !== currentPassword ? 'pass' : 'fail'),
      // Only check confirm after user starts typing it; suppress the red ✕ on empty.
      confirmMatch: !hasConfirm
        ? 'pending'
        : (confirmPassword === newPassword ? 'pass' : 'fail'),
    };
    return status;
  }, [hasNew, hasCurrent, hasConfirm, newPassword, currentPassword, confirmPassword]);

  const everyFrontendRulePasses = useMemo(
    () => (Object.values(ruleStatus) as Array<'pending' | 'pass' | 'fail'>).every((s) => s === 'pass'),
    [ruleStatus],
  );

  // Submit is blocked unless ALL frontend-checkable rules pass.
  // Note: we never try to verify the current password's correctness here —
  // the backend is the source of truth for that.
  const canSubmit =
    hasCurrent &&
    hasNew &&
    hasConfirm &&
    everyFrontendRulePasses &&
    !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return; // belt-and-braces; button should already be disabled
    setError(null);
    setSuccess(false);
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
        // SECURITY: clear all three password fields after success.
        // No localStorage / sessionStorage writes of passwords.
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setShowCurrent(false);
        setShowNew(false);
        setShowConfirm(false);

        // Clear only the mustChangePassword flag (not a password).
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

  if (!mounted || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-slate-500">กำลังโหลด...</div>
      </div>
    );
  }

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

            {/* Current password — we only check "non-empty" on the frontend.
                Backend verifies correctness. */}
            <div className="space-y-2">
              <Label htmlFor="current">รหัสผ่านปัจจุบัน *</Label>
              <div className="flex gap-2">
                <Input
                  id="current"
                  type={showCurrent ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowCurrent((v) => !v)}
                  aria-label={showCurrent ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                  aria-pressed={showCurrent}
                  title={showCurrent ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                  disabled={submitting}
                >
                  {showCurrent ? '🙈' : '👁️'}
                </Button>
              </div>
            </div>

            {/* New password — drives all 7 password rules except confirmMatch */}
            <div className="space-y-2">
              <Label htmlFor="new">รหัสผ่านใหม่ *</Label>
              <div className="flex gap-2">
                <Input
                  id="new"
                  type={showNew ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowNew((v) => !v)}
                  aria-label={showNew ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                  aria-pressed={showNew}
                  title={showNew ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                  disabled={submitting}
                >
                  {showNew ? '🙈' : '👁️'}
                </Button>
              </div>
            </div>

            {/* Confirm password */}
            <div className="space-y-2">
              <Label htmlFor="confirm">ยืนยันรหัสผ่านใหม่ *</Label>
              <div className="flex gap-2">
                <Input
                  id="confirm"
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowConfirm((v) => !v)}
                  aria-label={showConfirm ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                  aria-pressed={showConfirm}
                  title={showConfirm ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                  disabled={submitting}
                >
                  {showConfirm ? '🙈' : '👁️'}
                </Button>
              </div>
            </div>

            {/* Real-time rule checklist.
                Status: pending (gray) | pass (green ✓) | fail (red ✕).
                Note: "ไม่ใช่รหัสผ่านที่พบบ่อย" is NOT shown in this checklist because
                the frontend does not have the same common-password list as the
                backend (per project rule: don't duplicate that list).
                Backend's error message remains the source of truth for that rule. */}
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-medium text-slate-700 mb-2">เงื่อนไขรหัสผ่าน</p>
              <ul className="space-y-1 text-sm">
                {PASSWORD_RULES.map((rule) => {
                  const s = ruleStatus[rule.key];
                  const color =
                    s === 'pass'
                      ? 'text-emerald-700'
                      : s === 'fail'
                        ? 'text-red-600'
                        : 'text-slate-400';
                  const icon = s === 'pass' ? '✓' : s === 'fail' ? '✕' : '○';
                  return (
                    <li key={rule.key} className={`flex items-center gap-2 ${color}`}>
                      <span aria-hidden="true" className="w-3 text-center">{icon}</span>
                      <span>{rule.label}</span>
                    </li>
                  );
                })}
                <li className="flex items-center gap-2 text-slate-500">
                  <span aria-hidden="true" className="w-3 text-center">●</span>
                  <span>
                    หลีกเลี่ยงรหัสผ่านที่พบบ่อย
                    <span className="ml-1 text-xs text-slate-400">
                      (เซิร์ฟเวอร์เป็นผู้ตรวจ)
                    </span>
                  </span>
                </li>
              </ul>
            </div>

            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={!canSubmit}>
                {submitting ? 'กำลังเปลี่ยนรหัสผ่าน...' : 'เปลี่ยนรหัสผ่าน'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
                disabled={submitting}
              >
                ยกเลิก
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
