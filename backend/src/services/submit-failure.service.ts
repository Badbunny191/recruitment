/**
 * Submission Failure Evidence Service
 * ===================================
 *
 * Responsibilities:
 * - logSubmitFailureSafely: Fail-soft recording of application submit rejections.
 * - querySubmitFailures: Read-only lookup for HR dispute defense (by refCode, email, fullname, round).
 * - purgeOldSubmitFailures: Automated retention cleanup for records older than 180 days.
 */

import { v4 as uuidv4 } from 'uuid';
import { eq, sql, desc, and, or, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { applicationSubmitFailures } from '../db/schema';

export type SubmitFailureCategory =
  | 'ROUND_CLOSED'
  | 'VALIDATION_ERROR'
  | 'DUPLICATE_EMAIL'
  | 'TURNSTILE_FAIL'
  | 'INTERNAL_ERROR'
  | 'UNKNOWN';

export type LogSubmitFailureInput = {
  db: any;
  refCode: string;
  roundId?: string | null;
  email?: string | null;
  fullname?: string | null;
  submissionToken?: string | null;
  category: SubmitFailureCategory | string;
  reasonCode?: string | null;
  errorMessage: string;
  httpStatus: number;
  ipAddress?: string | null;
  cfRay?: string | null;
  userAgent?: string | null;
  createdAt?: number;
};

export async function logSubmitFailureSafely(input: LogSubmitFailureInput): Promise<boolean> {
  try {
    const id = uuidv4();
    const createdAt = input.createdAt ?? Date.now();

    await input.db.insert(applicationSubmitFailures).values({
      id,
      refCode: input.refCode,
      roundId: input.roundId ?? null,
      email: input.email ? input.email.trim() : null,
      fullname: input.fullname ? input.fullname.trim() : null,
      submissionToken: input.submissionToken ?? null,
      category: input.category,
      reasonCode: input.reasonCode ?? null,
      errorMessage: input.errorMessage.slice(0, 1000), // Defensive truncate
      httpStatus: input.httpStatus,
      ipAddress: input.ipAddress ?? null,
      cfRay: input.cfRay ?? null,
      userAgent: input.userAgent ? input.userAgent.slice(0, 500) : null,
      createdAt,
    });

    return true;
  } catch (err) {
    // FAIL-SOFT: Never allow a logging error to break or throw
    console.error('[SUBMIT_FAILURE_LOG_FAIL_SOFT]', err);
    return false;
  }
}

export type QuerySubmitFailuresFilter = {
  search?: string;
  roundId?: string;
  page?: number;
  pageSize?: number;
};

export async function querySubmitFailures(db: any, filters: QuerySubmitFailuresFilter = {}) {
  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || 20));
  const offset = (page - 1) * pageSize;

  const conditions = [];

  if (filters.roundId && filters.roundId.trim()) {
    conditions.push(eq(applicationSubmitFailures.roundId, filters.roundId.trim()));
  }

  if (filters.search && filters.search.trim()) {
    const term = `%${filters.search.trim().toLowerCase()}%`;
    conditions.push(
      or(
        like(sql`lower(${applicationSubmitFailures.refCode})`, term),
        like(sql`lower(${applicationSubmitFailures.email})`, term),
        like(sql`lower(${applicationSubmitFailures.fullname})`, term)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const countQuery = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(applicationSubmitFailures);
  if (whereClause) countQuery.where(whereClause);
  const totalRes = await countQuery.get();
  const total = Number(totalRes?.count ?? 0);

  const query = db
    .select()
    .from(applicationSubmitFailures)
    .orderBy(desc(applicationSubmitFailures.createdAt))
    .limit(pageSize)
    .offset(offset);
  if (whereClause) query.where(whereClause);

  const items = await query.all();

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize) || 1,
  };
}

/**
 * Purges failure logs older than retentionDays (default: 180 days).
 */
export async function purgeOldSubmitFailures(d1Db: any, retentionDays = 180): Promise<number> {
  try {
    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const stmt = d1Db.prepare(
      'DELETE FROM application_submit_failures WHERE created_at < ?'
    );
    const result = await stmt.bind(cutoffMs).run();
    const deletedCount = result?.meta?.changes ?? 0;
    console.log(`[SUBMIT_FAILURE_RETENTION_PURGE] Deleted ${deletedCount} records older than ${retentionDays} days.`);
    return deletedCount;
  } catch (err) {
    console.error('[SUBMIT_FAILURE_PURGE_ERROR]', err);
    return 0;
  }
}
