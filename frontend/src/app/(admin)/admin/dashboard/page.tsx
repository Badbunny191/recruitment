'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDateThai } from '@/lib/date';
import { getAuditActionConfig, getAuditEntityLabel } from '@/lib/audit-log-display';
import { redirectToLogin } from '@/lib/account-state';
import { useRole } from '@/lib/useRole';
import {
  buildDashboardSnapshotFromOverview,
  type AuditLogItem,
  type DashboardOverviewPayload,
  type PendingOverview,
} from '@/lib/dashboard-overview';

/**
 * Executive Dashboard — V2 (single endpoint)
 * -----------------------------
 * เรียก GET /admin/dashboard/overview เพียง request เดียว แทน fan-out
 * 5 endpoint ของ V1 (applications/summary, applications, rounds,
 * rounds/comparison, audit-logs) — backend aggregate KPI ครบทุก section
 * รวมถึงงานค้างที่ V1 ต้อง fetch แถวมากถึง 200 แถวมานับฝั่ง client
 *
 * Response เป็น fail-soft ต่อ section: section ใดล้ม = null + ชื่อ section
 * ใน errors[] — ส่วนอื่นยังแสดงได้ (คุณสมบัติ allSettled ของ V1 รักษาไว้)
 * section ที่ล้ม → กล่อง "โหลดข้อมูลไม่สำเร็จ" ของส่วนนั้นเหมือนเดิม
 *
 * UI/markup คงเดิมทุกส่วนจาก V1 — มีเพียงชั้นโหลดข้อมูลที่เปลี่ยน
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

// =============================================================================
// Types
// =============================================================================

interface OverviewResponse {
  data?: DashboardOverviewPayload;
}

/** สถานะการโหลดของแต่ละส่วน */
type SectionStatus = 'loading' | 'ready' | 'error';

interface SectionState<T> {
  status: SectionStatus;
  data: T | null;
  error: string | null;
}

const initialSection = <T,>(): SectionState<T> => ({ status: 'loading', data: null, error: null });

// =============================================================================
// Fetch helper
// =============================================================================

/**
 * 401 = session หมดอายุ/ถูกเพิกถอน — ต้องพาไป login ไม่ใช่แสดง
 * "โหลดข้อมูลไม่สำเร็จ" (ซึ่งทำให้ผู้ใช้เข้าใจว่าข้อมูลพัง ทั้งที่แค่ต้อง login ใหม่)
 * แยกเป็น error ชนิดของตัวเองเพื่อให้ caller ตัดสินใจได้โดยไม่ต้องอ่าน string
 */
class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized');
    this.name = 'UnauthorizedError';
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('adminToken') : null;

  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (res.status === 401) {
    // ใช้ helper เดิมของระบบ (ล้าง session + hard navigation + loop guard)
    redirectToLogin();
    throw new UnauthorizedError();
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  return (await res.json()) as T;
}

// =============================================================================
// Small presentational pieces
// =============================================================================

function SectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-md bg-slate-100" />
      ))}
    </div>
  );
}

function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3">
      <p className="text-sm text-red-700">โหลดข้อมูลไม่สำเร็จ: {message}</p>
      <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
        ลองอีกครั้ง
      </Button>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-slate-500">{text}</p>;
}

function Pill({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold',
        className,
      )}
    >
      {label}
    </span>
  );
}

// =============================================================================
// KPI card
// =============================================================================

function KpiCard({
  title,
  value,
  hint,
  tone = 'neutral',
  loading,
  unavailable,
}: {
  title: string;
  value: string | number;
  hint?: string;
  tone?: 'neutral' | 'warning' | 'danger' | 'good';
  loading?: boolean;
  /** โหลดไม่สำเร็จ — ห้ามแสดง 0 หรือข้อความ "ปกติ" แทนข้อมูลที่ยังไม่รู้ */
  unavailable?: boolean;
}) {
  // ระหว่าง loading/unavailable ต้องไม่สื่อสถานะ "เขียว/ปกติ" จากข้อมูลที่ยังไม่มี
  const effectiveTone = loading || unavailable ? 'neutral' : tone;

  const toneClass = {
    neutral: 'text-slate-900',
    warning: 'text-amber-600',
    danger: 'text-red-600',
    good: 'text-emerald-600',
  }[effectiveTone];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-slate-600">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-8 w-16 animate-pulse rounded bg-slate-100" />
        ) : unavailable ? (
          <div className="text-3xl font-bold tabular-nums text-slate-400">–</div>
        ) : (
          <div className={cn('text-3xl font-bold tabular-nums', toneClass)}>{value}</div>
        )}
        {/* hint อธิบายค่าที่แสดง — ระหว่าง loading ยังไม่มีค่า จึงต้องไม่แสดง */}
        {hint && !loading && !unavailable && (
          <p className="mt-1 text-xs text-slate-500">{hint}</p>
        )}
        {unavailable && <p className="mt-1 text-xs text-slate-500">โหลดข้อมูลไม่สำเร็จ</p>}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Page
// =============================================================================

export default function DashboardPage() {
  // Audit Log เปิดให้เฉพาะ SUPER_ADMIN (ตรงกับ RBAC ของหน้า /admin/audit-logs
  // และเมนู System) — role อื่นต้องไม่เห็นกิจกรรมเลย แม้แต่ใน dashboard
  // (backend ส่ง activities เฉพาะ SUPER_ADMIN อยู่แล้ว — ชั้นนี้เป็น guard แสดงผล)
  const { isSuperAdmin } = useRole();

  // request เดียวรวมทุก section — สถานะ loading/error/error message ใช้ร่วมกัน
  // แล้วแยกเป็นสถานะต่อ section ด้วย sectionOf ด้านล่าง
  const [overview, setOverview] = useState<SectionState<DashboardOverviewPayload>>(
    initialSection(),
  );

  // ── Loader (request เดียว) ──

  const loadOverview = useCallback(async () => {
    setOverview((s) => ({ ...s, status: 'loading', error: null }));
    try {
      const res = await fetchJson<OverviewResponse>('/admin/dashboard/overview');
      setOverview({ status: 'ready', data: res.data ?? null, error: null });
    } catch (e) {
      // 401 → กำลังถูกพาไป login อยู่ ไม่ต้องแสดง error ปลอม
      if (e instanceof UnauthorizedError) return;
      setOverview({ status: 'error', data: null, error: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const reloadAll = useCallback(() => {
    void loadOverview();
  }, [loadOverview]);

  // ── สถานะต่อ section (map จาก response เดียว → SectionState รูปทรงเดิม) ──
  // fail-soft ฝั่ง backend: section ที่ query ล้มจะเป็น null + ชื่อใน errors[]
  // → ส่วนนั้นแสดงกล่อง error ของตัวเอง ส่วนอื่นยังแสดงตามปกติ

  const sectionOf = <T,>(key: string, value: T | null | undefined): SectionState<T> => {
    if (overview.status === 'loading') return initialSection<T>();
    if (overview.status === 'error') {
      return { status: 'error', data: null, error: overview.error ?? 'ไม่ทราบสาเหตุ' };
    }
    if (value == null) {
      return {
        status: 'error',
        data: null,
        error: overview.data?.errors.includes(key)
          ? 'เกิดข้อผิดพลาดจากเซิร์ฟเวอร์'
          : 'รูปทรงข้อมูลไม่ถูกต้อง',
      };
    }
    return { status: 'ready', data: value, error: null };
  };

  const summary = sectionOf('summary', overview.data?.summary ?? null);
  const pending = sectionOf<PendingOverview>('pending', overview.data?.pending ?? null);
  const rounds = sectionOf('rounds', overview.data?.rounds ?? null);
  const comparison = sectionOf('comparison', overview.data?.comparison ?? null);
  // role อื่น: server ไม่ส่ง activities มาตั้งแต่ต้น (ไม่ใช่ error) — แสดงเป็น "พร้อม, ว่าง"
  const activities = !isSuperAdmin
    ? ({ status: 'ready', data: [] as AuditLogItem[], error: null } as SectionState<AuditLogItem[]>)
    : sectionOf<AuditLogItem[]>('activities', overview.data?.activities?.items ?? null);

  // ── Derived data (คำนวณผ่าน pure logic ที่เทสแล้ว) ──

  const snapshot = useMemo(
    () => buildDashboardSnapshotFromOverview(overview.data),
    [overview.data],
  );

  const anyLoading = overview.status === 'loading';

  const { total, cards, unaccounted } = snapshot.statusCards;
  const { pending: pendingInfo, rounds: activeRounds, alerts, activities: activityRows } = snapshot;

  const highAlerts = alerts.filter((a) => a.severity === 'high').length;

  return (
    <div className="p-4 md:p-8 space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Executive Dashboard</h1>
          <p className="text-sm text-slate-500">
            ภาพรวมการรับสมัคร · ข้อมูล ณ {formatDateThai(new Date())}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={reloadAll} disabled={anyLoading}>
          {anyLoading ? 'กำลังโหลด…' : 'รีเฟรช'}
        </Button>
      </div>

      {/* ── 1. KPI cards ── */}
      <section aria-labelledby="kpi-heading" className="space-y-3">
        <h2 id="kpi-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          ภาพรวมใบสมัคร
        </h2>

        {summary.status === 'error' ? (
          <SectionError message={summary.error ?? 'ไม่ทราบสาเหตุ'} onRetry={reloadAll} />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                title="ใบสมัครทั้งหมด"
                value={total}
                hint="ทุกสถานะ รวมที่เก็บเข้าคลัง"
                loading={summary.status === 'loading'}
              />
              <KpiCard
                title="รอการตรวจสอบ"
                value={pendingInfo.count}
                hint={
                  pendingInfo.oldestAgeDays != null
                    ? pendingInfo.truncated
                      ? `ค้างนานสุด ${pendingInfo.oldestAgeDays} วัน (จาก ${pendingInfo.fetchedCount} ใบแรก)`
                      : `ค้างนานสุด ${pendingInfo.oldestAgeDays} วัน`
                    : 'ไม่มีงานค้าง'
                }
                tone={pendingInfo.overdueCount > 0 ? 'warning' : 'neutral'}
                // ต้องรอทั้งสองส่วน: count มาจาก pending, แต่การ์ดอยู่ในบล็อก summary
                loading={pending.status === 'loading' || summary.status === 'loading'}
                unavailable={pending.status === 'error'}
              />
              <KpiCard
                title="รอบที่เปิดรับ"
                value={
                  activeRounds.filter(
                    (r) => r.urgency === 'open' || r.urgency === 'closing-soon' || r.urgency === 'overdue',
                  ).length
                }
                hint={
                  snapshot.overdueRounds > 0
                    ? `เลยกำหนด ${snapshot.overdueRounds} รอบ`
                    : `${activeRounds.length} รอบในช่วงนี้`
                }
                tone={snapshot.overdueRounds > 0 ? 'danger' : 'neutral'}
                loading={rounds.status === 'loading'}
                unavailable={rounds.status === 'error'}
              />
              <KpiCard
                title="Template ต้องอัปเดต"
                value={highAlerts}
                hint={alerts.length > 0 ? `พบทั้งหมด ${alerts.length} รายการ` : 'ทันสมัยทั้งหมด'}
                tone={highAlerts > 0 ? 'warning' : 'good'}
                loading={comparison.status === 'loading'}
                unavailable={comparison.status === 'error'}
              />
            </div>

            {/* แถบสถานะ — ใช้สัดส่วนแทน chart ตามข้อกำหนด "ห้ามทำ chart" */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-slate-600">
                  สัดส่วนตามสถานะ
                </CardTitle>
              </CardHeader>
              <CardContent>
                {summary.status === 'loading' ? (
                  <SectionSkeleton rows={2} />
                ) : (
                  <>
                    <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
                      {cards
                        .filter((c) => c.count > 0)
                        .map((c) => (
                          <div
                            key={c.status}
                            className={cn('h-full', c.className.split(' ')[0])}
                            style={{ width: `${c.share * 100}%` }}
                            title={`${c.label}: ${c.count}`}
                          />
                        ))}
                    </div>
                    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                      {cards.map((c) => (
                        <li key={c.status} className="flex items-center gap-2 text-sm">
                          <span className={cn('h-2.5 w-2.5 rounded-full', c.className.split(' ')[0])} />
                          <span className="text-slate-600">{c.label}</span>
                          <span className="font-semibold tabular-nums text-slate-900">{c.count}</span>
                        </li>
                      ))}
                    </ul>
                    {unaccounted !== 0 && (
                      <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                        พบ {unaccounted} ใบที่ยังไม่ถูกนับในสถานะใด (ผลรวมสถานะไม่เท่ากับยอดทั้งหมด)
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </section>

      {/* ── 2 + 3. Rounds + Pending decisions ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Active rounds */}
        <section aria-labelledby="rounds-heading">
          <Card className="h-full">
            <CardHeader className="!flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle id="rounds-heading" className="text-base font-semibold">
                รอบที่เปิดรับ
              </CardTitle>
              <Link href="/admin/rounds" className="text-sm text-blue-600 hover:underline">
                ดูทั้งหมด
              </Link>
            </CardHeader>
            <CardContent>
              {rounds.status === 'loading' && <SectionSkeleton rows={4} />}
              {rounds.status === 'error' && (
                <SectionError message={rounds.error ?? 'ไม่ทราบสาเหตุ'} onRetry={reloadAll} />
              )}
              {rounds.status === 'ready' && activeRounds.length === 0 && (
                <EmptyRow text="ยังไม่มีรอบที่เปิดรับ" />
              )}
              {rounds.status === 'ready' && activeRounds.length > 0 && (
                <ul className="divide-y divide-slate-100">
                  {activeRounds.map((r) => (
                    <li key={r.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{r.title}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {r.roundCode ? `${r.roundCode} · ` : ''}
                          {formatDateThai(r.openDate)} – {formatDateThai(r.closeDate)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <Pill label={r.urgencyLabel} className={r.urgencyClassName} />
                        {r.daysLeft != null && (
                          <p className="mt-1 text-xs text-slate-500">
                            {r.daysLeft < 0
                              ? `เลยกำหนด ${Math.abs(r.daysLeft)} วัน`
                              : `เหลือ ${r.daysLeft} วัน`}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Pending decisions */}
        <section aria-labelledby="pending-heading">
          <Card className="h-full">
            <CardHeader className="!flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle id="pending-heading" className="text-base font-semibold">
                งานค้างที่ต้องตัดสิน
              </CardTitle>
              <Link
                href="/admin/applications?status=SUBMITTED"
                className="text-sm text-blue-600 hover:underline"
              >
                ไปหน้าพิจารณา
              </Link>
            </CardHeader>
            <CardContent>
              {pending.status === 'loading' && <SectionSkeleton rows={4} />}
              {pending.status === 'error' && (
                <SectionError message={pending.error ?? 'ไม่ทราบสาเหตุ'} onRetry={reloadAll} />
              )}
              {pending.status === 'ready' && pendingInfo.count === 0 && (
                <EmptyRow text="ไม่มีใบสมัครที่รอการตัดสิน" />
              )}
              {pending.status === 'ready' && pendingInfo.count > 0 && (
                <>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Pill
                      label={`ค้าง ${pendingInfo.count} ใบ`}
                      className="bg-blue-100 text-blue-800 border-blue-200"
                    />
                    {pendingInfo.oldestAgeDays != null && (
                      <Pill
                        label={`เก่าสุด ${pendingInfo.oldestAgeDays} วัน`}
                        className={
                          pendingInfo.oldestAgeDays > pendingInfo.slaDays
                            ? 'bg-red-100 text-red-800 border-red-200'
                            : 'bg-slate-100 text-slate-700 border-slate-200'
                        }
                      />
                    )}
                    {pendingInfo.overdueCount > 0 && (
                      <Pill
                        label={`เกิน ${pendingInfo.slaDays} วัน: ${pendingInfo.overdueCount} ใบ`}
                        className="bg-amber-100 text-amber-800 border-amber-200"
                      />
                    )}
                  </div>
                  {pendingInfo.truncated && (
                    <p className="mb-2 text-xs text-slate-500">
                      อายุและจำนวนเกินกำหนดคำนวณจาก {pendingInfo.fetchedCount} ใบแรกจากทั้งหมด{' '}
                      {pendingInfo.count} ใบ
                    </p>
                  )}
                  <ul className="divide-y divide-slate-100">
                    {(pending.data?.items ?? []).slice(0, 5).map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-3 py-2 first:pt-0">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900">
                            {a.applicationNo ?? a.id}
                          </p>
                          <p className="truncate text-xs text-slate-500">{a.fullname ?? '-'}</p>
                        </div>
                        <span className="shrink-0 text-xs text-slate-500">
                          {formatDateThai(a.submittedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {pendingInfo.count > 5 && (
                    <p className="mt-2 text-xs text-slate-500">
                      และอีก {pendingInfo.count - 5} ใบ
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </section>
      </div>

      {/* ── 4. Recent activities — SUPER_ADMIN เท่านั้น (RBAC เดียวกับ /admin/audit-logs) ── */}
      {isSuperAdmin && (
        <section aria-labelledby="activity-heading">
          <Card>
            <CardHeader className="!flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle id="activity-heading" className="text-base font-semibold">
                กิจกรรมล่าสุด
              </CardTitle>
              <Link href="/admin/audit-logs" className="text-sm text-blue-600 hover:underline">
                ดู Audit Log
              </Link>
            </CardHeader>
            <CardContent>
              {activities.status === 'loading' && <SectionSkeleton rows={5} />}
              {activities.status === 'error' && (
                <SectionError message={activities.error ?? 'ไม่ทราบสาเหตุ'} onRetry={reloadAll} />
              )}
              {activities.status === 'ready' && activityRows.length === 0 && (
                <EmptyRow text="ยังไม่มีกิจกรรมที่บันทึกไว้" />
              )}
              {activities.status === 'ready' && activityRows.length > 0 && (
                <ul className="divide-y divide-slate-100">
                  {activityRows.map((log) => {
                    const actionCfg = getAuditActionConfig(log.action);
                    return (
                      <li key={log.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <Pill label={actionCfg.label} className={actionCfg.className} />
                          <span className="truncate text-sm text-slate-700">
                            {getAuditEntityLabel(log.entityType)}
                            {log.primary ? ` · ${log.primary}` : ''}
                            {log.secondary ? ` (${log.secondary})` : ''}
                          </span>
                        </div>
                        <span className="shrink-0 text-xs text-slate-500">{log.relative}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── 5. Template governance alerts ── */}
      <section aria-labelledby="governance-heading">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle id="governance-heading" className="text-base font-semibold">
              Template Governance
            </CardTitle>
          </CardHeader>
          <CardContent>
            {comparison.status === 'loading' && <SectionSkeleton rows={2} />}
            {comparison.status === 'error' && (
              <SectionError message={comparison.error ?? 'ไม่ทราบสาเหตุ'} onRetry={reloadAll} />
            )}
            {comparison.status === 'ready' && alerts.length === 0 && (
              <p className="py-4 text-sm text-emerald-700">
                ทุกรอบใช้ template version ล่าสุดแล้ว
              </p>
            )}
            {comparison.status === 'ready' && alerts.length > 0 && (
              <ul className="space-y-2">
                {alerts.map((a) => (
                  <li
                    key={a.roundId}
                    className={cn(
                      'flex flex-wrap items-center justify-between gap-2 rounded-md border p-3',
                      a.severity === 'high'
                        ? 'border-amber-200 bg-amber-50'
                        : 'border-slate-200 bg-slate-50',
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{a.roundTitle}</p>
                      <p className="text-xs text-slate-600">{a.message}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Pill
                        label={a.severity === 'high' ? 'ควรอัปเดต' : 'ล้าสมัย'}
                        className={
                          a.severity === 'high'
                            ? 'bg-amber-100 text-amber-800 border-amber-300'
                            : 'bg-slate-100 text-slate-700 border-slate-300'
                        }
                      />
                      <Link
                        href="/admin/rounds"
                        className="text-xs text-blue-600 hover:underline"
                      >
                        จัดการ
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
