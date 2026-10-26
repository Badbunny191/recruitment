/**
 * Template Version options สำหรับ dropdown ใน flow Create/Edit Round
 * ============================================================================
 * ปัญหา: endpoint `/admin/template-versions/published` คืน Published version
 * ทุก version ของทุก template → dropdown แสดงซ้ำหลายรายการของ template เดียวกัน
 * (เช่น "เชี่ยวชาญ 2569 v2/v3/v4/v5") → admin เลือกผิดได้ง่าย
 *
 * กฎที่ใช้: แสดงเฉพาะ Published version ล่าสุดของแต่ละ template (max versionNumber)
 *
 * ⚠️ ข้อมูลเก่าไม่ถูกลบ — ฟังก์ชันนี้เป็นการ "เลือก" สำหรับแสดงผลเท่านั้น
 *    ไม่กระทบหน้า History ของ Template Builder (หน้านั้นโหลดข้อมูลเอง)
 */

export interface PublishedTemplateVersion {
  id: string;
  versionNumber: number;
  status: string;
  templateId: string;
  templateName: string;
}

/**
 * เลือก Published version ล่าสุดของแต่ละ template
 * - group by templateId
 * - เลือกตัวที่ versionNumber สูงสุด
 * - tie-break: createdAt ใหม่กว่า → id มากกว่า (กำหนดลำดับแน่นอน)
 * - เรียงผลลัพธ์ตาม templateName แล้ว versionNumber (คงลำดับเดิมของ dropdown)
 *
 * ไม่แก้ array ต้นฉบับ (pure function)
 */
export function pickLatestPublishedPerTemplate(
  versions: readonly PublishedTemplateVersion[]
): PublishedTemplateVersion[] {
  const latestByTemplate = new Map<string, PublishedTemplateVersion>();

  for (const v of versions) {
    if (!v || !v.templateId || !v.id) continue;
    const current = latestByTemplate.get(v.templateId);
    if (!current || isNewer(v, current)) {
      latestByTemplate.set(v.templateId, v);
    }
  }

  return Array.from(latestByTemplate.values()).sort(compareVersions);
}

/**
 * ตัวเลือกสำหรับ dropdown ใน flow Create/Edit Round
 *
 * @param versions  Published versions ทั้งหมดจาก API
 * @param selectedVersionId  version ที่รอบกำลังใช้อยู่ (โหมด Edit)
 * @param selectedVersionMeta  ข้อมูล version ปัจจุบันของรอบ (ชื่อ template + เลข version)
 *        ใช้ fallback เมื่อ version ที่รอบใช้อยู่ถูก unpublish แล้ว (ไม่อยู่ในรายการ Published)
 *        → ยังต้องแสดงไว้ ไม่งั้น Select จะไม่มี option ตรงกับค่าที่เลือก
 */
export function buildTemplateVersionOptions(
  versions: readonly PublishedTemplateVersion[],
  selectedVersionId?: string | null,
  selectedVersionMeta?: { templateName?: string | null; versionNumber?: number | null } | null
): PublishedTemplateVersion[] {
  const latest = pickLatestPublishedPerTemplate(versions);

  if (!selectedVersionId) return latest;

  if (latest.some((v) => v.id === selectedVersionId)) return latest;

  // version ปัจจุบันยัง published → ต่อท้ายกลับเข้ามา
  const current = versions.find((v) => v.id === selectedVersionId);
  if (current) return [...latest, current].sort(compareVersions);

  // version ปัจจุบันถูก unpublish แล้ว → สร้าง option จากข้อมูลของรอบ (ถ้ามี)
  if (
    selectedVersionMeta &&
    selectedVersionMeta.templateName &&
    selectedVersionMeta.versionNumber != null
  ) {
    const fallback: PublishedTemplateVersion = {
      id: selectedVersionId,
      versionNumber: selectedVersionMeta.versionNumber,
      status: 'PUBLISHED',
      templateId: `__current__${selectedVersionId}`,
      templateName: selectedVersionMeta.templateName,
    };
    return [...latest, fallback].sort(compareVersions);
  }

  return latest;
}

/** label ใน dropdown — เพิ่มเครื่องหมายกำกับ version ที่รอบใช้อยู่แต่ไม่ใช่ตัวล่าสุด */
export function formatTemplateVersionOptionLabel(
  version: PublishedTemplateVersion,
  isCurrentRoundVersion = false
): string {
  const base = `${version.templateName} v${version.versionNumber}`;
  return isCurrentRoundVersion ? `${base} (เวอร์ชันที่รอบใช้อยู่)` : base;
}

// ── internal helpers ────────────────────────────────────────────────────────

function isNewer(a: PublishedTemplateVersion, b: PublishedTemplateVersion): boolean {
  if (a.versionNumber !== b.versionNumber) return a.versionNumber > b.versionNumber;
  // tie-break ด้วย createdAt (ถ้ามี) แล้ว id
  const aCreated = (a as any).createdAt as number | string | Date | undefined;
  const bCreated = (b as any).createdAt as number | string | Date | undefined;
  const aTime = toTime(aCreated);
  const bTime = toTime(bCreated);
  if (aTime !== bTime) return aTime > bTime;
  return a.id > b.id;
}

function toTime(value: number | string | Date | undefined): number {
  if (value === undefined || value === null) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compareVersions(a: PublishedTemplateVersion, b: PublishedTemplateVersion): number {
  const byName = a.templateName.localeCompare(b.templateName, 'th');
  if (byName !== 0) return byName;
  if (a.versionNumber !== b.versionNumber) return a.versionNumber - b.versionNumber;
  return a.id.localeCompare(b.id);
}
