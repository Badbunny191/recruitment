/**
 * Template Descriptor Service
 * --------------------------------------------
 * Feature: Document Composer V1 — Descriptor Storage Layer
 *
 * จัดการ DocumentDescriptor ที่เก็บใน template_versions
 * - load descriptor (with version check)
 * - save descriptor (with validation)
 * - clear descriptor (revert to legacy render)
 *
 * Version-safety:
 * - descriptor_json = null → legacy path (fallback)
 * - descriptor_schema_version = null → ไม่รู้ schema version → fallback
 *   (ถ้า column ถูก add ทีหลังและ row เก่ายังไม่ถูก populate)
 * - descriptor_schema_version mismatch → fallback (return default empty
 *   descriptor + warning ใน result)
 * - ทุก save ต้องผ่าน validateDescriptor() ก่อน persist
 *
 * D1/SQLite considerations:
 * - descriptor_json เก็บเป็น TEXT (JSON serialized) ใช้ Drizzle json mode
 * - การอ่าน/เขียน atomic — ไม่มี concurrent edit conflict (เพราะไม่มี
 *   high-frequency updates แบบ round_sequences)
 *
 * Important:
 * - ไม่ได้ใช้ immutability pattern (เหมือน round_sequences) เพราะ
 *   template descriptor ถูก edit บ่อยในอนาคต (UI editor)
 */

import { eq, sql } from 'drizzle-orm';
import type { drizzle as drizzleFn } from 'drizzle-orm/d1';
import { templateVersions } from '../db/schema';
import {
  validateDescriptor,
  type DocumentDescriptorInput,
} from '../lib/document-composer';
import type { DocumentDescriptor } from '../lib/document-composer/types';

type DB = ReturnType<typeof drizzleFn<any>>;

/**
 * Current descriptor schema version — ต้องตรงกับ types.ts:DocumentDescriptor.version
 * ถ้า types.ts version เปลี่ยน → bump constant นี้ + เขียน migration transform
 */
export const CURRENT_DESCRIPTOR_SCHEMA_VERSION = 1;

// =============================================================================
// Result types
// =============================================================================

export interface LoadDescriptorSuccess {
  ok: true;
  descriptor: DocumentDescriptor;
  /** schema version ที่ save ไว้ใน DB (= CURRENT_DESCRIPTOR_SCHEMA_VERSION) */
  schemaVersion: number;
  /** meta สำหรับ debugging */
  meta: {
    source: 'db' | 'default';
    loadedAt: number;
  };
}

export interface LoadDescriptorFallback {
  ok: true;
  descriptor: DocumentDescriptor;
  schemaVersion: null;
  meta: {
    source: 'default';
    reason: 'NO_DESCRIPTOR' | 'VERSION_MISMATCH' | 'NOT_FOUND' | 'INVALID_JSON';
    loadedAt: number;
  };
}

export type LoadDescriptorResult = LoadDescriptorSuccess | LoadDescriptorFallback;

export type SaveDescriptorResult =
  | { ok: true; schemaVersion: number; savedAt: number }
  | { ok: false; reason: 'NOT_FOUND' | 'VALIDATION_FAILED' | 'VERSION_MISMATCH' | 'DB_ERROR'; error?: string; issues?: { path: string; message: string }[] };

export type ClearDescriptorResult =
  | { ok: true }
  | { ok: false; reason: 'NOT_FOUND' | 'DB_ERROR'; error?: string };

// =============================================================================
// Default descriptor (fallback เมื่อ DB ไม่มี / version mismatch)
// =============================================================================

/**
 * Default descriptor ใช้เป็น fallback เท่านั้น
 *
 * - ไม่มี block → render เป็น PDF เปล่า (header + footer + body ว่าง)
 * - caller สามารถเช็ค `meta.source === 'default'` แล้วตัดสินใจ
 *   ว่าจะใช้ descriptor นี้ หรือ fallback ไป pdf-renderer.service.ts legacy path
 */
export function createDefaultDescriptor(): DocumentDescriptor {
  return {
    version: CURRENT_DESCRIPTOR_SCHEMA_VERSION as 1,
    blocks: [],
  };
}

// =============================================================================
// Load descriptor
// =============================================================================

/**
 * Load descriptor จาก template_versions
 *
 * Behavior:
 *   - row ไม่พบ       → fallback default + reason: 'NOT_FOUND'
 *   - descriptor_json = null → fallback default + reason: 'NO_DESCRIPTOR'
 *   - descriptor_schema_version != CURRENT → fallback + reason: 'VERSION_MISMATCH'
 *     (version-safe: ไม่ throw — caller ตัดสินใจว่าจะใช้ default หรือ bypass)
 *   - JSON parse fail   → fallback + reason: 'INVALID_JSON'
 *   - zod validate fail → fallback + reason: 'INVALID_JSON' (corruption safety)
 *   - success           → return typed descriptor
 */
export async function loadTemplateDescriptor(
  db: DB,
  templateVersionId: string
): Promise<LoadDescriptorResult> {
  const row = await db
    .select({
      descriptorJson: templateVersions.descriptorJson,
      descriptorSchemaVersion: templateVersions.descriptorSchemaVersion,
      descriptorUpdatedAt: templateVersions.descriptorUpdatedAt,
    })
    .from(templateVersions)
    .where(eq(templateVersions.id, templateVersionId))
    .get();

  const loadedAt = Math.floor(Date.now() / 1000);

  // ── Not found ──────────────────────────────────────────────────────
  if (!row) {
    return {
      ok: true,
      descriptor: createDefaultDescriptor(),
      schemaVersion: null,
      meta: { source: 'default', reason: 'NOT_FOUND', loadedAt },
    };
  }

  // ── No descriptor saved ───────────────────────────────────────────
  if (row.descriptorJson === null || row.descriptorSchemaVersion === null) {
    return {
      ok: true,
      descriptor: createDefaultDescriptor(),
      schemaVersion: null,
      meta: { source: 'default', reason: 'NO_DESCRIPTOR', loadedAt },
    };
  }

  // ── Version mismatch (version-safety) ──────────────────────────────
  if (row.descriptorSchemaVersion !== CURRENT_DESCRIPTOR_SCHEMA_VERSION) {
    // V1: ไม่ migrate — fallback default.
    // V2+: จะเขียน transform function ในไฟล์แยก
    return {
      ok: true,
      descriptor: createDefaultDescriptor(),
      schemaVersion: null,
      meta: { source: 'default', reason: 'VERSION_MISMATCH', loadedAt },
    };
  }

  // ── Parse JSON ─────────────────────────────────────────────────────
  let rawJson: unknown;
  try {
    // descriptorJson เป็น raw text (no mode:'json') เพื่อให้ service layer
    // จัดการ parse/corruption ได้เอง (version-safe)
    rawJson = typeof row.descriptorJson === 'string'
      ? JSON.parse(row.descriptorJson)
      : (row.descriptorJson as unknown);
  } catch {
    return {
      ok: true,
      descriptor: createDefaultDescriptor(),
      schemaVersion: null,
      meta: { source: 'default', reason: 'INVALID_JSON', loadedAt },
    };
  }

  // ── Validate ผ่าน zod (corruption safety) ─────────────────────────
  const validation = validateDescriptor(rawJson);
  if (!validation.ok) {
    return {
      ok: true,
      descriptor: createDefaultDescriptor(),
      schemaVersion: null,
      meta: { source: 'default', reason: 'INVALID_JSON', loadedAt },
    };
  }

  return {
    ok: true,
    descriptor: validation.value as DocumentDescriptor,
    schemaVersion: row.descriptorSchemaVersion,
    meta: { source: 'db', loadedAt },
  };
}

// =============================================================================
// Save descriptor
// =============================================================================

export interface SaveDescriptorOptions {
  /** admin user id สำหรับ audit trail */
  adminUserId: string;
  /** expected version (optimistic locking) — ถ้าใส่แล้ว mismatch → reject */
  expectedVersion?: number;
}

/**
 * Save descriptor (with full validation pipeline)
 *
 * Pipeline:
 *   1. validateDescriptor() ผ่าน zod
 *   2. version check (ต้องเป็น CURRENT_DESCRIPTOR_SCHEMA_VERSION)
 *   3. optimistic version check (ถ้ามี expectedVersion)
 *   4. UPDATE template_versions
 *
 * Idempotent:
 *   - save ด้วย same descriptor 2 ครั้ง = same result
 *   - ไม่กระทบ template_versions.versionNumber / status
 *     (descriptor เป็น metadata ไม่ใช่ source of truth ของ template)
 */
export async function saveTemplateDescriptor(
  db: DB,
  templateVersionId: string,
  descriptorInput: DocumentDescriptorInput,
  options: SaveDescriptorOptions
): Promise<SaveDescriptorResult> {
  // ── 1. Schema validation (zod) ─────────────────────────────────────
  const validation = validateDescriptor(descriptorInput);
  if (!validation.ok) {
    return {
      ok: false,
      reason: 'VALIDATION_FAILED',
      issues: validation.issues,
    };
  }

  const descriptor = validation.value;

  // ── 2. Version check (descriptor.version) ──────────────────────────
  if (descriptor.version !== CURRENT_DESCRIPTOR_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: 'VERSION_MISMATCH',
      error: `Descriptor version ${descriptor.version} != supported ${CURRENT_DESCRIPTOR_SCHEMA_VERSION}`,
    };
  }

  const savedAt = Math.floor(Date.now() / 1000);

  // Serialize เป็น JSON string เพราะ column เป็น raw text (no mode:'json')
  // Validation ผ่านแล้ว ดังนั้น serialize ไม่ fail
  const descriptorJsonText = JSON.stringify(descriptor);

  try {
    // ── 3. Optimistic version check + UPDATE ────────────────────────
    // build WHERE dynamic — ถ้ามี expectedVersion ให้ตรวจ +UPDATE ต้อง match
    if (options.expectedVersion !== undefined) {
      const result = await db
        .update(templateVersions)
        .set({
          descriptorJson: descriptorJsonText,
          descriptorSchemaVersion: CURRENT_DESCRIPTOR_SCHEMA_VERSION,
          descriptorUpdatedAt: new Date(savedAt * 1000),
          descriptorUpdatedBy: options.adminUserId,
        })
        .where(
          sql`${templateVersions.id} = ${templateVersionId} AND ${templateVersions.descriptorSchemaVersion} = ${options.expectedVersion}`
        )
        .run();

      // D1 / better-sqlite3 result shape: { changes, lastInsertRowid }
      const changes = (result as any)?.changes ?? 0;
      if (changes === 0) {
        // ตรวจว่า row exists เลย หรือ version mismatch จริง
        const exists = await db
          .select({ id: templateVersions.id })
          .from(templateVersions)
          .where(eq(templateVersions.id, templateVersionId))
          .get();
        if (!exists) {
          return { ok: false, reason: 'NOT_FOUND' };
        }
        return {
          ok: false,
          reason: 'VERSION_MISMATCH',
          error: `Expected descriptor schema version ${options.expectedVersion} — possible concurrent edit`,
        };
      }
    } else {
      // ── 4a. UPDATE แบบ overwrite (ไม่มี version check) ─────────────
      // ตรวจ row exists ก่อนเพื่อให้ error message ชัด
      const exists = await db
        .select({ id: templateVersions.id })
        .from(templateVersions)
        .where(eq(templateVersions.id, templateVersionId))
        .get();
      if (!exists) {
        return { ok: false, reason: 'NOT_FOUND' };
      }

      await db
        .update(templateVersions)
        .set({
          descriptorJson: descriptorJsonText,
          descriptorSchemaVersion: CURRENT_DESCRIPTOR_SCHEMA_VERSION,
          descriptorUpdatedAt: new Date(savedAt * 1000),
          descriptorUpdatedBy: options.adminUserId,
        })
        .where(eq(templateVersions.id, templateVersionId))
        .run();
    }

    return {
      ok: true,
      schemaVersion: CURRENT_DESCRIPTOR_SCHEMA_VERSION,
      savedAt,
    };
  } catch (err: any) {
    const message = String(err?.message ?? err);
    return { ok: false, reason: 'DB_ERROR', error: message };
  }
}

// =============================================================================
// Clear descriptor (revert to legacy render)
// =============================================================================

/**
 * Clear descriptor → ไม่ใช้ composer → ใช้ legacy render path
 *
 * - ตั้ง descriptor_* columns เป็น NULL
 * - ไม่ลบ templateVersions row
 * - audit: descriptorUpdatedAt/By ก็เคลียร์ด้วย (เพราะ "ไม่เคย save")
 */
export async function clearTemplateDescriptor(
  db: DB,
  templateVersionId: string,
  options: { adminUserId: string }
): Promise<ClearDescriptorResult> {
  try {
    const exists = await db
      .select({ id: templateVersions.id })
      .from(templateVersions)
      .where(eq(templateVersions.id, templateVersionId))
      .get();
    if (!exists) {
      return { ok: false, reason: 'NOT_FOUND' };
    }

    await db
      .update(templateVersions)
      .set({
        descriptorJson: null,
        descriptorSchemaVersion: null,
        descriptorUpdatedAt: null,
        descriptorUpdatedBy: null,
      })
      .where(eq(templateVersions.id, templateVersionId))
      .run();

    return { ok: true };
  } catch (err: any) {
    const message = String(err?.message ?? err);
    return { ok: false, reason: 'DB_ERROR', error: message };
  }
}
