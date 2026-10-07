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
    // verify(token, secret, options?) - ใช้ overload ที่มี 3 arguments
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256');
    c.set('jwtPayload', payload as any);
    await next();
  } catch (error) {
    return c.json({ error: 'Invalid Token' }, 401);
  }
});