import { createMiddleware } from 'hono/factory';
import { verify } from 'hono/jwt';
import { Bindings, AppVariables, isAdmin, isSuperAdmin } from '../types';

export const authMiddleware = createMiddleware<{ Bindings: Bindings; Variables: AppVariables }>(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.split(' ')[1];
  try {
    // verify(token, secret, options?) - ใช้ overload ที่มี 3 arguments
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256');
    c.set('jwtPayload', payload as any);
    await next();
  } catch (error) {
    return c.json({ error: 'Invalid Token' }, 401);
  }
});

// =============================================================================
// RBAC v1 — Middleware
// =============================================================================

/**
 * Allow only SUPER_ADMIN and ADMIN to perform write operations.
 * Returns 403 for VIEWER and unauthenticated requests.
 *
 * Use this on POST / PATCH / PUT / DELETE routes.
 */
export const adminOnlyMiddleware = createMiddleware<{ Bindings: Bindings; Variables: AppVariables }>(
  async (c, next) => {
    const user = c.get('jwtPayload');
    if (!user || !isAdmin(user.role)) {
      return c.json(
        {
          error: 'Forbidden',
          message: 'คุณไม่มีสิทธิ์ดำเนินการนี้ (VIEWER เป็น read-only)',
        },
        403,
      );
    }
    await next();
  },
);

/**
 * Allow only SUPER_ADMIN.
 * Returns 403 for ADMIN, VIEWER, and unauthenticated requests.
 *
 * Use this for User Management, Role Management, and System Configuration.
 */
export const superAdminOnlyMiddleware = createMiddleware<{ Bindings: Bindings; Variables: AppVariables }>(
  async (c, next) => {
    const user = c.get('jwtPayload');
    if (!user || !isSuperAdmin(user.role)) {
      return c.json(
        {
          error: 'Forbidden',
          message: 'ต้องมีสิทธิ์ SUPER_ADMIN เท่านั้น',
        },
        403,
      );
    }
    await next();
  },
);