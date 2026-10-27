/**
 * Change Tracking Helper
 * 
 * Utility functions for computing and formatting field-level changes
 * for audit log display.
 */

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

export function formatValue(field: string, value: any): string | null {
  if (value === null || value === undefined) return null;
  
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
 */
export function buildAuditPayload(
  changes: FieldChange[],
  additionalData?: Record<string, any>
): string | null {
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
  
  return JSON.stringify(payload);
}

// =============================================================================
// Special Entity Handlers
// =============================================================================

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
