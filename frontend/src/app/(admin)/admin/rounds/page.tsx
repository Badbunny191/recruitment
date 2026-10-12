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
import { CompareVersionModal } from '@/components/CompareVersionModal';
import { CloneRoundModal } from '@/components/CloneRoundModal';

interface Round {
  id: string;
  templateVersionId: string;
  title: string;
  positionLevel: string;
  openDate: string | number | Date;
  closeDate: string | number | Date;
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED';
  createdAt: string | number | Date;
  deletedAt: string | number | Date | null;
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
  openDate: string;
  closeDate: string;
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED';
  // Form Header / Announcement
  announcementTitle: string;
  announcementDescription: string;
  contactInformation: string;
  remark: string;
}

interface RoundVersionInfo {
  roundId: string;
  roundTitle: string;
  roundStatus: 'DRAFT' | 'ACTIVE' | 'CLOSED';
  currentVersion: {
    id: string;
    versionNumber: number;
    status: string;
    fields: { fieldId: string; labelTh: string; isRequired: boolean }[];
  } | null;
  latestPublishedVersion: {
    id: string;
    versionNumber: number;
    status: string;
    fields: { fieldId: string; labelTh: string; isRequired: boolean }[];
  } | null;
  hasNewerVersion: boolean;
  template: {
    id: string;
    name: string;
  } | null;
}

const EMPTY_FORM: FormState = {
  title: '',
  positionLevel: '',
  templateVersionId: '',
  openDate: '',
  closeDate: '',
  status: 'DRAFT',
  // Form Header / Announcement
  announcementTitle: '',
  announcementDescription: '',
  contactInformation: '',
  remark: '',
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
  const [roundsWithVersionInfo, setRoundsWithVersionInfo] = useState<RoundVersionInfo[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Round | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  // Compare Version Modal
  const [compareModalOpen, setCompareModalOpen] = useState(false);
  const [compareFromVersionId, setCompareFromVersionId] = useState('');
  const [compareToVersionId, setCompareToVersionId] = useState('');

  // Clone Round Modal
  const [cloneModalOpen, setCloneModalOpen] = useState(false);
  const [cloneRoundId, setCloneRoundId] = useState('');

  // Active Round Protection
  const [editingAppCount, setEditingAppCount] = useState<number | null>(null);
  const [loadingAppCount, setLoadingAppCount] = useState(false);

  // View filter: all | active | archived
  const [view, setView] = useState<'all' | 'active' | 'archived'>('active');

  // Archive / Restore / Permanent Delete dialogs
  const [archiveDialog, setArchiveDialog] = useState<{ open: boolean; round: Round | null }>({ open: false, round: null });
  const [restoreDialog, setRestoreDialog] = useState<{ open: boolean; round: Round | null }>({ open: false, round: null });
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; round: Round | null; appCount: number }>({ open: false, round: null, appCount: 0 });
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    if (editing && editing.status === 'ACTIVE') {
      loadApplicationCount(editing.id);
    } else {
      setEditingAppCount(null);
    }
  }, [editing]);

  const loadApplicationCount = async (roundId: string) => {
    setLoadingAppCount(true);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/rounds/${roundId}/clone-options`,
        { headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` } }
      ).then(r => r.json()).catch(() => ({ data: null }));
      setEditingAppCount(res?.data?.applicationCount || 0);
    } catch {
      setEditingAppCount(0);
    } finally {
      setLoadingAppCount(false);
    }
  };

  const loadRounds = async () => {
    setLoading(true);
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/admin/rounds?view=${view}`,
      { headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` } }
    ).then((r) => r.json());
    setRounds(res.data || []);
    setLoading(false);
  };

  // Archive / Restore / Permanent Delete handlers
  const handleArchive = async () => {
    if (!archiveDialog.round) return;
    setArchiveLoading(true);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/rounds/${archiveDialog.round.id}/archive`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'จัดเก็บไม่สำเร็จ');
      }
      setArchiveDialog({ open: false, round: null });
      await loadRounds();
    } catch (err) {
      alert('Archive ไม่สำเร็จ: ' + (err as Error).message);
    } finally {
      setArchiveLoading(false);
    }
  };

  const handleRestore = async () => {
    if (!restoreDialog.round) return;
    setRestoreLoading(true);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/rounds/${restoreDialog.round.id}/restore`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'เรียกคืนไม่สำเร็จ');
      }
      setRestoreDialog({ open: false, round: null });
      await loadRounds();
    } catch (err) {
      alert('Restore ไม่สำเร็จ: ' + (err as Error).message);
    } finally {
      setRestoreLoading(false);
    }
  };

  const openDeleteDialog = async (round: Round) => {
    // Check usage first
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/admin/rounds/${round.id}/usage`,
      { headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` } }
    ).then(r => r.json()).catch(() => ({ data: null }));
    const appCount = res?.data?.applicationCount || 0;
    setDeleteDialog({ open: true, round, appCount });
    setDeleteConfirmText('');
  };

  const handlePermanentDelete = async () => {
    if (!deleteDialog.round) return;
    if (deleteConfirmText !== deleteDialog.round.title) {
      alert('กรุณาพิมพ์ชื่อ Round ให้ตรงกันเพื่อยืนยัน');
      return;
    }
    setDeleteLoading(true);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/rounds/${deleteDialog.round.id}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'เกิดข้อผิดพลาดในการลบ');
      }
      setDeleteDialog({ open: false, round: null, appCount: 0 });
      setDeleteConfirmText('');
      await loadRounds();
    } catch (err) {
      alert('Delete ไม่สำเร็จ: ' + (err as Error).message);
    } finally {
      setDeleteLoading(false);
    }
  };

  const loadTemplates = async () => {
    const res = await fetch(process.env.NEXT_PUBLIC_API_URL + '/admin/templates', {
      headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
    }).then((r) => r.json());
    setTemplates(res.data || []);
  };

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

  const loadRoundsWithVersionInfo = async () => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/rounds-with-version-info`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
      }).then((r) => r.json());
      setRoundsWithVersionInfo(res.data || []);
    } catch (err) {
      console.error('Failed to load version info:', err);
    }
  };

  useEffect(() => {
    loadRounds();
    loadTemplates();
    loadAllVersions();
    loadRoundsWithVersionInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const getVersionWarning = (roundId: string) => {
    const info = roundsWithVersionInfo.find(r => r.roundId === roundId);
    if (!info) return null;
    
    if (info.hasNewerVersion && info.latestPublishedVersion) {
      return {
        currentVersionNumber: info.currentVersion?.versionNumber || 0,
        latestVersionNumber: info.latestPublishedVersion.versionNumber,
        latestVersionId: info.latestPublishedVersion.id,
        currentVersionId: info.currentVersion?.id || '',
      };
    }
    return null;
  };

  const openCompareModal = (fromVersionId: string, toVersionId: string) => {
    setCompareFromVersionId(fromVersionId);
    setCompareToVersionId(toVersionId);
    setCompareModalOpen(true);
  };

  const openCloneModal = (roundId: string) => {
    setCloneRoundId(roundId);
    setCloneModalOpen(true);
  };

  const handleCloneSuccess = async () => {
    await loadRounds();
    await loadRoundsWithVersionInfo();
  };

  const handleCloneFromCompare = (versionId: string) => {
    setCompareModalOpen(false);
    const info = roundsWithVersionInfo.find(r => r.currentVersion?.id === compareFromVersionId);
    if (info) {
      openCloneModal(info.roundId);
    }
  };

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
      // Form Header / Announcement
      announcementTitle: (r as any).announcementTitle || '',
      announcementDescription: (r as any).announcementDescription || '',
      contactInformation: (r as any).contactInformation || '',
      remark: (r as any).remark || '',
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
        const payload = {
          title: form.title,
          positionLevel: form.positionLevel,
          templateVersionId: form.templateVersionId,
          openDate: toUnix(form.openDate),
          closeDate: toUnix(form.closeDate),
          status: form.status,
          // Form Header / Announcement
          announcementTitle: form.announcementTitle || null,
          announcementDescription: form.announcementDescription || null,
          contactInformation: form.contactInformation || null,
          remark: form.remark || null,
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
        const payload = {
          title: form.title,
          positionLevel: form.positionLevel,
          templateVersionId: form.templateVersionId,
          openDate: toUnix(form.openDate),
          closeDate: toUnix(form.closeDate),
          status: form.status,
          // Form Header / Announcement
          announcementTitle: form.announcementTitle || null,
          announcementDescription: form.announcementDescription || null,
          contactInformation: form.contactInformation || null,
          remark: form.remark || null,
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

  const publishedVersions = versions.filter(v => v.status === 'PUBLISHED');

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">รอบการรับสมัคร (Recruitment Rounds)</h1>
        <Button onClick={openCreate} disabled={publishedVersions.length === 0}>
          + สร้างรอบใหม่
        </Button>
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
          {view === 'active' && 'แสดงเฉพาะรอบที่ใช้งานอยู่'}
          {view === 'archived' && 'แสดงเฉพาะรอบที่จัดเก็บแล้ว'}
          {view === 'all' && 'แสดงรอบทั้งหมด'}
        </span>
      </div>

      {publishedVersions.length === 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-4 text-sm text-yellow-800">
          ยังไม่มี Published Template Version — กรุณาไปที่{' '}
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
              rounds.map((r) => {
                const versionWarning = getVersionWarning(r.id);
                return (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.title}
                    {versionWarning && (
                      <div className="mt-1">
                        <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full border border-amber-300 text-xs">
                          ⚠️ มี Published Version ใหม่กว่า
                        </span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{r.positionLevel}</TableCell>
                  <TableCell className="text-slate-500 text-sm">
                    {versionLabel(r.templateVersionId)}
                    {versionWarning && (
                      <div className="text-xs text-amber-600 mt-1">
                        Published ล่าสุด: v{versionWarning.latestVersionNumber}
                      </div>
                    )}
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
                    <div className="flex items-center justify-end gap-2">
                      {versionWarning && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs text-blue-600 hover:text-blue-800"
                          onClick={() => openCompareModal(
                            versionWarning.currentVersionId,
                            versionWarning.latestVersionId
                          )}
                        >
                          เปรียบเทียบ
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs text-purple-700 border-purple-300 hover:bg-purple-50"
                        onClick={() => window.open(`/admin/rounds/preview?id=${r.id}`, '_blank')}
                        title="เปิดดูตัวอย่างฟอร์ม (Bypass Round Lifecycle Gate)"
                      >
                        👁 Preview
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => openCloneModal(r.id)}
                      >
                        Clone
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openEdit(r)}>
                        แก้ไข
                      </Button>
                      {/* Archive / Restore / Delete Permanently actions */}
                      {!r.deletedAt ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs text-slate-700 border-slate-300 hover:bg-slate-50"
                          onClick={() => setArchiveDialog({ open: true, round: r })}
                          title="จัดเก็บ (ซ่อนจากรายการปกติ แต่ไม่ลบข้อมูล)"
                        >
                          📁 จัดเก็บ
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs text-green-700 border-green-300 hover:bg-green-50"
                            onClick={() => setRestoreDialog({ open: true, round: r })}
                            title="เรียกคืนกลับมาเป็นรอบที่ใช้งานอยู่"
                          >
                            ↩ เรียกคืน
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs text-red-700 border-red-300 hover:bg-red-50"
                            onClick={() => openDeleteDialog(r)}
                            title="ลบถาวร (เฉพาะผู้ดูแลระบบ)"
                          >
                            🗑 ลบถาวร
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )})
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
                  <option value="">-- เลือก Published Version --</option>
                  {publishedVersions.map((v) => {
                    const t = templates.find((x) => x.id === v.templateId);
                    return (
                      <option key={v.id} value={v.id}>
                        {t?.name || '?'} v{v.versionNumber}
                      </option>
                    );
                  })}
                </Select>
                <p className="text-xs text-slate-500">
                  เฉพาะ Published Version เท่านั้นที่สร้าง Round ได้
                </p>
              </div>
            )}
            {editing && (
              <div className="space-y-2">
                <Label>Template Version</Label>
                {editing.status === 'DRAFT' ? (
                  <>
                    <Select
                      value={form.templateVersionId}
                      onChange={(e) => setForm({ ...form, templateVersionId: e.target.value })}
                    >
                      <option value="">-- เลือก Published Version --</option>
                      {publishedVersions.map((v) => {
                        const t = templates.find((x) => x.id === v.templateId);
                        return (
                          <option key={v.id} value={v.id}>
                            {t?.name || '?'} v{v.versionNumber}
                          </option>
                        );
                      })}
                    </Select>
                    <p className="text-xs text-blue-600">
                      Draft Round: สามารถเปลี่ยน Version ได้
                    </p>
                  </>
                ) : editing.status === 'ACTIVE' ? (
                  <div className="p-3 bg-slate-100 rounded">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">
                        {versionLabel(form.templateVersionId)}
                      </span>
                    </div>
                    {loadingAppCount ? (
                      <p className="text-xs text-slate-500 mt-2">กำลังโหลด...</p>
                    ) : editingAppCount !== null && editingAppCount > 0 ? (
                      <div className="mt-3 p-2 bg-amber-50 border border-amber-200 rounded text-xs">
                        <div className="flex items-center gap-2 text-amber-800">
                          <span>🔒</span>
                          <span>ล็อกแล้ว — มีผู้สมัครแล้ว {editingAppCount} คน</span>
                        </div>
                        <p className="text-amber-700 mt-1">
                          ไม่สามารถเปลี่ยน Version ได้ กรุณา Clone Round ใหม่
                        </p>
                        <Button 
                          size="sm" 
                          variant="outline"
                          className="mt-2 text-xs"
                          onClick={() => openCloneModal(editing.id)}
                        >
                          Clone Round
                        </Button>
                      </div>
                    ) : (
                      <p className="text-xs text-red-600 mt-2">
                        ไม่สามารถเปลี่ยน Template Version ได้ เนื่องจากรอบเปิดรับสมัครแล้ว
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="p-3 bg-slate-100 rounded">
                    <span className="text-sm font-medium">
                      {versionLabel(form.templateVersionId)}
                    </span>
                    <p className="text-xs text-red-600 mt-2">
                      ไม่สามารถเปลี่ยน Template Version ได้ เนื่องจากรอบปิดรับสมัครแล้ว
                    </p>
                  </div>
                )}
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

            {/* Form Header / Announcement Section */}
            <div className="border-t pt-4 mt-4">
              <h3 className="font-medium text-gray-800 mb-4">ข้อมูลประกาศรับสมัคร (Header)</h3>

              <div className="space-y-2">
                <Label htmlFor="announcementTitle">หัวข้อประกาศ</Label>
                <Input
                  id="announcementTitle"
                  value={form.announcementTitle}
                  onChange={(e) => setForm({ ...form, announcementTitle: e.target.value })}
                  placeholder="เช่น ประกาศรับสมัครนักตรวจเงินแผ่นดิน"
                />
              </div>

              <div className="space-y-2 mt-3">
                <Label htmlFor="announcementDescription">รายละเอียดประกาศ</Label>
                <Textarea
                  id="announcementDescription"
                  value={form.announcementDescription}
                  onChange={(e) => setForm({ ...form, announcementDescription: e.target.value })}
                  rows={3}
                  placeholder="รายละเอียดเพิ่มเติมเกี่ยวกับการรับสมัคร"
                />
              </div>

              <div className="space-y-2 mt-3">
                <Label htmlFor="contactInformation">ข้อมูลติดต่อ</Label>
                <Input
                  id="contactInformation"
                  value={form.contactInformation}
                  onChange={(e) => setForm({ ...form, contactInformation: e.target.value })}
                  placeholder="เช่น ติดต่อ 02-xxx-xxxx ต่อ xxx"
                />
              </div>

              <div className="space-y-2 mt-3">
                <Label htmlFor="remark">หมายเหตุ</Label>
                <Textarea
                  id="remark"
                  value={form.remark}
                  onChange={(e) => setForm({ ...form, remark: e.target.value })}
                  rows={2}
                  placeholder="หมายเหตุเพิ่มเติม"
                />
              </div>
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

      <CompareVersionModal
        open={compareModalOpen}
        onOpenChange={setCompareModalOpen}
        fromVersionId={compareFromVersionId}
        toVersionId={compareToVersionId}
        onClone={handleCloneFromCompare}
      />

      <CloneRoundModal
        open={cloneModalOpen}
        onOpenChange={setCloneModalOpen}
        roundId={cloneRoundId}
        onCloneSuccess={handleCloneSuccess}
      />

      {/* Archive Confirmation Dialog */}
      <Dialog open={archiveDialog.open} onOpenChange={(open) => setArchiveDialog({ open, round: open ? archiveDialog.round : null })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              📁 จัดเก็บรอบรับสมัคร
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-700">
              คุณกำลังจะจัดเก็บ <span className="font-semibold">"{archiveDialog.round?.title}"</span>
            </p>
            <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-900">
              <p className="font-medium">ผลกระทบ:</p>
              <ul className="list-disc list-inside mt-1 space-y-0.5 text-xs">
                <li>รอบรับสมัครจะหายไปจากรายการปกติ</li>
                <li>ไม่เปิดรับสมัครใหม่ (Public API block)</li>
                <li>เรียกคืนกลับมาได้ภายหลัง</li>
                <li>ข้อมูลผู้สมัครไม่ถูกลบ</li>
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveDialog({ open: false, round: null })} disabled={archiveLoading}>
              ยกเลิก
            </Button>
            <Button onClick={handleArchive} disabled={archiveLoading} className="bg-slate-700 hover:bg-slate-800">
              {archiveLoading ? 'กำลังจัดเก็บ...' : '📁 จัดเก็บ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore Confirmation Dialog */}
      <Dialog open={restoreDialog.open} onOpenChange={(open) => setRestoreDialog({ open, round: open ? restoreDialog.round : null })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              ↩ เรียกคืนรอบรับสมัคร
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-700">
              คุณกำลังจะเรียกคืน <span className="font-semibold">"{restoreDialog.round?.title}"</span>
            </p>
            <div className="bg-green-50 border border-green-200 rounded p-3 text-sm text-green-900">
              <p>รอบรับสมัครจะกลับมาแสดงในรายการปกติ และสามารถใช้งานต่อได้</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreDialog({ open: false, round: null })} disabled={restoreLoading}>
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
        setDeleteDialog(open ? deleteDialog : { open: false, round: null, appCount: 0 });
      }}>
        <DialogContent className="max-w-md border-red-300 border-2">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              ⚠️ ลบรอบรับสมัครถาวร
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-700">
              คุณกำลังจะลบถาวร <span className="font-semibold">"{deleteDialog.round?.title}"</span>
            </p>
            {deleteDialog.appCount > 0 ? (
              <div className="bg-red-50 border border-red-300 rounded p-3 text-sm text-red-900">
                <p className="font-semibold">ไม่สามารถลบรอบรับสมัครได้</p>
                <p className="mt-1">เนื่องจากมีผู้สมัครอยู่ในรอบนี้ {deleteDialog.appCount} คน</p>
                <p className="mt-2 text-xs font-semibold text-red-800">จึงไม่สามารถลบถาวรได้</p>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-300 rounded p-3 text-sm text-amber-900">
                <p className="font-semibold">⚠️ คำเตือน</p>
                <p className="mt-1 text-xs">
                  การลบถาวรจะลบข้อมูลทั้งหมดรวมถึง:
                </p>
                <ul className="list-disc list-inside mt-1 text-xs">
                  <li>ข้อมูลผู้สมัคร (ถ้ามี)</li>
                  <li>ไฟล์แนบทั้งหมด</li>
                </ul>
                <p className="mt-2 text-xs font-semibold">การกระทำนี้ไม่สามารถย้อนกลับได้</p>
              </div>
            )}
            <div className="text-sm">
              <label className="block text-slate-700 mb-1">
                พิมพ์ <span className="font-mono font-semibold text-red-700">"{deleteDialog.round?.title}"</span> เพื่อยืนยัน:
              </label>
              <Input
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="พิมพ์ชื่อรอบเพื่อยืนยัน"
                className="font-mono"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialog({ open: false, round: null, appCount: 0 });
                setDeleteConfirmText('');
              }}
              disabled={deleteLoading}
            >
              ยกเลิก
            </Button>
            <Button
              onClick={handlePermanentDelete}
              disabled={deleteLoading || deleteConfirmText !== deleteDialog.round?.title || deleteDialog.appCount > 0}
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
