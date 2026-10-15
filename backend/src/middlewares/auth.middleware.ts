import { createMiddleware } from 'hono/factory';
import { verify } from 'hono/jwt';
import { Bindings, AppVariables } from '../types';

const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Validate JWT_SECRET at startup
 * Returns error message if invalid, null if valid
 */
export function validateJwtSecret(secret: string | undefined): string | null {
  if (!secret) {
    return 'JWT_SECRET is not configured';
  }
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    return `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters (currently ${secret.length})`;
  }
  // Warn if using default/placeholder value
  if (secret.includes('change_me') || secret.includes('secret')) {
    return 'JWT_SECRET appears to be a placeholder value. Please use a secure random string.';
  }
  return null;
}

export const authMiddleware = createMiddleware<{ Bindings: Bindings; Variables: AppVariables }>(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized', message: 'Missing or invalid Authorization header' }, 401);
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return c.json({ error: 'Unauthorized', message: 'Missing token' }, 401);
  }

  try {
    // Verify with explicit algorithm
    const payload = await verify(token, c.env.JWT_SECRET!, {
      alg: 'HS256',
    } as any);

    // Type guard: ensure required fields exist
    if (!payload.id || !payload.email || !payload.role) {
      return c.json({ error: 'Unauthorized', message: 'Invalid token payload' }, 401);
    }

    // Set payload with proper typing
    c.set('jwtPayload', {
      id: payload.id as string,
      email: payload.email as string,
      role: payload.role as string,
      mustChangePassword: payload.mustChangePassword as boolean | undefined,
    });

    await next();
  } catch (error: any) {
    console.error('[Auth] Token verification failed:', error?.message || error);
    
    // Provide specific error messages
    if (error?.message?.includes('expired')) {
      return c.json({ error: 'Token Expired', message: 'กรุณาเข้าสู่ระบบใหม่' }, 401);
    }
    if (error?.message?.includes('signature')) {
      return c.json({ error: 'Invalid Token', message: 'Token ไม่ถูกต้อง' }, 401);
    }
    
    return c.json({ error: 'Invalid Token', message: 'Token ไม่ถูกต้อง' }, 401);
  }
});

/**
 * Startup validation - call this once when the worker starts
 * Throws an error if JWT_SECRET is invalid
 */
export function validateJwtSecretOnStartup(env: Bindings): void {
  const error = validateJwtSecret(env.JWT_SECRET);
  if (error) {
    console.error('[STARTUP] JWT_SECRET validation failed:', error);
    throw new Error(`[STARTUP] ${error}`);
  }
  console.log('[STARTUP] JWT_SECRET validated successfully');
}
