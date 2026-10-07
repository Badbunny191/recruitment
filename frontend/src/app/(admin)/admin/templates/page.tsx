'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface Template {
  id: string;
  name: string;
  description: string | null;
  createdAt: number;
}

export default function TemplatesPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [form, setForm] = useState({ name: '', description: '' });
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    const res = await fetch(process.env.NEXT_PUBLIC_API_URL + '/admin/templates', {
      headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
    }).then((r) => r.json());
    setTemplates(res.data || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', description: '' });
    setDialogOpen(true);
  };

  const openEdit = (t: Template, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditing(t);
    setForm({ name: t.name, description: t.description || '' });
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        name: form.name,
        description: form.description || null,
      };
      const url = editing
        ? `${process.env.NEXT_PUBLIC_API_URL}/admin/templates/${editing.id}`
        : `${process.env.NEXT_PUBLIC_API_URL}/admin/templates`;
      const method = editing ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('adminToken')}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('save failed');
      setDialogOpen(false);
      await load();
    } catch (err) {
      alert('เกิดข้อผิดพลาด: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Form Templates (แม่แบบฟอร์ม)</h1>
        <Button onClick={openCreate}>+ สร้าง Template</Button>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Template Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>สร้างเมื่อ</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-slate-500 py-6">
                  กำลังโหลด...
                </TableCell>
              </TableRow>
            ) : templates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-slate-500 py-6">
                  ยังไม่มี Template — คลิก "+ สร้าง Template" เพื่อเริ่มต้น
                </TableCell>
              </TableRow>
            ) : (
              templates.map((tpl) => (
                <TableRow
                  key={tpl.id}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => router.push(`/admin/templates/builder?id=${tpl.id}`)}
                >
                  <TableCell className="font-medium">{tpl.name}</TableCell>
                  <TableCell className="text-slate-500">{tpl.description || '-'}</TableCell>
                  <TableCell className="text-slate-500 text-sm">
                    {tpl.createdAt ? new Date(tpl.createdAt * 1000).toLocaleDateString('th-TH') : '-'}
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => openEdit(tpl, e)}
                    >
                      แก้ไข
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => router.push(`/admin/templates/builder?id=${tpl.id}`)}
                    >
                      Builder
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
            <DialogTitle>{editing ? 'แก้ไข Template' : 'สร้าง Template ใหม่'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tplName">ชื่อ Template</Label>
              <Input
                id="tplName"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                placeholder="เช่น แบบฟอร์มสมัครงานทั่วไป"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tplDesc">คำอธิบาย (ไม่บังคับ)</Label>
              <Textarea
                id="tplDesc"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                placeholder="อธิบายว่า template นี้ใช้สำหรับอะไร"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                ยกเลิก
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'กำลังบันทึก...' : 'บันทึก'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}