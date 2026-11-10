/**
 * Change Tracking Helper
 * 
 * Utility functions for computing and formatting field-level changes
 * for audit log display.
 */

import { toEpochMs } from './round-visibility';

// =============================================================================
// Types
// =============================================================================

export interface FieldChange {
  field: string;           // Field name (English)
  fieldLabel: string;      // Human-readable label (Thai)
  oldValue: string | null; // Previous value
  newValue: string | null; // New value
}

export interface ChangeTrackingData {
  changes: FieldChange[];
  summary: string;         // Short summary for display in table
}

// =============================================================================
// Field Labels (Thai) - Function-based to avoid duplicate keys
// =============================================================================

function getFieldLabel(entityType: string, field: string): string {
  // Entity-specific labels
  const labels: Record<string, Record<string, string>> = {
    ADMIN_USER: {
      email: 'อีเมล',
      role: 'สิทธิ์การใช้งาน',
      isActive: 'สถานะ',
    },
    ORGANIZATION: {
      name: 'ชื่อหน่วยงาน',
      displayOrder: 'ลำดับการแสดง',
      isActive: 'สถานะ',
    },
    JOB_FAMILY: {
      name: 'ชื่อกลุ่มงาน',
      displayOrder: 'ลำดับการแสดง',
      isActive: 'สถานะ',
    },
    POSITION_LEVEL: {
      name: 'ชื่อระดับตำแหน่ง',
      displayOrder: 'ลำดับการแสดง',
      isActive: 'สถานะ',
    },
    POSITION: {
      title: 'ตำแหน่ง',
      organizationId: 'หน่วยงาน',
      jobFamilyId: 'กลุ่มงาน',
      positionLevelId: 'ระดับตำแหน่ง',
      displayOrder: 'ลำดับการแสดง',
      isActive: 'สถานะ',
    },
    RECRUITMENT_ROUND: {
      title: 'ชื่อรอบรับสมัคร',
      positionLevel: 'ระดับตำแหน่ง',
      status: 'สถานะ',
      openDate: 'วันเปิดรับสมัคร',
      closeDate: 'วันปิดรับสมัคร',
      roundCode: 'รหัสรอบ',
      announcementTitle: 'หัวข้อประกาศ',
      announcementDescription: 'รายละเอียดประกาศ',
      contactInformation: 'ข้อมูลติดต่อ',
      remark: 'หมายเหตุ',
    },
    APPLICATION: {
      status: 'สถานะใบสมัคร',
      statusReason: 'เหตุผล',
    },
    TEMPLATE: {
      name: 'ชื่อ Template',
      description: 'คำอธิบาย',
      isPublished: 'สถานะเผยแพร่',
      isArchived: 'สถานะ archive',
    },
    TEMPLATE_VERSION: {
      versionNumber: 'เวอร์ชัน',
      description: 'คำอธิบาย',
    },
    TEMPLATE_SECTION: {
      title: 'ชื่อ Section',
      description: 'คำอธิบาย',
      displayOrder: 'ลำดับ',
    },
    TEMPLATE_FIELD: {
      labelTh: 'ชื่อช่อง (TH)',
      labelEn: 'ชื่อช่อง (EN)',
      placeholderTh: 'Placeholder (TH)',
      placeholderEn: 'Placeholder (EN)',
      isRequired: 'บังคับกรอก',
      displayOrder: 'ลำดับ',
    },
    FIELD_MASTER: {
      fieldType: 'ประเภทฟิลด์',
      labelTh: 'ชื่อฟิลด์ (TH)',
      labelEn: 'ชื่อฟิลด์ (EN)',
    },
  };

  // Try entity-specific label first
  const entityLabels = labels[entityType];
  if (entityLabels && entityLabels[field]) {
    return entityLabels[field];
  }

  // Fallback generic labels
  const genericLabels: Record<string, string> = {
    name: 'ชื่อ',
    title: 'ชื่อ',
    email: 'อีเมล',
    role: 'สิทธิ์การใช้งาน',
    isActive: 'สถานะ',
    displayOrder: 'ลำดับ',
    status: 'สถานะ',
    description: 'คำอธิบาย',
  };

  return genericLabels[field] || field;
}

// =============================================================================
// Value Formatters
// =============================================================================

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'ผู้ดูแลระบบสูงสุด',
  ADMIN: 'ผู้ดูแลระบบ',
  VIEWER: 'ผู้ชม',
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'ร่าง',
  OPEN: 'เปิดรับสมัคร',
  CLOSED: 'ปิดรับสมัคร',
  ARCHIVED: 'เก็บถาวร',
};

const ACTIVE_LABELS: Record<string, string> = {
  true: 'เปิดใช้งาน',
  false: 'ปิดใช้งาน',
  '1': 'เปิดใช้งาน',
  '0': 'ปิดใช้งาน',
};

// =============================================================================
// Date/Time Formatters (audit)
// =============================================================================

const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

/** Asia/Bangkok = UTC+7 (ค่าคงที่ — ไม่พึ่ง timezone ของเครื่อง/Worker) */
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * แปลงวันที่ของ entity → ข้อความสำหรับ audit payload (เวลาไทย + พ.ศ.)
 *
 *   "6 พ.ย. 2569 16:30"
 *
 * ⚠️ ต้องมี **นาที** เสมอ — นี่คือหัวใจของ fix นี้
 *    เดิม PATCH /admin/rounds/:id ใช้ toLocaleDateString('th-TH') ซึ่งเก็บ
 *    แค่วันที่ → การเลื่อนปิดรับสมัคร 16:29 → 16:31 ในวันเดียวกันได้
 *    oldValue === newValue → computeChanges ข้าม → **ไม่มี diff ใน audit เลย**
 *    (เหตุการณ์ที่สำคัญที่สุดของรอบหนึ่ง ๆ หายไปจาก log)
 *
 * ใช้ fixed offset + getUTC* แทน local getters เพราะ Worker รันที่ UTC
 * (pattern เดียวกับ pdf-renderer.service.ts formatThaiDate)
 *
 * ค่าที่อ่านไม่ได้ (null / '' / ขยะ) → null เพื่อให้ computeChanges
 * มองเป็น "ไม่มีค่า" ไม่ใช่ "ค่าว่างที่เปลี่ยน"
 */
export function formatAuditDateTime(value: unknown): string | null {
  const ms = toEpochMs(value as any);
  if (ms === null) return null;
  const d = new Date(ms + BANGKOK_OFFSET_MS);
  const day = d.getUTCDate();
  const month = THAI_MONTHS_SHORT[d.getUTCMonth()];
  const year = d.getUTCFullYear() + 543;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${year} ${hh}:${mm}`;
}

/** field ที่เก็บ "วันเวลา" ของ entity — ต้อง format ด้วย formatAuditDateTime */
const DATETIME_FIELDS = new Set(['openDate', 'closeDate']);

export function formatValue(field: string, value: any): string | null {
  if (value === null || value === undefined) return null;

  // Date/time fields — ต้องเห็นนาที (ดู formatAuditDateTime)
  if (DATETIME_FIELDS.has(field)) {
    return formatAuditDateTime(value);
  }

  // Boolean fields
  if (field === 'isActive' || field === 'isRequired' || field === 'isPublished' || field === 'isArchived') {
    const boolVal = typeof value === 'boolean' ? value : (value === '1' || value === 'true');
    return ACTIVE_LABELS[String(boolVal)] || (boolVal ? 'เปิดใช้งาน' : 'ปิดใช้งาน');
  }
  
  // Role fields
  if (field === 'role') {
    return ROLE_LABELS[value] || value;
  }
  
  // Status fields
  if (field === 'status') {
    return STATUS_LABELS[value] || value;
  }
  
  // Default: return as string
  return String(value);
}

// =============================================================================
// Change Detection
// =============================================================================

/**
 * Computes the differences between old and new values.
 * Only returns fields that have actually changed.
 */
export function computeChanges(
  oldValues: Record<string, any>,
  newValues: Record<string, any>,
  entityType: string
): FieldChange[] {
  const changes: FieldChange[] = [];
  
  // Get all keys from both objects
  const allKeys = new Set([...Object.keys(oldValues), ...Object.keys(newValues)]);
  
  for (const key of allKeys) {
    // Skip internal/system fields
    if (key.startsWith('_') || key === 'id' || key === 'createdAt' || key === 'updatedAt') {
      continue;
    }
    
    const oldVal = oldValues[key];
    const newVal = newValues[key];

    // undefined = field not sent (partial PATCH) — never a change, no diff.
    // null IS a value: X → null (or null → X) must still produce a diff,
    // and false/0/'' are real values too — never skip them.
    if (oldVal === undefined || newVal === undefined) continue;

    // Skip if values are the same (also covers false===false, 0===0, ''==='')
    if (oldVal === newVal) continue;

    // ⚠️ Date objects: `===` เทียบ reference ไม่ใช่ instant → Date สองตัวที่
    //    เป็นเวลาเดียวกันจะไม่เท่ากัน (ได้ false diff ทุกครั้งที่ PATCH ส่งวันที่เดิม)
    //    เทียบด้วย getTime() แทน — และถ้าเท่ากันจริงให้ข้าม
    if (oldVal instanceof Date && newVal instanceof Date) {
      if (oldVal.getTime() === newVal.getTime()) continue;
    }

    changes.push({
      field: key,
      fieldLabel: getFieldLabel(entityType, key),
      oldValue: formatValue(key, oldVal),
      newValue: formatValue(key, newVal),
    });
  }
  
  return changes;
}

// =============================================================================
// Summary Generation
// =============================================================================

/**
 * Generates a short summary string for display in audit log table.
 * Shows first change or count of changes if multiple.
 */
export function generateSummary(changes: FieldChange[]): string {
  if (changes.length === 0) return '';
  
  if (changes.length === 1) {
    const change = changes[0];
    return `${change.fieldLabel}: ${change.oldValue ?? '-'} → ${change.newValue ?? '-'}`;
  }
  
  // Multiple changes - show count
  return `${changes.length} รายการ`;
}

/**
 * Generates a detailed multi-line summary for modal/drawer display.
 */
export function generateDetailedSummary(changes: FieldChange[]): string {
  if (changes.length === 0) return '';
  
  return changes.map(change => {
    const oldDisplay = change.oldValue ?? '(ว่าง)';
    const newDisplay = change.newValue ?? '(ว่าง)';
    return `${change.fieldLabel}:\n${oldDisplay}\n↓\n${newDisplay}`;
  }).join('\n\n');
}

// =============================================================================
// Payload Builder
// =============================================================================

/**
 * Builds the audit payload for UPDATE actions.
 * Includes change tracking data.
 *
 * คืน object — ไม่ stringify ที่นี่แล้ว (เคยทำให้ drizzle `text mode json`
 * stringify ซ้ำเป็น double-encode) encode ครั้งเดียวที่ audit.service
 */
export function buildAuditPayload(
  changes: FieldChange[],
  additionalData?: Record<string, any>
): Record<string, any> | null {
  if (changes.length === 0 && !additionalData) {
    return null;
  }

  const payload: Record<string, any> = {
    changes,
    summary: generateSummary(changes),
  };

  if (additionalData) {
    Object.assign(payload, additionalData);
  }

  return payload;
}

// =============================================================================
// Special Entity Handlers
// =============================================================================

/**
 * Payload สำหรับ CREATE ที่ entityId มาจาก route ไม่ใช่ path param
 *
 * ปัญหาเดิม (POST /admin/rounds): auditMiddleware อ่าน param('id') ไม่ได้
 * (path คือ '/rounds' ไม่มี :id) → entityId = sentinel 'BULK/NEW' และ
 * route ไม่ได้ setAuditPayload เลย → payload = NULL
 *
 * ผลคือ audit log ของการสร้างรอบบอกได้แค่ว่า "มีใครสร้างอะไรบางอย่าง"
 * ไม่มีชื่อรอบ ไม่มีรหัส ไม่มีช่วงเวลาเปิด/ปิด → ตอบคำถามย้อนหลังไม่ได้
 *
 * payload นี้เก็บค่าที่ "ตัดสินตัวตนของรอบ" ไว้ครบ:
 *   roundId, title, roundCode, positionLevel, openDate, closeDate, status
 * (วันที่เก็บเป็นเวลาไทยพร้อมนาที ผ่าน formatValue)
 */
export interface RoundCreateSnapshot {
  id: string;
  title: string;
  roundCode: string | null;
  positionLevel: string;
  openDate: unknown;
  closeDate: unknown;
  status: string | null;
}

export function buildRoundCreatePayload(
  round: RoundCreateSnapshot,
): Record<string, any> {
  return {
    roundId: round.id,
    title: round.title,
    roundCode: round.roundCode,
    positionLevel: round.positionLevel,
    openDate: formatValue('openDate', round.openDate),
    closeDate: formatValue('closeDate', round.closeDate),
    status: round.status,
  };
}

/**
 * Handler for APPLICATION status changes.
 */
export function handleApplicationStatusChange(
  oldStatus: string,
  newStatus: string,
  reason?: string
): ChangeTrackingData {
  const changes: FieldChange[] = [];
  
  if (oldStatus !== newStatus) {
    changes.push({
      field: 'status',
      fieldLabel: 'สถานะใบสมัคร',
      oldValue: formatValue('status', oldStatus),
      newValue: formatValue('status', newStatus),
    });
  }
  
  if (reason) {
    changes.push({
      field: 'statusReason',
      fieldLabel: 'เหตุผล',
      oldValue: null,
      newValue: reason,
    });
  }
  
  return {
    changes,
    summary: generateSummary(changes),
  };
}

/**
 * Handler for ADMIN_USER role changes.
 */
export function handleUserRoleChange(
  oldRole: string,
  newRole: string
): ChangeTrackingData {
  const changes: FieldChange[] = [];
  
  if (oldRole !== newRole) {
    changes.push({
      field: 'role',
      fieldLabel: 'สิทธิ์การใช้งาน',
      oldValue: formatValue('role', oldRole),
      newValue: formatValue('role', newRole),
    });
  }
  
  return {
    changes,
    summary: generateSummary(changes),
  };
}
