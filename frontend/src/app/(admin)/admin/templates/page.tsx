'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

interface TemplateVersion {
  id: string;
  versionNumber: number;
  status: string;
  createdAt: string | number | Date;
}

interface Template {
  id: string;
  name: string;
  description: string | null;
  createdAt: string | number | Date;
  versionCount: number;
  currentVersion: TemplateVersion | null;
  // Round counts (active = ใช้งานอยู่, archived = จัดเก็บแล้ว, total = รวมทั้งหมด)
  activeRoundsCount: number;
  archivedRoundsCount: number;
  totalRoundsCount: number;
  // Backward-compat (legacy field)
  roundsCount?: number;
  deletedAt: string | number | Date | null;
}

interface RoundRef {
  roundId: string;
  roundName: string;
  roundStatus: string;
  deletedAt: string | number | Date | null;
}

export default function TemplatesPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [form, setForm] = useState({ name: '', description: '' });
  const [submitting, setSubmitting] = useState(false);

  // View filter: all | active | archived
  const [view, setView] = useState<'all' | 'active' | 'archived'>('active');

  // Archive / Restore / Permanent Delete dialogs
  const [archiveDialog, setArchiveDialog] = useState<{ open: boolean; tpl: Template | null }>({ open: false, tpl: null });
  const [restoreDialog, setRestoreDialog] = useState<{ open: boolean; tpl: Template | null }>({ open: false, tpl: null });
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    tpl: Template | null;
    activeRounds: number;
    archivedRounds: number;
    totalRounds: number;
    rounds: RoundRef[];
  }>({ open: false, tpl: null, activeRounds: 0, archivedRounds: 0, totalRounds: 0, rounds: [] });
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/admin/templates?view=${view}`,
      { headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` } }
    ).then((r) => r.json());
    setTemplates(res.data || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

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

  // Archive / Restore / Permanent Delete handlers
  const handleArchive = async () => {
    if (!archiveDialog.tpl) return;
    setArchiveLoading(true);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/templates/${archiveDialog.tpl.id}/archive`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Archive failed');
      }
      setArchiveDialog({ open: false, tpl: null });
      await load();
    } catch (err) {
      alert('Archive ไม่สำเร็จ: ' + (err as Error).message);
    } finally {
      setArchiveLoading(false);
    }
  };

  const handleRestore = async () => {
    if (!restoreDialog.tpl) return;
    setRestoreLoading(true);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/templates/${restoreDialog.tpl.id}/restore`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Restore failed');
      }
      setRestoreDialog({ open: false, tpl: null });
      await load();
    } catch (err) {
      alert('Restore ไม่สำเร็จ: ' + (err as Error).message);
    } finally {
      setRestoreLoading(false);
    }
  };

  const openDeleteDialog = async (tpl: Template) => {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/admin/templates/${tpl.id}/usage`,
      { headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` } }
    ).then(r => r.json()).catch(() => ({ data: null }));
    const data = res?.data;
    const activeRounds = data?.activeRounds || 0;
    const archivedRounds = data?.archivedRounds || 0;
    const totalRounds = data?.totalRounds ?? data?.roundCount ?? (activeRounds + archivedRounds);
    const rounds: RoundRef[] = Array.isArray(data?.rounds) ? data.rounds : [];
    setDeleteDialog({ open: true, tpl, activeRounds, archivedRounds, totalRounds, rounds });
    setDeleteConfirmText('');
  };

  const handlePermanentDelete = async () => {
    if (!deleteDialog.tpl) return;
    if (deleteConfirmText !== deleteDialog.tpl.name) {
      alert('กรุณาพิมพ์ชื่อแม่แบบให้ตรงกันเพื่อยืนยัน');
      return;
    }
    setDeleteLoading(true);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/templates/${deleteDialog.tpl.id}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'เกิดข้อผิดพลาดในการลบ');
      }
      setDeleteDialog({ open: false, tpl: null, activeRounds: 0, archivedRounds: 0, totalRounds: 0, rounds: [] });
      setDeleteConfirmText('');
      await load();
    } catch (err) {
      alert('Delete ไม่สำเร็จ: ' + (err as Error).message);
    } finally {
      setDeleteLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PUBLISHED':
        return <Badge variant="default" className="bg-green-600">Published</Badge>;
      case 'DRAFT':
        return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 border-yellow-300">Draft</Badge>;
      case 'ARCHIVED':
        return <Badge variant="outline" className="bg-gray-100 text-gray-600 border-gray-300">จัดเก็บแล้ว</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  // แสดงรายชื่อ Round สูงสุด 10 รายการ พร้อม "...และอีก X รายการ"
  const renderRoundList = (rounds: RoundRef[], kind: 'active' | 'archived') => {
    const filtered = rounds.filter(r =>
      kind === 'active' ? !r.deletedAt : !!r.deletedAt
    );
    if (filtered.length === 0) {
      return <p className="text-xs text-slate-500 italic ml-4">ไม่มี</p>;
    }
    const MAX = 10;
    const shown = filtered.slice(0, MAX);
    const remaining = filtered.length - shown.length;
    return (
      <ul className="text-sm text-slate-800 ml-4 space-y-1">
        {shown.map(r => (
          <li key={r.roundId} className="flex items-center gap-2">
            <span className="text-slate-500">•</span>
            <span>{r.roundName}</span>
            {kind === 'active' && (
              <Badge
                variant="outline"
                className={`text-[10px] px-1.5 py-0 ${
                  r.roundStatus === 'ACTIVE'
                    ? 'bg-green-50 text-green-700 border-green-300'
                    : r.roundStatus === 'CLOSED'
                    ? 'bg-slate-100 text-slate-600 border-slate-300'
                    : 'bg-yellow-50 text-yellow-700 border-yellow-300'
                }`}
              >
                {r.roundStatus}
              </Badge>
            )}
          </li>
        ))}
        {remaining > 0 && (
          <li className="text-xs text-slate-500 italic">…และอีก {remaining} รายการ</li>
        )}
      </ul>
    );
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Form Templates (แม่แบบฟอร์ม)</h1>
        <Button onClick={openCreate}>+ สร้าง Template</Button>
      </div>

      {/* View filter: All / Active / Archived */}
      <div className="flex gap-2 items-center">
        <span className="text-sm text-slate-600">มุมมอง:</span>
        <div className="inline-flex rounded-md border border-slate-200 overflow-hidden">
          <button
            onClick={() => setView('all')}
            className={`px-3 py-1.5 text-sm ${view === 'all' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
          >
            ทั้งหมด
          </button>
          <button
            onClick={() => setView('active')}
            className={`px-3 py-1.5 text-sm border-l border-slate-200 ${view === 'active' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
          >
            ใช้งานอยู่
          </button>
          <button
            onClick={() => setView('archived')}
            className={`px-3 py-1.5 text-sm border-l border-slate-200 ${view === 'archived' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
          >
            จัดเก็บแล้ว
          </button>
        </div>
        <span className="text-xs text-slate-500 ml-2">
          {view === 'active' && 'แสดงเฉพาะแม่แบบที่ยังใช้งานอยู่'}
          {view === 'archived' && 'แสดงเฉพาะแม่แบบที่จัดเก็บแล้ว'}
          {view === 'all' && 'แสดงแม่แบบทั้งหมด'}
        </span>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ชื่อแม่แบบ</TableHead>
              <TableHead>Version ปัจจุบัน</TableHead>
              <TableHead>จำนวน Version</TableHead>
              <TableHead>รอบรับสมัคร</TableHead>
              <TableHead>สร้างเมื่อ</TableHead>
              <TableHead className="text-right">การจัดการ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-slate-500 py-6">
                  กำลังโหลด...
                </TableCell>
              </TableRow>
            ) : templates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-slate-500 py-6">
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
                  <TableCell>
                    {tpl.currentVersion ? (
                      <div className="flex items-center gap-2">
                        <span className="font-medium">v{tpl.currentVersion.versionNumber}</span>
                        {getStatusBadge(tpl.currentVersion.status)}
                      </div>
                    ) : (
                      <span className="text-slate-400 text-sm">ยังไม่มี Published</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-slate-600">{tpl.versionCount} version</span>
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const active = tpl.activeRoundsCount ?? 0;
                      const archived = tpl.archivedRoundsCount ?? 0;
                      const total = tpl.totalRoundsCount ?? (active + archived);
                      if (total === 0) {
                        return <span className="text-slate-400 text-sm">ไม่มีรอบ</span>;
                      }
                      if (active === 0 && archived > 0) {
                        return (
                          <div className="text-sm">
                            <div className="text-slate-400">ใช้งานอยู่ 0 รอบ</div>
                            <div className="text-amber-600 font-medium">จัดเก็บแล้ว {archived} รอบ</div>
                          </div>
                        );
                      }
                      return (
                        <div className="text-sm">
                          <div className="font-medium text-slate-700">{total} รอบ</div>
                          <div className="text-xs text-slate-500">
                            (ใช้งานอยู่ {active} / จัดเก็บแล้ว {archived})
                          </div>
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="text-slate-500 text-sm">
                    {tpl.createdAt ? new Date(tpl.createdAt).toLocaleDateString('th-TH') : '-'}
                  </TableCell>
                  <TableCell className="text-right space-x-2" onClick={(e) => e.stopPropagation()}>
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
                    {/* Archive / Restore / Delete Permanently actions */}
                    {!tpl.deletedAt ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-slate-700 border-slate-300 hover:bg-slate-50"
                        onClick={() => setArchiveDialog({ open: true, tpl })}
                        title="จัดเก็บ (ซ่อนจากรายการปกติ แต่ไม่ลบข้อมูล)"
                      >
                        📁 จัดเก็บ
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-green-700 border-green-300 hover:bg-green-50"
                          onClick={() => setRestoreDialog({ open: true, tpl })}
                          title="เรียกคืนกลับมาเป็นแม่แบบที่ใช้งานอยู่"
                        >
                          ↩ เรียกคืน
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-red-700 border-red-300 hover:bg-red-50"
                          onClick={() => openDeleteDialog(tpl)}
                          title="ลบถาวร (เฉพาะผู้ดูแลระบบ)"
                        >
                          🗑 ลบถาวร
                        </Button>
                      </>
                    )}
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

      {/* Archive Confirmation Dialog */}
      <Dialog open={archiveDialog.open} onOpenChange={(open) => setArchiveDialog({ open, tpl: open ? archiveDialog.tpl : null })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              📁 จัดเก็บแม่แบบ
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-700">
              คุณกำลังจะจัดเก็บ <span className="font-semibold">"{archiveDialog.tpl?.name}"</span>
            </p>
            <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-900">
              <p className="font-medium">ผลกระทบ:</p>
              <ul className="list-disc list-inside mt-1 space-y-0.5 text-xs">
                <li>แม่แบบจะหายไปจากรายการปกติ</li>
                <li>รอบรับสมัครที่อ้างอิงยังคงอยู่ (ไม่ถูกลบ)</li>
                <li>เรียกคืนกลับมาได้ภายหลัง</li>
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveDialog({ open: false, tpl: null })} disabled={archiveLoading}>
              ยกเลิก
            </Button>
            <Button onClick={handleArchive} disabled={archiveLoading} className="bg-slate-700 hover:bg-slate-800">
              {archiveLoading ? 'กำลังจัดเก็บ...' : '📁 จัดเก็บ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore Confirmation Dialog */}
      <Dialog open={restoreDialog.open} onOpenChange={(open) => setRestoreDialog({ open, tpl: open ? restoreDialog.tpl : null })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              ↩ เรียกคืนแม่แบบ
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-700">
              คุณกำลังจะเรียกคืน <span className="font-semibold">"{restoreDialog.tpl?.name}"</span>
            </p>
            <div className="bg-green-50 border border-green-200 rounded p-3 text-sm text-green-900">
              <p>แม่แบบจะกลับมาแสดงในรายการปกติ</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreDialog({ open: false, tpl: null })} disabled={restoreLoading}>
              ยกเลิก
            </Button>
            <Button onClick={handleRestore} disabled={restoreLoading} className="bg-green-600 hover:bg-green-700">
              {restoreLoading ? 'กำลังเรียกคืน...' : '↩ เรียกคืน'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Permanent Delete Dialog (Danger Zone) */}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => {
        if (!open) setDeleteConfirmText('');
        setDeleteDialog(open ? deleteDialog : { open: false, tpl: null, activeRounds: 0, archivedRounds: 0, totalRounds: 0, rounds: [] });
      }}>
        <DialogContent className="max-w-lg border-red-300 border-2">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              ⚠️ ลบแม่แบบถาวร
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-700">
              คุณกำลังจะลบถาวร <span className="font-semibold">"{deleteDialog.tpl?.name}"</span>
            </p>
            {deleteDialog.totalRounds > 0 ? (
              <div className="bg-red-50 border border-red-300 rounded p-3 text-sm text-red-900">
                <p className="font-semibold">ไม่สามารถลบแม่แบบฟอร์มได้</p>
                <p className="mt-1">เนื่องจากยังมีรอบรับสมัครที่อ้างอิงแม่แบบนี้อยู่</p>

                <div className="mt-3 space-y-2">
                  <div>
                    <p className="text-xs font-semibold text-red-800">
                      รอบที่ใช้งานอยู่ ({deleteDialog.activeRounds}):
                    </p>
                    {renderRoundList(deleteDialog.rounds, 'active')}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-red-800">
                      รอบที่จัดเก็บแล้ว ({deleteDialog.archivedRounds}):
                    </p>
                    {renderRoundList(deleteDialog.rounds, 'archived')}
                  </div>
                </div>

                <p className="mt-3 text-xs font-medium text-red-800">
                  รวมทั้งหมด {deleteDialog.totalRounds} รอบ — จึงไม่สามารถลบถาวรได้
                </p>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-300 rounded p-3 text-sm text-amber-900">
                <p className="font-semibold">⚠️ คำเตือน</p>
                <p className="mt-1 text-xs">การลบถาวรจะลบข้อมูลทั้งหมดของแม่แบบนี้:</p>
                <ul className="list-disc list-inside mt-1 text-xs">
                  <li>Version ทั้งหมด</li>
                  <li>Section และ Field ทั้งหมด</li>
                </ul>
                <p className="mt-2 text-xs font-semibold">การกระทำนี้ไม่สามารถย้อนกลับได้</p>
              </div>
            )}
            <div className="text-sm">
              <label className="block text-slate-700 mb-1">
                พิมพ์ <span className="font-mono font-semibold text-red-700">"{deleteDialog.tpl?.name}"</span> เพื่อยืนยัน:
              </label>
              <Input
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="พิมพ์ชื่อแม่แบบเพื่อยืนยัน"
                className="font-mono"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialog({ open: false, tpl: null, activeRounds: 0, archivedRounds: 0, totalRounds: 0, rounds: [] });
                setDeleteConfirmText('');
              }}
              disabled={deleteLoading}
            >
              ยกเลิก
            </Button>
            <Button
              onClick={handlePermanentDelete}
              disabled={deleteLoading || deleteConfirmText !== deleteDialog.tpl?.name || deleteDialog.totalRounds > 0}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleteLoading ? 'กำลังลบ...' : '🗑 ลบถาวร'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
