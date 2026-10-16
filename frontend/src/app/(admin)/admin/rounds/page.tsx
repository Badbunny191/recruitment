'use client';

import { useState, useEffect, useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { CompareVersionModal } from '@/components/CompareVersionModal';
import { CloneRoundModal } from '@/components/CloneRoundModal';
import { SearchInput } from '@/components/ui/search-input';
import { SortDropdown } from '@/components/ui/sort-dropdown';
import { Pagination } from '@/components/ui/pagination';
import { ActionMenu } from '@/components/ui/action-menu';
import { NoDataEmptyState, NoResultsEmptyState } from '@/components/ui/empty-state';
import { ApplicationPatternField } from '@/components/ApplicationPatternField';
import { cn } from '@/lib/utils';
import { useRole } from '@/lib/useRole';

interface Round {
  id: string;
  templateVersionId: string;
  templateId?: string | null;
  templateName?: string | null;
  versionNumber?: number | null;
  versionStatus?: string | null;
  title: string;
  positionLevel: string;
  openDate: string | number | Date;
  closeDate: string | number | Date;
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED';
  createdAt: string | number | Date;
  deletedAt: string | number | Date | null;
  // Migration 019 - Application Number Pattern
  applicationPattern?: string | null;
  roundCode?: string | null;
}

interface PublishedTemplateVersion {
  id: string;
  versionNumber: number;
  status: string;
  templateId: string;
  templateName: string;
}

interface FormState {
  title: string;
  positionLevel: string;
  templateVersionId: string;
  openDate: string;
  closeDate: string;
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED';
  announcementTitle: string;
  announcementDescription: string;
  contactInformation: string;
  remark: string;
  // Migration 019 - Application Number Pattern
  // string = pattern (ทุก round ใหม่ต้องมี pattern)
  // null = legacy round (readonly banner)
  applicationPattern: string | null;
  // รหัสรอบ (Admin กำหนด เช่น CHM01, TEMP01) — required
  roundCode: string;
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
  announcementTitle: '',
  announcementDescription: '',
  contactInformation: '',
  remark: '',
  // Migration 019 - Default ใช้ standard pattern ทันที (ไม่มี "ใช้ format เดิม" ใน Create Round)
  applicationPattern: '{YEAR}-{ROUND_CODE}-{RUNNING:4}',
  roundCode: '',
};

const toLocalInput = (value: string | number | Date) => {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const toUnix = (local: string) => Math.floor(new Date(local).getTime() / 1000);

// ============================================
// DESIGN SYSTEM - Smart Family Style
// ============================================
const CARD_STYLE = {
  container: 'bg-white rounded-xl border border-slate-200 shadow-sm',
  header: 'px-4 py-3 border-b border-slate-100',
  body: 'px-4 py-3',
};

const STATUS_CONFIG = {
  ACTIVE: { label: 'ใช้งาน', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  CLOSED: { label: 'ปิดแล้ว', className: 'bg-slate-100 text-slate-600 border-slate-200' },
  DRAFT: { label: 'ร่าง', className: 'bg-amber-100 text-amber-700 border-amber-200' },
} as const;

// ============================================
// SUB-COMPONENTS
// ============================================

/** KPI Card - Smart Family Style */
function KpiCard({ 
  icon, 
  value, 
  label, 
  variant = 'default' 
}: { 
  icon: string; 
  value: number | string; 
  label: string; 
  variant?: 'default' | 'success' | 'muted';
}) {
  const valueColor = {
    default: 'text-slate-900',
    success: 'text-emerald-600',
    muted: 'text-slate-500',
  }[variant];
  
  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm px-6 py-5 flex items-center gap-4">
      <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-2xl shrink-0">
        {icon}
      </div>
      <div className="flex flex-col">
        <span className={cn("text-3xl font-bold tabular-nums leading-none", valueColor)}>{value}</span>
        <span className="text-sm text-slate-500 mt-1.5">{label}</span>
      </div>
    </div>
  );
}

/** Filter Pill - Ultra Compact */
function FilterPill({ 
  label, 
  isActive, 
  onClick,
  count,
}: { 
  label: string; 
  isActive: boolean; 
  onClick: () => void;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap",
        isActive 
          ? "bg-slate-900 text-white" 
          : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
      )}
    >
      {label}
      {count !== undefined && (
        <span className={cn(
          "text-[10px] px-1 rounded min-w-[16px] text-center leading-none",
          isActive ? "bg-white/20" : "bg-slate-100 text-slate-600"
        )}>
          {count}
        </span>
      )}
    </button>
  );
}

/** Version Badge - Smart Family Style */
function VersionBadge({ 
  version, 
  onCompare 
}: { 
  version: number;
  onCompare: () => void;
}) {
  return (
    <button
      onClick={onCompare}
      className="group inline-flex items-center gap-1.5 text-[11px] text-blue-600 hover:text-blue-800 transition-colors"
    >
      <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-blue-50 border border-blue-200 text-blue-700 font-medium group-hover:bg-blue-100">
        🆕 v{version}
      </span>
      <span className="opacity-0 group-hover:opacity-100 transition-opacity underline-offset-2">
        ดูความต่าง
      </span>
    </button>
  );
}

// ============================================
// MAIN PAGE
// ============================================

export default function RoundsPage() {
  const { canWrite } = useRole();
  const [rounds, setRounds] = useState<Round[]>([]);
  const [roundsWithVersionInfo, setRoundsWithVersionInfo] = useState<RoundVersionInfo[]>([]);
  const [publishedVersions, setPublishedVersions] = useState<PublishedTemplateVersion[]>([]);
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

  // View filter
  const [view, setView] = useState<'all' | 'active' | 'archived'>('all');

  // Search & Sort state
  const [search, setSearch] = useState('');
  const [sortId, setSortId] = useState<string>('createdAt-desc');
  const [sortField, setSortField] = useState<string>('createdAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(10);

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
    // ดึงข้อมูลทั้งหมดเสมอ เพื่อให้ KPI เป็น System Summary (ไม่ใช่ Filter Summary)
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/admin/rounds?view=all`,
      { headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` } }
    ).then((r) => r.json());
    setRounds(res.data || []);
    setLoading(false);
  };

  const handleArchive = async () => {
    if (!archiveDialog.round) return;
    setArchiveLoading(true);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/rounds/${archiveDialog.round.id}/archive`,
        { method: 'PATCH', headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` } }
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
        { method: 'PATCH', headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` } }
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
        { method: 'DELETE', headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` } }
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

  const loadPublishedVersions = async () => {
    const res = await fetch(
      process.env.NEXT_PUBLIC_API_URL + '/admin/template-versions/published',
      { headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` } }
    ).then((r) => r.json());
    setPublishedVersions(res.data || []);
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
    // โหลดข้อมูลครั้งเดียวตอน mount — KPI ใช้ System State เสมอ
    loadRounds();
    loadPublishedVersions();
    loadRoundsWithVersionInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [view, search, sortId]);

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

  const handleCloneFromCompare = () => {
    setCompareModalOpen(false);
    const info = roundsWithVersionInfo.find(r => r.currentVersion?.id === compareFromVersionId);
    if (info) openCloneModal(info.roundId);
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
      announcementTitle: (r as any).announcementTitle || '',
      announcementDescription: (r as any).announcementDescription || '',
      contactInformation: (r as any).contactInformation || '',
      remark: (r as any).remark || '',
      // Migration 019 - เก็บ pattern เดิม (อาจเป็น null สำหรับ legacy round)
      applicationPattern: r.applicationPattern ?? null,
      roundCode: r.roundCode ?? '',
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
      // NOTE: เมื่อ editing mode - ไม่ส่ง roundCode และ applicationPattern
      // เพราะเป็น immutable fields - backend จะใช้ค่าปัจจุบันจาก database
      const url = editing
        ? `${process.env.NEXT_PUBLIC_API_URL}/admin/rounds/${editing.id}`
        : `${process.env.NEXT_PUBLIC_API_URL}/admin/rounds`;
      const method = editing ? 'PATCH' : 'POST';

      const payload: any = editing
        ? {
            title: form.title,
            positionLevel: form.positionLevel,
            openDate: toUnix(form.openDate),
            closeDate: toUnix(form.closeDate),
            status: form.status,
            announcementTitle: form.announcementTitle || null,
            announcementDescription: form.announcementDescription || null,
            contactInformation: form.contactInformation || null,
            remark: form.remark || null,
            // templateVersionId: เปลี่ยนได้เฉพาะ DRAFT round
            ...(form.templateVersionId ? { templateVersionId: form.templateVersionId } : {}),
          }
        : {
            title: form.title,
            positionLevel: form.positionLevel,
            templateVersionId: form.templateVersionId,
            openDate: toUnix(form.openDate),
            closeDate: toUnix(form.closeDate),
            status: form.status,
            announcementTitle: form.announcementTitle || null,
            announcementDescription: form.announcementDescription || null,
            contactInformation: form.contactInformation || null,
            remark: form.remark || null,
            // Create mode - ต้องส่ง roundCode และ applicationPattern
            applicationPattern: form.applicationPattern,
            roundCode: form.roundCode,
          };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || (editing ? 'update failed' : 'create failed'));
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
    return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const formatTemplateCell = (r: Round): string => {
    if (r.templateName && r.versionNumber != null) return `${r.templateName} v${r.versionNumber}`;
    if (r.templateName) return `${r.templateName} (ไม่พบ version)`;
    return `(Template ถูกลบ) ${r.templateVersionId.slice(0, 8)}…`;
  };

  const formatTemplateVersionLabel = (templateVersionId: string): string => {
    const v = publishedVersions.find((x) => x.id === templateVersionId);
    if (v) return `${v.templateName} v${v.versionNumber}`;
    return `(Template ถูกลบ) ${templateVersionId.slice(0, 8)}…`;
  };

  // Sort options
  const sortOptions = [
    { id: 'createdAt-desc', field: 'createdAt', label: 'ล่าสุด', direction: 'desc' as const },
    { id: 'createdAt-asc', field: 'createdAt', label: 'เก่าสุด', direction: 'asc' as const },
    { id: 'title-asc', field: 'title', label: 'ชื่อ A-Z', direction: 'asc' as const },
    { id: 'title-desc', field: 'title', label: 'ชื่อ Z-A', direction: 'desc' as const },
  ];

  // Filter & Sort & Paginate
  // หมายเหตุ: KPI คำนวณจาก `rounds` (System State - ข้อมูลทั้งหมด)
  // แต่ Table คำนวณจาก `filteredAndSortedRounds` (ผ่าน filter/sort แล้ว)
  const filteredAndSortedRounds = useMemo(() => {
    let result = [...rounds];

    // View filter (ทำฝั่ง client — ไม่กระทบ KPI)
    if (view === 'active') {
      result = result.filter(r => r.status === 'ACTIVE' && !r.deletedAt);
    } else if (view === 'archived') {
      result = result.filter(r => !!r.deletedAt);
    }

    if (search.trim()) {
      const s = search.toLowerCase();
      result = result.filter(r =>
        r.title.toLowerCase().includes(s) ||
        r.positionLevel.toLowerCase().includes(s) ||
        (r.templateName?.toLowerCase().includes(s))
      );
    }

    result.sort((a, b) => {
      let aVal: any, bVal: any;
      if (sortField === 'createdAt') {
        aVal = new Date(a.createdAt).getTime();
        bVal = new Date(b.createdAt).getTime();
      } else if (sortField === 'title') {
        aVal = a.title.toLowerCase();
        bVal = b.title.toLowerCase();
      } else {
        return 0;
      }
      if (isNaN(aVal) && isNaN(bVal)) return 0;
      if (isNaN(aVal)) return 1;
      if (isNaN(bVal)) return -1;
      
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [rounds, view, search, sortField, sortDirection]);

  const totalItems = filteredAndSortedRounds.length;
  const paginatedRounds = filteredAndSortedRounds.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const totalRounds = rounds.length;
  const activeRounds = rounds.filter(r => r.status === 'ACTIVE' && !r.deletedAt).length;
  const archivedRounds = rounds.filter(r => r.deletedAt).length;

  const viewCounts = {
    all: totalRounds,
    active: activeRounds,
    archived: archivedRounds,
  };

  return (
    <div className="p-4 md:p-6 space-y-3">
      {/* ============================================ */}
      {/* 1. PAGE HEADER */}
      {/* ============================================ */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">📋</span>
          <div>
            <h1 className="text-lg font-bold text-slate-900 leading-tight">รอบการรับสมัคร</h1>
            <p className="text-[11px] text-slate-500">จัดการรอบการรับสมัครทั้งหมดในระบบ</p>
          </div>
        </div>
        {canWrite && (
          <Button onClick={openCreate} disabled={publishedVersions.length === 0} size="sm" className="h-8">
            + สร้างรอบใหม่
          </Button>
        )}
      </div>

      {/* Warning Banner */}
      {publishedVersions.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
          ยังไม่มี Published Template Version — กรุณาไปที่{' '}
          <a href="/admin/templates" className="underline font-medium hover:text-amber-900">หน้า Templates</a>{' '}
          เพื่อสร้าง Template และ Publish Version ก่อน
        </div>
      )}

      {/* ============================================ */}
      {/* 2. KPI CARDS - Ultra Compact */}
      {/* ============================================ */}
      <div className="grid grid-cols-3 gap-2">
        <KpiCard icon="📊" value={totalRounds} label="ทั้งหมด" />
        <KpiCard icon="✅" value={activeRounds} label="ใช้งานอยู่" variant="success" />
        <KpiCard icon="📁" value={archivedRounds} label="จัดเก็บแล้ว" variant="muted" />
      </div>

      {/* ============================================ */}
      {/* 3. CONTENT CARD - Smart Family Style */}
      {/* ============================================ */}
      <div className={cn(CARD_STYLE.container, "overflow-hidden")}>
        {/* 3.1 UNIFIED TOOLBAR */}
        <div className={cn(CARD_STYLE.header, "flex flex-col gap-2")}>
          {/* Row 1: Search + Sort */}
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="ค้นหาชื่อรอบ..."
                resultCount={totalItems}
                resultLabel="รายการ"
                size="sm"
                hideResultCount
              />
            </div>
            <SortDropdown
              value={sortId}
              onChange={(id, field, direction) => {
                setSortId(id);
                setSortField(field);
                if (direction) setSortDirection(direction);
              }}
              options={sortOptions}
              size="sm"
            />
          </div>
          
          {/* Row 2: Filter Pills + Result Count */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <FilterPill label="ทั้งหมด" isActive={view === 'all'} onClick={() => setView('all')} count={viewCounts.all} />
              <FilterPill label="ใช้งานอยู่" isActive={view === 'active'} onClick={() => setView('active')} count={viewCounts.active} />
              <FilterPill label="จัดเก็บแล้ว" isActive={view === 'archived'} onClick={() => setView('archived')} count={viewCounts.archived} />
            </div>
            <span className="text-[11px] text-slate-500 whitespace-nowrap">
              {search.trim() ? `พบทั้งหมด ${totalItems} รายการ` : `ทั้งหมด ${totalItems} รายการ`}
            </span>
          </div>
        </div>

        {/* 3.2 TABLE */}
        <div className="overflow-x-auto">
          <Table className="w-full table-fixed">
            <TableHeader>
              <TableRow className="bg-slate-50/50 hover:bg-slate-50/50">
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 w-[40%]">ชื่อรอบ</TableHead>
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 hidden md:table-cell w-[10%]">ระดับ</TableHead>
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 hidden lg:table-cell w-[22%]">Template</TableHead>
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 hidden sm:table-cell w-[15%]">เปิด-ปิด</TableHead>
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 w-[8%]">สถานะ</TableHead>
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 text-right w-[5%]">จัดการ</TableHead>
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
              ) : filteredAndSortedRounds.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-0">
                    {/* ถ้ามี search หรือ filter (ที่ไม่ใช่ all) → ไม่พบผลลัพธ์ */}
                    {search || view !== 'all' ? (
                      <NoResultsEmptyState
                        keyword={search}
                        onClearFilters={() => {
                          setSearch('');
                          setView('all');
                        }}
                      />
                    ) : (
                      <NoDataEmptyState
                        title="ยังไม่มีรอบรับสมัคร"
                        description="เริ่มต้นโดยการสร้างรอบรับสมัครใหม่"
                        action={{ label: '+ สร้างรอบใหม่', onClick: openCreate, variant: 'primary' }}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                paginatedRounds.map((r) => {
                  const versionWarning = getVersionWarning(r.id);
                  const status = STATUS_CONFIG[r.status];
                  
                  return (
                    <TableRow key={r.id} className="group">
                      {/* ชื่อรอบ - line-clamp-2 */}
                      <TableCell className="py-3 align-top">
                        <div className="flex flex-col gap-1.5 min-w-0">
                          <div 
                            className="font-medium text-sm text-slate-900 leading-snug line-clamp-2" 
                            title={r.title}
                          >
                            {r.title}
                          </div>
                          {versionWarning && (
                            <VersionBadge 
                              version={versionWarning.latestVersionNumber}
                              onCompare={() => openCompareModal(versionWarning.currentVersionId, versionWarning.latestVersionId)}
                            />
                          )}
                        </div>
                      </TableCell>
                      
                      {/* ระดับ */}
                      <TableCell className="py-3 text-sm text-slate-600 hidden md:table-cell align-top">
                        {r.positionLevel}
                      </TableCell>
                      
                      {/* Template - line-clamp-2 */}
                      <TableCell className="py-3 text-xs text-slate-500 hidden lg:table-cell align-top">
                        <div 
                          className="leading-snug line-clamp-2" 
                          title={formatTemplateCell(r)}
                        >
                          {formatTemplateCell(r)}
                        </div>
                      </TableCell>
                      
                      {/* วันที่ */}
                      <TableCell className="py-3 text-xs text-slate-500 whitespace-nowrap hidden sm:table-cell align-top">
                        <div>{formatDate(r.openDate)}</div>
                        <div className="text-slate-400">– {formatDate(r.closeDate)}</div>
                      </TableCell>
                      
                      {/* สถานะ - Pill Badge */}
                      <TableCell className="py-3 align-top">
                        <span className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap",
                          status.className
                        )}>
                          {status.label}
                        </span>
                      </TableCell>
                      
                      {/* Actions - ⋮ only */}
                      <TableCell className="py-3 text-right align-top">
                        {canWrite ? (
                          <ActionMenu
                            size="sm"
                            items={[
                              { label: '✏️ แก้ไข', onClick: () => openEdit(r) },
                              { label: '👁 ดูตัวอย่าง', onClick: () => window.open(`/admin/rounds/preview?id=${r.id}`, '_blank') },
                              { label: '📋 ทำสำเนา', onClick: () => openCloneModal(r.id) },
                              ...(versionWarning ? [{ label: '🔍 ดูความต่าง', onClick: () => openCompareModal(versionWarning.currentVersionId, versionWarning.latestVersionId) }] : []),
                              { type: 'separator', label: '', onClick: () => {} },
                              ...(!r.deletedAt
                                ? [{ label: '📁 จัดเก็บ', onClick: () => setArchiveDialog({ open: true, round: r }) }]
                                : [
                                    { label: '↩ เรียกคืน', onClick: () => setRestoreDialog({ open: true, round: r }) },
                                    { label: '🗑 ลบถาวร', type: 'danger' as const, onClick: () => openDeleteDialog(r) },
                                  ]
                              ),
                            ]}
                          />
                        ) : (
                          <ActionMenu
                            size="sm"
                            items={[
                              { label: '👁 ดูตัวอย่าง', onClick: () => window.open(`/admin/rounds/preview?id=${r.id}`, '_blank') },
                              ...(versionWarning ? [{ label: '🔍 ดูความต่าง', onClick: () => openCompareModal(versionWarning.currentVersionId, versionWarning.latestVersionId) }] : []),
                            ]}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* 3.3 PAGINATION */}
        <div className={cn(CARD_STYLE.header, "flex items-center justify-between")}>
          <span className="text-[11px] text-slate-500">
            {search.trim() ? `พบ ${totalItems} รายการ` : `แสดง ${paginatedRounds.length} จาก ${totalItems}`}
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

      {/* ============================================ */}
      {/* 4. FORM DIALOG */}
      {/* ============================================ */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? '✏️ แก้ไขรอบรับสมัคร' : '➕ สร้างรอบรับสมัครใหม่'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* ====== LOCK WARNING (เฉพาะตอน edit + มี application) ====== */}
            {editing && editingAppCount !== null && editingAppCount > 0 && (
              <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🔒</span>
                  <div className="text-sm font-semibold text-amber-900">
                    รอบนี้มีผู้สมัครแล้ว {editingAppCount} คน
                  </div>
                </div>
                <div className="text-xs text-amber-800 space-y-1">
                  <p>ไม่สามารถแก้ไข:</p>
                  <ul className="list-disc list-inside ml-1 space-y-0.5">
                    <li>รหัสรอบ (Round Code)</li>
                    <li>รูปแบบเลขที่ใบสมัคร</li>
                  </ul>
                  <p className="pt-1">
                    หากต้องการรูปแบบใหม่{' '}
                    <button
                      type="button"
                      onClick={() => openCloneModal(editing.id)}
                      className="underline font-semibold hover:text-amber-950"
                    >
                      กรุณา Clone Round
                    </button>
                  </p>
                </div>
              </div>
            )}

            {/* ============================================ */}
            {/* SECTION 1: ข้อมูลรอบรับสมัคร */}
            {/* ============================================ */}
            <section className="space-y-3">
              <div className="flex items-center gap-2 pb-1 border-b border-slate-200">
                <span className="text-base">📝</span>
                <h3 className="text-sm font-semibold text-slate-900">ข้อมูลรอบรับสมัคร</h3>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="title">ชื่อรอบ <span className="text-red-500">*</span></Label>
                  <Input
                    id="title"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    required
                    placeholder="เช่น รับสมัครนักตรวจเงินแผ่นดิน รุ่นที่ 12"
                    disabled={editingAppCount !== null && editingAppCount > 0}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="positionLevel">ระดับตำแหน่ง <span className="text-red-500">*</span></Label>
                    <Input
                      id="positionLevel"
                      value={form.positionLevel}
                      onChange={(e) => setForm({ ...form, positionLevel: e.target.value })}
                      required
                      placeholder="เช่น ปฏิบัติการ / ชำนาญการ"
                      disabled={editingAppCount !== null && editingAppCount > 0}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="roundCode">
                      รหัสรอบ (round_code) <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="roundCode"
                      value={form.roundCode}
                      onChange={(e) => {
                        // Auto uppercase + filter invalid chars
                        const cleaned = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
                        setForm({ ...form, roundCode: cleaned });
                      }}
                      placeholder="CHM01"
                      className="font-mono"
                      maxLength={20}
                      minLength={3}
                      required
                      disabled={editingAppCount !== null && editingAppCount > 0}
                    />
                    <p className="text-[11px] text-slate-500">
                      A-Z และ 0-9 เท่านั้น (3-20 ตัว)
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* ============================================ */}
            {/* SECTION 2: เลขที่ใบสมัคร */}
            {/* ============================================ */}
            <section className="space-y-3">
              <div className="flex items-center gap-2 pb-1 border-b border-slate-200">
                <span className="text-base">🔢</span>
                <h3 className="text-sm font-semibold text-slate-900">เลขที่ใบสมัคร</h3>
              </div>

              <ApplicationPatternField
                value={form.applicationPattern}
                onChange={(pattern) => setForm({ ...form, applicationPattern: pattern })}
                context={{
                  year: form.openDate
                    ? new Date(form.openDate).getFullYear()
                    : new Date().getFullYear(),
                  roundCode: form.roundCode || '?',
                }}
                locked={editingAppCount !== null && editingAppCount > 0}
                lockedReason={
                  editingAppCount
                    ? `ล็อก — มีผู้สมัครแล้ว ${editingAppCount} คน (หากต้องการรูปแบบใหม่ กรุณา Clone Round)`
                    : undefined
                }
              />
            </section>

            {/* ============================================ */}
            {/* SECTION 3: การตั้งค่ารอบ */}
            {/* ============================================ */}
            <section className="space-y-3">
              <div className="flex items-center gap-2 pb-1 border-b border-slate-200">
                <span className="text-base">⚙️</span>
                <h3 className="text-sm font-semibold text-slate-900">การตั้งค่ารอบ</h3>
              </div>

              <div className="space-y-3">
                {!editing && (
                  <div className="space-y-1.5">
                    <Label htmlFor="templateVersionId">Template Version <span className="text-red-500">*</span></Label>
                    <Select id="templateVersionId" value={form.templateVersionId} onChange={(e) => setForm({ ...form, templateVersionId: e.target.value })} required>
                      <option value="">-- เลือก Published Version --</option>
                      {publishedVersions.map((v) => (
                        <option key={v.id} value={v.id}>{v.templateName} v{v.versionNumber}</option>
                      ))}
                    </Select>
                    <p className="text-[11px] text-slate-500">เฉพาะ Published Version เท่านั้นที่สร้าง Round ได้</p>
                  </div>
                )}

                {editing && (
                  <div className="space-y-1.5">
                    <Label>Template Version</Label>
                    {editing.status === 'DRAFT' ? (
                      <>
                        <Select value={form.templateVersionId} onChange={(e) => setForm({ ...form, templateVersionId: e.target.value })}>
                          <option value="">-- เลือก Published Version --</option>
                          {publishedVersions.map((v) => (
                            <option key={v.id} value={v.id}>{v.templateName} v{v.versionNumber}</option>
                          ))}
                        </Select>
                        <p className="text-[11px] text-blue-600">Draft Round: สามารถเปลี่ยน Version ได้</p>
                      </>
                    ) : editing.status === 'ACTIVE' ? (
                      <div className="p-3 bg-slate-100 rounded-lg">
                        <span className="text-sm font-medium">{formatTemplateVersionLabel(form.templateVersionId)}</span>
                        {loadingAppCount ? (
                          <p className="text-[11px] text-slate-500 mt-2">กำลังโหลด...</p>
                        ) : editingAppCount !== null && editingAppCount > 0 ? (
                          <p className="text-[11px] text-amber-700 mt-2">ล็อก — มีผู้สมัครแล้ว {editingAppCount} คน</p>
                        ) : (
                          <p className="text-[11px] text-red-600 mt-2">ไม่สามารถเปลี่ยน Template Version ได้ เนื่องจากรอบเปิดรับสมัครแล้ว</p>
                        )}
                      </div>
                    ) : (
                      <div className="p-3 bg-slate-100 rounded-lg">
                        <span className="text-sm font-medium">{formatTemplateVersionLabel(form.templateVersionId)}</span>
                        <p className="text-[11px] text-red-600 mt-2">ไม่สามารถเปลี่ยน Template Version ได้ เนื่องจากรอบปิดรับสมัครแล้ว</p>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="openDate">วันเปิดรับสมัคร <span className="text-red-500">*</span></Label>
                    <Input id="openDate" type="datetime-local" value={form.openDate} onChange={(e) => setForm({ ...form, openDate: e.target.value })} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="closeDate">วันปิดรับสมัคร <span className="text-red-500">*</span></Label>
                    <Input id="closeDate" type="datetime-local" value={form.closeDate} onChange={(e) => setForm({ ...form, closeDate: e.target.value })} required />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="status">สถานะ</Label>
                  <Select id="status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as FormState['status'] })}>
                    <option value="DRAFT">ร่าง — ยังไม่เปิดรับ</option>
                    <option value="ACTIVE">เปิดรับ — รับสมัครอยู่</option>
                    <option value="CLOSED">ปิดแล้ว — หยุดรับสมัคร</option>
                  </Select>
                </div>
              </div>
            </section>

            {/* ============================================ */}
            {/* SECTION 4: ข้อมูลประกาศรับสมัคร */}
            {/* ============================================ */}
            <section className="space-y-3">
              <div className="flex items-center gap-2 pb-1 border-b border-slate-200">
                <span className="text-base">📢</span>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-slate-900">ข้อมูลประกาศรับสมัคร</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    ข้อมูลที่จะแสดงบนหน้าประกาศรับสมัครสำหรับผู้สมัคร
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="announcementTitle">หัวข้อประกาศ</Label>
                  <Input id="announcementTitle" value={form.announcementTitle} onChange={(e) => setForm({ ...form, announcementTitle: e.target.value })} placeholder="เช่น ประกาศรับสมัครนักตรวจเงินแผ่นดิน" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="announcementDescription">รายละเอียดประกาศ</Label>
                  <Textarea id="announcementDescription" value={form.announcementDescription} onChange={(e) => setForm({ ...form, announcementDescription: e.target.value })} rows={2} placeholder="รายละเอียดเพิ่มเติม" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="contactInformation">ข้อมูลติดต่อ</Label>
                  <Input id="contactInformation" value={form.contactInformation} onChange={(e) => setForm({ ...form, contactInformation: e.target.value })} placeholder="เช่น ติดต่อ 02-xxx-xxxx ต่อ xxx" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="remark">หมายเหตุ</Label>
                  <Textarea id="remark" value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} rows={2} placeholder="หมายเหตุเพิ่มเติม" />
                </div>
              </div>
            </section>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>ยกเลิก</Button>
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

      {/* Archive Dialog */}
      <Dialog open={archiveDialog.open} onOpenChange={(open) => setArchiveDialog({ open, round: open ? archiveDialog.round : null })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">📁 จัดเก็บรอบรับสมัคร</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-700">คุณกำลังจะจัดเก็บ <span className="font-semibold">"{archiveDialog.round?.title}"</span></p>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900">
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
            <Button variant="outline" onClick={() => setArchiveDialog({ open: false, round: null })} disabled={archiveLoading}>ยกเลิก</Button>
            <Button onClick={handleArchive} disabled={archiveLoading} className="bg-slate-700 hover:bg-slate-800">
              {archiveLoading ? 'กำลังจัดเก็บ...' : '📁 จัดเก็บ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore Dialog */}
      <Dialog open={restoreDialog.open} onOpenChange={(open) => setRestoreDialog({ open, round: open ? restoreDialog.round : null })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">↩ เรียกคืนรอบรับสมัคร</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-700">คุณกำลังจะเรียกคืน <span className="font-semibold">"{restoreDialog.round?.title}"</span></p>
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-900">
              <p>รอบรับสมัครจะกลับมาแสดงในรายการปกติ และสามารถใช้งานต่อได้</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreDialog({ open: false, round: null })} disabled={restoreLoading}>ยกเลิก</Button>
            <Button onClick={handleRestore} disabled={restoreLoading} className="bg-emerald-600 hover:bg-emerald-700">
              {restoreLoading ? 'กำลังเรียกคืน...' : '↩ เรียกคืน'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => {
        if (!open) setDeleteConfirmText('');
        setDeleteDialog(open ? deleteDialog : { open: false, round: null, appCount: 0 });
      }}>
        <DialogContent className="max-w-md border-red-300 border-2">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">⚠️ ลบรอบรับสมัครถาวร</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-700">คุณกำลังจะลบถาวร <span className="font-semibold">"{deleteDialog.round?.title}"</span></p>
            {deleteDialog.appCount > 0 ? (
              <div className="bg-red-50 border border-red-300 rounded-lg p-3 text-sm text-red-900">
                <p className="font-semibold">ไม่สามารถลบรอบรับสมัครได้</p>
                <p className="mt-1">เนื่องจากมีผู้สมัครอยู่ในรอบนี้ {deleteDialog.appCount} คน</p>
                <p className="mt-2 text-xs font-semibold text-red-800">จึงไม่สามารถลบถาวรได้</p>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-sm text-amber-900">
                <p className="font-semibold">⚠️ คำเตือน</p>
                <p className="mt-1 text-xs">การลบถาวรจะลบข้อมูลทั้งหมดรวมถึง:</p>
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
              <Input value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} placeholder="พิมพ์ชื่อรอบเพื่อยืนยัน" className="font-mono" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteDialog({ open: false, round: null, appCount: 0 }); setDeleteConfirmText(''); }} disabled={deleteLoading}>ยกเลิก</Button>
            <Button onClick={handlePermanentDelete} disabled={deleteLoading || deleteConfirmText !== deleteDialog.round?.title || deleteDialog.appCount > 0} className="bg-red-600 hover:bg-red-700 text-white">
              {deleteLoading ? 'กำลังลบ...' : '🗑 ลบถาวร'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
