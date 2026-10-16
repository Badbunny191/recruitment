'use client';

import { useState, useEffect, useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SearchInput } from '@/components/ui/search-input';
import { Pagination } from '@/components/ui/pagination';
import { ActionMenu } from '@/components/ui/action-menu';
import { NoDataEmptyState, NoResultsEmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import {
  listUsers,
  createUser,
  updateUser,
  resetUserPassword,
  forceChangePassword,
  disableUser,
  getCurrentUser,
} from '@/lib/api/users';
import type { AdminUser, UserRole } from '@/types/user';
import { ROLE_LABELS, ROLE_DESCRIPTIONS, ROLE_COLORS } from '@/types/user';
import { useRole } from '@/lib/useRole';

// =============================================================================
// DESIGN SYSTEM - Smart Family Style
// =============================================================================
const CARD_STYLE = {
  container: 'bg-white rounded-xl border border-slate-200 shadow-sm',
  header: 'px-4 py-3 border-b border-slate-100',
  body: 'px-4 py-3',
};

// =============================================================================
// ROLE DROPDOWN OPTIONS (RBAC v1)
// =============================================================================
// - ลบ REVIEWER, HR_ADMIN, HR_OFFICER ออกแล้ว
// - SUPER_ADMIN ห้ามแสดงใน Dropdown ตอน Create (ต้องสร้างผ่าน Bootstrap/DB เท่านั้น)
// - ใน EDIT: ถ้า current user เป็น SUPER_ADMIN จะเห็น SUPER_ADMIN เพิ่มใน Dropdown
const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'ADMIN', label: 'Admin' },
  { value: 'VIEWER', label: 'Viewer' },
];

/** ตัวเลือก Role สำหรับ Edit Dialog (รวม SUPER_ADMIN เมื่อ current user เป็น Super Admin) */
const EDIT_ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'SUPER_ADMIN', label: 'Super Admin' },
  { value: 'ADMIN', label: 'Admin' },
  { value: 'VIEWER', label: 'Viewer' },
];

// =============================================================================
// TYPES
// =============================================================================
interface CreateUserForm {
  email: string;
  role: UserRole;
  mustChangePassword: boolean;
}

interface EditUserForm {
  email: string;
  role: UserRole;
  isActive: boolean;
}

interface CreateUserResult {
  email: string;
  tempPassword: string;
}

const EMPTY_CREATE_FORM: CreateUserForm = {
  email: '',
  role: 'VIEWER',
  mustChangePassword: true,
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================
export default function UsersPage() {
  const { canManageUsers, canWrite } = useRole();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [currentUser, setCurrentUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search & Pagination
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Dialogs
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [forceChangeDialogOpen, setForceChangeDialogOpen] = useState(false);
  const [disableDialogOpen, setDisableDialogOpen] = useState(false);

  // Form states
  const [createForm, setCreateForm] = useState<CreateUserForm>(EMPTY_CREATE_FORM);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editForm, setEditForm] = useState<EditUserForm>({ email: '', role: 'VIEWER', isActive: true });
  const [createResult, setCreateResult] = useState<CreateUserResult | null>(null);
  const [resetResult, setResetResult] = useState<{ email: string; tempPassword: string } | null>(null);
  const [disableReason, setDisableReason] = useState('');

  // Submitting states
  const [submitting, setSubmitting] = useState(false);

  // =============================================================================
  // DATA LOADING
  // =============================================================================
  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersData, meData] = await Promise.all([
        listUsers(),
        getCurrentUser().catch(() => null),
      ]);
      setUsers(usersData);
      setCurrentUser(meData);
    } catch (err: any) {
      setError(err.message || 'ไม่สามารถโหลดข้อมูลผู้ใช้ได้');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [search]);

  // =============================================================================
  // PERMISSIONS
  // =============================================================================
  // canManageUsers is sourced from useRole() (centralized).
  // canWrite is exposed for symmetry (e.g. hide non-essential write actions for viewers).
  const canModifyUser = (user: AdminUser): boolean => {
    if (!currentUser) return false;
    if (currentUser.role === 'SUPER_ADMIN') return true;
    if (currentUser.role === 'ADMIN') {
      return user.role !== 'SUPER_ADMIN';
    }
    return false;
  };

  // =============================================================================
  // FILTERING & PAGINATION
  // =============================================================================
  const filteredUsers = useMemo(() => {
    if (!search.trim()) return users;
    const s = search.toLowerCase();
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(s) ||
        u.role.toLowerCase().includes(s)
    );
  }, [users, search]);

  const totalItems = filteredUsers.length;
  const paginatedUsers = filteredUsers.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  // =============================================================================
  // KPI COUNTS
  // =============================================================================
  const totalUsers = users.length;
  const activeUsers = users.filter((u) => u.isActive !== false).length;
  const superAdminCount = users.filter((u) => u.role === 'SUPER_ADMIN').length;

  // =============================================================================
  // HANDLERS
  // =============================================================================
  const openCreate = () => {
    setCreateForm(EMPTY_CREATE_FORM);
    setCreateResult(null);
    setError(null);
    setCreateDialogOpen(true);
  };

  const openEdit = (user: AdminUser) => {
    setEditingUser(user);
    setEditForm({
      email: user.email,
      role: user.role,
      isActive: user.isActive !== false,
    });
    setError(null);
    setEditDialogOpen(true);
  };

  const openResetPassword = (user: AdminUser) => {
    setEditingUser(user);
    setResetResult(null);
    setError(null);
    setResetPasswordDialogOpen(true);
  };

  const openForceChange = (user: AdminUser) => {
    setEditingUser(user);
    setError(null);
    setForceChangeDialogOpen(true);
  };

  const openDisable = (user: AdminUser) => {
    setEditingUser(user);
    setDisableReason('');
    setError(null);
    setDisableDialogOpen(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await createUser(createForm);
      setCreateResult({
        email: createForm.email,
        tempPassword: result.tempPassword || '',
      });
      await load();
    } catch (err: any) {
      setError(err.message || 'ไม่สามารถสร้างผู้ใช้ได้');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateUser(editingUser.id, editForm);
      setEditDialogOpen(false);
      await load();
    } catch (err: any) {
      setError(err.message || 'ไม่สามารถแก้ไขผู้ใช้ได้');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!editingUser) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await resetUserPassword(editingUser.id);
      setResetResult({
        email: editingUser.email,
        tempPassword: result.tempPassword || '',
      });
      await load();
    } catch (err: any) {
      setError(err.message || 'ไม่สามารถรีเซ็ตรหัสผ่านได้');
    } finally {
      setSubmitting(false);
    }
  };

  const handleForceChange = async () => {
    if (!editingUser) return;
    setSubmitting(true);
    setError(null);
    try {
      await forceChangePassword(editingUser.id, true);
      setForceChangeDialogOpen(false);
      await load();
    } catch (err: any) {
      setError(err.message || 'ไม่สามารถบังคับเปลี่ยนรหัสผ่านได้');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDisable = async () => {
    if (!editingUser || !disableReason.trim()) {
      setError('กรุณาระบุเหตุผล');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await disableUser(editingUser.id, disableReason);
      setDisableDialogOpen(false);
      await load();
    } catch (err: any) {
      setError(err.message || 'ไม่สามารถปิดใช้งานผู้ใช้ได้');
    } finally {
      setSubmitting(false);
    }
  };

  // =============================================================================
  // RENDER
  // =============================================================================
  return (
    <div className="p-4 md:p-6 space-y-3">
      {/* Page Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">👥</span>
          <div>
            <h1 className="text-lg font-bold text-slate-900 leading-tight">จัดการผู้ใช้ (User Management)</h1>
            <p className="text-[11px] text-slate-500">จัดการผู้ดูแลระบบ เพิ่ม แก้ไข ปิดใช้งาน และรีเซ็ตรหัสผ่าน</p>
          </div>
        </div>
        {canManageUsers && (
          <Button onClick={openCreate} size="sm" className="h-8">
            + เพิ่มผู้ใช้ใหม่
          </Button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm px-6 py-5 flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-2xl shrink-0">
            👥
          </div>
          <div className="flex flex-col">
            <span className="text-3xl font-bold tabular-nums leading-none text-slate-900">{totalUsers}</span>
            <span className="text-sm text-slate-500 mt-1.5">ผู้ใช้ทั้งหมด</span>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm px-6 py-5 flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-emerald-100 flex items-center justify-center text-2xl shrink-0">
            ✅
          </div>
          <div className="flex flex-col">
            <span className="text-3xl font-bold tabular-nums leading-none text-emerald-600">{activeUsers}</span>
            <span className="text-sm text-slate-500 mt-1.5">ใช้งานอยู่</span>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm px-6 py-5 flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-red-100 flex items-center justify-center text-2xl shrink-0">
            🔐
          </div>
          <div className="flex flex-col">
            <span className="text-3xl font-bold tabular-nums leading-none text-red-600">{superAdminCount}</span>
            <span className="text-sm text-slate-500 mt-1.5">Super Admin</span>
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <Alert className="border-red-200 bg-red-50">
          <AlertDescription className="text-red-800">{error}</AlertDescription>
        </Alert>
      )}

      {/* Content Card */}
      <div className={cn(CARD_STYLE.container, "overflow-hidden")}>
        {/* Toolbar */}
        <div className={cn(CARD_STYLE.header, "flex flex-col gap-2")}>
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="ค้นหาอีเมล หรือ role..."
                resultCount={totalItems}
                resultLabel="รายการ"
                size="sm"
                hideResultCount
              />
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <Table className="w-full table-fixed">
            <TableHeader>
              <TableRow className="bg-slate-50/50 hover:bg-slate-50/50">
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 w-[30%]">อีเมล</TableHead>
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 w-[12%]">Role</TableHead>
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 hidden sm:table-cell w-[12%]">สถานะ</TableHead>
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 hidden md:table-cell w-[15%]">ความปลอดภัย</TableHead>
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 hidden lg:table-cell w-[15%]">เข้าสู่ระบบล่าสุด</TableHead>
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 text-right w-[16%]">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    <div className="flex items-center justify-center gap-2 text-slate-500">
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span className="text-xs">กำลังโหลด...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filteredUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-0">
                    {search ? (
                      <NoResultsEmptyState
                        keyword={search}
                        onClearFilters={() => setSearch('')}
                      />
                    ) : (
                      <NoDataEmptyState
                        title="ยังไม่มีผู้ใช้"
                        description="เริ่มต้นโดยการเพิ่มผู้ใช้ใหม่"
                        action={
                          canManageUsers
                            ? { label: '+ เพิ่มผู้ใช้ใหม่', onClick: openCreate, variant: 'primary' }
                            : undefined
                        }
                      />
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                paginatedUsers.map((user) => {
                  const isLocked = user.lockedUntil && user.lockedUntil > Math.floor(Date.now() / 1000);
                  const isActive = user.isActive !== false;
                  return (
                    <TableRow key={user.id} className="group">
                      {/* Email */}
                      <TableCell className="py-3 align-top">
                        <div className="flex flex-col gap-1 min-w-0">
                          <div className="font-medium text-sm text-slate-900 leading-snug truncate" title={user.email}>
                            {user.email}
                          </div>
                          {user.id === currentUser?.id && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border bg-blue-50 text-blue-700 border-blue-200 w-fit">
                              คุณ (You)
                            </span>
                          )}
                        </div>
                      </TableCell>

                      {/* Role */}
                      <TableCell className="py-3 align-top">
                        <span className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border whitespace-nowrap",
                          ROLE_COLORS[user.role]
                        )}>
                          {ROLE_LABELS[user.role]}
                        </span>
                      </TableCell>

                      {/* Status */}
                      <TableCell className="py-3 hidden sm:table-cell align-top">
                        <div className="flex flex-col gap-1">
                          <span className={cn(
                            "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap w-fit",
                            isActive
                              ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                              : "bg-slate-100 text-slate-600 border-slate-200"
                          )}>
                            {isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}
                          </span>
                          {isLocked && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border bg-red-100 text-red-700 border-red-200 w-fit">
                              🔒 ล็อก
                            </span>
                          )}
                        </div>
                      </TableCell>

                      {/* Security */}
                      <TableCell className="py-3 hidden md:table-cell align-top">
                        <div className="flex flex-col gap-1">
                          {user.passwordMigrated ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border bg-emerald-50 text-emerald-700 border-emerald-200 w-fit">
                              🔒 Bcrypt
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border bg-amber-50 text-amber-700 border-amber-200 w-fit">
                              ⚠ Plaintext
                            </span>
                          )}
                          {user.mustChangePassword && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border bg-orange-50 text-orange-700 border-orange-200 w-fit">
                              ต้องเปลี่ยน
                            </span>
                          )}
                          {user.failedLoginAttempts > 0 && (
                            <span className="text-[10px] text-slate-500">
                              ผิด {user.failedLoginAttempts} ครั้ง
                            </span>
                          )}
                        </div>
                      </TableCell>

                      {/* Created At */}
                      <TableCell className="py-3 hidden lg:table-cell text-xs text-slate-500 align-top">
                        {user.passwordChangedAt
                          ? new Date(user.passwordChangedAt * 1000).toLocaleDateString('th-TH')
                          : 'ยังไม่เคยเปลี่ยน'}
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="py-3 text-right align-top">
                        <ActionMenu
                          size="sm"
                          items={[
                            {
                              label: '✏️ แก้ไข',
                              onClick: () => openEdit(user),
                              disabled: !canModifyUser(user),
                            },
                            {
                              label: '🔑 รีเซ็ตรหัสผ่าน',
                              onClick: () => openResetPassword(user),
                              disabled: !canModifyUser(user) || user.role === 'SUPER_ADMIN',
                            },
                            {
                              label: user.mustChangePassword ? '✓ ยกเลิกบังคับเปลี่ยน' : '⚠ บังคับเปลี่ยนรหัสผ่าน',
                              onClick: () => openForceChange(user),
                              disabled: !canModifyUser(user) || user.role === 'SUPER_ADMIN',
                            },
                            ...(isActive && user.id !== currentUser?.id
                              ? [{
                                  label: '🚫 ปิดใช้งาน',
                                  type: 'danger' as const,
                                  onClick: () => openDisable(user),
                                  disabled: !canModifyUser(user) || user.role === 'SUPER_ADMIN',
                                }]
                              : []
                            ),
                          ]}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        <div className={cn(CARD_STYLE.header, "flex items-center justify-between")}>
          <span className="text-[11px] text-slate-500">
            แสดง {paginatedUsers.length} จาก {totalItems}
          </span>
          <Pagination
            currentPage={currentPage}
            totalItems={totalItems}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            showPageSizeSelector={false}
            showResultCount={false}
          />
        </div>
      </div>

      {/* ================================================================== */}
      {/* CREATE USER DIALOG */}
      {/* ================================================================== */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>➕ เพิ่มผู้ใช้ใหม่</DialogTitle>
            <DialogDescription>
              สร้างบัญชีผู้ดูแลระบบใหม่ ระบบจะสร้างรหัสผ่านชั่วคราวให้
            </DialogDescription>
          </DialogHeader>

          {createResult ? (
            <div className="space-y-4">
              <Alert className="border-emerald-200 bg-emerald-50">
                <AlertDescription className="text-emerald-800">
                  ✅ สร้างผู้ใช้สำเร็จ! กรุณาคัดลอกรหัสผ่านชั่วคราวด้านล่างและส่งให้ผู้ใช้อย่างปลอดภัย
                </AlertDescription>
              </Alert>
              <div className="space-y-2">
                <Label>อีเมล</Label>
                <Input value={createResult.email} readOnly />
              </div>
              <div className="space-y-2">
                <Label>รหัสผ่านชั่วคราว (แสดงครั้งเดียว)</Label>
                <div className="flex gap-2">
                  <Input value={createResult.tempPassword} readOnly className="font-mono" />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigator.clipboard?.writeText(createResult.tempPassword)}
                  >
                    📋 คัดลอก
                  </Button>
                </div>
                <p className="text-xs text-amber-600">
                  ⚠️ รหัสผ่านนี้จะแสดงครั้งเดียวเท่านั้น กรุณาบันทึกไว้ก่อนปิดหน้าต่างนี้
                </p>
              </div>
              <DialogFooter>
                <Button onClick={() => setCreateDialogOpen(false)}>ปิด</Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleCreate} className="space-y-4">
              {error && (
                <Alert className="border-red-200 bg-red-50">
                  <AlertDescription className="text-red-800">{error}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="create-email">อีเมล *</Label>
                <Input
                  id="create-email"
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                  required
                  placeholder="user@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-role">Role *</Label>
                <Select
                  id="create-role"
                  value={createForm.role}
                  onChange={(e) => setCreateForm({ ...createForm, role: e.target.value as UserRole })}
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} - {ROLE_DESCRIPTIONS[opt.value]}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-slate-500">
                  Super Admin ต้องสร้างผ่านระบบ seeding เท่านั้น
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  id="create-must-change"
                  type="checkbox"
                  checked={createForm.mustChangePassword}
                  onChange={(e) => setCreateForm({ ...createForm, mustChangePassword: e.target.checked })}
                  className="rounded border-gray-300"
                />
                <Label htmlFor="create-must-change" className="cursor-pointer">
                  บังคับเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก
                </Label>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)}>
                  ยกเลิก
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? 'กำลังสร้าง...' : 'สร้างผู้ใช้'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* ================================================================== */}
      {/* EDIT USER DIALOG */}
      {/* ================================================================== */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>✏️ แก้ไขผู้ใช้</DialogTitle>
            <DialogDescription>{editingUser?.email}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            {error && (
              <Alert className="border-red-200 bg-red-50">
                <AlertDescription className="text-red-800">{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="edit-email">อีเมล</Label>
              <Input
                id="edit-email"
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-role">Role</Label>
              <Select
                id="edit-role"
                value={editForm.role}
                onChange={(e) => setEditForm({ ...editForm, role: e.target.value as UserRole })}
                disabled={editingUser?.role === 'SUPER_ADMIN'}
              >
                {EDIT_ROLE_OPTIONS
                  .filter((r) => !(r.value === 'SUPER_ADMIN' && currentUser?.role !== 'SUPER_ADMIN'))
                  .map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
              </Select>
              {editingUser?.role === 'SUPER_ADMIN' && (
                <p className="text-xs text-amber-600">ไม่สามารถเปลี่ยน role ของ Super Admin ได้</p>
              )}
            </div>
            <div className="flex items-center space-x-2">
              <input
                id="edit-active"
                type="checkbox"
                checked={editForm.isActive}
                onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
                className="rounded border-gray-300"
                disabled={editingUser?.id === currentUser?.id}
              />
              <Label htmlFor="edit-active" className="cursor-pointer">
                เปิดใช้งาน
              </Label>
              {editingUser?.id === currentUser?.id && (
                <span className="text-xs text-slate-500">(ไม่สามารถปิดใช้งานตัวเองได้)</span>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)}>
                ยกเลิก
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'กำลังบันทึก...' : 'บันทึก'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ================================================================== */}
      {/* RESET PASSWORD DIALOG */}
      {/* ================================================================== */}
      <Dialog open={resetPasswordDialogOpen} onOpenChange={setResetPasswordDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>🔑 รีเซ็ตรหัสผ่าน</DialogTitle>
            <DialogDescription>{editingUser?.email}</DialogDescription>
          </DialogHeader>

          {resetResult ? (
            <div className="space-y-4">
              <Alert className="border-emerald-200 bg-emerald-50">
                <AlertDescription className="text-emerald-800">
                  ✅ รีเซ็ตรหัสผ่านสำเร็จ! ผู้ใช้จะต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งถัดไป
                </AlertDescription>
              </Alert>
              <div className="space-y-2">
                <Label>อีเมล</Label>
                <Input value={resetResult.email} readOnly />
              </div>
              <div className="space-y-2">
                <Label>รหัสผ่านชั่วคราวใหม่ (แสดงครั้งเดียว)</Label>
                <div className="flex gap-2">
                  <Input value={resetResult.tempPassword} readOnly className="font-mono" />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigator.clipboard?.writeText(resetResult.tempPassword)}
                  >
                    📋 คัดลอก
                  </Button>
                </div>
                <p className="text-xs text-amber-600">
                  ⚠️ กรุณาส่งรหัสผ่านนี้ให้ผู้ใช้อย่างปลอดภัย
                </p>
              </div>
              <DialogFooter>
                <Button onClick={() => setResetPasswordDialogOpen(false)}>ปิด</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              {error && (
                <Alert className="border-red-200 bg-red-50">
                  <AlertDescription className="text-red-800">{error}</AlertDescription>
                </Alert>
              )}
              <Alert className="border-amber-200 bg-amber-50">
                <AlertDescription className="text-amber-800">
                  ⚠️ การรีเซ็ตรหัสผ่านจะ:
                  <ul className="list-disc list-inside mt-2 space-y-1 text-xs">
                    <li>สร้างรหัสผ่านชั่วคราวใหม่</li>
                    <li>บังคับให้ผู้ใช้เปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งถัดไป</li>
                    <li>ยกเลิกการล็อกบัญชี (ถ้ามี)</li>
                  </ul>
                </AlertDescription>
              </Alert>
              <DialogFooter>
                <Button variant="outline" onClick={() => setResetPasswordDialogOpen(false)}>
                  ยกเลิก
                </Button>
                <Button onClick={handleResetPassword} disabled={submitting}>
                  {submitting ? 'กำลังรีเซ็ต...' : 'ยืนยันรีเซ็ต'}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ================================================================== */}
      {/* FORCE CHANGE PASSWORD DIALOG */}
      {/* ================================================================== */}
      <Dialog open={forceChangeDialogOpen} onOpenChange={setForceChangeDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>⚠ บังคับเปลี่ยนรหัสผ่าน</DialogTitle>
            <DialogDescription>{editingUser?.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {error && (
              <Alert className="border-red-200 bg-red-50">
                <AlertDescription className="text-red-800">{error}</AlertDescription>
              </Alert>
            )}
            <Alert className="border-blue-200 bg-blue-50">
              <AlertDescription className="text-blue-800">
                ผู้ใช้จะถูกบังคับให้เปลี่ยนรหัสผ่านในการเข้าสู่ระบบครั้งถัดไป
                โดยไม่เปลี่ยนรหัสผ่านปัจจุบัน
              </AlertDescription>
            </Alert>
            <DialogFooter>
              <Button variant="outline" onClick={() => setForceChangeDialogOpen(false)}>
                ยกเลิก
              </Button>
              <Button onClick={handleForceChange} disabled={submitting}>
                {submitting ? 'กำลังดำเนินการ...' : 'ยืนยัน'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* ================================================================== */}
      {/* DISABLE USER DIALOG */}
      {/* ================================================================== */}
      <Dialog open={disableDialogOpen} onOpenChange={setDisableDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>🚫 ปิดใช้งานผู้ใช้</DialogTitle>
            <DialogDescription>{editingUser?.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {error && (
              <Alert className="border-red-200 bg-red-50">
                <AlertDescription className="text-red-800">{error}</AlertDescription>
              </Alert>
            )}
            <Alert className="border-amber-200 bg-amber-50">
              <AlertDescription className="text-amber-800">
                ⚠️ การปิดใช้งานจะ:
                <ul className="list-disc list-inside mt-2 space-y-1 text-xs">
                  <li>ยกเลิกการล็อกบัญชี</li>
                  <li>รีเซ็ตจำนวนครั้งที่ login ผิด</li>
                  <li>บันทึกเหตุผลใน audit log</li>
                </ul>
              </AlertDescription>
            </Alert>
            <div className="space-y-2">
              <Label htmlFor="disable-reason">เหตุผลในการปิดใช้งาน *</Label>
              <Input
                id="disable-reason"
                value={disableReason}
                onChange={(e) => setDisableReason(e.target.value)}
                placeholder="เช่น ลาออก, ละเมิดนโยบาย"
                required
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDisableDialogOpen(false)}>
                ยกเลิก
              </Button>
              <Button variant="destructive" onClick={handleDisable} disabled={submitting || !disableReason.trim()}>
                {submitting ? 'กำลังปิดใช้งาน...' : 'ยืนยันปิดใช้งาน'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
