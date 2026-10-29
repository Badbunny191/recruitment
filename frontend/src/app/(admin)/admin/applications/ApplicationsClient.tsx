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
} from '@/lib/excel-export';
import {
  BULK_PDF_LIMIT,
  BULK_PDF_NEAR_LIMIT,
  buildBulkZipFilename,
  bulkDownloadPdfs,
  formatBulkEstimate,
  resolveBulkTarget,
  type BulkDownloadFailure,
  type BulkDownloadMode,
  type PdfBulkTarget,
} from '@/lib/pdf-bulk-download';
import {
  STATUS_FILTER_OPTIONS,
  parseStatusFilter,
  statusFilterToExportStatusParam,
  statusFilterToParam,
  type StatusFilterValue,
} from '@/lib/applications-status-filter';
import {
  buildApplicationsListParams,
  APPLICATIONS_PAGE_SIZE_OPTIONS,
  APPLICATIONS_SORT_OPTIONS,
  normalizeSortId,
  readPagination,
  type ApplicationsPagination,
  type ApplicationsSortId,
} from '@/lib/applications-list-params';
import {
  applyListStatePatch,
  buildListStateUrlPatch,
  createRequestGuard,
  hydrateListState,
  isInitialRoundHydration,
  isPageResettingChange,
  resolvePageAfterResponse,
  shouldClearSelection,
  type ApplicationsListState,
} from '@/lib/applications-list-state';
import {
  buildSelectionSelector,
  canSubmitSelection,
  clearSelection,
  createSelection,
  describeSelectionBlocker,
  describeSelectionCount,
  isHeaderChecked,
  isHeaderIndeterminate,
  isRowSelected,
  resolveSelectedCount,
  toggleHeader,
  toggleRow,
  type ApplicationsSelection,
} from '@/lib/applications-selection-state';

interface Round {
  id: string;
  title: string;
  status: string;
  roundCode?: string | null;
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

// ARCHIVED (legacy-only): แถวเดิมยังแสดง/กรอง/ส่งออกได้ แต่ไม่รับตั้งใหม่ผ่าน UI
const BULK_STATUS_OPTIONS = ['SUBMITTED', 'QUALIFIED', 'REJECTED', 'CANCELED'];

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

// ตัวเลือกจำนวนรายการต่อหน้า — ค่า default คือ 10 (ไม่เขียนลง URL)
// ค่าจริงอยู่ใน lib/applications-list-params (ใช้ร่วมกับ parsePageSize)
const PAGE_SIZE_OPTIONS = [...APPLICATIONS_PAGE_SIZE_OPTIONS];

export default function ApplicationsClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { canWrite } = useRole();

  // URL State
  // ── List state (page/search/status/sort) อยู่ใน URL ทั้งหมด ────────────────
  // เปิดรายละเอียดแล้วกด Back (router.back) → component remount
  // → อ่านค่ากลับจาก URL จึงกลับมาตำแหน่งเดิมได้ (หน้าที่จากไป, search, filter, sort, view)
  //
  // Phase 1.1: hydrate ผ่าน hydrateListState() ตัวเดียว (applications-list-state)
  // — parse/normalize ของทั้ง 6 มิติอยู่ที่เดียว ไม่กระจายใน component
  // — ?archived=1 ไม่ใช่ส่วนของ list state (เป็นตัวคุมขอบเขตของ dropdown รอบ)
  //   จึงยังอ่านตรงจาก searchParams
  const showArchived = searchParams.get('archived') === '1';
  const urlListState = hydrateListState(new URLSearchParams(searchParams.toString()));
  const urlRoundId = urlListState.roundId;
  const urlSearch = urlListState.search;
  const urlStatusFilter = urlListState.status;
  const urlSortId = urlListState.sort;
  const urlPage = urlListState.page;
  const urlPageSize = urlListState.pageSize;

  // Helper: อัปเดต URL (ไม่ trigger re-mount)
  // ⚠️ ถือ "แผนที่ params ของตัวเอง" ใน ref ไม่อ่านจาก window.location / searchParams
  //   เพราะ router.replace แก้ URL แบบ async (transition เสร็จค่อย update) →
  //   การ replace ติดกันหลายครั้งในรอบเดียว (เช่น เปลี่ยน view แล้ว reset หน้า)
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
  // (Back จากหน้ารายละเอียด → remount → hydrate จาก URL → ได้ตำแหน่งเดิม)
  //
  // Phase 1.1: URL patch ทุกตัวมาจาก buildListStateUrlPatch() (applications-list-state)
  // — "ค่า default ไม่เขียนลง URL" เป็นกฎเดียว ไม่ใช่ if ซ้ำในทุก setter
  // — setter พวกนี้ไม่แตะ page เอง: กฎ page reset อยู่ใน effect ตัวเดียว (ด้านล่าง)
  //   ซึ่งใช้ isPageResettingChange() ตัวเดียวกับที่เทสต์ไว้

  /** เขียนเฉพาะ key ที่ patch มีค่า (undefined = ไม่แตะ) */
  const updateUrlFromState = useCallback(
    (patch: Record<string, string | null | undefined>) => {
      const defined: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) defined[key] = value;
      }
      updateUrl(defined);
    },
    [updateUrl],
  );

  /** เขียน list state ลง useState ทุกตัว + URL (ที่เดียว) */
  const commitListState = useCallback(
    (next: ApplicationsListState) => {
      setSearch(next.search);
      setStatusFilter(next.status);
      setSortId(next.sort);
      setCurrentPage(next.page);
      setPageSize(next.pageSize);
      // roundId เป็นของ effect รอบ (sync URL + localStorage) — ไม่เขียนทับที่นี่
      const { round: _round, ...urlPatch } = buildListStateUrlPatch(next);
      updateUrlFromState(urlPatch);
    },
    [updateUrlFromState],
  );

  const handleSearchChange = useCallback((value: string) => {
    commitListState(applyListStatePatch(listStateRef.current, { search: value }));
  }, [commitListState]);

  const handleStatusFilterChange = useCallback((next: StatusFilterValue) => {
    commitListState(applyListStatePatch(listStateRef.current, { status: next }));
    // ALL = ค่า default → ลบ param ทิ้ง + เคลียร์ legacy ?view= ทิ้งด้วยกันทีเดียว
    updateUrlFromState({ view: null });
  }, [commitListState, updateUrlFromState]);

  const handleSortChange = useCallback((id: string, field: string, direction?: 'asc' | 'desc' | null) => {
    // Phase 1: sort ทำที่ server — เก็บแค่ sortId แล้วให้ fetchData ส่งขึ้นไป
    commitListState(applyListStatePatch(listStateRef.current, { sort: normalizeSortId(id) }));
  }, [commitListState]);

  const handlePageChange = useCallback((page: number) => {
    commitListState(applyListStatePatch(listStateRef.current, { page }));
  }, [commitListState]);

  // เปลี่ยน page size → reset กลับหน้า 1 เสมอ (กฎอยู่ใน applyListStatePatch)
  const handlePageSizeChange = useCallback((size: number) => {
    commitListState(applyListStatePatch(listStateRef.current, { pageSize: size }));
  }, [commitListState]);

  // State
  const [rounds, setRounds] = useState<Round[]>([]);
  const [selectedRoundId, setSelectedRoundId] = useState<string>('');
  const [apps, setApps] = useState<Application[]>([]);
  const [summary, setSummary] = useState<Summary>({ total: 0, byStatus: {} });
  const [loading, setLoading] = useState(true);

  // สถานะของ "การโหลดรอบรับสมัคร" — ประตูของทั้งหน้า
  // ⚠️ loading เริ่มที่ true และ fetchData จะไม่รันเลยถ้า selectedRoundId ว่าง
  //   ดังนั้นถ้า rounds fetch ไม่จบ spinner จะค้างตลอดกาล → ต้องมี state ที่จบได้เสมอ
  //   'loading' = ยังไม่รู้ผล, 'ready' = ได้ลิสต์แล้ว (อาจว่าง), 'error' = ล้มเหลว
  const [roundsStatus, setRoundsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [roundsError, setRoundsError] = useState<string | null>(null);
  // ตัวนับสำหรับ "ลองอีกครั้ง" — ใส่ใน dep ของ effect โหลดรอบ
  const [roundsReloadKey, setRoundsReloadKey] = useState(0);

  // Pagination ที่ server คืนมา — source of truth ของ total/totalPages
  // (Phase 1: list เป็น server-side แล้ว ห้ามคำนวณ total จาก apps.length)
  const [pagination, setPagination] = useState<ApplicationsPagination>({
    page: urlPage,
    pageSize: urlPageSize,
    total: 0,
    totalPages: 1,
  });

  // Status filter: ALL | SUBMITTED | QUALIFIED | REJECTED | CANCELED | ARCHIVED — hydrate จาก URL
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>(urlStatusFilter);

  // Search & Sort state — hydrate จาก URL (sortId format: "<field>-<direction>")
  // Phase 1: sort ถูกส่งขึ้น server แล้ว จึงเก็บแค่ sortId (ไม่ต้องแยก field/direction)
  const [search, setSearch] = useState(urlSearch);
  const [sortId, setSortId] = useState<string>(urlSortId);

  // Pagination state — hydrate หน้า/page size จาก URL
  const [currentPage, setCurrentPage] = useState(urlPage);
  const [pageSize, setPageSize] = useState(urlPageSize);

  // List state รวม 6 มิติ — รูปเดียวกับที่ applications-list-state ใช้ตัดสินกฎ
  // (page reset / selection clear / request key) จึงไม่ต้องประกอบเองหลายที่
  const listState: ApplicationsListState = {
    roundId: selectedRoundId,
    search,
    status: statusFilter,
    sort: normalizeSortId(sortId),
    page: currentPage,
    pageSize,
  };
  // mirror ค่าล่าสุดสำหรับอ่านใน setter/effect ที่ไม่ depend บนทุกมิติ
  const listStateRef = useRef<ApplicationsListState>(listState);
  listStateRef.current = listState;

  // Selection state — Phase 4 state model (idle / explicit / all-filtered + excludeIds)
  // เก็บเป็น SelectionState ไม่ใช่ Set<string> เพราะ "เลือกทั้งหมดตามตัวกรอง"
  // ไม่มี id ครบในมือ (server-side pagination) → เก็บเป็น "ทั้งหมด ยกเว้นบางใบ"
  const [selection, setSelection] = useState<ApplicationsSelection>(createSelection);
  // mirror ค่าล่าสุดสำหรับอ่านใน effect ที่ไม่ depend บน selection
  const selectionRef = useRef<ApplicationsSelection>(selection);
  selectionRef.current = selection;

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

  // Bulk PDF download (Browser ZIP) — dialog phase + progress + ผลสรุป
  const [pdfBulkDialog, setPdfBulkDialog] = useState<BulkDownloadMode | null>(null);
  const [pdfBulkPhase, setPdfBulkPhase] = useState<'confirm' | 'running' | 'done' | 'canceled'>('confirm');
  const [pdfBulkProgress, setPdfBulkProgress] = useState({ done: 0, total: 0, failed: 0 });
  const [pdfBulkFailures, setPdfBulkFailures] = useState<BulkDownloadFailure[]>([]);
  const [pdfBulkSuccessCount, setPdfBulkSuccessCount] = useState(0);
  const [pdfBulkCacheStats, setPdfBulkCacheStats] = useState({ hit: 0, miss: 0, unknown: 0 });
  const pdfBulkAbortRef = useRef<AbortController | null>(null);

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
  // statusFilter → status param ให้ผลลัพธ์ตรงกับ chip ที่เห็น:
  //   สถานะเดี่ยว = enum ตรง ๆ, ทั้งหมด = ไม่ส่ง status (backend คืนทุกสถานะ ตัด DRAFT ให้)
  const handleExportExcel = async () => {
    if (!selectedRoundId || exporting || exportingSelected) return;
    setExporting(true);
    try {
      const params = new URLSearchParams();
      params.append('roundId', selectedRoundId);
      if (search.trim()) params.append('search', search.trim());
      const exportStatus = statusFilterToExportStatusParam(statusFilter);
      if (exportStatus) params.append('status', exportStatus);

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

  // Export Excel (โหมดรายการที่เลือก) — Phase 4
  // selection อยู่ข้ามหน้าได้ → explicit ส่ง applicationIds, all-filtered ส่ง selector
  // (backend รองรับ selector ตั้งแต่ Phase 2 — ไม่มีการแก้ API ในเฟสนี้)
  const handleExportSelected = async () => {
    const selector = buildSelectionSelector(selection, {
      roundId: selectedRoundId,
      statusFilter,
      search,
    });
    if (!selectedRoundId || !selector || exporting || exportingSelected) return;
    setExportingSelected(true);
    try {
      const res = await fetch(`${API_URL}/admin/applications/export-selected`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('adminToken')}`,
        },
        body: JSON.stringify(
          selector.kind === 'ids'
            ? { roundId: selectedRoundId, applicationIds: selector.ids }
            : { roundId: selectedRoundId, selector },
        ),
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

  // ── Bulk PDF download (Browser ZIP) — Phase 1 ──────────────────────────────
  // ใช้ endpoint เดิม GET /admin/applications/:id/pdf ทีละใบ (Concurrency = 2)
  // รวมเป็น ZIP ฝั่งเบราว์เซอร์ — backend ไม่ถูกแตะ, ชื่อไฟล์ต่อใบมาจาก
  // Content-Disposition (backend Source of Truth) เหมือนดาวน์โหลดรายคน
  //
  // Phase 1 (server-side list): หน่วยความจำมีแค่แถวของหน้าปัจจุบัน →
  //   - mode 'selected'  : ใช้ bulkTargets ที่สะสมไว้ (ครบทุกหน้าที่เคยเห็น)
  //   - mode 'filtered'  : ต้องดึง id + applicationNo ของ "ทุกแถวที่ตรง filter"
  //     จาก GET /applications/ids ตอนกดเริ่ม (ไม่ใช่ตอน render) แล้วค่อยรวมกับ
  //     bulkTargets ที่มี applicationNo อยู่แล้ว
  //   (Phase 2 จะเปลี่ยนไปใช้ pdf-targets endpoint — ยังไม่อยู่ใน scope นี้)

  /** ดึง id ทั้งหมดตาม filter ปัจจุบัน แล้ว map เป็น target (applicationNo ถ้ารู้) */
  const fetchFilteredTargets = async (): Promise<PdfBulkTarget[]> => {
    const params = buildApplicationsListParams({
      roundId: selectedRoundId,
      search,
      status: statusFilterToExportStatusParam(statusFilter),
      sort: sortId,
      page: 1,
      pageSize,
    });
    // endpoint /ids ไม่รับ page/pageSize — ส่งเฉพาะ filter + sort
    params.delete('page');
    params.delete('pageSize');

    const res = await fetch(`${API_URL}/admin/applications/ids?${params}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
    });
    if (!res.ok) throw new Error('ดึงรายการตามตัวกรองไม่สำเร็จ');
    const body = await res.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.data) ? body.data : [];

    const known = seenTargetsRef.current;
    return ids.map((id) => known.get(id) ?? { id, applicationNo: null });
  };

  const openPdfBulkDialog = (mode: BulkDownloadMode) => {
    setPdfBulkDialog(mode);
    setPdfBulkPhase('confirm');
    setPdfBulkProgress({ done: 0, total: 0, failed: 0 });
    setPdfBulkFailures([]);
    setPdfBulkSuccessCount(0);
  };

  const closePdfBulkDialog = () => {
    if (pdfBulkPhase === 'running') return; // ต้องกดยกเลิกก่อนเสมอ
    setPdfBulkDialog(null);
  };

  const startPdfBulkDownload = async () => {
    if (!pdfBulkDialog || pdfBulkPhase === 'running') return;

    // Phase 4: mode 'selected' แยกตาม state
    //   explicit     → ใช้ bulkTargets ที่สะสมไว้ (id ครบในมือ)
    //   all-filtered → ต้องดึง id ตามตัวกรองก่อน แล้วตัด excludeIds ออก
    // mode 'filtered' ต้องรู้ target ครบทุกหน้า — ดึงก่อนแล้วค่อย resolve
    const needsFilteredIds =
      pdfBulkDialog === 'filtered' ||
      (pdfBulkDialog === 'selected' && selection.state === 'all-filtered');

    let targets = bulkTargets;
    if (needsFilteredIds) {
      try {
        targets = await fetchFilteredTargets();
      } catch (error) {
        console.error('Bulk PDF filtered targets error:', error);
        alert(error instanceof Error ? error.message : 'ดึงรายการตามตัวกรองไม่สำเร็จ');
        return;
      }
    }

    // ชุด id ที่จะดาวน์โหลดจริง
    let selectedIdSet: Set<string>;
    if (pdfBulkDialog === 'filtered') {
      selectedIdSet = new Set(targets.map((t) => t.id));
    } else if (selection.state === 'all-filtered') {
      selectedIdSet = new Set(
        targets.map((t) => t.id).filter((id) => isRowSelected(selection, id)),
      );
    } else {
      selectedIdSet = new Set(selection.ids);
    }

    const resolved = resolveBulkTarget(pdfBulkDialog, targets, selectedIdSet);
    if (!resolved.ok) return; // dialog จะ disable ปุ่มไว้ก่อนแล้ว

    setPdfBulkPhase('running');
    setPdfBulkProgress({ done: 0, total: resolved.targets.length, failed: 0 });
    const controller = new AbortController();
    pdfBulkAbortRef.current = controller;

    const result = await bulkDownloadPdfs({
      targets: resolved.targets,
      zipFilename: buildBulkZipFilename(selectedRound?.roundCode),
      signal: controller.signal,
      onProgress: (p) => setPdfBulkProgress(p),
      fetchPdf: (target, signal) =>
        fetch(`${API_URL}/admin/applications/${target.id}/pdf`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
          signal,
        }),
    });
    pdfBulkAbortRef.current = null;
    setPdfBulkSuccessCount(result.successCount);
    setPdfBulkFailures(result.failures);
    setPdfBulkCacheStats(result.cacheStats);

    if (result.status === 'canceled') {
      setPdfBulkPhase('canceled');
      return;
    }
    if (result.zip) {
      const url = URL.createObjectURL(result.zip);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.zipFilename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
    setPdfBulkPhase('done');
  };

  const cancelPdfBulkDownload = () => {
    pdfBulkAbortRef.current?.abort();
  };

  // Fetch rounds
  // ⚠️ ทุกเส้นทางต้องจบที่ setRoundsStatus('ready' | 'error') — ห้ามมีทางที่ค้าง 'loading'
  //   (เดิม: ไม่มี .catch() เลย → 401/403/network error ทำให้ selectedRoundId ว่างตลอด
  //    และ fetchData early-return → loading ค้าง true → "กำลังโหลด..." ไม่มีวันหาย)
  useEffect(() => {
    const view = showArchived ? 'all' : 'active';
    let cancelled = false;

    setRoundsStatus('loading');
    setRoundsError(null);

    const loadRounds = async () => {
      try {
        const res = await fetch(`${API_URL}/admin/rounds?view=${view}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` }
        });
        if (!res.ok) {
          throw new Error(`โหลดรอบรับสมัครไม่สำเร็จ (HTTP ${res.status})`);
        }
        const res2 = await res.json();
        if (cancelled) return;

        const roundList: Round[] = Array.isArray(res2?.data) ? res2.data : [];
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
        // ไม่มีรอบให้เลือก = จบแล้ว (ไม่ใช่ loading) — หน้าจะแสดง empty state
        setRoundsStatus('ready');
      } catch (error) {
        if (cancelled) return;
        console.error('Error fetching rounds:', error);
        setRounds([]);
        setSelectedRoundId('');
        setRoundsError(error instanceof Error ? error.message : 'โหลดรอบรับสมัครไม่สำเร็จ');
        setRoundsStatus('error');
      }
    };

    loadRounds();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived, roundsReloadKey]);

  // Sync URL เมื่อผู้ใช้เปลี่ยน Round
  useEffect(() => {
    if (!selectedRoundId) return;
    if (urlRoundId === selectedRoundId) return;
    updateUrl({ round: selectedRoundId });
    localStorage.setItem('applications:lastRoundId', selectedRoundId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoundId]);

  // Fetch applications and summary
  // Phase 1 (server-side pagination):
  //   - ส่ง roundId/search/status/sort/page/pageSize ขึ้น server ทุกครั้ง
  //   - status filter ย้ายไป server (ไม่กรองฝั่ง client แล้ว)
  //   - total/totalPages มาจาก response (pagination) ไม่ใช่ apps.length
  //   - ⚠️ ห้ามล้าง selection ที่นี่ — เปลี่ยนหน้า/เรียง/รีเฟรช ต้องคง selection
  //     เดิม (การล้างเกิดเฉพาะตอน filter/รอบเปลี่ยน ซึ่งมี effect แยกอยู่แล้ว)
  //   - ⚠️ stale guard (Phase 3): request key = { roundId, q, status, sort, page,
  //     pageSize } เปลี่ยน filter แล้ว page reset เป็น 1 ใน effect ถัดไป →
  //     มีได้ 2 request พร้อมกัน (หน้าเก่า + หน้า 1) response ที่กลับมาทีหลัง
  //     อาจเป็นของ request เก่า → ต้องทิ้ง ไม่ให้ทับ state ของ request ล่าสุด
  //     ใช้ทั้ง request guard (ตัดสินว่าจะเขียน state ไหม) และ AbortController
  //     (ยกเลิก network ของ request ที่ตกยุคไปแล้ว)
  const requestGuardRef = useRef(createRequestGuard());
  const listAbortRef = useRef<AbortController | null>(null);
  const fetchData = useCallback(async () => {
    // ไม่มีรอบให้ยิง = ไม่มีอะไรให้โหลด → ต้องปลด loading เสมอ
    // (เดิม return เฉย ๆ → loading ค้าง true ตลอดกาล เพราะ setLoading(false) อยู่หลังจุดนี้)
    if (!selectedRoundId) {
      setLoading(false);
      return;
    }

    const requestState: ApplicationsListState = {
      roundId: selectedRoundId,
      search,
      status: statusFilter,
      sort: sortId as ApplicationsSortId,
      page: currentPage,
      pageSize,
    };
    const guard = requestGuardRef.current;
    const requestKey = guard.begin(requestState);

    // ยกเลิก request ก่อนหน้าที่ค้างอยู่ — ไม่ให้เสีย bandwidth และไม่ให้
    // response เก่าแวบเข้ามาเขียน state ก่อน guard จะได้ตัดสิน
    listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;

    setLoading(true);
    const token = localStorage.getItem('adminToken');

    try {
      const params = buildApplicationsListParams({
        roundId: selectedRoundId,
        search,
        status: statusFilterToExportStatusParam(statusFilter),
        sort: sortId,
        page: currentPage,
        pageSize,
      });

      const [appsRes, summaryRes] = await Promise.all([
        fetch(`${API_URL}/admin/applications?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        }),
        fetch(`${API_URL}/admin/applications/summary?roundId=${selectedRoundId}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        })
      ]);

      const appsData = await appsRes.json();
      const summaryData = await summaryRes.json();

      if (!guard.isCurrent(requestKey)) return; // มี request ใหม่กว่าแล้ว — ทิ้งผลนี้

      setApps(appsData.data || []);
      setPagination(readPagination(appsData, currentPage, pageSize));
      setSummary(summaryData.data || { total: 0, byStatus: {} });
    } catch (error) {
      // abort = ผู้ใช้เปลี่ยนตัวกรอง/หน้าเร็ว ๆ — ไม่ใช่ error ที่ต้องรายงาน
      if (controller.signal.aborted) return;
      if (!guard.isCurrent(requestKey)) return;
      console.error('Error fetching data:', error);
    } finally {
      // ⚠️ ปลด loading เสมอเมื่อ request นี้ยังเป็นตัวล่าสุด
      //   (เดิม: ถ้า response เก่ากลับมาทีหลัง guard จะไม่ปลด loading ของ request นั้น
      //    ซึ่งถูกต้องเพราะมี request ใหม่กว่าเป็นเจ้าของ loading อยู่แล้ว)
      if (guard.isCurrent(requestKey)) setLoading(false);
    }
  }, [selectedRoundId, search, statusFilter, sortId, currentPage, pageSize, API_URL]);

  // ยกเลิก request ที่ค้างอยู่ตอน unmount — กัน setState บน component ที่ถูกล้าง
  useEffect(() => () => listAbortRef.current?.abort(), []);

  // Reset กลับหน้า 1 เมื่อตัวกรอง/รอบ/การเรียงเปลี่ยน
  // Phase 1.1: กฎทั้งหมดมาจาก applications-list-state (isPageResettingChange /
  // isInitialRoundHydration) — ไม่ประกาศซ้ำใน component อีก
  // ⚠️ mount แรก (prev === null) ต้อง "ไม่ reset" — หน้าปัจจุบันเพิ่ง restore จาก URL
  // ⚠️ roundId จาก '' → รอบแรกที่โหลดเสร็จ ก็เป็นการ "init" หลัง restore เช่นกัน
  //   (กด Back กลับมา selectedRoundId เริ่มจาก '' แล้วค่อย set จาก URL ทีหลัง
  //    ถ้าถือเป็นการเปลี่ยนรอบ → จะเคลียร์ page ที่ restore มาทิ้ง = กลับหน้า 1 เสมอ)
  const prevListStateRef = useRef<ApplicationsListState | null>(null);
  useEffect(() => {
    const prev = prevListStateRef.current;
    prevListStateRef.current = listState;
    if (!prev) return;
    // init หลัง restore จาก URL ไม่ใช่การเปลี่ยนตัวกรองของผู้ใช้ → ห้าม reset page
    if (isInitialRoundHydration(prev, listState)) return;
    if (!isPageResettingChange(prev, listState)) return;
    setCurrentPage(1);
    updateUrlFromState(buildListStateUrlPatch({ ...listState, page: 1 }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoundId, search, sortId, statusFilter, updateUrlFromState]);

  // Policy การเลือก: selection คงอยู่ข้ามหน้า/การเรียงลำดับ แต่ถูกล้างเมื่อ
  // เปลี่ยนรอบรับสมัคร (เสมอ) หรือเปลี่ยนตัวกรอง search/สถานะ — พร้อมแจ้งเหตุผล
  // Phase 1.1: ตัดสินด้วย shouldClearSelection() ตัวเดียวกับที่เทสต์ไว้
  // (ต้องประกาศก่อน effect เรียก fetchData เพื่อให้ล้าง+แจ้งก่อน reset ใน fetch)
  const prevFilterStateRef = useRef<ApplicationsListState | null>(null);
  useEffect(() => {
    const prev = prevFilterStateRef.current;
    prevFilterStateRef.current = listState;
    if (!prev) return; // render แรกหลัง mount ยังไม่มีตัวกรองเดิมให้เทียบ
    if (!shouldClearSelection(prev, listState)) return;
    const roundChanged = prev.roundId !== selectedRoundId;
    const size = resolveSelectedCount(selectionRef.current, pagination.total);
    if (size === 0) return;
    setSelection(clearSelection());
    setSelectionNotice(
      `ล้างการเลือก ${size} รายการ เนื่องจาก${roundChanged ? 'เปลี่ยนรอบรับสมัคร' : 'ตัวกรอง (ค้นหา/สถานะ) เปลี่ยน'}`,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoundId, search, statusFilter]);

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

  // Bulk status update — Phase 4
  // explicit → ส่ง ids (รูปเดิม), all-filtered → ส่ง selector (backend รองรับตั้งแต่ Phase 2)
  const handleBulkStatusUpdate = async () => {
    const selector = buildSelectionSelector(selection, {
      roundId: selectedRoundId,
      statusFilter,
      search,
    });
    if (!bulkStatus || !selector) return;

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
          ...(selector.kind === 'ids' ? { ids: selector.ids } : { selector }),
          status: bulkStatus,
          reason: (bulkStatus === 'REJECTED' || bulkStatus === 'CANCELED') ? bulkReason.trim() : undefined
        })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setShowBulkModal(false);
        setBulkStatus('');
        setBulkReason('');
        // Phase 1.1 — behavior ที่เลือก: "ล้าง selection หลัง bulk status สำเร็จ"
        // เหตุผล: ชุดที่เพิ่งเปลี่ยนสถานะอาจหลุดออกจากตัวกรองปัจจุบัน (เช่นกรอง
        // SUBMITTED แล้วเปลี่ยนเป็น QUALIFIED) → ถ้าคง selection ไว้ ผู้ใช้กดซ้ำ
        // จะยิงชุดเดิมที่มองไม่เห็นแล้ว. เดิม (ก่อน Phase 1) พฤติกรรมนี้เกิดจาก
        // setSelectedIds(new Set()) ใน fetchData; ตอนนี้ fetchData ไม่ล้างแล้ว
        // จึงต้องล้างที่จุดนี้จุดเดียว — ไม่ใช่ทุก refetch (page/sort ยังคง selection)
        setSelection(clearSelection());
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

  // Sort options — 4 ตัวเดิม (ย้ายไป lib เพื่อให้ parse/normalize อยู่ที่เดียว)
  const sortOptions = [...APPLICATIONS_SORT_OPTIONS];

  // Phase 1: sort + pagination ทำที่ server แล้ว
  // `apps` = แถวของหน้าปัจจุบันตามลำดับที่ server ส่งมา (ห้าม sort/slice ซ้ำฝั่ง client
  // ไม่งั้นลำดับจะไม่ตรงกับ server และข้ามหน้าจะมีแถวซ้ำ/หาย)
  const pageApps = apps;
  const totalItems = pagination.total;
  const totalPages = pagination.totalPages;

  // กันหน้าเกินช่วงจริง (เช่น page ใน URL มากกว่าจำนวนหน้าหลังข้อมูลเปลี่ยน)
  // ⚠️ ข้ามตอน loading — ยังไม่มีข้อมูลชุดใหม่ ห้าม clamp ด้วยข้อมูลเก่า
  // ⚠️ ใช้ totalPages จาก server (ไม่คำนวณจาก apps.length ซึ่งเป็นแค่หน้าปัจจุบัน)
  useEffect(() => {
    if (loading) return;
    // Phase 1.1: resolvePageAfterResponse = clampPage ของ applications-list-params
    // (ชื่อสื่อความหมายของงาน: "หลังได้ totalPages จาก server") — กฎเดียว ไม่ประกาศซ้ำ
    const target = resolvePageAfterResponse(currentPage, totalPages);
    if (target !== null) handlePageChange(target);
  }, [loading, totalPages, currentPage, handlePageChange]);

  // Selection handlers — Phase 4 state model
  // Header checkbox = "เลือกทั้งหมดตามตัวกรอง" (ทุกหน้า ไม่ใช่แค่หน้านี้)
  // หลัง Phase 3 หน้านี้เห็นแค่แถวของหน้าปัจจุบัน → all-filtered เก็บเป็น
  // "ทั้งหมด ยกเว้น excludeIds" ไม่ต้องมี id ครบในมือ
  const pageIds = useMemo(() => apps.map((app) => app.id), [apps]);

  // Bulk PDF (Browser ZIP) — target ตามลำดับที่แสดงบนจอ, แนบ applicationNo
  // เพื่อให้ fallback ชื่อไฟล์ต่อใบตรงกับดาวน์โหลดรายคนพอดี
  // Phase 1: ต้องสะสม applicationNo ของแถวที่เคยเห็น (ข้ามหน้า) ไว้ด้วย
  // ไม่งั้นใบที่เลือกจากหน้าอื่นจะตกไปใช้ fallback ชื่อ = id
  const seenTargetsRef = useRef<Map<string, PdfBulkTarget>>(new Map());
  const bulkTargets = useMemo<PdfBulkTarget[]>(() => {
    const map = seenTargetsRef.current;
    for (const app of apps) {
      map.set(app.id, { id: app.id, applicationNo: app.applicationNo });
    }
    return Array.from(map.values());
  }, [apps]);

  // ยอดรวมตามตัวกรองจาก server — ใช้เป็นฐานของ all-filtered (client ไม่มี id ครบ)
  const selectedCount = resolveSelectedCount(selection, totalItems);
  const allFilteredSelected = isHeaderChecked(selection, pageIds, totalItems);
  const someFilteredSelected = isHeaderIndeterminate(selection, pageIds, totalItems);
  const selectionBlocker = describeSelectionBlocker(selection, {
    roundId: selectedRoundId,
    statusFilter,
    search,
  });

  const toggleSelectAll = () => {
    setSelection(toggleHeader(selection, pageIds, totalItems));
  };

  const toggleSelect = (id: string) => {
    setSelection(toggleRow(selection, id, totalItems));
  };

  // จำนวนต่อ chip ตามสถานะ (จาก summary ของรอบปัจจุบัน — ไม่ขึ้นกับ search)
  const statusCounts: Record<StatusFilterValue, number> = {
    ALL: summary.total,
    SUBMITTED: summary.byStatus.SUBMITTED || 0,
    QUALIFIED: summary.byStatus.QUALIFIED || 0,
    REJECTED: summary.byStatus.REJECTED || 0,
    CANCELED: summary.byStatus.CANCELED || 0,
    ARCHIVED: summary.byStatus.ARCHIVED || 0,
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
      {selectedCount > 0 && canWrite && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-700">
              {describeSelectionCount(selection, totalItems)}
            </span>
            <button
              onClick={() => setSelection(clearSelection())}
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
              disabled={!canSubmitSelection(selection, {
                roundId: selectedRoundId,
                statusFilter,
                search,
              })}
              title={selectionBlocker ?? undefined}
            >
              เปลี่ยนสถานะ
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
                onChange={handleSearchChange}
                placeholder="ค้นหาชื่อ, อีเมล, เลขใบสมัคร..."
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

          {/* Row 2: Filter Pills + Export + Result Count */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 flex-wrap">
              {STATUS_FILTER_OPTIONS.map((option) => (
                <FilterPill
                  key={option.value}
                  label={option.label}
                  isActive={statusFilter === option.value}
                  onClick={() => handleStatusFilterChange(option.value)}
                  count={statusCounts[option.value]}
                />
              ))}
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
                    disabled={selectedCount === 0 || exporting || exportingSelected || !selectedRoundId || !canSubmitSelection(selection, { roundId: selectedRoundId, statusFilter, search })}
                    title={selectionBlocker ?? 'ส่งออกเฉพาะใบสมัครที่เลือก (รวมทุกหน้า) เป็นไฟล์ Excel'}
                  >
                    <span aria-hidden>📑</span>
                    {exportingSelected ? 'กำลังสร้าง Excel...' : `Export ที่เลือก (${selectedCount})`}
                  </Button>
                </>
              )}
              {/* Bulk PDF (Browser ZIP) — ใช้ได้ทุก role เช่นเดียวกับ PDF รายคน */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => openPdfBulkDialog('selected')}
                disabled={selectedCount === 0 || pdfBulkDialog !== null}
                title="ดาวน์โหลด PDF เฉพาะใบสมัครที่เลือก (รวมทุกหน้า) เป็นไฟล์ ZIP"
              >
                <span aria-hidden>📄</span>
                ดาวน์โหลด PDF ที่เลือก ({selectedCount})
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openPdfBulkDialog('filtered')}
                disabled={totalItems === 0 || pdfBulkDialog !== null}
                title="ดาวน์โหลด PDF ทุกใบที่ตรงตัวกรองปัจจุบัน (ทุกหน้า) เป็นไฟล์ ZIP"
              >
                <span aria-hidden>🗂️</span>
                ดาวน์โหลด PDF ตามตัวกรอง ({totalItems})
              </Button>
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
              {roundsStatus === 'error' ? (
                // rounds ล้มเหลว → บอกให้ชัด + ทางลองใหม่ (ห้ามค้าง spinner)
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    <div className="flex flex-col items-center justify-center gap-2 text-slate-600">
                      <span className="text-sm font-medium">โหลดรายการรอบรับสมัครไม่สำเร็จ</span>
                      <span className="text-xs text-slate-500">{roundsError}</span>
                      <button
                        type="button"
                        onClick={() => setRoundsReloadKey((k) => k + 1)}
                        className="mt-1 text-xs font-medium text-blue-600 hover:text-blue-800 underline"
                      >
                        ลองอีกครั้ง
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : roundsStatus === 'ready' && !selectedRoundId ? (
                // โหลดรอบจบแล้วแต่ไม่มีรอบให้เลือก → จบ ไม่ใช่ loading
                <TableRow>
                  <TableCell colSpan={7} className="py-0">
                    <NoDataEmptyState
                      title="ไม่พบรอบรับสมัคร"
                      description={showArchived
                        ? 'ยังไม่มีรอบรับสมัครในระบบ'
                        : 'ยังไม่มีรอบรับสมัครที่เปิดใช้งาน — ลองเปิด "แสดงรอบที่จัดเก็บแล้ว"'}
                    />
                  </TableCell>
                </TableRow>
              ) : loading || roundsStatus === 'loading' ? (
                // loading ของ list หรือ "ยังรอ rounds อยู่" → spinner (ยังไม่รู้ผล ห้ามสรุปว่าว่าง)
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
                      <NoResultsEmptyState keyword={search} onClearFilters={() => handleSearchChange('')} />
                    ) : (
                      <NoDataEmptyState
                        title="ไม่พบใบสมัคร"
                        description={statusFilter !== 'ALL'
                          ? 'ไม่มีใบสมัครสถานะนี้ในรอบที่เลือก'
                          : 'ยังไม่มีใบสมัครในรอบนี้'}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                pageApps.map((app) => {
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
                          checked={isRowSelected(selection, app.id)}
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
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">📝 เปลี่ยนสถานะ ({selectedCount} รายการ)</h2>

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

      {/* ============================================ */}
      {/* 6. MODAL - Bulk PDF Download (Browser ZIP) */}
      {/* ============================================ */}
      {pdfBulkDialog && (() => {
        // Phase 4: mode 'filtered' = ทุกแถวที่ตรง filter (total จาก server)
        // mode 'selected' = จำนวนที่เลือกจริง (all-filtered หัก excludeIds แล้ว)
        const count = pdfBulkDialog === 'filtered'
          ? totalItems
          : selectedCount;
        const overLimit = count > BULK_PDF_LIMIT;
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              {pdfBulkPhase === 'confirm' && (
                <>
                  <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                    📄 ดาวน์โหลด PDF {pdfBulkDialog === 'selected' ? 'ที่เลือก' : 'ตามตัวกรอง'}
                  </h2>
                  <div className="text-sm text-slate-700 space-y-2 mb-4">
                    <p>
                      จำนวนรายการ <span className="font-semibold tabular-nums">{count}</span> ใบ
                    </p>
                    <p>
                      ขนาดโดยประมาณ{' '}
                      <span className="font-semibold">{formatBulkEstimate(count)}</span>{' '}
                      <span className="text-xs text-slate-500">(ประมาณการ ~200KB ต่อใบ ขึ้นกับเอกสารจริง)</span>
                    </p>
                    {overLimit && (
                      <p className="bg-red-50 border border-red-200 rounded-md px-3 py-2 text-xs text-red-700">
                        เกินจำนวนสูงสุด {BULK_PDF_LIMIT} รายการต่อครั้ง — กรุณากรองให้แคบลง
                        หรือแบ่งดาวน์โหลดเป็นหลายรอบ
                      </p>
                    )}
                    {!overLimit && count >= BULK_PDF_NEAR_LIMIT && (
                      <p className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs text-amber-800">
                        ⚠️ ใกล้จำนวนสูงสุด ({BULK_PDF_LIMIT} รายการ) — การดาวน์โหลดอาจใช้เวลานาน
                        และห้ามปิดหน้าเบราว์เซอร์ระหว่างทำงาน
                      </p>
                    )}
                    <p className="text-xs text-slate-500">
                      ระบบจะดาวน์โหลดทีละใบแล้วรวมเป็นไฟล์ ZIP เดียว หากบางใบสร้างไม่สำเร็จ
                      ระบบจะข้ามใบนั้นและสรุปผลเมื่อเสร็จ
                    </p>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" onClick={closePdfBulkDialog}>
                      ยกเลิก
                    </Button>
                    <Button onClick={startPdfBulkDownload} disabled={count === 0 || overLimit}>
                      เริ่มดาวน์โหลด
                    </Button>
                  </div>
                </>
              )}

              {pdfBulkPhase === 'running' && (
                <>
                  <h2 className="text-lg font-bold mb-4 flex items-center gap-2">⏳ กำลังดาวน์โหลด</h2>
                  <div className="text-sm text-slate-700 space-y-3 mb-4">
                    <p className="tabular-nums">
                      กำลังดาวน์โหลด <span className="font-semibold">{pdfBulkProgress.done}</span> /{' '}
                      <span className="font-semibold">{pdfBulkProgress.total}</span> ใบ
                      {pdfBulkProgress.failed > 0 && (
                        <span className="text-amber-700"> · ล้มเหลว {pdfBulkProgress.failed} ใบ</span>
                      )}
                    </p>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all"
                        style={{
                          width: pdfBulkProgress.total > 0
                            ? `${Math.min(100, (pdfBulkProgress.done / pdfBulkProgress.total) * 100)}%`
                            : '0%',
                        }}
                      />
                    </div>
                    <p className="text-xs text-slate-500">ห้ามปิดหรือรีเฟรชหน้านี้จนกว่าจะเสร็จ</p>
                  </div>
                  <div className="flex justify-end">
                    <Button variant="outline" onClick={cancelPdfBulkDownload}>
                      ยกเลิกการดาวน์โหลด
                    </Button>
                  </div>
                </>
              )}

              {pdfBulkPhase === 'done' && (
                <>
                  <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                    {pdfBulkSuccessCount > 0 ? '✅ ดาวน์โหลดเสร็จสิ้น' : '❌ ดาวน์โหลดไม่สำเร็จ'}
                  </h2>
                  <div className="text-sm text-slate-700 space-y-2 mb-4">
                    <p>
                      สำเร็จ <span className="font-semibold text-emerald-700 tabular-nums">{pdfBulkSuccessCount}</span>{' '}
                      รายการ · ล้มเหลว{' '}
                      <span className={cn('font-semibold tabular-nums', pdfBulkFailures.length > 0 ? 'text-red-700' : 'text-slate-500')}>
                        {pdfBulkFailures.length}
                      </span>{' '}
                      รายการ
                    </p>
                    {pdfBulkSuccessCount > 0 && (
                      <>
                        <p className="text-xs text-slate-500">
                          ไฟล์ ZIP ถูกบันทึกในโฟลเดอร์ดาวน์โหลดของเบราว์เซอร์แล้ว
                          {pdfBulkCacheStats.hit + pdfBulkCacheStats.miss > 0 && (
                            <> · Cache: HIT {pdfBulkCacheStats.hit} / MISS {pdfBulkCacheStats.miss}</>
                          )}
                        </p>
                      </>
                    )}
                    {pdfBulkFailures.length > 0 && (
                      <div className="bg-red-50 border border-red-200 rounded-md px-3 py-2 text-xs text-red-700 max-h-40 overflow-y-auto">
                        <p className="font-semibold mb-1">รายการที่ล้มเหลว (อาจถูกลบหรือเกิดข้อผิดพลาดชั่วคราว):</p>
                        <ul className="list-disc list-inside space-y-0.5">
                          {pdfBulkFailures.map((f) => (
                            <li key={f.id}>
                              {f.applicationNo || f.id} — {f.status}
                              {f.cause ? ` (${f.cause})` : ''}
                              {f.durationMs !== undefined ? ` · ${f.durationMs}ms` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end">
                    <Button onClick={closePdfBulkDialog}>ปิด</Button>
                  </div>
                </>
              )}

              {pdfBulkPhase === 'canceled' && (
                <>
                  <h2 className="text-lg font-bold mb-4 flex items-center gap-2">🚫 ยกเลิกการดาวน์โหลด</h2>
                  <div className="text-sm text-slate-700 space-y-2 mb-4">
                    <p>
                      ดาวน์โหลดสำเร็จไปแล้ว{' '}
                      <span className="font-semibold tabular-nums">{pdfBulkSuccessCount}</span> รายการก่อนยกเลิก
                      — ไม่มีไฟล์ ZIP ถูกสร้าง
                    </p>
                    <p className="text-xs text-slate-500">
                      เริ่มดาวน์โหลดใหม่ได้เสมอ — ใบที่เคยสร้างแล้วจะถูกใช้จาก cache ทำให้เร็วขึ้น
                    </p>
                  </div>
                  <div className="flex justify-end">
                    <Button onClick={closePdfBulkDialog}>ปิด</Button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
