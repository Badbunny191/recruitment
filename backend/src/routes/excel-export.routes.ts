/**
 * Excel Export Route Handler
 * ============================================================================
 * GET /api/v1/admin/applications/export?roundId=&status=&search=&dateFrom=&dateTo=
 *
 * - ติดตั้งใน admin.routes.ts (ถูก authMiddleware ครอบอยู่แล้วที่ use('/*'))
 *   + adminOnlyMiddleware → เฉพาะ ADMIN / SUPER_ADMIN (VIEWER ได้ 403)
 * - ความหมายตัวกรองตรงกับหน้ารายชื่อผู้สมัคร (ApplicationsClient):
 *     view=active    → status=SUBMITTED,QUALIFIED,REJECTED,CANCELED
 *     view=archived  → status=ARCHIVED
 *     view=all       → ไม่ส่ง status (default ที่ backend = ทุกสถานะยกเว้น DRAFT)
 * - ตอบ binary .xlsx พร้อม Content-Type / Content-Disposition
 * - Audit log เขียนภายใน service (1 รายการต่อการ export สำเร็จ)
 */

import type { Context } from 'hono';
import { exportApplicationsExcel } from '../services/excel-export.service';
import { Bindings, AppVariables } from '../types';

export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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

  return new Response(result.buffer, {
    status: 200,
    headers: {
      'Content-Type': XLSX_CONTENT_TYPE,
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Content-Length': String(result.bytes),
      'Cache-Control': 'no-store',
    },
  });
}
