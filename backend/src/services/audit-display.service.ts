/**
 * Audit Display Resolver — resolver กลางสำหรับหน้า Audit Logs
 * ============================================================================
 * Audit log เก็บ entityId เป็น UUID ตอนเกิดเหตุการณ์ (write-once, ห้ามแก้
 * historical data) — การแปลงเป็นชื่อที่คนอ่าน ("ใคร ทำอะไร กับใคร") ทำ
 * ณ ตอนอ่านผ่าน resolver นี้เท่านั้น
 *
 * ออกแบบ:
 *   - resolve เฉพาะรายการในหน้าปัจจุบัน (≤100 แถว) ไม่ใช่ทั้งตาราง
 *   - group entityId ต่อ entityType → query แบบ IN (...) ต่อ chunk ≤ 90
 *     (D1 bind limit — pattern เดียวกับ excel-export.service.ts)
 *   - resolve ไม่ได้ (ข้อมูลถูกลบ/UUID แปลก) → ไม่มีรายการใน map
 *     → caller/fallback แสดง UUID ย่อแทน
 *   - พิเศษ (legacy): EXPORT_EXCEL รุ่นเก่าบันทึก entityType='APPLICATION'
 *     แต่ entityId = roundId → resolve เป็นรอบรับสมัครตาม action
 *     (เขียนใหม่แล้วเป็น RECRUITMENT_ROUND — ดู writeExportAudit)
 *
 * ผลลัพธ์เป็น { name, secondary } เพื่อให้ frontend จัด 2 บรรทัดได้ เช่น
 *   APPLICATION          → "APP-2026-5012" / "นายสมชาย ใจดี"
 *   TEMPLATE_VERSION(+)  → "แบบฟอร์มสมัครงาน" / "v5"
 *   RECRUITMENT_ROUND    → "เชี่ยวชาญ 2569" / "เชี่ยวชาญ"
 */

import { eq, inArray } from 'drizzle-orm';
import type { drizzle as drizzleFn } from 'drizzle-orm/d1';
import {
  adminUsers,
  applications,
  fieldMaster,
  jobFamilies,
  organizations,
  positionLevels,
  positions,
  recruitmentRounds,
  templates,
  templateVersions,
} from '../db/schema';

type DB = ReturnType<typeof drizzleFn<any>>;

/** D1 limit: ทุก query ที่รับ array (IN (...)) แบ่ง chunk ≤ 90 bind */
const IN_CLAUSE_CHUNK_SIZE = 90;

export interface AuditLogRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
}

export interface AuditEntityDisplay {
  /** ชื่อหลักที่คนอ่าน — null เมื่อ resolve ไม่ได้ (fallback UUID ฝั่ง UI) */
  name: string | null;
  /** บรรทัดรอง เช่น ชื่อผู้สมัคร / vN / ระดับตำแหน่ง */
  secondary: string | null;
}

export type AuditDisplayMap = Record<string, AuditEntityDisplay>;

/** แบ่ง array เป็น chunk ขนาดเท่า ๆ กัน (ตัวสุดท้ายอาจสั้นกว่า) */
function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * กลุ่ม resolve ต่อ log — คืน null เมื่อ entityType ไม่รู้จัก (ข้าม)
 * EXPORT_EXCEL (legacy): log เก่า entityId เป็น roundId แม้ entityType
 * จะเป็น APPLICATION — log ใหม่เป็น RECRUITMENT_ROUND อยู่แล้ว
 */
function strategyFor(log: AuditLogRow): string | null {
  switch (log.entityType) {
    case 'APPLICATION':
      return log.action === 'EXPORT_EXCEL' ? 'ROUND' : 'APPLICATION';
    case 'RECRUITMENT_ROUND':
    case 'ROUND_CLONED':
      return 'ROUND';
    case 'TEMPLATE':
      return 'TEMPLATE';
    case 'TEMPLATE_VERSION':
    case 'TEMPLATE_VERSION_DESCRIPTOR':
      return 'TEMPLATE_VERSION';
    case 'FIELD_MASTER':
      return 'FIELD_MASTER';
    case 'ORGANIZATION':
      return 'ORGANIZATION';
    case 'JOB_FAMILY':
      return 'JOB_FAMILY';
    case 'POSITION_LEVEL':
      return 'POSITION_LEVEL';
    case 'POSITION':
      return 'POSITION';
    case 'ADMIN_USER':
      return 'ADMIN_USER';
    default:
      return null;
  }
}

async function lookupInChunks<T>(
  ids: string[],
  load: (chunk: string[]) => Promise<T[]>,
  pick: (row: T) => AuditEntityDisplay,
): Promise<Map<string, AuditEntityDisplay>> {
  const map = new Map<string, AuditEntityDisplay>();
  for (const chunk of chunkArray(ids, IN_CLAUSE_CHUNK_SIZE)) {
    const rows = await load(chunk);
    for (const row of rows) {
      map.set((row as { id: string }).id, pick(row));
    }
  }
  return map;
}

/**
 * Resolve ชื่อ entity สำหรับ audit logs ชุดหนึ่ง (หน้าปัจจุบัน)
 * คืน map จาก log.id → display — log ที่ resolve ไม่ได้จะไม่อยู่ใน map
 */
export async function resolveAuditEntityDisplays(
  db: DB,
  logs: AuditLogRow[],
): Promise<AuditDisplayMap> {
  const result: AuditDisplayMap = {};
  if (!Array.isArray(logs) || logs.length === 0) return result;

  // ── 1) group entityId ต่อกลุ่ม resolve ────────────────────────────────
  const idsByStrategy = new Map<string, Set<string>>();
  for (const log of logs) {
    if (!log.entityId || log.entityId === 'BULK/NEW') continue;
    const strategy = strategyFor(log);
    if (!strategy) continue;
    let set = idsByStrategy.get(strategy);
    if (!set) {
      set = new Set();
      idsByStrategy.set(strategy, set);
    }
    set.add(log.entityId);
  }

  // ── 2) query ทีละกลุ่ม (batched IN, ไม่ N+1) ──────────────────────────
  const maps = new Map<string, Map<string, AuditEntityDisplay>>();

  const appIds = [...(idsByStrategy.get('APPLICATION') ?? [])];
  if (appIds.length > 0) {
    maps.set(
      'APPLICATION',
      await lookupInChunks(
        appIds,
        (chunk) =>
          db
            .select({
              id: applications.id,
              applicationNo: applications.applicationNo,
              fullname: applications.fullname,
            })
            .from(applications)
            .where(inArray(applications.id, chunk)),
        (r) => ({ name: r.applicationNo ?? r.id, secondary: r.fullname ?? null }),
      ),
    );
  }

  const roundIds = [...(idsByStrategy.get('ROUND') ?? [])];
  if (roundIds.length > 0) {
    maps.set(
      'ROUND',
      await lookupInChunks(
        roundIds,
        (chunk) =>
          db
            .select({
              id: recruitmentRounds.id,
              title: recruitmentRounds.title,
              positionLevel: recruitmentRounds.positionLevel,
            })
            .from(recruitmentRounds)
            .where(inArray(recruitmentRounds.id, chunk)),
        (r) => ({ name: r.title ?? null, secondary: r.positionLevel ?? null }),
      ),
    );
  }

  const templateIds = [...(idsByStrategy.get('TEMPLATE') ?? [])];
  if (templateIds.length > 0) {
    maps.set(
      'TEMPLATE',
      await lookupInChunks(
        templateIds,
        (chunk) =>
          db
            .select({ id: templates.id, name: templates.name })
            .from(templates)
            .where(inArray(templates.id, chunk)),
        (r) => ({ name: r.name ?? null, secondary: null }),
      ),
    );
  }

  // TEMPLATE_VERSION + TEMPLATE_VERSION_DESCRIPTOR: entityId = templateVersions.id
  // ต้อง join templates เพื่อได้ชื่อ template + เลข version
  const versionIds = [...(idsByStrategy.get('TEMPLATE_VERSION') ?? [])];
  if (versionIds.length > 0) {
    maps.set(
      'TEMPLATE_VERSION',
      await lookupInChunks(
        versionIds,
        (chunk) =>
          db
            .select({
              id: templateVersions.id,
              versionNumber: templateVersions.versionNumber,
              templateName: templates.name,
            })
            .from(templateVersions)
            .innerJoin(templates, eq(templateVersions.templateId, templates.id))
            .where(inArray(templateVersions.id, chunk)),
        (r) => ({ name: r.templateName ?? null, secondary: `v${r.versionNumber}` }),
      ),
    );
  }

  const fieldIds = [...(idsByStrategy.get('FIELD_MASTER') ?? [])];
  if (fieldIds.length > 0) {
    maps.set(
      'FIELD_MASTER',
      await lookupInChunks(
        fieldIds,
        (chunk) =>
          db
            .select({ id: fieldMaster.id, labelTh: fieldMaster.labelTh })
            .from(fieldMaster)
            .where(inArray(fieldMaster.id, chunk)),
        (r) => ({ name: r.labelTh ?? null, secondary: null }),
      ),
    );
  }

  const orgIds = [...(idsByStrategy.get('ORGANIZATION') ?? [])];
  if (orgIds.length > 0) {
    maps.set(
      'ORGANIZATION',
      await lookupInChunks(
        orgIds,
        (chunk) =>
          db
            .select({ id: organizations.id, name: organizations.name })
            .from(organizations)
            .where(inArray(organizations.id, chunk)),
        (r) => ({ name: r.name ?? null, secondary: null }),
      ),
    );
  }

  const jobFamilyIds = [...(idsByStrategy.get('JOB_FAMILY') ?? [])];
  if (jobFamilyIds.length > 0) {
    maps.set(
      'JOB_FAMILY',
      await lookupInChunks(
        jobFamilyIds,
        (chunk) =>
          db
            .select({ id: jobFamilies.id, name: jobFamilies.name })
            .from(jobFamilies)
            .where(inArray(jobFamilies.id, chunk)),
        (r) => ({ name: r.name ?? null, secondary: null }),
      ),
    );
  }

  const levelIds = [...(idsByStrategy.get('POSITION_LEVEL') ?? [])];
  if (levelIds.length > 0) {
    maps.set(
      'POSITION_LEVEL',
      await lookupInChunks(
        levelIds,
        (chunk) =>
          db
            .select({ id: positionLevels.id, name: positionLevels.name })
            .from(positionLevels)
            .where(inArray(positionLevels.id, chunk)),
        (r) => ({ name: r.name ?? null, secondary: null }),
      ),
    );
  }

  const positionIds = [...(idsByStrategy.get('POSITION') ?? [])];
  if (positionIds.length > 0) {
    maps.set(
      'POSITION',
      await lookupInChunks(
        positionIds,
        (chunk) =>
          db
            .select({ id: positions.id, title: positions.title })
            .from(positions)
            .where(inArray(positions.id, chunk)),
        (r) => ({ name: r.title ?? null, secondary: null }),
      ),
    );
  }

  const adminIds = [...(idsByStrategy.get('ADMIN_USER') ?? [])];
  if (adminIds.length > 0) {
    maps.set(
      'ADMIN_USER',
      await lookupInChunks(
        adminIds,
        (chunk) =>
          db
            .select({ id: adminUsers.id, email: adminUsers.email })
            .from(adminUsers)
            .where(inArray(adminUsers.id, chunk)),
        (r) => ({ name: r.email ?? null, secondary: null }),
      ),
    );
  }

  // ── 3) ผูกกลับเป็น map ต่อ log.id ─────────────────────────────────────
  for (const log of logs) {
    const strategy = strategyFor(log);
    if (!strategy) continue;
    const display = maps.get(strategy)?.get(log.entityId);
    if (display) result[log.id] = display;
  }

  return result;
}
