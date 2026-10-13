'use client';

import { useState, useEffect, useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SearchInput } from '@/components/ui/search-input';
import { FilterDropdown } from '@/components/ui/filter-dropdown';
import { NoDataEmptyState, NoResultsEmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';

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

// =============================================================================
// Design Tokens (Smart Family Style - ใช้ร่วมกับหน้าอื่นในระบบ)
// =============================================================================

const CARD_STYLE = {
  container: 'bg-white rounded-xl border border-slate-200 shadow-sm',
  header: 'px-4 py-3 border-b border-slate-100',
  body: 'px-4 py-3',
};

// Action Badge Config - ใช้ Tailwind class ตรงกับ StatusBadge / Rounds page
const ACTION_CONFIG: Record<string, { label: string; className: string }> = {
  CREATE: { label: 'สร้าง', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  UPDATE: { label: 'แก้ไข', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  DELETE: { label: 'ลบ', className: 'bg-red-100 text-red-700 border-red-200' },
};

// Entity Type Label (แสดงชื่อจริงภาษาไทยแทน enum)
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

// =============================================================================
// Entity Lookup Maps
// โหลด "ครั้งเดียว" ต่อ entity type ตอนเปิดหน้า แล้วเก็บใน memory
// ห้าม: 1 log = 1 request
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

/**
 * โหลดทุก entity reference พร้อมกัน (1 ครั้ง ต่อ entity type)
 * คืน LookupBundle ที่ใช้ resolve entityId -> ชื่อจริง
 */
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
    // view=all เพื่อให้เห็นทั้ง round ที่ archive แล้ว
    fetchMap(
      `${apiUrl}/admin/rounds?view=all`,
      (r) => `${r.title} (${r.positionLevel})`
    ),
    // view=all เพื่อให้เห็นทั้ง template ที่ archive แล้ว
    fetchMap(
      `${apiUrl}/admin/templates?view=all`,
      (t) => t.name || t.title || 'Template'
    ),
    fetchMap(
      `${apiUrl}/admin/fields`,
      (f) => f.labelTh || f.label || f.fieldType
    ),
    fetchMap(
      `${apiUrl}/admin/organizations`,
      (o) => o.name
    ),
    fetchMap(
      `${apiUrl}/admin/job-families`,
      (j) => j.name
    ),
    fetchMap(
      `${apiUrl}/admin/position-levels`,
      (p) => p.name
    ),
    fetchMap(
      `${apiUrl}/admin/positions`,
      (p) => p.title
    ),
  ]);

  return {
    ROUND,
    TEMPLATE,
    FIELD_MASTER,
    ORGANIZATION,
    JOB_FAMILY,
    POSITION_LEVEL,
    POSITION,
  };
}

/** Map entityType (จาก audit_logs.entity_type) -> key ใน LookupBundle */
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

/** Parse payload (อาจเป็น string หรือ object) */
function parsePayload(payload: string | null | undefined): Record<string, any> | null {
  if (!payload) return null;
  if (typeof payload !== 'string') return payload as any;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/** Format เวลาเป็น th-TH */
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

/** ตัด UUID ยาว ๆ ให้สั้นลง เพื่อ fallback แสดงผล */
function shortId(id: string): string {
  if (!id) return '-';
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

/**
 * สร้างข้อความ "รายละเอียด" แบบมนุษย์อ่าน
 * ใช้ข้อมูลจาก payload (ถ้ามี) ผสมกับ entityName
 */
function buildDescription(log: AuditLog, entityName: string | null): string {
  const payload = parsePayload(log.payload);
  const action = log.action;
  const entityLabel = ENTITY_LABEL[log.entityType] || log.entityType;
  const displayName = entityName || shortId(log.entityId);

  // ROUND_CLONED มี payload พิเศษ
  if (log.entityType === 'ROUND_CLONED') {
    return `คัดลอกรอบรับสมัคร → ${displayName}`;
  }

  // APPLICATION status update
  if (log.entityType === 'APPLICATION' && action === 'UPDATE' && payload) {
    if (payload.status) {
      const reason = payload.statusReason ? ` (${payload.statusReason})` : '';
      return `เปลี่ยนสถานะใบสมัคร → ${payload.status}${reason}`;
    }
  }

  // ค่า default ตาม action
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
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [lookup, setLookup] = useState<LookupBundle>(EMPTY_LOOKUP);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [actionFilters, setActionFilters] = useState<string[]>([]);
  const [entityFilters, setEntityFilters] = useState<string[]>([]);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
  const token = useMemo(
    () => (typeof window !== 'undefined' ? localStorage.getItem('adminToken') || '' : ''),
    []
  );

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);

        // 1) โหลด audit logs
        const res = await fetch(`${apiUrl}/admin/audit-logs`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const rawData: AuditLog[] = json.data || [];
        const data = rawData
          .slice()
          .sort(
            (a: AuditLog, b: AuditLog) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );

        if (cancelled) return;
        setLogs(data);

        // 2) โหลด entity reference ทั้งหมดครั้งเดียว
        const bundle = await loadAllLookups(apiUrl, token);
        if (cancelled) return;
        setLookup(bundle);
      } catch (e) {
        if (!cancelled) setError((e as Error).message || 'โหลดข้อมูลไม่สำเร็จ');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apiUrl, token]);

  // หาชื่อ entity จาก LookupBundle
  const resolveEntityName = (entityType: string, entityId: string): string | null => {
    const key = ENTITY_TO_LOOKUP[entityType];
    if (!key) return null;
    return lookup[key][entityId] || null;
  };

  // รายการ Entity Type ที่มีจริงในข้อมูล
  const availableEntityTypes = useMemo(() => {
    const typesInData = new Set(logs.map((l) => l.entityType));
    const ordered = Object.keys(ENTITY_LABEL).filter((t) => typesInData.has(t));
    const extras = Array.from(typesInData).filter((t) => !ENTITY_LABEL[t]);
    return [...ordered, ...extras];
  }, [logs]);

  const availableActions = useMemo(() => {
    const set = new Set(logs.map((l) => l.action));
    return Array.from(set).sort();
  }, [logs]);

  // Filtered logs (Client Side)
  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((log) => {
      if (actionFilters.length > 0 && !actionFilters.includes(log.action)) return false;
      if (entityFilters.length > 0 && !entityFilters.includes(log.entityType)) return false;
      if (q) {
        const entityName = resolveEntityName(log.entityType, log.entityId) || '';
        const haystack = [
          entityName,
          log.entityType,
          ENTITY_LABEL[log.entityType] || '',
          log.adminId,
          log.entityId,
          log.ipAddress || '',
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [logs, search, actionFilters, entityFilters, lookup]);

  const totalActiveFilters =
    (actionFilters.length > 0 ? 1 : 0) + (entityFilters.length > 0 ? 1 : 0);

  const clearAllFilters = () => {
    setActionFilters([]);
    setEntityFilters([]);
    setSearch('');
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

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-slate-900">System Audit Logs</h1>
        <p className="text-sm text-slate-500">
          ประวัติการทำงานของผู้ดูแลระบบ
        </p>
      </div>

      {/* Toolbar: Search + Filters */}
      <div className={cn(CARD_STYLE.container, 'p-3')}>
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
          <div className="flex-1 min-w-0">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="ค้นหา... (ชื่อ Entity, ประเภท, Admin ID, IP)"
              resultCount={filteredLogs.length}
              resultLabel="รายการ"
            />
          </div>
          <FilterDropdown
            label="Action"
            groups={[
              {
                label: 'Action',
                type: 'multi',
                selected: actionFilters,
                onChange: setActionFilters,
                options: availableActions.map((a) => ({
                  value: a,
                  label: ACTION_CONFIG[a]?.label || a,
                })),
              },
            ]}
            totalActiveFilters={actionFilters.length}
            onClearAll={() => setActionFilters([])}
          />
          <FilterDropdown
            label="Entity"
            groups={[
              {
                label: 'Entity Type',
                type: 'multi',
                selected: entityFilters,
                onChange: setEntityFilters,
                options: availableEntityTypes.map((t) => ({
                  value: t,
                  label: ENTITY_LABEL[t] || t,
                })),
              },
            ]}
            totalActiveFilters={entityFilters.length}
            onClearAll={() => setEntityFilters([])}
          />
          {totalActiveFilters > 0 || search ? (
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
              รายการ ({filteredLogs.length.toLocaleString('th-TH')})
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
              onClick={() => window.location.reload()}
              className="ml-3 underline text-blue-600 hover:text-blue-700"
            >
              ลองใหม่
            </button>
          </div>
        ) : logs.length === 0 && !loading ? (
          <NoDataEmptyState
            title="ยังไม่มีข้อมูล Audit Log"
            description="เมื่อมีการแก้ไขข้อมูลในระบบ รายการจะปรากฏที่นี่"
          />
        ) : filteredLogs.length === 0 ? (
          <NoResultsEmptyState
            keyword={search}
            onClearFilters={clearAllFilters}
          />
        ) : (
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
              {filteredLogs.map((log) => {
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
        )}
      </div>
    </div>
  );
}