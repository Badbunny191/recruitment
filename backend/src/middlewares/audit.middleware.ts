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
  if (method === 'PUT') action = 'UPDATE';
  if (method === 'DELETE') action = 'DELETE';

  await db.insert(auditLogs).values({
    id: uuidv4(),
    adminId: user.id,
    action,
    entityType,
    entityId: c.req.param('id') || 'BULK/NEW',
    ipAddress: c.req.header('cf-connecting-ip') || 'unknown',
  });
});