'use client';

import { useState, useEffect } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface Round {
  id: string;
  templateVersionId: string;
  title: string;
  positionLevel: string;
  openDate: string | number | Date;
  closeDate: string | number | Date;
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED';
  createdAt: string | number | Date;
}

interface Template {
  id: string;
  name: string;
  description: string | null;
}

interface TemplateVersion {
  id: string;
  templateId: string;
  versionNumber: number;
  status: string;
}

interface FormState {
  title: string;
  positionLevel: string;
  templateVersionId: string;
  openDate: string; // datetime-local string
  closeDate: string;
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED';
}

const EMPTY_FORM: FormState = {
  title: '',
  positionLevel: '',
  templateVersionId: '',
  openDate: '',
  closeDate: '',
  status: 'DRAFT',
};

const toLocalInput = (value: string | number | Date) => {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const toUnix = (local: string) => Math.floor(new Date(local).getTime() / 1000);

export default function RoundsPage() {
  const [rounds, setRounds] = useState<Round[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Round | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const loadRounds = async () => {
    const res = await fetch(process.env.NEXT_PUBLIC_API_URL + '/admin/rounds', {
      headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
    }).then((r) => r.json());
    setRounds(res.data || []);
    setLoading(false);
  };

  const loadTemplates = async () => {
    const res = await fetch(process.env.NEXT_PUBLIC_API_URL + '/admin/templates', {
      headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
    }).then((r) => r.json());
    setTemplates(res.data || []);
  };

  // โหลด versions ของทุก template
  const loadAllVersions = async () => {
    const tpls: Template[] = await fetch(process.env.NEXT_PUBLIC_API_URL + '/admin/templates', {
      headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
    }).then((r) => r.json()).then((res) => res.data || []);
    const allVersions: TemplateVersion[] = [];
    for (const t of tpls) {
      const vs: TemplateVersion[] = await fetch(
        process.env.NEXT_PUBLIC_API_URL + `/admin/templates/${t.id}/versions`,
        { headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` } }
      ).then((r) => r.json()).then((res) => res.data || []);
      allVersions.push(...vs);
    }
    setVersions(allVersions);
  };

  useEffect(() => {
    loadRounds();
    loadTemplates();
    loadAllVersions();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (r: Round) => {
    setEditing(r);
    setForm({
      title: r.title,
      positionLevel: r.positionLevel,
      templateVersionId: r.templateVersionId,
      openDate: toLocalInput(r.openDate),
      closeDate: toLocalInput(r.closeDate),
      status: r.status,
    });
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (new Date(form.closeDate) <= new Date(form.openDate)) {
      alert('วันปิดรับสมัครต้องมากกว่าวันเปิดรับสมัคร');
      return;
    }

    setSubmitting(true);
    try {
      if (editing) {
        // PATCH: ห้ามส่ง templateVersionId
        const payload = {
          title: form.title,
          positionLevel: form.positionLevel,
          openDate: toUnix(form.openDate),
          closeDate: toUnix(form.closeDate),
          status: form.status,
        };
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/rounds/${editing.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('adminToken')}`,
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('update failed');
      } else {
        // POST
        const payload = {
          title: form.title,
          positionLevel: form.positionLevel,
          templateVersionId: form.templateVersionId,
          openDate: toUnix(form.openDate),
          closeDate: toUnix(form.closeDate),
          status: form.status,
        };
        const res = await fetch(process.env.NEXT_PUBLIC_API_URL + '/admin/rounds', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('adminToken')}`,
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('create failed');
      }
      setDialogOpen(false);
      await loadRounds();
    } catch (err) {
      alert('เกิดข้อผิดพลาด: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (value: string | number | Date | null | undefined): string => {
    if (!value) return 'ไม่กำหนด';
    const d = new Date(value);
    if (isNaN(d.getTime())) return 'ไม่กำหนด';
    return d.toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const versionLabel = (templateVersionId: string) => {
    const v = versions.find((x) => x.id === templateVersionId);
    if (!v) return templateVersionId.slice(0, 8) + '...';
    const t = templates.find((x) => x.id === v.templateId);
    return `${t?.name || '?'} v${v.versionNumber}`;
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">รอบการรับสมัคร (Recruitment Rounds)</h1>
        <Button onClick={openCreate} disabled={versions.length === 0}>
          + สร้างรอบใหม่
        </Button>
      </div>

      {versions.length === 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-4 text-sm text-yellow-800">
          ยังไม่มี Template Version — กรุณาไปที่{' '}
          <a href="/admin/templates" className="underline font-medium">หน้า Templates</a>{' '}
          เพื่อสร้าง Template และ Publish Version ก่อน
        </div>
      )}

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ชื่อรอบ</TableHead>
              <TableHead>ระดับ</TableHead>
              <TableHead>Template</TableHead>
              <TableHead>เปิด-ปิด</TableHead>
              <TableHead>สถานะ</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-slate-500 py-6">
                  กำลังโหลด...
                </TableCell>
              </TableRow>
            ) : rounds.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-slate-500 py-6">
                  ยังไม่มีรอบรับสมัคร
                </TableCell>
              </TableRow>
            ) : (
              rounds.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.title}</TableCell>
                  <TableCell>{r.positionLevel}</TableCell>
                  <TableCell className="text-slate-500 text-sm">
                    {versionLabel(r.templateVersionId)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatDate(r.openDate)} - {formatDate(r.closeDate)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        r.status === 'ACTIVE' ? 'default' : r.status === 'CLOSED' ? 'secondary' : 'outline'
                      }
                    >
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => openEdit(r)}>
                      แก้ไข
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'แก้ไขรอบรับสมัคร' : 'สร้างรอบรับสมัครใหม่'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">ชื่อรอบ</Label>
              <Input
                id="title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
                placeholder="เช่น รับสมัครนักตรวจเงินแผ่นดิน รุ่นที่ 12"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="positionLevel">ระดับตำแหน่ง</Label>
              <Input
                id="positionLevel"
                value={form.positionLevel}
                onChange={(e) => setForm({ ...form, positionLevel: e.target.value })}
                required
                placeholder="เช่น ปฏิบัติการ / ชำนาญการ"
              />
            </div>
            {!editing && (
              <div className="space-y-2">
                <Label htmlFor="templateVersionId">Template Version</Label>
                <Select
                  id="templateVersionId"
                  value={form.templateVersionId}
                  onChange={(e) => setForm({ ...form, templateVersionId: e.target.value })}
                  required
                >
                  <option value="">-- เลือก Template Version --</option>
                  {versions.map((v) => {
                    const t = templates.find((x) => x.id === v.templateId);
                    return (
                      <option key={v.id} value={v.id}>
                        {t?.name || '?'} v{v.versionNumber} ({v.status})
                      </option>
                    );
                  })}
                </Select>
                <p className="text-xs text-slate-500">
                  Template ที่เลือกจะถูกล็อกไว้ ไม่สามารถเปลี่ยนได้หลังสร้างรอบแล้ว
                </p>
              </div>
            )}
            {editing && (
              <div className="space-y-2">
                <Label>Template (ล็อกไว้แล้ว)</Label>
                <div className="p-2 bg-slate-100 rounded text-sm">
                  {versionLabel(form.templateVersionId)}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="openDate">วันเปิดรับสมัคร</Label>
                <Input
                  id="openDate"
                  type="datetime-local"
                  value={form.openDate}
                  onChange={(e) => setForm({ ...form, openDate: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="closeDate">วันปิดรับสมัคร</Label>
                <Input
                  id="closeDate"
                  type="datetime-local"
                  value={form.closeDate}
                  onChange={(e) => setForm({ ...form, closeDate: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">สถานะ</Label>
              <Select
                id="status"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as FormState['status'] })}
              >
                <option value="DRAFT">DRAFT — ยังไม่เปิดรับ</option>
                <option value="ACTIVE">ACTIVE — เปิดรับสมัครแล้ว</option>
                <option value="CLOSED">CLOSED — ปิดรับแล้ว</option>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                ยกเลิก
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'กำลังบันทึก...' : editing ? 'บันทึกการแก้ไข' : 'สร้างรอบ'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}