'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { StatusBadge, ApplicationStatus } from '@/components/ui/status-badge';
import { formatDateThai } from '@/lib/date';
import { parseContentDispositionFilename } from '@/lib/pdf-download';

interface RoundOption {
  id: string;
  title: string;
  positionLevel?: string;
  status?: string;
}

interface LookupResult {
  applicationNo: string;
  fullname?: string;
  positionTitle: string;
  roundTitle?: string;
  submittedAt: string | number | Date | null;
  status: string;
  statusReason?: string | null;
}

export default function LookupPage() {
  const [rounds, setRounds] = useState<RoundOption[]>([]);
  const [roundsLoading, setRoundsLoading] = useState(true);

  const [roundId, setRoundId] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const [isSearching, setIsSearching] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);

  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Load rounds on mount
  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';

    // Try lookup-options first (includes active and closed rounds)
    fetch(`${apiUrl}/public/rounds/lookup-options`)
      .then(async (res) => {
        if (!res.ok) {
          // Fallback to active rounds
          return fetch(`${apiUrl}/public/rounds/active`).then((r) => r.json());
        }
        return res.json();
      })
      .then((data) => {
        const list: RoundOption[] = data.data || [];
        setRounds(list);
        setRoundsLoading(false);
      })
      .catch(() => {
        // Fallback to active rounds on network error
        fetch(`${apiUrl}/public/rounds/active`)
          .then((r) => r.json())
          .then((data) => {
            setRounds(data.data || []);
            setRoundsLoading(false);
          })
          .catch(() => setRoundsLoading(false));
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setResult(null);
    setDownloadError(null);

    if (!roundId) {
      setErrorMessage('กรุณาเลือกรอบรับสมัคร');
      return;
    }
    if (!email.trim()) {
      setErrorMessage('กรุณากรอกอีเมล');
      return;
    }
    const cleanPhone = phone.trim();
    if (!cleanPhone) {
      setErrorMessage('กรุณากรอกเบอร์โทรศัพท์');
      return;
    }
    if (/[^0-9+\s\-().]/.test(cleanPhone)) {
      setErrorMessage('รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง (ตัวอย่าง: 0812345678 หรือ 081-234-5678)');
      return;
    }

    setIsSearching(true);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
      const response = await fetch(`${apiUrl}/public/applications/lookup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          roundId,
          email: email.trim(),
          phone: cleanPhone,
        }),
      });

      const json = await response.json();

      if (response.ok && json.success && json.data) {
        setResult(json.data);
      } else {
        const errorText =
          typeof json.error === 'string'
            ? json.error
            : json.error?.issues?.[0]?.message ||
              'ไม่พบข้อมูลใบสมัครที่ตรงกับข้อมูลที่ระบุ กรุณาตรวจสอบรอบรับสมัคร อีเมล และเบอร์โทรศัพท์อีกครั้ง';
        setErrorMessage(errorText);
      }
    } catch {
      setErrorMessage('ไม่สามารถเชื่อมต่อกับระบบได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setIsSearching(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!result) return;
    setIsDownloadingPdf(true);
    setDownloadError(null);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
      const response = await fetch(`${apiUrl}/public/applications/download-pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          roundId,
          email: email.trim(),
          phone: phone.trim(),
        }),
      });

      if (!response.ok) {
        const errorJson = await response.json().catch(() => null);
        throw new Error(errorJson?.error || 'ไม่สามารถดาวน์โหลดใบสมัครได้');
      }

      // ชื่อไฟล์จาก backend (Source of Truth) — filename* ก่อน filename
      // Header ไม่มี/ผิดรูปแบบ → fallback เลขที่ใบสมัคร (ห้าม resolve pattern เอง)
      const disposition = response.headers.get('Content-Disposition') || '';
      const filename =
        parseContentDispositionFilename(disposition) ||
        `${result.applicationNo || 'application'}.pdf`;

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(link);
    } catch (err: any) {
      setDownloadError(err?.message || 'เกิดข้อผิดพลาดในการดาวน์โหลด กรุณาลองใหม่อีกครั้ง');
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-8 space-y-6">
      {/* Breadcrumb / Back link */}
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
        >
          <span>←</span> กลับหน้ารอบรับสมัคร
        </Link>
      </div>

      {/* Main card */}
      <Card className="shadow-md border-slate-200">
        <CardHeader className="border-b border-slate-100 bg-slate-50/50 pb-5">
          <CardTitle className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <span aria-hidden="true">🔍</span> ค้นหาใบสมัคร
          </CardTitle>
          <p className="text-slate-500 text-sm mt-1">
            ระบุรอบรับสมัคร อีเมล และเบอร์โทรศัพท์ที่ใช้ในการสมัครเพื่อตรวจสอบสถานะใบสมัคร
          </p>
        </CardHeader>

        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Round select */}
            <div className="space-y-1.5">
              <Label htmlFor="roundId" className="text-slate-700 font-medium text-sm">
                รอบรับสมัคร <span className="text-red-500">*</span>
              </Label>
              <Select
                id="roundId"
                value={roundId}
                onChange={(e) => setRoundId(e.target.value)}
                disabled={roundsLoading || isSearching}
                required
              >
                <option value="">
                  {roundsLoading ? 'กำลังโหลดรอบรับสมัคร...' : 'เลือกรอบรับสมัคร'}
                </option>
                {rounds.map((round) => (
                  <option key={round.id} value={round.id}>
                    {round.title} {round.positionLevel ? `(${round.positionLevel})` : ''}
                  </option>
                ))}
              </Select>
            </div>

            {/* Email input */}
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-slate-700 font-medium text-sm">
                อีเมล <span className="text-red-500">*</span>
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@email.com"
                disabled={isSearching}
                required
              />
            </div>

            {/* Phone input */}
            <div className="space-y-1.5">
              <Label htmlFor="phone" className="text-slate-700 font-medium text-sm">
                เบอร์โทรศัพท์ <span className="text-red-500">*</span>
              </Label>
              <Input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="08XXXXXXXX หรือ 02XXXXXXX"
                disabled={isSearching}
                required
              />
            </div>

            {/* Error banner */}
            {errorMessage && (
              <div
                role="alert"
                className="p-4 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm flex items-start gap-2.5 animate-fadeIn"
              >
                <span className="text-base font-bold leading-none mt-0.5">⚠️</span>
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Submit button */}
            <div className="pt-2">
              <Button
                type="submit"
                disabled={isSearching || roundsLoading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 text-base shadow-sm"
              >
                {isSearching ? 'กำลังค้นหา...' : 'ค้นหาใบสมัคร'}
              </Button>
            </div>
          </form>

          {/* Results section */}
          {result && (
            <div className="mt-8 pt-6 border-t border-slate-200 animate-fadeIn">
              <div className="rounded-lg border border-emerald-200 bg-white overflow-hidden shadow-sm">
                <div className="bg-emerald-50 px-4 py-3 border-b border-emerald-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-700 text-base font-bold">✓</span>
                    <span className="font-semibold text-emerald-900 text-sm">
                      พบข้อมูลใบสมัคร
                    </span>
                  </div>
                  <StatusBadge status={(result.status || 'SUBMITTED') as ApplicationStatus} />
                </div>

                <div className="p-5 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* เลขที่ใบสมัคร */}
                    <div className="space-y-1">
                      <span className="text-xs text-slate-500 font-medium block">
                        เลขที่ใบสมัคร
                      </span>
                      <span className="text-xl font-mono font-bold text-blue-900 block tracking-tight">
                        {result.applicationNo}
                      </span>
                    </div>

                    {/* ชื่อ-นามสกุล */}
                    <div className="space-y-1">
                      <span className="text-xs text-slate-500 font-medium block">
                        ชื่อ-นามสกุล
                      </span>
                      <span className="text-base font-semibold text-slate-800 block">
                        {result.fullname || '-'}
                      </span>
                    </div>

                    {/* ตำแหน่งที่สมัคร */}
                    <div className="space-y-1">
                      <span className="text-xs text-slate-500 font-medium block">
                        ตำแหน่งที่สมัคร
                      </span>
                      <span className="text-base font-semibold text-slate-800 block">
                        {result.positionTitle || '-'}
                      </span>
                    </div>

                    {/* วันที่สมัคร */}
                    <div className="space-y-1">
                      <span className="text-xs text-slate-500 font-medium block">
                        วันที่สมัคร
                      </span>
                      <span className="text-sm font-medium text-slate-700 block">
                        {formatDateThai(result.submittedAt, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>

                    {/* สถานะปัจจุบัน */}
                    <div className="space-y-1 sm:col-span-2">
                      <span className="text-xs text-slate-500 font-medium block">
                        สถานะปัจจุบัน
                      </span>
                      <div className="pt-0.5">
                        <StatusBadge status={(result.status || 'SUBMITTED') as ApplicationStatus} />
                      </div>
                    </div>

                    {/* เหตุผล (หากสถานะเป็น ข้อมูลไม่ครบถ้วน หรือ ยกเลิกใบสมัคร) */}
                    {(result.status === 'REJECTED' || result.status === 'CANCELED') && (
                      <div className="space-y-1 sm:col-span-2 bg-amber-50/70 border border-amber-200 rounded-md p-3.5">
                        <span className="text-xs text-amber-800 font-semibold block">
                          เหตุผล
                        </span>
                        <span className="text-sm font-medium text-slate-800 block whitespace-pre-wrap">
                          {result.statusReason || '-'}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* ปุ่มดาวน์โหลด PDF ใต้ผลลัพธ์การค้นหา */}
                  <div className="pt-4 border-t border-slate-200 flex flex-col gap-2">
                    <Button
                      type="button"
                      onClick={handleDownloadPdf}
                      disabled={isDownloadingPdf}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 shadow-sm inline-flex items-center justify-center gap-2"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      {isDownloadingPdf ? 'กำลังดาวน์โหลด...' : 'ดาวน์โหลดใบสมัคร PDF'}
                    </Button>
                    {downloadError && (
                      <p className="text-sm text-red-600 font-medium text-center">
                        {downloadError}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
