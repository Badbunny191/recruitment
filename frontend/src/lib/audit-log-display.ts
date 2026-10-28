/**
 * Audit Log display resolver — ฝั่ง client ของ resolver กลาง
 * ---------------------------------------------------------------------------
 * Audit log เก็บ entityId เป็น UUID (historical, ห้ามแก้) — การแสดงผล
 * "ใคร ทำอะไร กับใคร" ประกอบจาก 2 ชั้น:
 *
 *   1. `display` จาก backend (GET /admin/audit-logs → resolveAuditEntityDisplays)
 *      — resolve ครบทุก entityType รวม APPLICATION (appNo + ชื่อผู้สมัคร),
 *      TEMPLATE_VERSION/TEMPLATE_VERSION_DESCRIPTOR (ชื่อ template + vN)
 *      และ EXPORT_EXCEL (entityId = roundId → ชื่อรอบ)
 *   2. fallback client lookup (lookup ที่หน้าโหลดไว้: ROUND/TEMPLATE/...)
 *      — กัน backend resolver ล้ม/ข้อมูล legacy
 *   3. fallback สุดท้าย: UUID ย่อ (shortId)
 *
 * ประกอบ description ด้วย buildAuditDescription — ตัวอย่าง:
 *   PDF_DOWNLOAD  → "ดาวน์โหลด PDF APP-2026-5012 (นายสมชาย ใจดี)"
 *   EXPORT_EXCEL  → "ส่งออก Excel เชี่ยวชาญ 2569 (เชี่ยวชาญ)"
 *   UPDATE + TEMPLATE_VERSION_DESCRIPTOR → "บันทึกตัวประกอบเอกสาร แบบฟอร์มสมัครงาน v5"
 */

export interface AuditEntityDisplay {
  name: string | null;
  secondary: string | null;
}

export interface AuditLogForDisplay {
  action: string;
  entityType: string;
  entityId: string;
  display?: AuditEntityDisplay | null;
}

export interface ResolvedEntity {
  primary: string;
  secondary?: string;
}

type ClientLookup = (entityType: string, entityId: string) => string | null;

// Action Badge Config — ครบทุก action ที่ระบบบันทึกจริง:
// CREATE/UPDATE/DELETE มาจาก auditMiddleware (HTTP method)
// PDF_DOWNLOAD (admin.routes.ts) และ EXPORT_EXCEL (excel-export.service.ts)
// บันทึกแบบ manual — publish/archive ของ template/round ถูกบันทึกเป็น UPDATE
// CHANGE_PASSWORD/RESET_PASSWORD (R9): เปลี่ยนรหัสผ่านเอง / admin รีเซ็ตให้
// CREATE_USER (P0 fix): POST /admin/users — action เฉพาะเพราะ entityId เป็น
//   'BULK/NEW' (ไม่มี :id ใน path) → ต้องแยกจาก CREATE ของ entity อื่น
export const AUDIT_ACTION_CONFIG: Record<string, { label: string; className: string }> = {
  CREATE: { label: 'สร้าง', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  CREATE_USER: { label: 'สร้างผู้ใช้', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  UPDATE: { label: 'แก้ไข', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  DELETE: { label: 'ลบ', className: 'bg-red-100 text-red-700 border-red-200' },
  PDF_DOWNLOAD: { label: 'ดาวน์โหลด PDF', className: 'bg-sky-100 text-sky-700 border-sky-200' },
  EXPORT_EXCEL: { label: 'ส่งออก Excel', className: 'bg-teal-100 text-teal-700 border-teal-200' },
  CHANGE_PASSWORD: { label: 'เปลี่ยนรหัสผ่าน', className: 'bg-violet-100 text-violet-700 border-violet-200' },
  RESET_PASSWORD: { label: 'รีเซ็ตรหัสผ่าน', className: 'bg-orange-100 text-orange-700 border-orange-200' },
};

/** action ที่ไม่รู้จัก → แสดง raw string บน badge สีเทา (fallback) */
export function getAuditActionConfig(action: string): { label: string; className: string } {
  return (
    AUDIT_ACTION_CONFIG[action] || {
      label: action,
      className: 'bg-slate-100 text-slate-700 border-slate-200',
    }
  );
}

export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  RECRUITMENT_ROUND: 'รอบรับสมัคร',
  TEMPLATE: 'Template',
  TEMPLATE_VERSION: 'เวอร์ชัน Template',
  TEMPLATE_SECTION: 'Section',
  TEMPLATE_FIELD: 'ช่องในฟอร์ม',
  TEMPLATE_VERSION_DESCRIPTOR: 'ตัวประกอบเอกสาร (Descriptor)',
  FIELD_MASTER: 'ฟิลด์หลัก',
  APPLICATION: 'ใบสมัคร',
  ROUND_CLONED: 'คัดลอกรอบ',
  ORGANIZATION: 'หน่วยงาน',
  JOB_FAMILY: 'กลุ่มงาน',
  POSITION_LEVEL: 'ระดับตำแหน่ง',
  POSITION: 'ตำแหน่ง',
  ADMIN_USER: 'ผู้ใช้งานระบบ',
};

export function getAuditEntityLabel(entityType: string): string {
  return AUDIT_ENTITY_LABELS[entityType] || entityType;
}

/** UUID ย่อสำหรับ fallback เช่น "65ef…c4ed" */
export function shortId(id: string): string {
  if (!id) return '-';
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

/**
 * Resolve ชื่อ entity ของ 1 log — display จาก backend ก่อน แล้ว client
 * lookup, คืน null เมื่อทั้งคู่ resolve ไม่ได้ (ผู้เรียก fallback shortId)
 */
export function resolveAuditEntity(
  log: AuditLogForDisplay,
  clientLookup: ClientLookup,
): ResolvedEntity | null {
  const d = log.display;
  if (d && d.name) {
    return { primary: d.name, secondary: d.secondary || undefined };
  }
  const client = clientLookup(log.entityType, log.entityId);
  if (client) return { primary: client };
  return null;
}

/**
 * ประกอบประโยค "ใคร ทำอะไร กับใคร" — resolved = ผลของ resolveAuditEntity
 * (null → fallback UUID ย่อ), payload = parsed audit payload (สำหรับ
 * APPLICATION status change)
 */
export function buildAuditDescription(
  log: AuditLogForDisplay,
  resolved: ResolvedEntity | null,
  payload: Record<string, unknown> | null,
): string {
  const display = resolved || { primary: shortId(log.entityId) };
  const target = display.secondary
    ? `${display.primary} (${display.secondary})`
    : display.primary;
  const entityLabel = getAuditEntityLabel(log.entityType);

  // จุดประสงค์เฉพาะของ action พิเศษ (ไม่ได้มาจาก HTTP method)
  if (log.action === 'PDF_DOWNLOAD') {
    return `ดาวน์โหลด PDF ${target}`;
  }
  if (log.action === 'EXPORT_EXCEL') {
    return `ส่งออก Excel ${target}`;
  }
  if (log.entityType === 'TEMPLATE_VERSION_DESCRIPTOR') {
    // entityId = templateVersions.id — secondary = "vN" (จาก backend resolver)
    const version = display.secondary ? ` ${display.secondary}` : '';
    return `บันทึกตัวประกอบเอกสาร ${display.primary}${version}`;
  }
  if (log.entityType === 'ROUND_CLONED') {
    return `คัดลอกรอบรับสมัคร → ${display.primary}`;
  }
  // CREATE_USER — entityId = 'BULK/NEW' (ไม่มี :id ใน path) จึง resolve ไม่ได้
  // → ใช้ targetEmail/targetUserId จาก payload แทน
  if (log.action === 'CREATE_USER') {
    const targetEmail =
      payload && typeof payload === 'object' && typeof payload.targetEmail === 'string'
        ? payload.targetEmail
        : null;
    const role =
      payload && typeof payload === 'object' && typeof payload.role === 'string'
        ? payload.role
        : null;
    const who = targetEmail ?? display.primary;
    return role ? `สร้างผู้ใช้ ${who} (${role})` : `สร้างผู้ใช้ ${who}`;
  }
  if (
    log.entityType === 'APPLICATION' &&
    log.action === 'UPDATE' &&
    payload &&
    typeof payload === 'object' &&
    payload.status
  ) {
    const reason = payload.statusReason ? ` (${payload.statusReason})` : '';
    return `เปลี่ยนสถานะใบสมัคร → ${payload.status}${reason}`;
  }

  switch (log.action) {
    case 'CREATE':
      return `สร้าง${entityLabel} ${display.primary}`;
    case 'UPDATE':
      return `แก้ไข${entityLabel} ${display.primary}`;
    case 'DELETE':
      return `ลบ${entityLabel} ${display.primary}`;
    default:
      return `${log.action} ${entityLabel} ${display.primary}`;
  }
}
