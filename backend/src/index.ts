import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Bindings } from './types';
import { publicRoutes } from './routes/public.routes';
import { adminRoutes } from './routes/admin.routes';
import { uploadRoutes } from './routes/upload.routes';

// ==========================================
// 1. API Application (Hono)
// ==========================================
const app = new Hono<{ Bindings: Bindings }>();

// เปิด CORS ให้ Frontend เรียกใช้งานได้
app.use('*', cors());

// แยกจัดกลุ่ม Routes
app.route('/api/v1/public/uploads', uploadRoutes);
app.route('/api/v1/public', publicRoutes);
app.route('/api/v1/admin', adminRoutes);

app.get('/health', (c) => c.json({ status: 'ok', timestamp: Math.floor(Date.now() / 1000) }));

// ==========================================
// JWT Secret Validation (Per-Request)
// ==========================================
// Note: Cloudflare Workers are stateless and env vars are only
// available at request time. We cannot validate at module load.
// Instead, we cache the validation result per isolate.
const MIN_JWT_SECRET_LENGTH = 32;
let jwtSecretValidated = false;

function isJwtSecretValid(secret: string | undefined): boolean {
  if (!secret) return false;
  if (secret.length < MIN_JWT_SECRET_LENGTH) return false;
  if (secret.includes('change_me')) return false;
  return true;
}

// ==========================================
// 2. Worker Export (รวม HTTP & Queue)
// ==========================================
export default {
  // รับ Request แบบ HTTP
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    // Validate JWT_SECRET - log error once per isolate
    if (!isJwtSecretValid(env.JWT_SECRET)) {
      if (!jwtSecretValidated) {
        console.error('[FATAL] JWT_SECRET is not properly configured. ' +
          'Must be at least 32 characters and not a placeholder value.');
        jwtSecretValidated = true; // Prevent log spam
      }
      return new Response(
        JSON.stringify({
          error: 'Server Misconfiguration',
          message: 'Authentication is not properly configured. Please contact administrator.'
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
    
    return app.fetch(request, env, ctx);
  }

  // รับ Request แบบ Queue (Background Job สร้าง PDF)
  //async queue(batch: MessageBatch<any>, env: Bindings): Promise<void> {
  //  for (const message of batch.messages) {
  //    try {
  //      const { applicationId, roundId } = message.body;
  //      console.log(`Processing PDF for App: ${applicationId}, Round: ${roundId}`);
  //      // ที่นี่จะเรียกใช้ pdf-generator.service.ts ในอนาคต
  //      message.ack();
  //    } catch (error) {
  //      console.error(`Queue error:`, error);
  //      message.retry();
  //    }
  //  }
  //}
};
