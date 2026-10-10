'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';

export interface MasterItem {
  id: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
}

export interface MasterListPageConfig {
  title: string;
  addButtonLabel: string;
  apiPath: string;
  entityNameTh: string; // เช่น "หน่วยงาน", "Job Family", "Position Level"
  emptyText?: string;
  /** API field name for the name/title field. Default: "name" */
  nameField?: string;
}

export function MasterListPage({ config }: { config: MasterListPageConfig }) {
  const nameField = config.nameField || 'name';

  const [items, setItems] = useState<MasterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MasterItem | null>(null);
  const [form, setForm] = useState<{ name: string; displayOrder: number; isActive: boolean }>({
    name: '',
    displayOrder: 0,
    isActive: true,
  });
  const [submitting, setSubmitting] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);

  const apiBase = process.env.NEXT_PUBLIC_API_URL || '';
  const token = () => (typeof window !== 'undefined' ? localStorage.getItem('adminToken') || '' : '');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (activeFilter === 'active') params.set('isActive', 'true');
      if (activeFilter === 'inactive') params.set('isActive', 'false');

      const res = await fetch(`${apiBase}${config.apiPath}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const json = await res.json();
      setItems(json.data || []);
    } catch (err) {
      alert('เกิดข้อผิดพลาดในการโหลดข้อมูล');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilter, search, config.apiPath]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    load();
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', displayOrder: 0, isActive: true });
    setDialogOpen(true);
  };

  const openEdit = (item: MasterItem) => {
    setEditing(item);
    setForm({ name: item.name, displayOrder: item.displayOrder, isActive: item.isActive });
    setDialogOpen(true);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    // Allow direct call from Button onClick
    if (e) e.preventDefault();
    if (!form.name.trim()) {
      alert(`กรุณากรอกชื่อ${config.entityNameTh}`);
      return;
    }
    // displayOrder validation only when editing (when it's editable)
    if (editing && (!Number.isInteger(form.displayOrder) || form.displayOrder < 1)) {
      alert('กรุณากรอก displayOrder เป็นจำนวนเต็มบวก');
      return;
    }
    setSubmitting(true);
    try {
      const url = editing ? `${apiBase}${config.apiPath}/${editing.id}` : `${apiBase}${config.apiPath}`;
      const method = editing ? 'PUT' : 'POST';

      // Build payload: use configured nameField (default "name")
      const payload: Record<string, any> = {
        [nameField]: form.name.trim(),
        isActive: form.isActive,
      };
      // Only include displayOrder when editing (it is auto-assigned on create)
      if (editing) {
        payload.displayOrder = form.displayOrder;
      }

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token()}`,
        },
        body: JSON.stringify(payload),
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

  const handleToggle = async (item: MasterItem) => {
    try {
      const res = await fetch(`${apiBase}${config.apiPath}/${item.id}/toggle`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!res.ok) throw new Error('toggle failed');
      await load();
    } catch (err) {
      alert('เกิดข้อผิดพลาดในการเปลี่ยนสถานะ');
    }
  };

  // Stats
  const total = items.length;
  const active = items.filter((i) => i.isActive).length;
  const inactive = items.filter((i) => !i.isActive).length;

  return (
    <div className="p-4 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
        <h1 className="text-2xl font-bold">{config.title}</h1>
        <Button onClick={openCreate}>
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {config.addButtonLabel}
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
            placeholder={`ค้นหาชื่อ${config.entityNameTh}...`}
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
                <TableHead>ชื่อ{config.entityNameTh}</TableHead>
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
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-12 text-gray-500">
                    {config.emptyText || `ไม่พบข้อมูล${config.entityNameTh}`}
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.id} className="hover:bg-gray-50 transition-colors">
                    <TableCell className="text-center font-mono text-slate-600">
                      {item.displayOrder}
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{item.name}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.isActive ? 'default' : 'secondary'}>
                        {item.isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
                        <Button variant="outline" size="sm" onClick={() => openEdit(item)}>
                          แก้ไข
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggle(item)}
                          className="text-slate-600 hover:text-slate-800"
                        >
                          {item.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
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
            <DialogTitle>
              {editing ? `แก้ไข${config.entityNameTh}` : `เพิ่ม${config.entityNameTh}ใหม่`}
            </DialogTitle>
          </DialogHeader>
          <form id="master-form" ref={formRef} onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">ชื่อ{config.entityNameTh} *</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="displayOrder">ลำดับการแสดงผล (display_order)</Label>
              {editing ? (
                <>
                  <Input
                    id="displayOrder"
                    type="number"
                    min={1}
                    step={1}
                    value={form.displayOrder}
                    onChange={(e) => setForm({ ...form, displayOrder: parseInt(e.target.value, 10) || 0 })}
                    required
                  />
                  <p className="text-xs text-slate-500">กรอกจำนวนเต็มบวก (1, 2, 3...)</p>
                </>
              ) : (
                <Input
                  id="displayOrderDisplay"
                  type="text"
                  value="(ระบบจะกำหนดให้อัตโนมัติ)"
                  disabled
                />
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
            <Button type="submit" form="master-form" disabled={submitting}>
              {submitting ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
