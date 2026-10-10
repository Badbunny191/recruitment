'use client';

import { useState, useEffect } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { SearchableDropdown } from '@/components/SearchableDropdown';

interface Position {
  id: string;
  title: string;
  jobFamilyId: string;
  positionLevelId: string;
  displayOrder: number;
  isActive: boolean;
}

interface JobFamily {
  id: string;
  name: string;
}

interface PositionLevel {
  id: string;
  name: string;
}

interface FormState {
  title: string;
  jobFamilyId: string | null;
  positionLevelId: string | null;
  displayOrder: number;
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  title: '',
  jobFamilyId: null,
  positionLevelId: null,
  displayOrder: 0,
  isActive: true,
};

export default function PositionsPage() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [jobFamilies, setJobFamilies] = useState<JobFamily[]>([]);
  const [positionLevels, setPositionLevels] = useState<PositionLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Position | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const apiBase = process.env.NEXT_PUBLIC_API_URL || '';
  const token = () => localStorage.getItem('adminToken') || '';

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (activeFilter === 'active') params.set('isActive', 'true');
      if (activeFilter === 'inactive') params.set('isActive', 'false');

      const [posRes, jfRes, plRes] = await Promise.all([
        fetch(`${apiBase}/admin/positions?${params.toString()}`, { headers: { Authorization: `Bearer ${token()}` } }),
        fetch(`${apiBase}/admin/job-families?isActive=true`, { headers: { Authorization: `Bearer ${token()}` } }),
        fetch(`${apiBase}/admin/position-levels?isActive=true`, { headers: { Authorization: `Bearer ${token()}` } }),
      ]);

      const [posJson, jfJson, plJson] = await Promise.all([posRes.json(), jfRes.json(), plRes.json()]);
      setPositions(posJson.data || []);
      setJobFamilies(jfJson.data || []);
      setPositionLevels(plJson.data || []);
    } catch (err) {
      alert('เกิดข้อผิดพลาดในการโหลดข้อมูล');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [activeFilter, search]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    load();
  };

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (item: Position) => {
    setEditing(item);
    setForm({
      title: item.title,
      jobFamilyId: item.jobFamilyId,
      positionLevelId: item.positionLevelId,
      displayOrder: item.displayOrder,
      isActive: item.isActive,
    });
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { alert('กรุณากรอกชื่อตำแหน่ง'); return; }
    if (!form.jobFamilyId) { alert('กรุณาเลือก Job Family'); return; }
    if (!form.positionLevelId) { alert('กรุณาเลือก Position Level'); return; }

    setSubmitting(true);
    try {
      const url = editing ? `${apiBase}/admin/positions/${editing.id}` : `${apiBase}/admin/positions`;
      const method = editing ? 'PUT' : 'POST';

      // Build payload - displayOrder only sent when editing (auto-assigned on create)
      const payload: Record<string, any> = {
        title: form.title.trim(),
        jobFamilyId: form.jobFamilyId,
        positionLevelId: form.positionLevelId,
        isActive: form.isActive,
      };
      if (editing) {
        payload.displayOrder = form.displayOrder;
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'save failed');
      }
      setDialogOpen(false);
      await load();
    } catch (err: any) {
      alert(`เกิดข้อผิดพลาด: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (item: Position) => {
    try {
      const res = await fetch(`${apiBase}/admin/positions/${item.id}/toggle`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!res.ok) throw new Error('toggle failed');
      await load();
    } catch (err) {
      alert('เกิดข้อผิดพลาด');
    }
  };

  const total = positions.length;
  const active = positions.filter((p) => p.isActive).length;
  const inactive = positions.filter((p) => !p.isActive).length;

  // Helper - look up name from id
  const jfName = (id: string) => jobFamilies.find((j) => j.id === id)?.name || id;
  const plName = (id: string) => positionLevels.find((p) => p.id === id)?.name || id;

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold">ตำแหน่ง (Positions)</h1>
          <p className="text-sm text-slate-500 mt-1">
            ใช้ SearchableDropdown ในการเลือก Job Family และ Position Level
          </p>
        </div>
        <Button onClick={openCreate}>
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          เพิ่มตำแหน่งใหม่
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
          <Input placeholder="ค้นหาชื่อตำแหน่ง..." value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1" />
          <Button type="submit" variant="outline">ค้นหา</Button>
        </form>
        <div className="flex gap-2">
          <Button variant={activeFilter === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setActiveFilter('all')}>ทั้งหมด</Button>
          <Button variant={activeFilter === 'active' ? 'default' : 'outline'} size="sm" onClick={() => setActiveFilter('active')}>ใช้งาน</Button>
          <Button variant={activeFilter === 'inactive' ? 'default' : 'outline'} size="sm" onClick={() => setActiveFilter('inactive')}>ปิดใช้งาน</Button>
        </div>
      </div>

      {/* Table */}
      <div className="border rounded-lg bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead className="w-16 text-center">ลำดับ</TableHead>
                <TableHead>ชื่อตำแหน่ง</TableHead>
                <TableHead>Job Family</TableHead>
                <TableHead>Position Level</TableHead>
                <TableHead>สถานะ</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12">
                  <div className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span className="text-gray-500">กำลังโหลด...</span>
                  </div>
                </TableCell></TableRow>
              ) : positions.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12 text-gray-500">ไม่พบข้อมูลตำแหน่ง</TableCell></TableRow>
              ) : (
                positions.map((p) => (
                  <TableRow key={p.id} className="hover:bg-gray-50 transition-colors">
                    <TableCell className="text-center font-mono text-slate-600">{p.displayOrder}</TableCell>
                    <TableCell>
                      <p className="font-medium">{p.title}</p>
                    </TableCell>
                    <TableCell><Badge variant="outline">{jfName(p.jobFamilyId)}</Badge></TableCell>
                    <TableCell><Badge variant="outline">{plName(p.positionLevelId)}</Badge></TableCell>
                    <TableCell>
                      <Badge variant={p.isActive ? 'default' : 'secondary'}>
                        {p.isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
                        <Button variant="outline" size="sm" onClick={() => openEdit(p)}>แก้ไข</Button>
                        <Button variant="ghost" size="sm" onClick={() => handleToggle(p)} className="text-slate-600">
                          {p.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
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

      {/* Form Dialog - ใช้ SearchableDropdown 2 ตัว */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'แก้ไขตำแหน่ง' : 'เพิ่มตำแหน่งใหม่'}</DialogTitle>
          </DialogHeader>
          <form id="position-form" onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">ชื่อตำแหน่ง *</Label>
              <Input id="title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            </div>

            <div className="space-y-2">
              <Label>Job Family *</Label>
              <SearchableDropdown
                options={jobFamilies.map((j) => ({ id: j.id, label: j.name }))}
                value={form.jobFamilyId}
                onChange={(id) => setForm({ ...form, jobFamilyId: id })}
                placeholder="เลือก Job Family..."
                emptyText="ไม่พบ Job Family"
              />
            </div>

            <div className="space-y-2">
              <Label>Position Level *</Label>
              <SearchableDropdown
                options={positionLevels.map((p) => ({ id: p.id, label: p.name }))}
                value={form.positionLevelId}
                onChange={(id) => setForm({ ...form, positionLevelId: id })}
                placeholder="เลือก Position Level..."
                emptyText="ไม่พบ Position Level"
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
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>ยกเลิก</Button>
            <Button type="submit" form="position-form" disabled={submitting}>{submitting ? 'กำลังบันทึก...' : 'บันทึก'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
