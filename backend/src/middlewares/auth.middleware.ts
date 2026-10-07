import { createMiddleware } from 'hono/factory';
import { verify } from 'hono/jwt';
import { Bindings, AppVariables } from '../types';

export const authMiddleware = createMiddleware<{ Bindings: Bindings; Variables: AppVariables }>(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = await verify(token, c.env.JWT_SECRET);
    c.set('jwtPayload', payload as any);
    await next();
  } catch (error) {
    return c.json({ error: 'Invalid Token' }, 401);
  }
});