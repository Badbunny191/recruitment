'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { SearchInput } from '@/components/ui/search-input';
import { SortDropdown } from '@/components/ui/sort-dropdown';
import { Pagination } from '@/components/ui/pagination';
import { ActionMenu } from '@/components/ui/action-menu';
import { NoDataEmptyState, NoResultsEmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { useRole } from '@/lib/useRole';
import {
  parseContentDispositionFilename,
  DEFAULT_EXPORT_FILENAME,
  areAllFilteredSelected,
  isFilteredPartiallySelected,
  toggleAllFilteredSelection,
} from '@/lib/excel-export';

interface Round {
  id: string;
  title: string;
  status: string;
  deletedAt?: string | number | Date | null;
}

const ROUND_STATUS_META: Record<string, { label: string; pill: string }> = {
  ACTIVE:   { label: 'ใช้งาน',   pill: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  DRAFT:    { label: 'ร่าง',      pill: 'bg-amber-100 text-amber-700 border-amber-200' },
  CLOSED:   { label: 'ปิดแล้ว',   pill: 'bg-slate-100 text-slate-600 border-slate-200' },
  ARCHIVED: { label: 'จัดเก็บแล้ว', pill: 'bg-purple-100 text-purple-700 border-purple-200' },
};

const getRoundStatusMeta = (round: Round) => {
  if (round.deletedAt) return ROUND_STATUS_META.ARCHIVED;
  return ROUND_STATUS_META[round.status] || ROUND_STATUS_META.DRAFT;
};

interface Application {
  id: string;
  applicationNo: string;
  fullname: string;
  email: string;
  nationalId: string;
  status: string;
  submittedAt: number;
}

interface Summary {
  total: number;
  byStatus: Record<string, number>;
}

const STATUS_LABELS: Record<string, string> = {
  SUBMITTED: 'รอการตรวจสอบ',
  QUALIFIED: 'ผ่านการตรวจสอบ',
  REJECTED: 'ข้อมูลไม่ครบถ้วน',
  CANCELED: 'ยกเลิกใบสมัคร',
  ARCHIVED: 'เก็บเข้าคลัง',
};

// Status Badge Style (คัดลอกจาก Recruitment Rounds: pill badge with border)
const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  SUBMITTED: { label: 'รอการตรวจสอบ', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  QUALIFIED: { label: 'ผ่านการตรวจสอบ', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  REJECTED: { label: 'ข้อมูลไม่ครบถ้วน', className: 'bg-red-100 text-red-700 border-red-200' },
  CANCELED: { label: 'ยกเลิกใบสมัคร', className: 'bg-slate-100 text-slate-600 border-slate-200' },
  ARCHIVED: { label: 'เก็บเข้าคลัง', className: 'bg-purple-100 text-purple-700 border-purple-200' },
};

const BULK_STATUS_OPTIONS = ['SUBMITTED', 'QUALIFIED', 'REJECTED', 'CANCELED', 'ARCHIVED'];

const getErrorMessage = (data: any, fallback = 'เกิดข้อผิดพลาด'): string => {
  if (!data) return fallback;
  if (Array.isArray(data.error?.issues)) {
    return data.error.issues.map((i: any) => i.message).filter(Boolean).join('\n') || fallback;
  }
  if (typeof data.error?.message === 'string') return data.error.message;
  if (typeof data.message === 'string') return data.message;
  if (typeof data.error === 'string') return data.error;
  if (typeof data.details === 'string') return data.details;
  return fallback;
};

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
  variant?: 'default' | 'success' | 'muted' | 'warning' | 'danger' | 'info';
}) {
  const valueColor = {
    default: 'text-slate-900',
    success: 'text-emerald-600',
    muted: 'text-slate-500',
    warning: 'text-amber-600',
    danger: 'text-red-600',
    info: 'text-blue-600',
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

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

export default function ApplicationsClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { canWrite } = useRole();

  // URL State
  const urlRoundId = searchParams.get('round') || '';
  const showArchived = searchParams.get('archived') === '1';

  // Helper: อัปเดต URL (ไม่ trigger re-mount)
  const updateUrl = useCallback((patch: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(patch).forEach(([key, value]) => {
      if (value === null || value === '') {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, pathname, router]);

  // State
  const [rounds, setRounds] = useState<Round[]>([]);
  const [selectedRoundId, setSelectedRoundId] = useState<string>('');
  const [apps, setApps] = useState<Application[]>([]);
  const [summary, setSummary] = useState<Summary>({ total: 0, byStatus: {} });
  const [loading, setLoading] = useState(true);

  // View filter: all | active (excl. archived) | archived
  const [view, setView] = useState<'all' | 'active' | 'archived'>('active');

  // Search & Sort state
  const [search, setSearch] = useState('');
  const [sortId, setSortId] = useState<string>('submittedAt-desc');
  const [sortField, setSortField] = useState<string>('submittedAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(10);

  // Selection state — เก็บเป็น Set ของ ID จึงคงอยู่ข้ามหน้า (pagination)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // mirror ค่าล่าสุดสำหรับอ่านใน effect ที่ไม่ depend บน selectedIds
  const selectedIdsRef = useRef<Set<string>>(selectedIds);
  selectedIdsRef.current = selectedIds;

  // Status update modal (single)
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [newStatus, setNewStatus] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [updating, setUpdating] = useState(false);

  // Bulk status modal
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkReason, setBulkReason] = useState('');
  const [bulkUpdating, setBulkUpdating] = useState(false);

  // Excel export state — loading แยก Filtered / Selected + กันกดซ้ำ
  const [exporting, setExporting] = useState(false);
  const [exportingSelected, setExportingSelected] = useState(false);
  // แจ้งเตือนเมื่อ selection ถูกล้างเพราะตัวกรอง/รอบเปลี่ยน (ห้ามหายเงียบ)
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);

  // ดาวน์โหลด blob ด้วยชื่อไฟล์ที่ backend สร้างให้ (จาก Content-Disposition)
  const triggerExcelDownload = async (res: Response) => {
    const filename = parseContentDispositionFilename(res.headers.get('Content-Disposition') || '')
      ?? DEFAULT_EXPORT_FILENAME;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // Export Excel (โหมดตามตัวกรอง) — ส่งตัวกรองเดียวกับที่ผู้ใช้เลือกอยู่บนหน้าจอ
  // view → status mapping ให้ผลลัพธ์ตรงกับ FilterPill ที่เห็น:
  //   active = ไม่รวม ARCHIVED/DRAFT, archived = ARCHIVED, all = ทุกสถานะ (backend ตัด DRAFT ให้)
  const handleExportExcel = async () => {
    if (!selectedRoundId || exporting || exportingSelected) return;
    setExporting(true);
    try {
      const params = new URLSearchParams();
      params.append('roundId', selectedRoundId);
      if (search.trim()) params.append('search', search.trim());
      if (view === 'active') params.append('status', 'SUBMITTED,QUALIFIED,REJECTED,CANCELED');
      if (view === 'archived') params.append('status', 'ARCHIVED');

      const res = await fetch(`${API_URL}/admin/applications/export?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || 'ส่งออก Excel ไม่สำเร็จ');
      }

      await triggerExcelDownload(res);
    } catch (error) {
      console.error('Excel export error:', error);
      alert(error instanceof Error ? error.message : 'ส่งออก Excel ไม่สำเร็จ');
    } finally {
      setExporting(false);
    }
  };

  // Export Excel (โหมดรายการที่เลือก) — POST applicationIds ทั้งหมดที่เลือก
  // selection อยู่ข้ามหน้าได้ → ส่ง ID ทุกหน้า ไม่ใช่เฉพาะหน้าปัจจุบัน
  const handleExportSelected = async () => {
    if (!selectedRoundId || selectedIds.size === 0 || exporting || exportingSelected) return;
    setExportingSelected(true);
    try {
      const res = await fetch(`${API_URL}/admin/applications/export-selected`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('adminToken')}`,
        },
        body: JSON.stringify({
          roundId: selectedRoundId,
          applicationIds: Array.from(selectedIds),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || 'ส่งออก Excel ไม่สำเร็จ');
      }

      await triggerExcelDownload(res);
      // สำเร็จแล้วคง selection ไว้ (ไม่ล้างโดยไม่จำเป็น)
    } catch (error) {
      console.error('Excel selected export error:', error);
      alert(error instanceof Error ? error.message : 'ส่งออก Excel ไม่สำเร็จ');
    } finally {
      setExportingSelected(false);
    }
  };

  // Fetch rounds
  useEffect(() => {
    const view = showArchived ? 'all' : 'active';
    fetch(`${API_URL}/admin/rounds?view=${view}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` }
    })
      .then(res => res.json())
      .then(res => {
        const roundList = res.data || [];
        setRounds(roundList);

        // ลำดับการเลือก Round:
        // 1) URL ?round=... (ถ้ามีและอยู่ในลิสต์)
        // 2) LocalStorage cache (ถ้ามีและอยู่ในลิสต์)
        // 3) Default: ACTIVE ก่อน, ไม่มี → เอาตัวแรก
        let chosen: Round | undefined;
        if (urlRoundId) {
          chosen = roundList.find((r: Round) => r.id === urlRoundId);
        }
        if (!chosen) {
          const cached = localStorage.getItem('applications:lastRoundId');
          if (cached) {
            chosen = roundList.find((r: Round) => r.id === cached);
          }
        }
        if (!chosen) {
          chosen = roundList.find((r: Round) => r.status === 'ACTIVE' && !r.deletedAt) || roundList[0];
        }
        if (chosen) {
          setSelectedRoundId(chosen.id);
          // Sync URL ถ้า URL ว่างหรือไม่ตรงกับที่เลือก
          if (!urlRoundId) {
            updateUrl({ round: chosen.id });
          }
          localStorage.setItem('applications:lastRoundId', chosen.id);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  // Sync URL เมื่อผู้ใช้เปลี่ยน Round
  useEffect(() => {
    if (!selectedRoundId) return;
    if (urlRoundId === selectedRoundId) return;
    updateUrl({ round: selectedRoundId });
    localStorage.setItem('applications:lastRoundId', selectedRoundId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoundId]);

  // Fetch applications and summary
  const fetchData = useCallback(async () => {
    if (!selectedRoundId) return;

    setLoading(true);
    setSelectedIds(new Set()); // Reset selection
    const token = localStorage.getItem('adminToken');

    try {
      // Fetch applications with filters
      const params = new URLSearchParams();
      params.append('roundId', selectedRoundId);
      if (search) params.append('search', search);

      const [appsRes, summaryRes] = await Promise.all([
        fetch(`${API_URL}/admin/applications?${params}`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(`${API_URL}/admin/applications/summary?roundId=${selectedRoundId}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);

      const appsData = await appsRes.json();
      const summaryData = await summaryRes.json();

      let appsList = appsData.data || [];

      // Filter by view
      if (view === 'active') {
        appsList = appsList.filter((app: Application) => app.status !== 'ARCHIVED');
      } else if (view === 'archived') {
        appsList = appsList.filter((app: Application) => app.status === 'ARCHIVED');
      }

      setApps(appsList);
      setSummary(summaryData.data || { total: 0, byStatus: {} });
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedRoundId, search, view, API_URL]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedRoundId, search, sortId, view]);

  // Policy การเลือก: selection คงอยู่ข้ามหน้า/การเรียงลำดับ แต่ถูกล้างเมื่อ
  // เปลี่ยนรอบรับสมัคร (เสมอ) หรือเปลี่ยนตัวกรอง search/view — พร้อมแจ้งเหตุผล
  // (ต้องประกาศก่อน effect เรียก fetchData เพื่อให้ล้าง+แจ้งก่อน reset ใน fetch)
  const prevFilterStateRef = useRef<{ roundId: string; search: string; view: string } | null>(null);
  useEffect(() => {
    const prev = prevFilterStateRef.current;
    prevFilterStateRef.current = { roundId: selectedRoundId, search, view };
    if (!prev) return; // render แรกหลัง mount ยังไม่มีตัวกรองเดิมให้เทียบ
    const roundChanged = prev.roundId !== selectedRoundId;
    const filterChanged = prev.search !== search || prev.view !== view;
    if (!roundChanged && !filterChanged) return;
    const size = selectedIdsRef.current.size;
    if (size === 0) return;
    setSelectedIds(new Set());
    setSelectionNotice(
      `ล้างการเลือก ${size} รายการ เนื่องจาก${roundChanged ? 'เปลี่ยนรอบรับสมัคร' : 'ตัวกรอง (ค้นหา/สถานะ) เปลี่ยน'}`,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoundId, search, view]);

  // Fetch on mount and when dependencies change
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Open status modal
  const openStatusModal = (app: Application, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedApp(app);
    setNewStatus(app.status || 'SUBMITTED');
    setRejectReason('');
    setShowStatusModal(true);
  };

  // Handle status update
  const handleStatusUpdate = async () => {
    if (!selectedApp || !newStatus) return;

    if ((newStatus === 'REJECTED' || newStatus === 'CANCELED') && !rejectReason.trim()) {
      alert('กรุณาระบุเหตุผล');
      return;
    }

    setUpdating(true);
    try {
      const res = await fetch(`${API_URL}/admin/applications/${selectedApp.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('adminToken')}`
        },
        body: JSON.stringify({
          status: newStatus,
          reason: (newStatus === 'REJECTED' || newStatus === 'CANCELED') ? rejectReason.trim() : undefined
        })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setShowStatusModal(false);
        fetchData();
      } else {
        alert(getErrorMessage(data, 'เกิดข้อผิดพลาด'));
      }
    } catch (error) {
      console.error('Status update error:', error);
      alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
      setUpdating(false);
    }
  };

  // Bulk status update
  const handleBulkStatusUpdate = async () => {
    if (!bulkStatus || selectedIds.size === 0) return;

    if ((bulkStatus === 'REJECTED' || bulkStatus === 'CANCELED') && !bulkReason.trim()) {
      alert('กรุณาระบุเหตุผล');
      return;
    }

    setBulkUpdating(true);
    try {
      const res = await fetch(`${API_URL}/admin/applications/bulk-status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('adminToken')}`
        },
        body: JSON.stringify({
          ids: Array.from(selectedIds),
          status: bulkStatus,
          reason: (bulkStatus === 'REJECTED' || bulkStatus === 'CANCELED') ? bulkReason.trim() : undefined
        })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setShowBulkModal(false);
        setBulkStatus('');
        setBulkReason('');
        fetchData();
        alert(`อัปเดตสถานะสำเร็จ ${data.updated} รายการ`);
      } else {
        alert(getErrorMessage(data, 'เกิดข้อผิดพลาด'));
      }
    } catch (error) {
      console.error('Bulk status update error:', error);
      alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
      setBulkUpdating(false);
    }
  };

  const openBulkModal = () => {
    setBulkStatus('');
    setBulkReason('');
    setShowBulkModal(true);
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return 'ไม่ระบุ';

    let date: Date;

    if (timestamp instanceof Date) {
      date = timestamp;
    } else if (typeof timestamp === 'number') {
      date = new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp);
    } else if (typeof timestamp === 'string') {
      date = new Date(timestamp);
    } else {
      return 'ไม่ถูกต้อง';
    }

    if (isNaN(date.getTime())) return 'ไม่ถูกต้อง';

    return date.toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Sort options
  const sortOptions = [
    { id: 'submittedAt-desc', field: 'submittedAt', label: 'ล่าสุด', direction: 'desc' as const },
    { id: 'submittedAt-asc', field: 'submittedAt', label: 'เก่าสุด', direction: 'asc' as const },
    { id: 'fullname-asc', field: 'fullname', label: 'ชื่อ A-Z', direction: 'asc' as const },
    { id: 'fullname-desc', field: 'fullname', label: 'ชื่อ Z-A', direction: 'desc' as const },
  ];

  // Sort + Paginate
  const sortedApps = useMemo(() => {
    const result = [...apps];
    result.sort((a, b) => {
      let aVal: any, bVal: any;
      if (sortField === 'submittedAt') {
        aVal = typeof a.submittedAt === 'number'
          ? (a.submittedAt < 1e12 ? a.submittedAt * 1000 : a.submittedAt)
          : new Date(a.submittedAt).getTime();
        bVal = typeof b.submittedAt === 'number'
          ? (b.submittedAt < 1e12 ? b.submittedAt * 1000 : b.submittedAt)
          : new Date(b.submittedAt).getTime();
      } else if (sortField === 'fullname') {
        aVal = (a.fullname || '').toLowerCase();
        bVal = (b.fullname || '').toLowerCase();
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
  }, [apps, sortField, sortDirection]);

  const totalItems = sortedApps.length;
  const paginatedApps = sortedApps.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  // Selection handlers — Header Checkbox "เลือกทั้งหมด" ทำงานกับผลลัพธ์ตาม
  // ตัวกรองปัจจุบัน "ทุกหน้า" (sortedApps = หลัง round + search + view + sort
  // ก่อนทำ pagination แบ่งหน้า) ไม่ใช่เฉพาะหน้าปัจจุบัน
  const allFilteredIds = useMemo(() => sortedApps.map((app) => app.id), [sortedApps]);
  const allFilteredSelected = areAllFilteredSelected(allFilteredIds, selectedIds);
  const someFilteredSelected = isFilteredPartiallySelected(allFilteredIds, selectedIds);

  const toggleSelectAll = () => {
    setSelectedIds(toggleAllFilteredSelection(allFilteredIds, selectedIds));
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  // Count by view (จาก summary ทั้งหมด)
  const totalAll = summary.total;
  const totalActive = summary.total - (summary.byStatus.ARCHIVED || 0);
  const totalArchived = summary.byStatus.ARCHIVED || 0;

  const viewCounts = {
    all: totalAll,
    active: totalActive,
    archived: totalArchived,
  };

  // =====================
  // Searchable Round Selector (Combobox) - local state
  // =====================
  const [roundSearchOpen, setRoundSearchOpen] = useState(false);
  const [roundSearchQuery, setRoundSearchQuery] = useState('');
  const roundSelectorRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!roundSearchOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (roundSelectorRef.current && !roundSelectorRef.current.contains(e.target as Node)) {
        setRoundSearchOpen(false);
        setRoundSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [roundSearchOpen]);

  const filteredRounds = useMemo(() => {
    if (!roundSearchQuery.trim()) return rounds;
    const q = roundSearchQuery.toLowerCase();
    return rounds.filter(r => r.title.toLowerCase().includes(q));
  }, [rounds, roundSearchQuery]);

  const selectedRound = rounds.find(r => r.id === selectedRoundId);
  const selectedMeta = selectedRound ? getRoundStatusMeta(selectedRound) : null;

  return (
    <div className="p-4 md:p-6 space-y-3">
      {/* ============================================ */}
      {/* 1. PAGE HEADER */}
      {/* ============================================ */}
      <div className="flex items-center gap-2">
        <span className="text-lg">📋</span>
        <div>
          <h1 className="text-lg font-bold text-slate-900 leading-tight">ใบสมัคร (Applications)</h1>
          <p className="text-[11px] text-slate-500">จัดการใบสมัครและตรวจสอบคุณสมบัติผู้สมัคร</p>
        </div>
      </div>

      {/* ============================================ */}
      {/* 1.5 CONTEXT BAR - Round Selector (POLISHED) */}
      {/* ============================================ */}
      <div className="bg-gradient-to-r from-slate-50 to-white rounded-xl border-2 border-slate-200 shadow-sm px-5 py-4">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          {/* Visual Anchor - Left */}
          <div className="flex items-center gap-2.5 shrink-0 md:min-w-[200px]">
            <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
              <span className="text-lg">🎯</span>
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Context</span>
              <span className="text-sm font-semibold text-slate-800">กำลังดูข้อมูลของรอบ</span>
            </div>
          </div>

          {/* Searchable Round Selector - ใช้พื้นที่เต็มที่ */}
          <div className="relative flex-1 min-w-0" ref={roundSelectorRef}>
            <button
              type="button"
              onClick={() => setRoundSearchOpen(o => !o)}
              className={cn(
                "w-full h-11 px-4 text-left bg-white border-2 rounded-lg flex items-center justify-between gap-3 transition-all",
                roundSearchOpen
                  ? "border-blue-500 ring-4 ring-blue-100 shadow-sm"
                  : "border-slate-300 hover:border-slate-400 hover:shadow-sm"
              )}
            >
              {selectedRound ? (
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <span className="font-semibold text-base text-slate-900 truncate" title={selectedRound.title}>
                    {selectedRound.title}
                  </span>
                  {selectedMeta && (
                    <span className={cn(
                      "shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border",
                      selectedMeta.pill
                    )}>
                      {selectedMeta.label}
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-slate-400 text-sm">-- เลือกรอบ --</span>
              )}
              <svg className={cn("h-4 w-4 text-slate-500 shrink-0 transition-transform", roundSearchOpen && "rotate-180")} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {roundSearchOpen && (
              <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
                {/* Search Input */}
                <div className="p-2 border-b border-slate-100">
                  <div className="relative">
                    <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                      type="text"
                      value={roundSearchQuery}
                      onChange={(e) => setRoundSearchQuery(e.target.value)}
                      placeholder="ค้นหารอบ..."
                      className="w-full h-9 pl-8 pr-3 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                      autoFocus
                    />
                  </div>
                </div>

                {/* List */}
                <div className="max-h-[300px] overflow-y-auto py-1">
                  {filteredRounds.length === 0 ? (
                    <div className="px-3 py-6 text-center text-xs text-slate-500">
                      {roundSearchQuery ? 'ไม่พบรอบที่ค้นหา' : 'ไม่มีรอบรับสมัคร'}
                    </div>
                  ) : (
                    filteredRounds.map((round) => {
                      const meta = getRoundStatusMeta(round);
                      const isSelected = round.id === selectedRoundId;
                      return (
                        <button
                          key={round.id}
                          type="button"
                          onClick={() => {
                            setSelectedRoundId(round.id);
                            setRoundSearchOpen(false);
                            setRoundSearchQuery('');
                          }}
                          className={cn(
                            "w-full px-3 py-2 text-left flex items-center gap-2.5 hover:bg-slate-50 transition-colors",
                            isSelected && "bg-blue-50"
                          )}
                        >
                          <span className={cn("text-sm flex-1 truncate", isSelected ? "font-semibold text-slate-900" : "text-slate-700")} title={round.title}>
                            {round.title}
                          </span>
                          <span className={cn(
                            "shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border",
                            meta.pill
                          )}>
                            {meta.label}
                          </span>
                          {isSelected && (
                            <svg className="h-4 w-4 text-blue-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Show Archived toggle */}
          <label className="flex items-center gap-2 cursor-pointer shrink-0 md:ml-2 pl-3 md:border-l border-slate-200">
            <Checkbox
              checked={showArchived}
              onChange={(e) => {
                updateUrl({ archived: e.target.checked ? '1' : null });
              }}
            />
            <span className="text-sm text-slate-700 whitespace-nowrap">
              แสดงรอบที่จัดเก็บแล้ว
              <span className="ml-1 text-slate-400">📦</span>
            </span>
          </label>
        </div>
      </div>

      {/* ============================================ */}
      {/* 2. KPI CARDS - Status Summary */}
      {/* ============================================ */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <KpiCard icon="📊" value={summary.total} label="ทั้งหมด" />
        <KpiCard icon="📥" value={summary.byStatus.SUBMITTED || 0} label="รอการตรวจสอบ" variant="info" />
        <KpiCard icon="✅" value={summary.byStatus.QUALIFIED || 0} label="ผ่านการตรวจสอบ" variant="success" />
        <KpiCard icon="⚠️" value={summary.byStatus.REJECTED || 0} label="ข้อมูลไม่ครบถ้วน" variant="danger" />
        <KpiCard icon="🚫" value={summary.byStatus.CANCELED || 0} label="ยกเลิกใบสมัคร" variant="muted" />
        <KpiCard icon="📦" value={summary.byStatus.ARCHIVED || 0} label="เก็บเข้าคลัง" variant="muted" />
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && canWrite && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-700">
              เลือกแล้ว <span className="font-semibold">{selectedIds.size}</span> รายการตามตัวกรอง
            </span>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-[11px] text-slate-500 hover:text-slate-700 underline"
            >
              ยกเลิก
            </button>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={openBulkModal}
            >
              เปลี่ยนสถานะ
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (confirm(`เก็บเข้าคลัง ${selectedIds.size} รายการ?`)) {
                  setBulkStatus('ARCHIVED');
                  setBulkReason('');
                  setShowBulkModal(true);
                }
              }}
            >
              เก็บเข้าคลัง
            </Button>
          </div>
        </div>
      )}

      {/* Selection cleared notice — แจ้งเหตุผลที่ selection ถูกล้าง (ห้ามหายเงียบ) */}
      {selectionNotice && (
        <div role="status" className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
          <span className="text-xs text-amber-800">
            <span aria-hidden>⚠️</span> {selectionNotice}
          </span>
          <button
            type="button"
            onClick={() => setSelectionNotice(null)}
            aria-label="ปิดข้อความแจ้งเตือน"
            className="text-amber-500 hover:text-amber-700 text-xs px-1 shrink-0"
          >
            ✕
          </button>
        </div>
      )}

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
                placeholder="ค้นหาชื่อ, อีเมล, เลขใบสมัคร..."
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

          {/* Row 2: Filter Pills + Export + Result Count */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <FilterPill label="ทั้งหมด" isActive={view === 'all'} onClick={() => setView('all')} count={viewCounts.all} />
              <FilterPill label="กำลังดำเนินการ" isActive={view === 'active'} onClick={() => setView('active')} count={viewCounts.active} />
              <FilterPill label="เก็บเข้าคลัง" isActive={view === 'archived'} onClick={() => setView('archived')} count={viewCounts.archived} />
            </div>
            <div className="flex items-center gap-2">
              {canWrite && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportExcel}
                    disabled={exporting || exportingSelected || !selectedRoundId}
                    title="ส่งออกใบสมัครตามตัวกรองปัจจุบันเป็นไฟล์ Excel"
                  >
                    <span aria-hidden>📊</span>
                    {exporting ? 'กำลังสร้าง Excel...' : 'Export Excel'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportSelected}
                    disabled={selectedIds.size === 0 || exporting || exportingSelected || !selectedRoundId}
                    title="ส่งออกเฉพาะใบสมัครที่เลือก (รวมทุกหน้า) เป็นไฟล์ Excel"
                  >
                    <span aria-hidden>📑</span>
                    {exportingSelected ? 'กำลังสร้าง Excel...' : `Export ที่เลือก (${selectedIds.size})`}
                  </Button>
                </>
              )}
              <span className="text-[11px] text-slate-500 whitespace-nowrap">
                {search.trim() ? `พบ ${totalItems}` : `ทั้งหมด ${totalItems}`}
              </span>
            </div>
          </div>
        </div>

        {/* 3.2 TABLE */}
        <div className="overflow-x-auto">
          <Table className="w-full table-fixed">
            <TableHeader>
              <TableRow className="bg-slate-50/50 hover:bg-slate-50/50">
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 w-[6%]">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    ref={(el) => { if (el) el.indeterminate = someFilteredSelected; }}
                    onChange={toggleSelectAll}
                    aria-label="เลือกผู้สมัครทั้งหมดตามตัวกรอง"
                    title="เลือกผู้สมัครทั้งหมดตามตัวกรองปัจจุบัน (ทุกหน้า)"
                    className="w-4 h-4 rounded border-slate-300 cursor-pointer"
                  />
                </TableHead>
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 w-[15%]">เลขใบสมัคร</TableHead>
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 w-[20%]">ชื่อ-นามสกุล</TableHead>
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 hidden md:table-cell w-[22%]">อีเมล</TableHead>
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 w-[12%]">สถานะ</TableHead>
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 hidden sm:table-cell w-[15%]">วันที่สมัคร</TableHead>
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 text-right w-[10%]">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    <div className="flex items-center justify-center gap-2 text-slate-500">
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span className="text-xs">กำลังโหลด...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : totalItems === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-0">
                    {search ? (
                      <NoResultsEmptyState keyword={search} onClearFilters={() => setSearch('')} />
                    ) : (
                      <NoDataEmptyState
                        title="ไม่พบใบสมัคร"
                        description="ยังไม่มีใบสมัครในรอบนี้"
                      />
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                paginatedApps.map((app) => {
                  const status = STATUS_CONFIG[app.status] || STATUS_CONFIG.SUBMITTED;
                  return (
                    <TableRow
                      key={app.id}
                      className="group"
                    >
                      {/* Checkbox */}
                      <TableCell className="py-3 align-top" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(app.id)}
                          onChange={() => toggleSelect(app.id)}
                          aria-label={`เลือกใบสมัคร ${app.applicationNo}`}
                          className="w-4 h-4 rounded border-slate-300 cursor-pointer"
                        />
                      </TableCell>

                      {/* เลขใบสมัคร */}
                      <TableCell className="py-3 align-top">
                        <button
                          onClick={() => router.push(`/admin/application-detail?id=${app.id}`)}
                          className="font-medium text-sm text-blue-600 hover:text-blue-800 hover:underline text-left line-clamp-1"
                          title={app.applicationNo}
                        >
                          {app.applicationNo}
                        </button>
                      </TableCell>

                      {/* ชื่อ-นามสกุล */}
                      <TableCell className="py-3 align-top">
                        <button
                          onClick={() => router.push(`/admin/application-detail?id=${app.id}`)}
                          className="text-sm text-slate-900 hover:text-blue-600 text-left line-clamp-1"
                          title={app.fullname}
                        >
                          {app.fullname}
                        </button>
                      </TableCell>

                      {/* อีเมล */}
                      <TableCell className="py-3 text-xs text-slate-500 hidden md:table-cell align-top">
                        <span className="line-clamp-1" title={app.email}>{app.email}</span>
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

                      {/* วันที่สมัคร */}
                      <TableCell className="py-3 text-xs text-slate-500 whitespace-nowrap hidden sm:table-cell align-top">
                        {formatDate(app.submittedAt)}
                      </TableCell>

                      {/* Actions - ⋮ only */}
                      <TableCell className="py-3 text-right align-top">
                        <ActionMenu
                          size="sm"
                          items={[
                            ...(canWrite
                              ? [{ label: '✏️ เปลี่ยนสถานะ', onClick: () => openStatusModal(app, { stopPropagation: () => {} } as React.MouseEvent) }]
                              : []),
                            { label: '👁 ดูรายละเอียด', onClick: () => router.push(`/admin/application-detail?id=${app.id}`) },
                          ]}
                        />
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
            {search.trim() ? `พบ ${totalItems} รายการ` : `แสดง ${paginatedApps.length} จาก ${totalItems}`}
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
      {/* 4. MODALS - Status Update (Single) */}
      {/* ============================================ */}
      {showStatusModal && selectedApp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">✏️ เปลี่ยนสถานะใบสมัคร</h2>
            <p className="text-sm text-slate-600 mb-4">
              {selectedApp.applicationNo} - {selectedApp.fullname}
            </p>

            <div className="space-y-4">
              <div>
                <Label>สถานะใหม่</Label>
                <Select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                  className="w-full mt-1"
                >
                  <option value="SUBMITTED">รอการตรวจสอบ</option>
                  <option value="QUALIFIED">ผ่านการตรวจสอบ</option>
                  <option value="REJECTED">ข้อมูลไม่ครบถ้วน</option>
                  <option value="CANCELED">ยกเลิกใบสมัคร</option>
                  <option value="ARCHIVED">เก็บเข้าคลัง</option>
                </Select>
              </div>

              {(newStatus === 'REJECTED' || newStatus === 'CANCELED') && (
                <div>
                  <Label>เหตุผล *</Label>
                  <Textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="ระบุเหตุผล..."
                    className="w-full mt-1"
                    rows={3}
                  />
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-6 justify-end">
              <Button
                variant="outline"
                onClick={() => setShowStatusModal(false)}
                disabled={updating}
              >
                ยกเลิก
              </Button>
              <Button
                onClick={handleStatusUpdate}
                disabled={updating}
              >
                {updating ? 'กำลังบันทึก...' : 'บันทึก'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================ */}
      {/* 5. MODALS - Status Update (Bulk) */}
      {/* ============================================ */}
      {showBulkModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">📝 เปลี่ยนสถานะ ({selectedIds.size} รายการ)</h2>

            <div className="space-y-4">
              <div>
                <Label>สถานะใหม่</Label>
                <Select
                  value={bulkStatus}
                  onChange={(e) => setBulkStatus(e.target.value)}
                  className="w-full mt-1"
                >
                  <option value="">-- เลือกสถานะ --</option>
                  {BULK_STATUS_OPTIONS.map(status => (
                    <option key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </option>
                  ))}
                </Select>
              </div>

              {(bulkStatus === 'REJECTED' || bulkStatus === 'CANCELED') && (
                <div>
                  <Label>เหตุผล *</Label>
                  <Textarea
                    value={bulkReason}
                    onChange={(e) => setBulkReason(e.target.value)}
                    placeholder="ระบุเหตุผล..."
                    className="w-full mt-1"
                    rows={3}
                  />
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-6 justify-end">
              <Button
                variant="outline"
                onClick={() => setShowBulkModal(false)}
                disabled={bulkUpdating}
              >
                ยกเลิก
              </Button>
              <Button
                onClick={handleBulkStatusUpdate}
                disabled={bulkUpdating || !bulkStatus}
              >
                {bulkUpdating ? 'กำลังบันทึก...' : 'บันทึก'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
