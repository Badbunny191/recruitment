/**
 * Excel Export Route Handlers
 * ============================================================================
 * GET  /api/v1/admin/applications/export?roundId=&status=&search=&dateFrom=&dateTo=
 *      Export ตามตัวกรอง (โหมด FILTERED — contract เดิมไม่เปลี่ยน)
 * POST /api/v1/admin/applications/export-selected
 *      body: { roundId, applicationIds: string[] }
 *      Export เฉพาะใบสมัครที่เลือก (โหมด SELECTED)
 *
 * - ติดตั้งใน admin.routes.ts (ถูก authMiddleware ครอบอยู่แล้วที่ use('/*'))
 *   + adminOnlyMiddleware → เฉพาะ ADMIN / SUPER_ADMIN (VIEWER ได้ 403)
 * - ความหมายตัวกรอง GET ตรงกับหน้ารายชื่อผู้สมัคร (ApplicationsClient):
 *     view=active    → status=SUBMITTED,QUALIFIED,REJECTED,CANCELED
 *     view=archived  → status=ARCHIVED
 *     view=all       → ไม่ส่ง status (default ที่ backend = ทุกสถานะยกเว้น DRAFT)
 * - POST ใช้ body JSON เพราะ applicationIds 1,000 รายการ (UUID) ยาวเกิน
 *   URL/query limit ของ browser/Cloudflare (~8-16KB)
 * - ตอบ binary .xlsx พร้อม Content-Type / Content-Disposition
 *   (filename = ASCII fallback, filename* = ชื่อจริง Unicode ตาม RFC 5987)
 * - ชื่อไฟล์สร้างที่ backend จากข้อมูลรอบใน D1 เท่านั้น — ห้ามรับจาก client
 * - Audit log เขียนภายใน service (1 รายการต่อการ export สำเร็จ
 *   พร้อม exportMode FILTERED / SELECTED)
 */

import type { Context } from 'hono';
import { z } from 'zod';
import {
  exportApplicationsExcel,
  exportSelectedApplicationsExcel,
  MAX_EXPORT_ROWS,
} from '../services/excel-export.service';
import { Bindings, AppVariables } from '../types';

export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Body contract ของ POST /applications/export-selected:
 *   - roundId บังคับ
 *   - applicationIds: array ต้องมีอย่างน้อย 1 ไม่เกิน 1,000 รายการ
 *   - ID ซ้ำไม่ reject — service จะ deduplicate
 */
export const ExcelExportSelectedSchema = z.object({
  roundId: z
    .string({ required_error: 'กรุณาระบุรอบรับสมัคร (roundId)' })
    .min(1, 'กรุณาระบุรอบรับสมัคร (roundId)'),
  applicationIds: z
    .array(
      z.string({ invalid_type_error: 'รหัสใบสมัครต้องเป็นข้อความ' })
        .min(1, 'รหัสใบสมัครต้องไม่เป็นค่าว่าง'),
      {
        required_error: 'กรุณาระบุรายการที่เลือก (applicationIds)',
        invalid_type_error: 'applicationIds ต้องเป็น array',
      },
    )
    .min(1, 'ต้องเลือกใบสมัครอย่างน้อย 1 รายการ')
    .max(MAX_EXPORT_ROWS, `เลือกได้สูงสุด ${MAX_EXPORT_ROWS} รายการต่อการ export หนึ่งครั้ง`),
});

// ── Content-Disposition helper ──────────────────────────────────────────────
// filename= เป็น ASCII fallback (client เก่า), filename*= เป็นชื่อจริงตาม
// RFC 5987 — pattern เดียวกับ upload.routes.ts แต่เป็น attachment
// และ escape ' ( ) * ที่ encodeURIComponent ปล่อยไว้ (ไม่ใช่ attr-char)

/** เหลือเฉพาะ ASCII ที่ใส่ header ได้ — กัน CR/LF/quote แบบ defensive */
function asciiHeaderSafe(name: string): string {
  return name.replace(/[^\x21-\x7e]/g, '').replace(/["\\]/g, '') || 'applications.xlsx';
}

/** percent-encoding ตาม RFC 5987 attr-char (เพิ่ม ' ( ) * ที่ encodeURIComponent ไม่ encode) */
function rfc5987Encode(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (ch) => {
    const hex = ch.charCodeAt(0).toString(16).toUpperCase();
    return `%${hex}`;
  });
}

export function contentDispositionAttachment(filename: string, filenameAscii: string): string {
  return `attachment; filename="${asciiHeaderSafe(filenameAscii)}"; filename*=UTF-8''${rfc5987Encode(filename)}`;
}

function xlsxResponse(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
  result: {
    buffer: Uint8Array;
    filename: string;
    filenameAscii: string;
    bytes: number;
  },
): Response {
  return new Response(result.buffer, {
    status: 200,
    headers: {
      'Content-Type': XLSX_CONTENT_TYPE,
      'Content-Disposition': contentDispositionAttachment(result.filename, result.filenameAscii),
      'Content-Length': String(result.bytes),
      'Cache-Control': 'no-store',
    },
  });
}

export async function handleExcelExport(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
): Promise<Response> {
  const filters = {
    roundId: (c.req.query('roundId') || '').trim(),
    status: c.req.query('status') || undefined,
    search: c.req.query('search') || undefined,
    dateFrom: c.req.query('dateFrom') || undefined,
    dateTo: c.req.query('dateTo') || undefined,
  };

  if (!filters.roundId) {
    return c.json({ error: 'BAD_REQUEST', message: 'กรุณาระบุรอบรับสมัคร (roundId)' }, 400);
  }

  const user = c.get('jwtPayload');

  const result = await exportApplicationsExcel(
    c.env,
    filters,
    user?.id ?? 'unknown',
    c.req.header('cf-connecting-ip') ?? null,
  );

  if (!result.ok) {
    return c.json(
      { error: result.code, message: result.message },
      result.httpStatus as 404 | 422,
    );
  }

  return xlsxResponse(c, result);
}

export async function handleExcelExportSelected(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
): Promise<Response> {
  // Body ต้องเป็น JSON object — parse ไม่ได้ให้ 400 ไม่ throw
  const body = await c.req.json().catch(() => null);
  const parsed = ExcelExportSelectedSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => issue.message)
      .filter(Boolean)
      .join('\n') || 'คำขอไม่ถูกต้อง';
    return c.json({ error: 'BAD_REQUEST', message }, 400);
  }

  const user = c.get('jwtPayload');

  const result = await exportSelectedApplicationsExcel(
    c.env,
    parsed.data,
    user?.id ?? 'unknown',
    c.req.header('cf-connecting-ip') ?? null,
  );

  if (!result.ok) {
    return c.json(
      {
        error: result.code,
        message: result.message,
        ...(result.missingCount !== undefined ? { missingCount: result.missingCount } : {}),
      },
      result.httpStatus as 404 | 422,
    );
  }

  return xlsxResponse(c, result);
}
