'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SearchInput } from '@/components/ui/search-input';
import { FilterDropdown } from '@/components/ui/filter-dropdown';
import { Pagination } from '@/components/ui/pagination';
import { NoDataEmptyState, NoResultsEmptyState } from '@/components/ui/empty-state';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useRole } from '@/lib/useRole';

// =============================================================================
// Types
// =============================================================================

interface AuditLog {
  id: string;
  adminId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | string;
  entityType: string;
  entityId: string;
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

// =============================================================================
// Design Tokens (Smart Family Style - ใช้ร่วมกับหน้าอื่นในระบบ)
// =============================================================================

const CARD_STYLE = {
  container: 'bg-white rounded-xl border border-slate-200 shadow-sm',
  header: 'px-4 py-3 border-b border-slate-100',
  body: 'px-4 py-3',
};

// Action Badge Config
const ACTION_CONFIG: Record<string, { label: string; className: string }> = {
  CREATE: { label: 'สร้าง', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  UPDATE: { label: 'แก้ไข', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  DELETE: { label: 'ลบ', className: 'bg-red-100 text-red-700 border-red-200' },
};

// Entity Type Label
const ENTITY_LABEL: Record<string, string> = {
  RECRUITMENT_ROUND: 'รอบรับสมัคร',
  TEMPLATE: 'Template',
  TEMPLATE_VERSION: 'เวอร์ชัน Template',
  TEMPLATE_SECTION: 'Section',
  TEMPLATE_FIELD: 'ช่องในฟอร์ม',
  FIELD_MASTER: 'ฟิลด์หลัก',
  APPLICATION: 'ใบสมัคร',
  ROUND_CLONED: 'คัดลอกรอบ',
  ORGANIZATION: 'หน่วยงาน',
  JOB_FAMILY: 'กลุ่มงาน',
  POSITION_LEVEL: 'ระดับตำแหน่ง',
  POSITION: 'ตำแหน่ง',
};

// รายการ Action ที่ใช้ใน Filter (ค่าคงที่ — ไม่ขึ้นกับ data เพราะ data มีแค่หน้าปัจจุบัน)
const ACTION_OPTIONS = ['CREATE', 'UPDATE', 'DELETE'] as const;

// รายการ Entity ทั้งหมด (จาก requirement)
const ENTITY_OPTIONS = [
  'RECRUITMENT_ROUND',
  'TEMPLATE',
  'TEMPLATE_VERSION',
  'FIELD_MASTER',
  'APPLICATION',
  'POSITION',
  'ORGANIZATION',
  'JOB_FAMILY',
  'POSITION_LEVEL',
] as const;

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 50;

// =============================================================================
// Entity Lookup Maps
// โหลดครั้งเดียวต่อ entity type → ใช้ O(1) lookup ตอน render
// =============================================================================

type EntityLookup = Record<string, string>; // entityId -> "ชื่อจริง"

interface LookupBundle {
  ROUND: EntityLookup;
  TEMPLATE: EntityLookup;
  FIELD_MASTER: EntityLookup;
  ORGANIZATION: EntityLookup;
  JOB_FAMILY: EntityLookup;
  POSITION_LEVEL: EntityLookup;
  POSITION: EntityLookup;
}

const EMPTY_LOOKUP: LookupBundle = {
  ROUND: {},
  TEMPLATE: {},
  FIELD_MASTER: {},
  ORGANIZATION: {},
  JOB_FAMILY: {},
  POSITION_LEVEL: {},
  POSITION: {},
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
  ] = await Promise.all([
    fetchMap(`${apiUrl}/admin/rounds?view=all`, (r) => `${r.title} (${r.positionLevel})`),
    fetchMap(`${apiUrl}/admin/templates?view=all`, (t) => t.name || t.title || 'Template'),
    fetchMap(`${apiUrl}/admin/fields`, (f) => f.labelTh || f.label || f.fieldType),
    fetchMap(`${apiUrl}/admin/organizations`, (o) => o.name),
    fetchMap(`${apiUrl}/admin/job-families`, (j) => j.name),
    fetchMap(`${apiUrl}/admin/position-levels`, (p) => p.name),
    fetchMap(`${apiUrl}/admin/positions`, (p) => p.title),
  ]);

  return { ROUND, TEMPLATE, FIELD_MASTER, ORGANIZATION, JOB_FAMILY, POSITION_LEVEL, POSITION };
}

const ENTITY_TO_LOOKUP: Record<string, keyof LookupBundle> = {
  RECRUITMENT_ROUND: 'ROUND',
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

function parsePayload(payload: string | null | undefined): Record<string, any> | null {
  if (!payload) return null;
  if (typeof payload !== 'string') return payload as any;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

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

function shortId(id: string): string {
  if (!id) return '-';
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function buildDescription(log: AuditLog, entityName: string | null): string {
  const payload = parsePayload(log.payload);
  const action = log.action;
  const entityLabel = ENTITY_LABEL[log.entityType] || log.entityType;
  const displayName = entityName || shortId(log.entityId);

  if (log.entityType === 'ROUND_CLONED') {
    return `คัดลอกรอบรับสมัคร → ${displayName}`;
  }

  if (log.entityType === 'APPLICATION' && action === 'UPDATE' && payload) {
    if (payload.status) {
      const reason = payload.statusReason ? ` (${payload.statusReason})` : '';
      return `เปลี่ยนสถานะใบสมัคร → ${payload.status}${reason}`;
    }
  }

  switch (action) {
    case 'CREATE':
      return `สร้าง${entityLabel} ${displayName}`;
    case 'UPDATE':
      return `แก้ไข${entityLabel} ${displayName}`;
    case 'DELETE':
      return `ลบ${entityLabel} ${displayName}`;
    default:
      return `${action} ${entityLabel} ${displayName}`;
  }
}

// =============================================================================
// Page
// =============================================================================

export default function AuditLogsPage() {
  // RBAC guard (RBAC v1): Audit Logs เข้าได้เฉพาะ SUPER_ADMIN เท่านั้น
  // ตาม RBAC matrix ใหม่: ADMIN และ VIEWER ห้ามเข้าถึง
  const { isSuperAdmin } = useRole();

  // Page state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // Filter / Search state
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [actionFilters, setActionFilters] = useState<string[]>([]);
  const [entityFilters, setEntityFilters] = useState<string[]>([]);

  // Data
  const [items, setItems] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Lookup
  const [lookup, setLookup] = useState<LookupBundle>(EMPTY_LOOKUP);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
  const token = useMemo(
    () => (typeof window !== 'undefined' ? localStorage.getItem('adminToken') || '' : ''),
    []
  );

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
        if (json.page && json.page !== page) setPage(json.page);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setError((e as Error).message || 'โหลดข้อมูลไม่สำเร็จ');
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [apiUrl, token, page, pageSize, actionFilters, entityFilters, debouncedSearch]
  );

  useEffect(() => {
    const ctrl = new AbortController();
    fetchLogs(ctrl.signal);
    return () => ctrl.abort();
  }, [fetchLogs]);

  // Reset กลับหน้า 1 เมื่อ filter/search/pageSize เปลี่ยน
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, actionFilters, entityFilters, pageSize]);

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
  };

  const renderEntity = (log: AuditLog) => {
    const name = resolveEntityName(log.entityType, log.entityId);
    const typeLabel = ENTITY_LABEL[log.entityType] || log.entityType;
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-slate-900">
          {name || shortId(log.entityId)}
        </span>
        <span className="text-xs text-slate-500">
          {typeLabel}
          {!name && log.entityId && log.entityId !== 'BULK/NEW' && (
            <span className="ml-1 font-mono text-[10px] text-slate-400">
              ({log.entityId.slice(0, 8)}…)
            </span>
          )}
        </span>
      </div>
    );
  };

  const renderActionBadge = (action: string) => {
    const cfg = ACTION_CONFIG[action] || {
      label: action,
      className: 'bg-slate-100 text-slate-700 border-slate-200',
    };
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
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-slate-900">System Audit Logs</h1>
        <p className="text-sm text-slate-500">
          ประวัติการทำงานของผู้ดูแลระบบ
        </p>
      </div>

      {/* Toolbar */}
      <div className={cn(CARD_STYLE.container, 'p-3')}>
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
          <div className="flex-1 min-w-0">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="ค้นหา... (Admin ID, Entity ID, IP)"
            />
          </div>
          <FilterDropdown
            label="Action"
            groups={[
              {
                label: 'Action',
                type: 'multi',
                selected: actionFilters,
                onChange: (next) => {
                  setActionFilters(next);
                  setPage(1);
                },
                options: ACTION_OPTIONS.map((a) => ({
                  value: a,
                  label: ACTION_CONFIG[a]?.label || a,
                })),
              },
            ]}
            totalActiveFilters={actionFilters.length}
            onClearAll={() => {
              setActionFilters([]);
              setPage(1);
            }}
          />
          <FilterDropdown
            label="Entity"
            groups={[
              {
                label: 'Entity Type',
                type: 'multi',
                selected: entityFilters,
                onChange: (next) => {
                  setEntityFilters(next);
                  setPage(1);
                },
                options: ENTITY_OPTIONS.map((t) => ({
                  value: t,
                  label: ENTITY_LABEL[t] || t,
                })),
              },
            ]}
            totalActiveFilters={entityFilters.length}
            onClearAll={() => {
              setEntityFilters([]);
              setPage(1);
            }}
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
                  const entityName = resolveEntityName(log.entityType, log.entityId);
                  return (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs text-slate-600">
                        {formatDateTime(log.createdAt)}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-slate-600">
                        {log.adminId}
                      </TableCell>
                      <TableCell>{renderActionBadge(log.action)}</TableCell>
                      <TableCell>{renderEntity(log)}</TableCell>
                      <TableCell className="text-sm text-slate-700">
                        {buildDescription(log, entityName)}
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
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              resultLabel="รายการ"
            />
          </>
        )}
        </div>
    </div>
  );
}