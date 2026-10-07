'use client';

import { useState, useEffect } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface FieldMaster {
  id: string;
  fieldType: 'TEXT' | 'TEXTAREA' | 'DROPDOWN' | 'RADIO' | 'FILE';
  labelTh: string;
  defaultOptions: string[] | null;
  pdfMappingKey: string | null;
  isActive: boolean;
}

interface FormState {
  fieldType: FieldMaster['fieldType'];
  labelTh: string;
  defaultOptionsText: string; // รับเป็น text แล้วแปลงเป็น array
  pdfMappingKey: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  fieldType: 'TEXT',
  labelTh: '',
  defaultOptionsText: '',
  pdfMappingKey: '',
  isActive: true,
};

export default function FieldMasterPage() {
  const [fields, setFields] = useState<FieldMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FieldMaster | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<FieldMaster | null>(null);

  const load = async () => {
    setLoading(true);
    const res = await fetch(process.env.NEXT_PUBLIC_API_URL + '/admin/fields', {
      headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
    }).then((r) => r.json());
    setFields(res.data || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (f: FieldMaster) => {
    setEditing(f);
    setForm({
      fieldType: f.fieldType,
      labelTh: f.labelTh,
      defaultOptionsText: f.defaultOptions ? f.defaultOptions.join('\n') : '',
      pdfMappingKey: f.pdfMappingKey || '',
      isActive: f.isActive,
    });
    setDialogOpen(true);
  };

  const parseOptions = (text: string): string[] | null => {
    const opts = text.split('\n').map((s) => s.trim()).filter(Boolean);
    return opts.length > 0 ? opts : null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        fieldType: form.fieldType,
        labelTh: form.labelTh,
        defaultOptions: parseOptions(form.defaultOptionsText),
        pdfMappingKey: form.pdfMappingKey || null,
        isActive: form.isActive,
      };

      const url = editing
        ? `${process.env.NEXT_PUBLIC_API_URL}/admin/fields/${editing.id}`
        : `${process.env.NEXT_PUBLIC_API_URL}/admin/fields`;
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
      alert('เกิดข้อผิดพลาดในการบันทึก');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/fields/${confirmDelete.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
      });
      if (!res.ok) throw new Error('delete failed');
      setConfirmDelete(null);
      await load();
    } catch (err) {
      alert('เกิดข้อผิดพลาดในการลบ');
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Field Master (คลังคำถาม)</h1>
        <Button onClick={openCreate}>+ เพิ่ม Field</Button>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label (TH)</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>PDF Mapping Key</TableHead>
              <TableHead>สถานะ</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-slate-500 py-6">
                  กำลังโหลด...
                </TableCell>
              </TableRow>
            ) : fields.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-slate-500 py-6">
                  ยังไม่มี Field
                </TableCell>
              </TableRow>
            ) : (
              fields.map((field) => (
                <TableRow key={field.id}>
                  <TableCell className="font-medium">{field.labelTh}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{field.fieldType}</Badge>
                  </TableCell>
                  <TableCell>{field.pdfMappingKey || '-'}</TableCell>
                  <TableCell>
                    <Badge variant={field.isActive ? 'default' : 'secondary'}>
                      {field.isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(field)}>
                      แก้ไข
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setConfirmDelete(field)}
                      disabled={!field.isActive}
                    >
                      ลบ
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Form Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'แก้ไข Field' : 'เพิ่ม Field ใหม่'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fieldType">ประเภทฟิลด์</Label>
              <Select
                id="fieldType"
                value={form.fieldType}
                onChange={(e) => setForm({ ...form, fieldType: e.target.value as FieldMaster['fieldType'] })}
                required
              >
                <option value="TEXT">TEXT — ช่องกรอกข้อความ</option>
                <option value="TEXTAREA">TEXTAREA — กล่องข้อความยาว</option>
                <option value="DROPDOWN">DROPDOWN — เลือกจากรายการ</option>
                <option value="RADIO">RADIO — เลือก 1 ตัวเลือก</option>
                <option value="FILE">FILE — อัปโหลดไฟล์ PDF</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="labelTh">คำถาม (ภาษาไทย)</Label>
              <Input
                id="labelTh"
                value={form.labelTh}
                onChange={(e) => setForm({ ...form, labelTh: e.target.value })}
                required
                placeholder="เช่น ประสบการณ์ทำงาน"
              />
            </div>
            {(form.fieldType === 'DROPDOWN' || form.fieldType === 'RADIO') && (
              <div className="space-y-2">
                <Label htmlFor="defaultOptions">ตัวเลือก (หนึ่งบรรทัดต่อหนึ่งตัวเลือก)</Label>
                <Textarea
                  id="defaultOptions"
                  rows={4}
                  value={form.defaultOptionsText}
                  onChange={(e) => setForm({ ...form, defaultOptionsText: e.target.value })}
                  placeholder={'ตัวเลือก 1\nตัวเลือก 2\nตัวเลือก 3'}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="pdfMappingKey">PDF Mapping Key (ตัวระบุในการสร้าง PDF)</Label>
              <Input
                id="pdfMappingKey"
                value={form.pdfMappingKey}
                onChange={(e) => setForm({ ...form, pdfMappingKey: e.target.value })}
                placeholder="เช่น experience_years"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="isActive"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              <Label htmlFor="isActive" className="cursor-pointer">ใช้งาน</Label>
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

      {/* Delete confirm */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ยืนยันการลบ Field</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600">
            คุณต้องการลบ <b>{confirmDelete?.labelTh}</b> หรือไม่?
            <br />
            ระบบจะตั้งค่าเป็น "ปิดใช้งาน" (ข้อมูลจะไม่ถูกลบออกจากฐานข้อมูล เพราะอาจถูกใช้ใน template version แล้ว)
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              ยกเลิก
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              ลบ (Soft Delete)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}