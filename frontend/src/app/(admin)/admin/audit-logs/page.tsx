'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SearchInput } from '@/components/ui/search-input';
import { FilterDropdown } from '@/components/ui/filter-dropdown';
import { Pagination } from '@/components/ui/pagination';
import { NoDataEmptyState, NoResultsEmptyState } from '@/components/ui/empty-state';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useRole } from '@/lib/useRole';
import {
  getAuditActionConfig,
  getAuditEntityLabel,
  shortId,
  resolveAuditEntity,
  buildAuditDescription,
  type AuditLogForDisplay,
} from '@/lib/audit-log-display';

// =============================================================================
// Types
// =============================================================================

interface AuditLog extends AuditLogForDisplay {
  id: string;
  adminId: string;
  adminEmail?: string; // Resolved from lookup
  payload: string | null;
  ipAddress: string | null;
  createdAt: string | number | Date;
}

interface AuditLogsResponse {
  items: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Change Tracking Types
interface FieldChange {
  field: string;
  fieldLabel: string;
  oldValue: string | null;
  newValue: string | null;
}

interface ParsedPayload {
  changes?: FieldChange[];
  summary?: string;
  [key: string]: any;
}

// =============================================================================
// Design Tokens (Smart Family Style - ใช้ร่วมกับหน้าอื่นในระบบ)
// =============================================================================

const CARD_STYLE = {
  container: 'bg-white rounded-xl border border-slate-200 shadow-sm',
  header: 'px-4 py-3 border-b border-slate-100',
  body: 'px-4 py-3',
};

// Action Badge Config / Entity Label / shortId — ใช้ resolver กลางจาก
// @/lib/audit-log-display (ครบทุก action รวม PDF_DOWNLOAD, EXPORT_EXCEL)

// รายการ Action ที่ใช้ใน Filter (ค่าคงที่ — ไม่ขึ้นกับ data เพราะ data มีแค่หน้าปัจจุบัน)
// NOTE: CREATE_USER เพิ่มเข้ามา (P0 fix) — action เฉพาะของการสร้างผู้ใช้
// NOTE: LOGIN/LOGIN_FAILED/ACCOUNT_LOCKED — login audit จาก writeLoginAudit
const ACTION_OPTIONS = [
  'CREATE',
  'CREATE_USER',
  'UPDATE',
  'DELETE',
  'PDF_DOWNLOAD',
  'EXPORT_EXCEL',
  'LOGIN',
  'LOGIN_FAILED',
  'ACCOUNT_LOCKED',
] as const;

// รายการ Entity ทั้งหมด (จาก requirement)
const ENTITY_OPTIONS = [
  'RECRUITMENT_ROUND',
  'ROUND_CLONED',
  'TEMPLATE',
  'TEMPLATE_VERSION',
  'TEMPLATE_VERSION_DESCRIPTOR',
  'FIELD_MASTER',
  'APPLICATION',
  'POSITION',
  'ORGANIZATION',
  'JOB_FAMILY',
  'POSITION_LEVEL',
  'ADMIN_USER',
] as const;

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 50;

// =============================================================================
// Entity Lookup Maps
// โหลดครั้งเดียวต่อ entity type → ใช้ O(1) lookup ตอน render
// =============================================================================

type EntityLookup = Record<string, string>; // entityId -> "ชื่อจริง"
type AdminLookup = Record<string, string>; // adminId -> email

interface LookupBundle {
  ROUND: EntityLookup;
  TEMPLATE: EntityLookup;
  FIELD_MASTER: EntityLookup;
  ORGANIZATION: EntityLookup;
  JOB_FAMILY: EntityLookup;
  POSITION_LEVEL: EntityLookup;
  POSITION: EntityLookup;
  ADMIN: AdminLookup;
}

const EMPTY_LOOKUP: LookupBundle = {
  ROUND: {},
  TEMPLATE: {},
  FIELD_MASTER: {},
  ORGANIZATION: {},
  JOB_FAMILY: {},
  POSITION_LEVEL: {},
  POSITION: {},
  ADMIN: {},
};

async function loadAllLookups(apiUrl: string, token: string): Promise<LookupBundle> {
  const headers = { Authorization: `Bearer ${token}` };

  const safeJson = async (res: Response) => {
    try {
      return (await res.json()) as { data?: any[] };
    } catch {
      return { data: [] };
    }
  };

  const fetchMap = async (
    url: string,
    pick: (item: any) => string,
    fallback = ''
  ): Promise<EntityLookup> => {
    try {
      const res = await fetch(url, { headers });
      const json = await safeJson(res);
      const map: EntityLookup = {};
      for (const item of json.data || []) {
        const name = pick(item);
        if (item?.id) map[item.id] = name || fallback;
      }
      return map;
    } catch {
      return {};
    }
  };

  const [
    ROUND,
    TEMPLATE,
    FIELD_MASTER,
    ORGANIZATION,
    JOB_FAMILY,
    POSITION_LEVEL,
    POSITION,
    ADMIN,
  ] = await Promise.all([
    fetchMap(`${apiUrl}/admin/rounds?view=all`, (r) => `${r.title} (${r.positionLevel})`),
    fetchMap(`${apiUrl}/admin/templates?view=all`, (t) => t.name || t.title || 'Template'),
    fetchMap(`${apiUrl}/admin/fields`, (f) => f.labelTh || f.label || f.fieldType),
    fetchMap(`${apiUrl}/admin/organizations`, (o) => o.name),
    fetchMap(`${apiUrl}/admin/job-families`, (j) => j.name),
    fetchMap(`${apiUrl}/admin/position-levels`, (p) => p.name),
    fetchMap(`${apiUrl}/admin/positions`, (p) => p.title),
    fetchMap(`${apiUrl}/admin/users`, (u: any) => u.email, ''),
  ]);

  return { ROUND, TEMPLATE, FIELD_MASTER, ORGANIZATION, JOB_FAMILY, POSITION_LEVEL, POSITION, ADMIN };
}

const ENTITY_TO_LOOKUP: Record<string, keyof LookupBundle> = {
  RECRUITMENT_ROUND: 'ROUND',
  ROUND_CLONED: 'ROUND',
  TEMPLATE: 'TEMPLATE',
  FIELD_MASTER: 'FIELD_MASTER',
  ORGANIZATION: 'ORGANIZATION',
  JOB_FAMILY: 'JOB_FAMILY',
  POSITION_LEVEL: 'POSITION_LEVEL',
  POSITION: 'POSITION',
};

// =============================================================================
// Helpers
// =============================================================================

function formatDateTime(value: string | number | Date): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function resolveAdminEmail(adminId: string, adminLookup: AdminLookup): string {
  return adminLookup[adminId] || adminId;
}

function parsePayload(payload: string | null | undefined): ParsedPayload | null {
  if (!payload) return null;
  if (typeof payload !== 'string') return payload as ParsedPayload;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function hasChangeTracking(payload: ParsedPayload | null): boolean {
  return payload !== null && Array.isArray(payload.changes) && payload.changes.length > 0;
}

function getChangeSummary(payload: ParsedPayload | null): string {
  if (!payload) return '';
  if (payload.summary) return payload.summary;
  if (payload.changes && payload.changes.length > 0) {
    if (payload.changes.length === 1) {
      const change = payload.changes[0];
      return `${change.fieldLabel}: ${change.oldValue ?? '-'} → ${change.newValue ?? '-'}`;
    }
    return `${payload.changes.length} รายการ`;
  }
  return '';
}

/**
 * Truncates long strings for table display
 */
function truncateForTable(text: string | null | undefined, maxLength: number = 30): string {
  if (!text) return '-';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Gets a short summary for table display
 * Shows field name + truncated values: "ชื่อ: สำนัก... → สำนัก..."
 */
function getTableChangeSummary(payload: ParsedPayload | null): string {
  if (!payload || !payload.changes || payload.changes.length === 0) return '';
  
  if (payload.changes.length === 1) {
    const change = payload.changes[0];
    const oldVal = truncateForTable(change.oldValue, 15);
    const newVal = truncateForTable(change.newValue, 15);
    return `${change.fieldLabel}: ${oldVal} → ${newVal}`;
  }
  
  return `${payload.changes.length} รายการ`;
}

// buildDescription — ใช้ buildAuditDescription จาก lib/audit-log-display
// (คง parsePayload ไว้ที่นี่เพราะต้องอ่าน log.payload จาก response)

// =============================================================================
// Page
// =============================================================================

export default function AuditLogsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // RBAC guard (RBAC v1): Audit Logs เข้าได้เฉพาะ SUPER_ADMIN เท่านั้น
  // ตาม RBAC matrix ใหม่: ADMIN และ VIEWER ห้ามเข้าถึง
  const { isSuperAdmin } = useRole();

  // URL State — page/pageSize/search/filter อยู่ใน URL ทั้งหมด
  // (ออกจากหน้าแล้วกด Back → remount → hydrate จาก URL → ได้ตำแหน่งเดิม)
  const urlSearch = searchParams.get('q') || '';
  const urlPage = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const urlPageSizeRaw = parseInt(searchParams.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE;
  const urlPageSize = PAGE_SIZE_OPTIONS.includes(urlPageSizeRaw) ? urlPageSizeRaw : DEFAULT_PAGE_SIZE;
  const urlActionFilters = (searchParams.get('action') || '')
    .split(',')
    .filter((v): v is (typeof ACTION_OPTIONS)[number] => (ACTION_OPTIONS as readonly string[]).includes(v));
  const urlEntityFilters = (searchParams.get('entity') || '')
    .split(',')
    .filter((v): v is (typeof ENTITY_OPTIONS)[number] => (ENTITY_OPTIONS as readonly string[]).includes(v));

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

  // Page state — hydrate หน้า/page size จาก URL
  const [page, setPage] = useState(urlPage);
  const [pageSize, setPageSize] = useState(urlPageSize);

  // Filter / Search state — hydrate จาก URL
  const [search, setSearch] = useState(urlSearch);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [actionFilters, setActionFilters] = useState<string[]>(urlActionFilters);
  const [entityFilters, setEntityFilters] = useState<string[]>(urlEntityFilters);

  // Data
  const [items, setItems] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Lookup
  const [lookup, setLookup] = useState<LookupBundle>(EMPTY_LOOKUP);

  // Modal state for change details
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
  const token = useMemo(
    () => (typeof window !== 'undefined' ? localStorage.getItem('adminToken') || '' : ''),
    []
  );

  // ── List state setters — ทุกการเปลี่ยนแนบลง URL ทันที ──────────────────────
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    updateUrl({ q: value.trim() ? value : null });
  }, [updateUrl]);

  const handleActionFiltersChange = useCallback((next: string[]) => {
    setActionFilters(next);
    setPage(1);
    updateUrl({ action: next.length > 0 ? next.join(',') : null, page: null });
  }, [updateUrl]);

  const handleEntityFiltersChange = useCallback((next: string[]) => {
    setEntityFilters(next);
    setPage(1);
    updateUrl({ entity: next.length > 0 ? next.join(',') : null, page: null });
  }, [updateUrl]);

  const handlePageChange = useCallback((nextPage: number) => {
    setPage(nextPage);
    updateUrl({ page: nextPage <= 1 ? null : String(nextPage) });
  }, [updateUrl]);

  // เปลี่ยน page size → reset กลับหน้า 1 เสมอ + บันทึกลง URL (ค่า default ไม่เขียนลง URL)
  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    setPage(1);
    updateUrl({ pageSize: size === DEFAULT_PAGE_SIZE ? null : String(size), page: null });
  }, [updateUrl]);

  // Debounce search 300ms ก่อนส่งไป Backend
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // โหลด entity lookup ครั้งเดียว (ตอน mount + เมื่อ token เปลี่ยน)
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      const bundle = await loadAllLookups(apiUrl, token);
      if (!cancelled) setLookup(bundle);
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl, token]);

  // Fetch audit logs ตาม page/filter/search (ทุกครั้งที่เปลี่ยน → โหลดใหม่)
  const fetchLogs = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) return;
      try {
        setLoading(true);
        setError(null);

        const params = new URLSearchParams();
        params.set('page', String(page));
        params.set('pageSize', String(pageSize));

        // ส่ง action/entity ไป backend แบบ comma-separated
        if (actionFilters.length > 0) params.set('action', actionFilters.join(','));
        if (entityFilters.length > 0) params.set('entity', entityFilters.join(','));
        if (debouncedSearch) params.set('search', debouncedSearch);

        const res = await fetch(`${apiUrl}/admin/audit-logs?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: AuditLogsResponse = await res.json();

        if (signal?.aborted) return;
        setItems(json.items || []);
        setTotal(json.total || 0);
        setTotalPages(json.totalPages || 0);
        // ถ้า backend clamp page (เช่น ขอเกิน) → sync กลับ
        if (json.page && json.page !== page) {
          setPage(json.page);
          updateUrl({ page: json.page <= 1 ? null : String(json.page) });
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setError((e as Error).message || 'โหลดข้อมูลไม่สำเร็จ');
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [apiUrl, token, page, pageSize, actionFilters, entityFilters, debouncedSearch, updateUrl]
  );

  useEffect(() => {
    const ctrl = new AbortController();
    fetchLogs(ctrl.signal);
    return () => ctrl.abort();
  }, [fetchLogs]);

  // Reset กลับหน้า 1 เมื่อ filter/search/pageSize เปลี่ยน — ข้าม mount แรก
  // (ไม่งั้นทับหน้าที่ restore จาก URL)
  const prevFilterKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = JSON.stringify([debouncedSearch, actionFilters, entityFilters, pageSize]);
    const prev = prevFilterKeyRef.current;
    prevFilterKeyRef.current = key;
    if (prev === null || key === prev) return;
    setPage(1);
    updateUrl({ page: null });
  }, [debouncedSearch, actionFilters, entityFilters, pageSize, updateUrl]);

  // Resolve entity name
  const resolveEntityName = (entityType: string, entityId: string): string | null => {
    const key = ENTITY_TO_LOOKUP[entityType];
    if (!key) return null;
    return lookup[key][entityId] || null;
  };

  const clearAllFilters = () => {
    setActionFilters([]);
    setEntityFilters([]);
    setSearch('');
    setPage(1);
    updateUrl({ action: null, entity: null, q: null, page: null });
  };

  const renderEntity = (log: AuditLog) => {
    const resolved = resolveAuditEntity(log, resolveEntityName);
    const typeLabel = getAuditEntityLabel(log.entityType);
    const secondary = resolved?.secondary || typeLabel;
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-slate-900">
          {resolved?.primary || shortId(log.entityId)}
        </span>
        <span className="text-xs text-slate-500">
          {secondary}
          {!resolved && log.entityId && log.entityId !== 'BULK/NEW' && (
            <span className="ml-1 font-mono text-[10px] text-slate-400">
              ({log.entityId.slice(0, 8)}…)
            </span>
          )}
        </span>
      </div>
    );
  };

  const renderActionBadge = (action: string) => {
    const cfg = getAuditActionConfig(action);
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold',
          cfg.className
        )}
      >
        {cfg.label}
      </span>
    );
  };

  if (!isSuperAdmin) {
    return (
      <div className="p-8">
        <Card>
          <CardContent className="p-8 text-center">
            <span className="text-5xl">🔒</span>
            <h2 className="text-lg font-semibold mt-4 text-slate-700">
              ไม่มีสิทธิ์เข้าถึงหน้านี้
            </h2>
            <p className="text-sm text-slate-500 mt-2">
              Audit Logs สงวนสิทธิ์เฉพาะ Super Admin เท่านั้น
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => (window.location.href = '/admin/dashboard')}
            >
              ← กลับหน้า Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-4 md:p-5 space-y-2.5 bg-slate-50/50 min-h-[calc(100vh-3.5rem)]">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-xl">📜</span>
          <h1 className="text-base md:text-lg font-bold text-slate-900 leading-tight">
            System Audit Logs
          </h1>
        </div>
        <p className="text-[11px] text-slate-500 ml-7">
          ประวัติการทำงานของผู้ดูแลระบบ
        </p>
      </div>

      {/* Toolbar */}
      <div className={cn(CARD_STYLE.container, 'p-3')}>
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
          <div className="flex-1 min-w-0">
            <SearchInput
              value={search}
              onChange={handleSearchChange}
              placeholder="ค้นหา... (Email, Admin ID, Entity ID, IP)"
            />
          </div>
          <FilterDropdown
            label="Action"
            groups={[
              {
                label: 'Action',
                type: 'multi',
                selected: actionFilters,
                onChange: handleActionFiltersChange,
                options: ACTION_OPTIONS.map((a) => ({
                  value: a,
                  label: getAuditActionConfig(a).label,
                })),
              },
            ]}
            totalActiveFilters={actionFilters.length}
            onClearAll={() => handleActionFiltersChange([])}
          />
          <FilterDropdown
            label="Entity"
            groups={[
              {
                label: 'Entity Type',
                type: 'multi',
                selected: entityFilters,
                onChange: handleEntityFiltersChange,
                options: ENTITY_OPTIONS.map((t) => ({
                  value: t,
                  label: getAuditEntityLabel(t),
                })),
              },
            ]}
            totalActiveFilters={entityFilters.length}
            onClearAll={() => handleEntityFiltersChange([])}
          />
          {actionFilters.length > 0 || entityFilters.length > 0 || search ? (
            <button
              type="button"
              onClick={clearAllFilters}
              className="text-sm text-slate-500 hover:text-slate-700 underline px-2"
            >
              ล้างตัวกรอง
            </button>
          ) : null}
        </div>
      </div>

      {/* Table */}
      <div className={CARD_STYLE.container}>
        <div className={CARD_STYLE.header}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">
              รายการ ({total.toLocaleString('th-TH')})
            </h2>
            {loading && (
              <span className="text-xs text-slate-400">กำลังโหลด…</span>
            )}
          </div>
        </div>

        {error ? (
          <div className="px-4 py-8 text-center text-sm text-red-600">
            ⚠️ โหลดข้อมูลไม่สำเร็จ: {error}
            <button
              type="button"
              onClick={() => fetchLogs()}
              className="ml-3 underline text-blue-600 hover:text-blue-700"
            >
              ลองใหม่
            </button>
          </div>
        ) : total === 0 && !loading ? (
          <NoDataEmptyState
            title="ยังไม่มีข้อมูล Audit Log"
            description="เมื่อมีการแก้ไขข้อมูลในระบบ รายการจะปรากฏที่นี่"
          />
        ) : items.length === 0 ? (
          <NoResultsEmptyState
            keyword={search}
            onClearFilters={clearAllFilters}
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[160px]">เวลา</TableHead>
                  <TableHead className="w-[200px]">Admin</TableHead>
                  <TableHead className="w-[110px]">Action</TableHead>
                  <TableHead className="min-w-[220px]">Entity</TableHead>
                  <TableHead>รายละเอียด</TableHead>
                  <TableHead className="w-[140px]">IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((log) => {
                  const resolved = resolveAuditEntity(log, resolveEntityName);
                  const adminEmail = resolveAdminEmail(log.adminId, lookup.ADMIN);
                  const payload = parsePayload(log.payload);
                  const hasChanges = hasChangeTracking(payload);
                  const tableChangeSummary = getTableChangeSummary(payload);
                  
                  return (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs text-slate-600">
                        {formatDateTime(log.createdAt)}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        <span className="inline-flex items-center gap-1">
                          <span>👤</span>
                          <span className="font-medium">{adminEmail}</span>
                        </span>
                      </TableCell>
                      <TableCell>{renderActionBadge(log.action)}</TableCell>
                      <TableCell>{renderEntity(log)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="text-sm text-slate-700">
                            {buildAuditDescription(log, resolved, payload)}
                          </span>
                          {hasChanges && (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 whitespace-nowrap">
                                {tableChangeSummary}
                              </span>
                              <button
                                type="button"
                                onClick={() => setSelectedLog(log)}
                                className="text-xs text-blue-600 hover:text-blue-700 underline whitespace-nowrap"
                              >
                                ดูรายละเอียด
                              </button>
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-slate-500">
                        {log.ipAddress || '-'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <Pagination
              currentPage={page}
              totalItems={total}
              pageSize={pageSize}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              resultLabel="รายการ"
            />
          </>
        )}
        </div>

      {/* Change Details Modal */}
      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span>📝</span>
              <span>รายละเอียดการเปลี่ยนแปลง</span>
            </DialogTitle>
          </DialogHeader>
          {selectedLog && (() => {
            const payload = parsePayload(selectedLog.payload);
            const changes = payload?.changes || [];
            return (
              <div className="space-y-4 mt-4">
                {/* Summary */}
                <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <span className="text-sm text-slate-600">
                    {selectedLog.action === 'UPDATE' ? 'แก้ไข' : selectedLog.action === 'CREATE' ? 'สร้าง' : 'ลบ'}
                  </span>
                  <span className="font-medium">
                    {getAuditEntityLabel(selectedLog.entityType)}
                  </span>
                  <span className="text-slate-400">→</span>
                  <span className="font-medium">
                    {resolveAuditEntity(selectedLog, resolveEntityName)?.primary || shortId(selectedLog.entityId)}
                  </span>
                </div>

                {/* Changes List */}
                {changes.length > 0 ? (
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-slate-700">การเปลี่ยนแปลง:</h4>
                    {changes.map((change: FieldChange, index: number) => (
                      <div key={index} className="p-3 bg-white rounded-lg border border-slate-200">
                        <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                          {change.fieldLabel}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 p-2 bg-red-50 rounded border border-red-100">
                            <div className="text-xs text-red-500 mb-0.5">เดิม</div>
                            <div className="text-sm text-slate-700">
                              {change.oldValue ?? '(ว่าง)'}
                            </div>
                          </div>
                          <div className="text-slate-400">↓</div>
                          <div className="flex-1 p-2 bg-green-50 rounded border border-green-100">
                            <div className="text-xs text-green-500 mb-0.5">ใหม่</div>
                            <div className="text-sm text-slate-700">
                              {change.newValue ?? '(ว่าง)'}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 text-center py-4">
                    ไม่มีข้อมูลการเปลี่ยนแปลง
                  </p>
                )}

                {/* Metadata */}
                <div className="flex items-center justify-between text-xs text-slate-500 pt-4 border-t">
                  <span>👤 {resolveAdminEmail(selectedLog.adminId, lookup.ADMIN)}</span>
                  <span>{formatDateTime(selectedLog.createdAt)}</span>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}