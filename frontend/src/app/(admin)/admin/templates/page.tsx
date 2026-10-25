'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { SearchInput } from '@/components/ui/search-input';
import { SortDropdown } from '@/components/ui/sort-dropdown';
import { Pagination } from '@/components/ui/pagination';
import { ActionMenu } from '@/components/ui/action-menu';
import { NoDataEmptyState, NoResultsEmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { useRole } from '@/lib/useRole';

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
  activeRoundsCount: number;
  archivedRoundsCount: number;
  totalRoundsCount: number;
  roundsCount?: number;
  deletedAt: string | number | Date | null;
}

interface RoundRef {
  roundId: string;
  roundName: string;
  roundStatus: string;
  deletedAt: string | number | Date | null;
}

// ============================================
// DESIGN SYSTEM - Smart Family Style (คัดลอกจาก Recruitment Rounds)
// ============================================
const CARD_STYLE = {
  container: 'bg-white rounded-xl border border-slate-200 shadow-sm',
  header: 'px-4 py-3 border-b border-slate-100',
  body: 'px-4 py-3',
};

// ============================================
// SUB-COMPONENTS
// ============================================

/** Filter Pill - Ultra Compact (คัดลอกจาก Recruitment Rounds) */
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

// ============================================
// MAIN PAGE
// ============================================

// ตัวเลือกจำนวนรายการต่อหน้า — ค่า default คือ 10 (ไม่เขียนลง URL)
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

// Sort options (module-level เพื่อใช้ validate sort id จาก URL ตอน hydrate)
const SORT_OPTIONS = [
  { id: 'createdAt-desc', field: 'createdAt', label: 'ล่าสุด', direction: 'desc' as const },
  { id: 'createdAt-asc', field: 'createdAt', label: 'เก่าสุด', direction: 'asc' as const },
  { id: 'name-asc', field: 'name', label: 'ชื่อ A-Z', direction: 'asc' as const },
  { id: 'name-desc', field: 'name', label: 'ชื่อ Z-A', direction: 'desc' as const },
];
const defaultSortOption = SORT_OPTIONS[0];
const sortOptionsById = (id: string) =>
  SORT_OPTIONS.find((o) => o.id === id) ?? defaultSortOption;

export default function TemplatesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { canWrite } = useRole();

  // URL State — page/pageSize/search/view/sort อยู่ใน URL ทั้งหมด
  // (ไปหน้า Builder แล้วกด Back → remount → hydrate จาก URL → ได้ตำแหน่งเดิม)
  const urlSearch = searchParams.get('q') || '';
  const urlViewParam = searchParams.get('view');
  const urlView: 'all' | 'active' | 'archived' =
    urlViewParam === 'active' || urlViewParam === 'archived' ? urlViewParam : 'all';
  const urlSort = sortOptionsById(searchParams.get('sort') || '');
  const urlPage = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const urlPageSizeRaw = parseInt(searchParams.get('pageSize') || '10', 10) || 10;
  const urlPageSize = PAGE_SIZE_OPTIONS.includes(urlPageSizeRaw) ? urlPageSizeRaw : 10;
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [form, setForm] = useState({ name: '', description: '' });
  const [submitting, setSubmitting] = useState(false);

  // View filter: all | active | archived (default 'all' เพื่อให้ KPI แสดง System State ตั้งแต่แรก)
  const [view, setView] = useState<'all' | 'active' | 'archived'>(urlView);

  // Search & Sort state — hydrate ค่าเริ่มต้นจาก URL
  const [search, setSearch] = useState(urlSearch);
  const [sortId, setSortId] = useState<string>(urlSort.id);
  const [sortField, setSortField] = useState<string>(urlSort.field);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(urlSort.direction);

  // Pagination state — hydrate หน้า/page size จาก URL
  const [currentPage, setCurrentPage] = useState(urlPage);
  const [pageSize, setPageSize] = useState(urlPageSize);

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

  // Helper: อัปเดต URL (ไม่ trigger re-mount)
  // ⚠️ ถือ "แผนที่ params ของตัวเอง" ใน ref ไม่อ่านจาก window.location / searchParams
  //   เพราะ router.replace แก้ URL แบบ async — replace ติดกันหลายครั้งในรอบเดียว
  //   ถ้าอ่านค่าล่าสุดจาก URL ตรง ๆ จะอ่านได้ค่าเก่าและทับ param ที่เพิ่งเขียนหาย
  // ref ถูก sync กลับจาก searchParams ทุกครั้งที่ transition จบ (ครอบคลุม Back/Forward)
  const urlParamsRef = useRef<URLSearchParams>(
    new URLSearchParams(searchParams.toString())
  );
  useEffect(() => {
    urlParamsRef.current = new URLSearchParams(searchParams.toString());
  }, [searchParams]);

  const updateUrl = useCallback((patch: Record<string, string | null>) => {
    const params = new URLSearchParams(urlParamsRef.current.toString());
    Object.entries(patch).forEach(([key, value]) => {
      if (value === null || value === '') {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });
    urlParamsRef.current = params;
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router]);

  // ── List state setters — ทุกการเปลี่ยนแนบลง URL ทันที ──────────────────────
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    updateUrl({ q: value.trim() ? value : null });
  }, [updateUrl]);

  const handleViewChange = useCallback((next: 'all' | 'active' | 'archived') => {
    setView(next);
    updateUrl({ view: next === 'all' ? null : next });
  }, [updateUrl]);

  const handleSortChange = useCallback((id: string, field: string, direction?: 'asc' | 'desc' | null) => {
    setSortId(id);
    setSortField(field);
    if (direction) setSortDirection(direction);
    updateUrl({ sort: id === defaultSortOption.id ? null : id });
  }, [updateUrl]);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
    updateUrl({ page: page <= 1 ? null : String(page) });
  }, [updateUrl]);

  // เปลี่ยน page size → reset กลับหน้า 1 เสมอ + บันทึกลง URL (ค่า default ไม่เขียนลง URL)
  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    setCurrentPage(1);
    updateUrl({ pageSize: size === 10 ? null : String(size), page: null });
  }, [updateUrl]);

  const load = async () => {
    setLoading(true);
    // ดึงข้อมูลทั้งหมดเสมอ เพื่อให้ KPI เป็น System Summary (ไม่ใช่ Filter Summary)
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/admin/templates?view=all`,
      { headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` } }
    ).then((r) => r.json());
    setTemplates(res.data || []);
    setLoading(false);
  };

  useEffect(() => {
    // โหลดข้อมูลครั้งเดียวตอน mount — KPI ใช้ System State เสมอ
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset กลับหน้า 1 เมื่อ view/search/sort เปลี่ยน — ข้าม mount แรก
  // (ไม่งั้นทับหน้าที่ restore จาก URL)
  const prevListStateRef = useRef<string | null>(null);
  useEffect(() => {
    const key = JSON.stringify([view, search, sortId]);
    const prev = prevListStateRef.current;
    prevListStateRef.current = key;
    if (prev === null || key === prev) return;
    setCurrentPage(1);
    updateUrl({ page: null });
  }, [view, search, sortId, updateUrl]);

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
              <span className={cn(
                "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border",
                r.roundStatus === 'ACTIVE'
                  ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                  : r.roundStatus === 'CLOSED'
                  ? 'bg-slate-100 text-slate-600 border-slate-200'
                  : 'bg-amber-100 text-amber-700 border-amber-200'
              )}>
                {r.roundStatus}
              </span>
            )}
          </li>
        ))}
        {remaining > 0 && (
          <li className="text-xs text-slate-500 italic">…และอีก {remaining} รายการ</li>
        )}
      </ul>
    );
  };

  const formatDate = (value: string | number | Date | null | undefined): string => {
    if (!value) return 'ไม่กำหนด';
    const d = new Date(value);
    if (isNaN(d.getTime())) return 'ไม่กำหนด';
    return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  // Sort options (module-level SORT_OPTIONS)
  const sortOptions = SORT_OPTIONS;

  // Filter & Sort & Paginate
  // หมายเหตุ: KPI คำนวณจาก `templates` (System State - ข้อมูลทั้งหมด)
  // แต่ Table คำนวณจาก `filteredAndSortedTemplates` (ผ่าน filter/sort แล้ว)
  const filteredAndSortedTemplates = useMemo(() => {
    let result = [...templates];

    // View filter (ทำฝั่ง client — ไม่กระทบ KPI)
    if (view === 'active') {
      result = result.filter(t => !t.deletedAt);
    } else if (view === 'archived') {
      result = result.filter(t => !!t.deletedAt);
    }

    if (search.trim()) {
      const s = search.toLowerCase();
      result = result.filter(t =>
        t.name.toLowerCase().includes(s) ||
        (t.description?.toLowerCase().includes(s))
      );
    }

    result.sort((a, b) => {
      let aVal: any, bVal: any;
      if (sortField === 'createdAt') {
        aVal = new Date(a.createdAt).getTime();
        bVal = new Date(b.createdAt).getTime();
      } else if (sortField === 'name') {
        aVal = a.name.toLowerCase();
        bVal = b.name.toLowerCase();
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
  }, [templates, view, search, sortField, sortDirection]);

  const totalItems = filteredAndSortedTemplates.length;
  const paginatedTemplates = filteredAndSortedTemplates.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  // กันหน้าเกินช่วงจริง (เช่น page ใน URL มากกว่าจำนวนหน้าหลังข้อมูลเปลี่ยน)
  // ⚠️ ข้ามตอน loading — ยังไม่มีข้อมูลชุดใหม่ ห้าม clamp ด้วยข้อมูลเก่า
  useEffect(() => {
    if (loading) return;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (currentPage > totalPages) {
      handlePageChange(totalPages);
    }
  }, [loading, totalItems, pageSize, currentPage, handlePageChange]);

  const totalTemplates = templates.length;
  const activeTemplates = templates.filter(t => !t.deletedAt).length;
  const archivedTemplates = templates.filter(t => t.deletedAt).length;

  const viewCounts = {
    all: totalTemplates,
    active: activeTemplates,
    archived: archivedTemplates,
  };

  return (
    <div className="p-4 md:p-6 space-y-3">
      {/* ============================================ */}
      {/* 1. PAGE HEADER */}
      {/* ============================================ */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">📄</span>
          <div>
            <h1 className="text-lg font-bold text-slate-900 leading-tight">แม่แบบฟอร์ม (Form Templates)</h1>
            <p className="text-[11px] text-slate-500">จัดการแม่แบบฟอร์มสำหรับการรับสมัครทั้งหมดในระบบ</p>
          </div>
        </div>
        {canWrite && (
          <Button onClick={openCreate} size="sm" className="h-8">
            + สร้าง Template
          </Button>
        )}
      </div>

      {/* ============================================ */}
      {/* 2. KPI CARDS - Ultra Compact */}
      {/* ============================================ */}
      <div className="grid grid-cols-3 gap-2">
        <KpiCard icon="📊" value={totalTemplates} label="ทั้งหมด" />
        <KpiCard icon="✅" value={activeTemplates} label="ใช้งานอยู่" variant="success" />
        <KpiCard icon="📁" value={archivedTemplates} label="จัดเก็บแล้ว" variant="muted" />
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
                onChange={handleSearchChange}
                placeholder="ค้นหาชื่อแม่แบบ..."
                resultCount={totalItems}
                resultLabel="รายการ"
                size="sm"
                hideResultCount
              />
            </div>
            <SortDropdown
              value={sortId}
              onChange={handleSortChange}
              options={sortOptions}
              size="sm"
            />
          </div>

          {/* Row 2: Filter Pills + Result Count */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <FilterPill label="ทั้งหมด" isActive={view === 'all'} onClick={() => handleViewChange('all')} count={viewCounts.all} />
              <FilterPill label="ใช้งานอยู่" isActive={view === 'active'} onClick={() => handleViewChange('active')} count={viewCounts.active} />
              <FilterPill label="จัดเก็บแล้ว" isActive={view === 'archived'} onClick={() => handleViewChange('archived')} count={viewCounts.archived} />
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
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 w-[35%]">ชื่อแม่แบบ</TableHead>
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 hidden md:table-cell w-[18%]">Version ปัจจุบัน</TableHead>
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 hidden sm:table-cell w-[10%]">จำนวน Version</TableHead>
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 hidden lg:table-cell w-[18%]">รอบรับสมัคร</TableHead>
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 hidden md:table-cell w-[14%]">สร้างเมื่อ</TableHead>
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
              ) : filteredAndSortedTemplates.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-0">
                    {/* ถ้ามี search หรือ filter (ที่ไม่ใช่ all) → ไม่พบผลลัพธ์ */}
                    {search || view !== 'all' ? (
                      <NoResultsEmptyState
                        keyword={search}
                        onClearFilters={() => {
                          setSearch('');
                          setView('all');
                          updateUrl({ q: null, view: null });
                        }}
                      />
                    ) : (
                      <NoDataEmptyState
                        title="ยังไม่มีแม่แบบ"
                        description="เริ่มต้นโดยการสร้างแม่แบบฟอร์มใหม่"
                        action={{ label: '+ สร้าง Template', onClick: openCreate, variant: 'primary' }}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                paginatedTemplates.map((tpl) => {
                  const active = tpl.activeRoundsCount ?? 0;
                  const archived = tpl.archivedRoundsCount ?? 0;
                  const total = tpl.totalRoundsCount ?? (active + archived);

                  return (
                    <TableRow
                      key={tpl.id}
                      className="group"
                    >
                      {/* ชื่อแม่แบบ */}
                      <TableCell className="py-3 align-top">
                        <div
                          className="font-medium text-sm text-slate-900 leading-snug line-clamp-2 cursor-pointer hover:text-blue-600"
                          title={tpl.name}
                          onClick={() => router.push(`/admin/templates/builder?id=${tpl.id}`)}
                        >
                          {tpl.name}
                        </div>
                        {tpl.description && (
                          <div className="text-[11px] text-slate-500 line-clamp-1 mt-0.5" title={tpl.description}>
                            {tpl.description}
                          </div>
                        )}
                      </TableCell>

                      {/* Version ปัจจุบัน */}
                      <TableCell className="py-3 text-sm text-slate-600 hidden md:table-cell align-top">
                        {tpl.currentVersion ? (
                          <div className="flex flex-col gap-1">
                            <span className="font-medium">v{tpl.currentVersion.versionNumber}</span>
                            <span className={cn(
                              "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border w-fit",
                              tpl.currentVersion.status === 'PUBLISHED'
                                ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                                : tpl.currentVersion.status === 'DRAFT'
                                ? "bg-amber-100 text-amber-700 border-amber-200"
                                : "bg-slate-100 text-slate-600 border-slate-200"
                            )}>
                              {tpl.currentVersion.status}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400 text-xs">ยังไม่มี Published</span>
                        )}
                      </TableCell>

                      {/* จำนวน Version */}
                      <TableCell className="py-3 text-xs text-slate-500 hidden sm:table-cell align-top">
                        {tpl.versionCount} version
                      </TableCell>

                      {/* รอบรับสมัคร */}
                      <TableCell className="py-3 text-xs text-slate-500 hidden lg:table-cell align-top">
                        {total === 0 ? (
                          <span className="text-slate-400">ไม่มีรอบ</span>
                        ) : active === 0 && archived > 0 ? (
                          <div>
                            <div className="text-slate-400">ใช้งานอยู่ 0 รอบ</div>
                            <div className="text-amber-600 font-medium">จัดเก็บแล้ว {archived} รอบ</div>
                          </div>
                        ) : (
                          <div>
                            <div className="font-medium text-slate-700">{total} รอบ</div>
                            <div className="text-[10px] text-slate-500">
                              (ใช้งานอยู่ {active} / จัดเก็บแล้ว {archived})
                            </div>
                          </div>
                        )}
                      </TableCell>

                      {/* สร้างเมื่อ */}
                      <TableCell className="py-3 text-xs text-slate-500 whitespace-nowrap hidden md:table-cell align-top">
                        {formatDate(tpl.createdAt)}
                      </TableCell>

                      {/* Actions - ⋮ only */}
                      <TableCell className="py-3 text-right align-top">
                        {canWrite ? (
                          <ActionMenu
                            size="sm"
                            items={[
                              { label: '✏️ แก้ไข', onClick: () => openEdit(tpl, { stopPropagation: () => {} } as React.MouseEvent) },
                              { label: '🛠 Builder', onClick: () => router.push(`/admin/templates/builder?id=${tpl.id}`) },
                              { type: 'separator', label: '', onClick: () => {} },
                              ...(!tpl.deletedAt
                                ? [{ label: '📁 จัดเก็บ', onClick: () => setArchiveDialog({ open: true, tpl }) }]
                                : [
                                    { label: '↩ เรียกคืน', onClick: () => setRestoreDialog({ open: true, tpl }) },
                                    { label: '🗑 ลบถาวร', type: 'danger' as const, onClick: () => openDeleteDialog(tpl) },
                                  ]
                              ),
                            ]}
                          />
                        ) : (
                          <ActionMenu
                            size="sm"
                            items={[
                              { label: '🛠 Builder', onClick: () => router.push(`/admin/templates/builder?id=${tpl.id}`) },
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
            {search.trim()
              ? `พบ ${totalItems} รายการ`
              : totalItems === 0
                ? 'ไม่พบรายการ'
                : `แสดง ${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, totalItems)} จาก ${totalItems} รายการ`}
          </span>
          <Pagination
            currentPage={currentPage}
            totalItems={totalItems}
            pageSize={pageSize}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            showPageSizeSelector
            showResultCount={false}
          />
        </div>
      </div>

      {/* ============================================ */}
      {/* 4. FORM DIALOG */}
      {/* ============================================ */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? '✏️ แก้ไข Template' : '➕ สร้าง Template ใหม่'}</DialogTitle>
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

/** KPI Card - Smart Family Style (คัดลอกจาก Recruitment Rounds) */
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
