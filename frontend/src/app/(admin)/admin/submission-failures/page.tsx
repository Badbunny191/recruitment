'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SearchInput } from '@/components/ui/search-input';
import { Pagination } from '@/components/ui/pagination';
import { NoDataEmptyState, NoResultsEmptyState } from '@/components/ui/empty-state';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { SearchableDropdown, type SearchableOption } from '@/components/SearchableDropdown';
import { useRole } from '@/lib/useRole';

interface SubmissionFailureItem {
  id: string;
  refCode: string;
  roundId: string | null;
  email: string | null;
  fullname: string | null;
  submissionToken: string | null;
  category: string;
  reasonCode: string | null;
  errorMessage: string;
  httpStatus: number;
  ipAddress: string | null;
  cfRay: string | null;
  userAgent: string | null;
  createdAt: number;
}

interface RoundOption {
  id: string;
  title: string;
  roundCode?: string | null;
}

const CATEGORY_MAP: Record<string, { label: string; variant: 'destructive' | 'secondary' | 'outline' | 'default' }> = {
  ROUND_CLOSED: { label: 'เลยเวลา/รอบปิด', variant: 'destructive' },
  VALIDATION_ERROR: { label: 'ข้อมูลไม่ครบถ้วน', variant: 'secondary' },
  DUPLICATE_EMAIL: { label: 'สมัครซ้ำ', variant: 'secondary' },
  TURNSTILE_FAIL: { label: 'บอท/ยืนยันตัวตนล้มเหลว', variant: 'destructive' },
  INTERNAL_ERROR: { label: 'ระบบขัดข้อง', variant: 'destructive' },
  UNKNOWN: { label: 'อื่นๆ', variant: 'outline' },
};

function formatThaiDateTime(epochMs: number): string {
  if (!epochMs) return '-';
  const d = new Date(epochMs);
  return d.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function SubmissionFailuresPage() {
  const { role } = useRole();
  const [items, setItems] = useState<SubmissionFailureItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [roundId, setRoundId] = useState('');
  const [rounds, setRounds] = useState<RoundOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<SubmissionFailureItem | null>(null);
  const [copied, setCopied] = useState(false);

  // Fetch rounds for filter dropdown
  useEffect(() => {
    const fetchRounds = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787/api/v1';
        const token = localStorage.getItem('adminToken');
        const res = await fetch(`${apiUrl}/admin/rounds`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.data)) {
            setRounds(
              json.data.map((r: any) => ({
                id: r.id,
                title: r.title,
                roundCode: r.roundCode || null,
              }))
            );
          }
        }
      } catch (err) {
        console.error('Failed to fetch rounds:', err);
      }
    };
    fetchRounds();
  }, []);

  // Memoized options for SearchableDropdown
  const roundOptions = useMemo<SearchableOption[]>(() => {
    return [
      { id: '', label: 'ทุกรอบรับสมัคร' },
      ...rounds.map((r) => ({
        id: r.id,
        label: r.roundCode ? `[${r.roundCode}] ${r.title}` : r.title,
      })),
    ];
  }, [rounds]);

  // Fetch submission failure records
  const fetchFailures = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787/api/v1';
      const token = localStorage.getItem('adminToken');
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (search.trim()) params.append('search', search.trim());
      if (roundId.trim()) params.append('roundId', roundId.trim());

      const res = await fetch(`${apiUrl}/admin/submission-failures?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setItems(json.data);
        setTotal(json.pagination?.total ?? 0);
      } else {
        setItems([]);
        setTotal(0);
      }
    } catch (err: any) {
      console.error('Fetch submission failures error:', err);
      setError('ไม่สามารถโหลดข้อมูลหลักฐานการส่งไม่สำเร็จได้');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, roundId]);

  useEffect(() => {
    fetchFailures();
  }, [fetchFailures]);

  const copyDetailSummary = () => {
    if (!selectedDetail) return;
    const summary = [
      `[รายงานหลักฐานการส่งใบสมัครไม่สำเร็จ]`,
      `รหัสอ้างอิง: ${selectedDetail.refCode}`,
      `วัน-เวลา (เซิร์ฟเวอร์): ${formatThaiDateTime(selectedDetail.createdAt)} (Asia/Bangkok)`,
      `ผู้สมัคร: ${selectedDetail.fullname || '-'}`,
      `อีเมล: ${selectedDetail.email || '-'}`,
      `รอบรับสมัคร: ${selectedDetail.roundId || '-'}`,
      `สาเหตุ: ${selectedDetail.errorMessage}`,
      `หมวดหมู่: ${selectedDetail.category} (Reason Code: ${selectedDetail.reasonCode || '-'})`,
      `HTTP Status: ${selectedDetail.httpStatus}`,
      `IP Address: ${selectedDetail.ipAddress || '-'}`,
      `Cloudflare Ray ID: ${selectedDetail.cfRay || '-'}`,
      `Submission Token: ${selectedDetail.submissionToken || '-'}`,
    ].join('\n');

    navigator.clipboard.writeText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            ข้อร้องเรียนการส่งใบสมัคร (Submission Failure Evidence)
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            ค้นหาและตรวจสอบหลักฐานการปฏิเสธคำขอส่งใบสมัครเพื่อตอบข้อร้องเรียนภายใน 30 วินาที
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <SearchInput
                placeholder="ค้นหาด้วย Ref Code (เช่น ERR-...), Email, หรือชื่อ-นามสกุล..."
                value={search}
                onChange={(val) => {
                  setSearch(val);
                  setPage(1);
                }}
              />
            </div>
            <div className="w-full md:w-72">
              <SearchableDropdown
                options={roundOptions}
                value={roundId}
                onChange={(id) => {
                  setRoundId(id || '');
                  setPage(1);
                }}
                placeholder="ทุกรอบรับสมัคร"
                emptyText="ไม่พบรอบรับสมัคร"
                className="w-full"
              />
            </div>
            {(search || roundId) && (
              <Button
                variant="outline"
                onClick={() => {
                  setSearch('');
                  setRoundId('');
                  setPage(1);
                }}
              >
                ล้างตัวกรอง
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Main Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 text-center text-slate-500">กำลังค้นหาข้อมูลหลักฐาน...</div>
          ) : error ? (
            <div className="p-12 text-center text-red-500">{error}</div>
          ) : items.length === 0 ? (
            search || roundId ? (
              <NoResultsEmptyState
                keyword={search}
                onClearFilters={() => {
                  setSearch('');
                  setRoundId('');
                  setPage(1);
                }}
              />
            ) : (
              <NoDataEmptyState title="ไม่มีประวัติการส่งใบสมัครที่ล้มเหลวในระบบ" />
            )
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[180px]">วัน-เวลา (เซิร์ฟเวอร์)</TableHead>
                    <TableHead className="w-[140px]">รหัสอ้างอิง</TableHead>
                    <TableHead className="w-[200px]">ผู้สมัคร</TableHead>
                    <TableHead className="w-[160px]">หมวดหมู่</TableHead>
                    <TableHead>สาเหตุการปฏิเสธ</TableHead>
                    <TableHead className="w-[90px] text-center">Status</TableHead>
                    <TableHead className="w-[100px] text-right">หลักฐาน</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((row) => {
                    const catInfo = CATEGORY_MAP[row.category] || CATEGORY_MAP.UNKNOWN;
                    return (
                      <TableRow key={row.id} className="hover:bg-slate-50">
                        <TableCell className="text-xs text-slate-600 whitespace-nowrap font-mono">
                          {formatThaiDateTime(row.createdAt)}
                        </TableCell>
                        <TableCell className="font-mono font-semibold text-blue-700">
                          {row.refCode}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-slate-900">{row.fullname || '-'}</div>
                          <div className="text-xs text-slate-500 font-mono">{row.email || '-'}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={catInfo.variant}>{catInfo.label}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-slate-700 max-w-md truncate">
                          {row.errorMessage}
                        </TableCell>
                        <TableCell className="text-center font-mono text-xs">
                          <span
                            className={
                              row.httpStatus >= 500
                                ? 'text-red-600 font-bold'
                                : row.httpStatus === 403
                                ? 'text-amber-600 font-semibold'
                                : 'text-slate-600'
                            }
                          >
                            {row.httpStatus}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedDetail(row)}
                          >
                            ดูหลักฐาน
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination */}
          {!loading && total > pageSize && (
            <div className="p-4 border-t border-slate-200">
              <Pagination
                currentPage={page}
                pageSize={pageSize}
                totalItems={total}
                onPageChange={(p) => setPage(p)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!selectedDetail} onOpenChange={(open) => !open && setSelectedDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>หลักฐานการส่งไม่สำเร็จ: {selectedDetail?.refCode}</span>
              <Badge variant={CATEGORY_MAP[selectedDetail?.category || '']?.variant || 'default'}>
                {CATEGORY_MAP[selectedDetail?.category || '']?.label || selectedDetail?.category}
              </Badge>
            </DialogTitle>
          </DialogHeader>

          {selectedDetail && (
            <div className="space-y-4 text-sm text-slate-700">
              <div className="grid grid-cols-2 gap-3 p-4 bg-slate-50 rounded-lg border border-slate-200">
                <div>
                  <span className="text-xs text-slate-500 block">วัน-เวลาที่ระบบปฏิเสธ:</span>
                  <span className="font-semibold">{formatThaiDateTime(selectedDetail.createdAt)}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 block">HTTP Status Code:</span>
                  <span className="font-semibold">{selectedDetail.httpStatus}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 block">ชื่อ-นามสกุล:</span>
                  <span className="font-semibold">{selectedDetail.fullname || '(ไม่ได้ระบุ)'}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 block">อีเมล:</span>
                  <span className="font-semibold">{selectedDetail.email || '(ไม่ได้ระบุ)'}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 block">รหัสรอบรับสมัคร (Round ID):</span>
                  <span className="font-mono text-xs">{selectedDetail.roundId || '-'}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 block">Reason Code:</span>
                  <span className="font-mono text-xs font-semibold">{selectedDetail.reasonCode || '-'}</span>
                </div>
              </div>

              <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
                <span className="text-xs font-semibold text-amber-800 block mb-1">
                  ข้อความข้อผิดพลาดที่ตอบกลับผู้สมัคร (Error Message):
                </span>
                <p className="text-amber-950 font-medium">{selectedDetail.errorMessage}</p>
              </div>

              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                <span className="text-xs font-semibold text-slate-700 block">
                  ข้อมูลเครือข่ายและระบบ (Technical Telemetry Evidence):
                </span>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-500">IP Address: </span>
                    <span className="font-mono">{selectedDetail.ipAddress || '-'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Cloudflare Ray ID: </span>
                    <span className="font-mono">{selectedDetail.cfRay || '-'}</span>
                  </div>
                </div>
                <div className="text-xs">
                  <span className="text-slate-500">Submission Token (Session): </span>
                  <span className="font-mono text-[11px] break-all">{selectedDetail.submissionToken || '-'}</span>
                </div>
                <div className="text-xs">
                  <span className="text-slate-500">User Agent: </span>
                  <span className="font-mono text-[11px] break-all text-slate-600">{selectedDetail.userAgent || '-'}</span>
                </div>
              </div>

              <div className="flex justify-between items-center pt-2">
                <span className="text-xs text-slate-500">
                  สิทธิ์ผู้ใช้งานปัจจุบัน: <span className="font-semibold text-blue-600">{role}</span> (Read-Only)
                </span>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={copyDetailSummary}>
                    {copied ? '✓ คัดลอกสำเร็จ' : 'คัดลอกสรุปข้อเท็จจริง'}
                  </Button>
                  <Button variant="outline" onClick={() => setSelectedDetail(null)}>
                    ปิดหน้าต่าง
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
