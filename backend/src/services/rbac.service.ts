import { drizzle } from 'drizzle-orm/d1';
import { eq, and, ne, count } from 'drizzle-orm';
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
 *
 * The guards below are based on the **post-change** state: the caller
 * describes what the target user will look like AFTER the change is
 * applied, and we count the number of active SUPER_ADMINs that will
 * still exist in the system. If that number drops to zero, the change
 * is rejected.
 */

export interface SuperAdminGuardResult {
  ok: boolean;
  reason?: 'LAST_SUPER_ADMIN' | 'DB_ERROR';
  /** Number of active SUPER_ADMINs that will exist AFTER the proposed change. */
  remainingActiveSuperAdminCount?: number;
  /**
   * Backwards-compatible alias for `remainingActiveSuperAdminCount`.
   * Older call sites in `admin.routes.ts` still serialize this key.
   */
  activeSuperAdminCount?: number;
}

// Test-only seam: lets unit tests inject a fake Drizzle instance without
// monkey-patching the drizzle-orm/d1 module. Production code never sets
// this; it is only used by the RBAC test suite.
//
// The factory receives a D1-shaped `env.DB`. Tests can build a real
// in-memory better-sqlite3 Drizzle instance and return it.
let __drizzleOverride: ((env: Bindings) => any) | null = null;
export function __setDrizzleForTests(factory: ((env: Bindings) => any) | null) {
  __drizzleOverride = factory;
}

function getDb(env: Bindings) {
  if (__drizzleOverride) return __drizzleOverride(env);
  return drizzle(env.DB);
}

/**
 * Counts active SUPER_ADMINs that will exist AFTER the proposed change
 * to the target user is applied.
 *
 * Semantics:
 *   - We count all currently-active SUPER_ADMINs in the DB.
 *   - We then subtract the target IF the post-change state would no
 *     longer be an active SUPER_ADMIN (i.e. the target is being demoted
 *     to ADMIN/VIEWER OR is being set to isActive=false).
 *   - We add the target IF the post-change state is becoming an active
 *     SUPER_ADMIN but currently is not (e.g. promoting a non-SUPER_ADMIN
 *     to active SUPER_ADMIN — although that path is rejected elsewhere).
 *
 * @param env                 Worker bindings (D1)
 * @param targetUserId        ID of the user the change applies to
 * @param postChangeRole      The role the user will have AFTER the change
 * @param postChangeIsActive  The isActive value AFTER the change
 */
export async function ensureNotLastSuperAdmin(
  env: Bindings,
  targetUserId: string,
  postChangeRole: string,
  postChangeIsActive: boolean,
): Promise<SuperAdminGuardResult> {
  try {
    // Read the CURRENT state once, to know whether the target is currently
    // an active SUPER_ADMIN (so we can compute the delta correctly).
    const db = getDb(env);
    const currentRow = await db
      .select({
        id: adminUsers.id,
        role: adminUsers.role,
        isActive: adminUsers.isActive,
      })
      .from(adminUsers)
      .where(eq(adminUsers.id, targetUserId))
      .get();

    // If the target user does not exist, there is nothing to protect.
    // (The route handler should normally have validated this already.)
    if (!currentRow) {
      return { ok: true };
    }

    const currentlyActiveSuperAdmin = currentRow.role === 'SUPER_ADMIN' && !!currentRow.isActive;
    const willBeActiveSuperAdmin = postChangeRole === 'SUPER_ADMIN' && postChangeIsActive;

    // Count the baseline: all rows that are active SUPER_ADMINs EXCEPT the
    // target itself. This gives the number of active SUPER_ADMINs that are
    // independent of this change.
    const baselineRow = await db
      .select({ value: count() })
      .from(adminUsers)
      .where(
        and(
          eq(adminUsers.role, 'SUPER_ADMIN'),
          eq(adminUsers.isActive, true),
          ne(adminUsers.id, targetUserId),
        ),
      )
      .get();
    const baseline = Number(baselineRow?.value ?? 0);

    // The "remaining" count after the change is:
    //   - baseline (other active SUPER_ADMINs)
    //   - PLUS the target IF it will be an active SUPER_ADMIN post-change
    //   - MINUS nothing else (we excluded the target from baseline)
    const remaining = baseline + (willBeActiveSuperAdmin ? 1 : 0);

    if (remaining < 1) {
      return {
        ok: false,
        reason: 'LAST_SUPER_ADMIN',
        remainingActiveSuperAdminCount: remaining,
        activeSuperAdminCount: remaining,
      };
    }

    return { ok: true, remainingActiveSuperAdminCount: remaining, activeSuperAdminCount: remaining };
  } catch (error) {
    console.error('ensureNotLastSuperAdmin error:', error);
    return { ok: false, reason: 'DB_ERROR' };
  }
}

/**
 * Counts active SUPER_ADMINs in the system (today, post any pending change).
 * Exposed for diagnostics and tests.
 */
export async function countActiveSuperAdmins(env: Bindings): Promise<number> {
  const db = getDb(env);
  const result = await db
    .select({ value: count() })
    .from(adminUsers)
    .where(and(eq(adminUsers.role, 'SUPER_ADMIN'), eq(adminUsers.isActive, true)))
    .get();
  return Number(result?.value ?? 0);
}
