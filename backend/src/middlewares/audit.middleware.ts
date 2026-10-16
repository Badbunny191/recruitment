import { createMiddleware } from 'hono/factory';
import { drizzle } from 'drizzle-orm/d1';
import { auditLogs } from '../db/schema';
import { v4 as uuidv4 } from 'uuid';
import { Bindings, AppVariables } from '../types';

export const auditMiddleware = (entityType: string) => createMiddleware<{ Bindings: Bindings; Variables: AppVariables }>(async (c, next) => {
  await next();
  
  const method = c.req.method;
  if (method === 'GET' || c.res.status >= 400) return;

  const db = drizzle(c.env.DB);
  const user = c.get('jwtPayload');
  
  let action = 'CREATE';
  if (method === 'PUT' || method === 'PATCH') action = 'UPDATE';
  if (method === 'DELETE') action = 'DELETE';

  // Try to get entity ID from params
  const entityId = c.req.param('id') || 'BULK/NEW';
  
  // Check for custom audit payload set by route handler
  // Routes can set this to include change tracking data
  const customPayload = c.get('auditPayload');
  
  // For APPLICATION status updates, capture the request body as payload
  let payload: any = null;
  if (entityType === 'APPLICATION' && (method === 'PATCH' || method === 'PUT') && !customPayload) {
    try {
      const body = await c.req.json().catch(() => null);
      if (body) {
        payload = body;
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Use custom payload if provided (e.g., change tracking data)
  const finalPayload = customPayload || (payload ? JSON.stringify(payload) : null);

  await db.insert(auditLogs).values({
    id: uuidv4(),
    adminId: user.id,
    action,
    entityType,
    entityId,
    payload: finalPayload,
    ipAddress: c.req.header('cf-connecting-ip') || 'unknown',
  });
});

/**
 * Sets a custom audit payload for change tracking.
 * Call this in route handlers before returning.
 */
export function setAuditPayload(c: any, payload: string | null): void {
  c.set('auditPayload', payload);
}
