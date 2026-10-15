import { drizzle } from 'drizzle-orm/d1';
import { eq, and, count } from 'drizzle-orm';
import { adminUsers } from '../db/schema';
import { Bindings } from '../types';

/**
 * RBAC v1 — Last-SUPER_ADMIN Protection
 * =============================================================================
 *
 * Guarantees that at least one active SUPER_ADMIN always exists.
 * Used to block:
 *   - disabling the last SUPER_ADMIN
 *   - deleting the last SUPER_ADMIN
 *   - demoting the last SUPER_ADMIN to ADMIN/VIEWER
 */

export interface SuperAdminGuardResult {
  ok: boolean;
  reason?: 'LAST_SUPER_ADMIN' | 'DB_ERROR';
  activeSuperAdminCount?: number;
}

/**
 * Counts active SUPER_ADMINs in the system.
 */
export async function countActiveSuperAdmins(env: Bindings): Promise<number> {
  const db = drizzle(env.DB);
  const result = await db
    .select({ value: count() })
    .from(adminUsers)
    .where(and(eq(adminUsers.role, 'SUPER_ADMIN'), eq(adminUsers.isActive, true)))
    .get();
  return Number(result?.value ?? 0);
}

/**
 * Returns `ok: false` if removing the given user would leave the system
 * with zero active SUPER_ADMINs.
 *
 * Pass the target user BEFORE applying the change; this guard checks
 * "after the change" semantics:
 *   - if target is the same user being demoted/disabled/deleted, count
 *     is computed as if that user were already removed.
 */
export async function ensureNotLastSuperAdmin(
  env: Bindings,
  targetUserId: string,
  targetUserRole: string,
  targetUserIsActive: boolean,
): Promise<SuperAdminGuardResult> {
  try {
    // Only relevant when the target is (or was) a SUPER_ADMIN
    if (targetUserRole !== 'SUPER_ADMIN') {
      return { ok: true };
    }

    // If target is being deactivated, we count active SUPER_ADMINs
    // that will remain after the change.
    let remaining = 0;
    const db = drizzle(env.DB);

    if (!targetUserIsActive) {
      // Already inactive — only "active" set matters
      const result = await db
        .select({ value: count() })
        .from(adminUsers)
        .where(and(eq(adminUsers.role, 'SUPER_ADMIN'), eq(adminUsers.isActive, true)))
        .get();
      remaining = Number(result?.value ?? 0);
    } else {
      // Target is active. We need to know "how many would remain if we
      // remove/demote this one". We can use total active SUPER_ADMINs.
      const result = await db
        .select({ value: count() })
        .from(adminUsers)
        .where(and(eq(adminUsers.role, 'SUPER_ADMIN'), eq(adminUsers.isActive, true)))
        .get();
      remaining = Number(result?.value ?? 0);

      // If the change keeps them active but demotes them, we still need
      // to subtract. The caller is responsible for indicating "would be removed".
    }

    if (remaining <= 1) {
      return { ok: false, reason: 'LAST_SUPER_ADMIN', activeSuperAdminCount: remaining };
    }
    return { ok: true, activeSuperAdminCount: remaining };
  } catch (error) {
    console.error('ensureNotLastSuperAdmin error:', error);
    return { ok: false, reason: 'DB_ERROR' };
  }
}
