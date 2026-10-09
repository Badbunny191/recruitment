'use client';

import { useState, useEffect } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';

interface Organization {
  id: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
  createdAt?: number;
  updatedAt?: number;
}

interface FormState {
  name: string;
  displayOrder: number;
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  displayOrder: 0,
  isActive: true,
};

export default function OrganizationsPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Organization | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Organization | null>(null);

  const token = () => localStorage.getItem('adminToken') || '';
  const apiBase = process.env.NEXT_PUBLIC_API_URL || '';

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (activeFilter === 'active') params.set('isActive', 'true');
      if (activeFilter === 'inactive') params.set('isActive', 'false');

      const res = await fetch(`${apiBase}/admin/organizations?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const json = await res.json();
      setOrganizations(json.data || []);
    } catch (err) {
      alert('เกิดข้อผิดพลาดในการโหลดข้อมูล');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    load();
  };

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (org: Organization) => {
    setEditing(org);
    setForm({ name: org.name, displayOrder: org.displayOrder, isActive: org.isActive });
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      alert('กรุณากรอกชื่อหน่วยงาน');
      return;
    }
    if (!Number.isInteger(form.displayOrder) || form.displayOrder < 1) {
      alert('กรุณากรอก displayOrder เป็นจำนวนเต็มบวก');
      return;
    }
    setSubmitting(true);
    try {
      const url = editing
        ? `${apiBase}/admin/organizations/${editing.id}`
        : `${apiBase}/admin/organizations`;
      const method = editing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token()}`,
        },
        body: JSON.stringify({
          name: form.name.trim(),
          displayOrder: form.displayOrder,
          isActive: form.isActive,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'save failed');
      }
      setDialogOpen(false);
      await load();
    } catch (err: any) {
      alert(`เกิดข้อผิดพลาด: ${err.message || 'ไม่สามารถบันทึกได้'}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (org: Organization) => {
    try {
      const res = await fetch(`${apiBase}/admin/organizations/${org.id}/toggle`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!res.ok) throw new Error('toggle failed');
      await load();
    } catch (err) {
      alert('เกิดข้อผิดพลาดในการเปลี่ยนสถานะ');
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      const res = await fetch(`${apiBase}/admin/organizations/${confirmDelete.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!res.ok) throw new Error('delete failed');
      setConfirmDelete(null);
      await load();
    } catch (err) {
      alert('เกิดข้อผิดพลาดในการลบ');
    }
  };

  // Stats
  const total = organizations.length;
  const active = organizations.filter((o) => o.isActive).length;
  const inactive = organizations.filter((o) => !o.isActive).length;

  return (
    <div className="p-4 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
        <h1 className="text-2xl font-bold">หน่วยงาน (Organizations)</h1>
        <Button onClick={openCreate}>
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          เพิ่มหน่วยงานใหม่
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-slate-800">{total}</p>
            <p className="text-xs text-slate-500">ทั้งหมด</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-700">{active}</p>
            <p className="text-xs text-slate-500">ใช้งาน</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-slate-500">{inactive}</p>
            <p className="text-xs text-slate-500">ปิดใช้งาน</p>
          </CardContent>
        </Card>
      </div>

      {/* Search + Filter */}
      <div className="flex flex-col md:flex-row gap-3">
        <form onSubmit={handleSearchSubmit} className="flex gap-2 flex-1">
          <Input
            placeholder="ค้นหาชื่อหน่วยงาน..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1"
          />
          <Button type="submit" variant="outline">ค้นหา</Button>
        </form>
        <div className="flex gap-2">
          <Button
            variant={activeFilter === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveFilter('all')}
          >
            ทั้งหมด
          </Button>
          <Button
            variant={activeFilter === 'active' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveFilter('active')}
          >
            ใช้งาน
          </Button>
          <Button
            variant={activeFilter === 'inactive' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveFilter('inactive')}
          >
            ปิดใช้งาน
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="border rounded-lg bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead className="w-16 text-center">ลำดับ</TableHead>
                <TableHead>ชื่อหน่วยงาน</TableHead>
                <TableHead>สถานะ</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-12">
                    <div className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span className="text-gray-500">กำลังโหลด...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : organizations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-12 text-gray-500">
                    ไม่พบข้อมูลหน่วยงาน
                  </TableCell>
                </TableRow>
              ) : (
                organizations.map((org) => (
                  <TableRow key={org.id} className="hover:bg-gray-50 transition-colors">
                    <TableCell className="text-center font-mono text-slate-600">
                      {org.displayOrder}
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{org.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5 font-mono">{org.id}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={org.isActive ? 'default' : 'secondary'}>
                        {org.isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
                        <Button variant="outline" size="sm" onClick={() => openEdit(org)}>
                          แก้ไข
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggle(org)}
                          className="text-slate-600 hover:text-slate-800"
                        >
                          {org.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmDelete(org)}
                          disabled={!org.isActive}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          ลบ
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Form Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'แก้ไขหน่วยงาน' : 'เพิ่มหน่วยงานใหม่'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">ชื่อหน่วยงาน *</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                placeholder="เช่น สำนักอำนวยการคณะกรรมการตรวจเงินแผ่นดิน"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="displayOrder">ลำดับการแสดงผล (display_order) *</Label>
              <Input
                id="displayOrder"
                type="number"
                min={1}
                step={1}
                value={form.displayOrder}
                onChange={(e) => setForm({ ...form, displayOrder: parseInt(e.target.value, 10) || 0 })}
                required
                disabled={!editing}
                placeholder={editing ? '' : 'กำหนดอัตโนมัติเมื่อสร้างใหม่'}
              />
              {!editing && (
                <p className="text-xs text-slate-500">ระบบจะกำหนดลำดับถัดไปให้อัตโนมัติ (สูงสุด + 1)</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                id="isActive"
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <Label htmlFor="isActive" className="cursor-pointer">ใช้งาน</Label>
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              ยกเลิก
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Delete Dialog */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>ยืนยันการลบหน่วยงาน</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              หน่วยงานจะถูกตั้งค่าเป็น &quot;ปิดใช้งาน&quot; (Soft Delete)
            </div>
            {confirmDelete && (
              <p className="text-sm">
                <strong>ชื่อ:</strong> {confirmDelete.name}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              ยกเลิก
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              ตกลง ลบ (Soft Delete)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
