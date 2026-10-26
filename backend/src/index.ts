import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { drizzle } from 'drizzle-orm/d1';

import { Bindings } from './types';
import { publicRoutes } from './routes/public.routes';
import { adminRoutes } from './routes/admin.routes';
import { uploadRoutes } from './routes/upload.routes';
import { cleanupExpiredTempAttachments } from './lib/attachment-cleanup';

const app = new Hono<{ Bindings: Bindings }>();

app.onError((err, c) => {
  // รักษา HTTP status เดิม เช่น 400, 401, 403, 404
  if (err instanceof HTTPException) {
    return err.getResponse();
  }

  // Error มาตรฐานไม่มี property code จึงต้องตรวจแบบปลอดภัยก่อน
  const errorCode =
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof err.code === 'string'
      ? err.code
      : 'UNKNOWN';

  // รายละเอียดเต็มแสดงเฉพาะ Server Log
  console.error('[UNHANDLED_ERROR]', {
    name: err.name,
    code: errorCode,
    message: err.message,
    cause: err.cause,
    stack: err.stack,
  });

  // Client ได้ข้อความกลาง ไม่เปิดเผย SQL หรือ Stack
  return c.json(
    {
      error: 'INTERNAL_ERROR',
      code: errorCode,
      message: 'เกิดข้อผิดพลาดภายในระบบ',
    },
    500
  );
});

// เปิด CORS ให้ Frontend เรียกใช้งานได้
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposeHeaders: ['Content-Length', 'Content-Disposition', 'X-Pdf-Page-Count'],
  })
);

// Routes
app.route('/api/v1/public/uploads', uploadRoutes);
app.route('/api/v1/public', publicRoutes);
app.route('/api/v1/admin', adminRoutes);

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    timestamp: Math.floor(Date.now() / 1000),
  })
);

export default {
  async fetch(
    request: Request,
    env: Bindings,
    ctx: ExecutionContext
  ): Promise<Response> {
    return app.fetch(request, env, ctx);
  },

  // ── Attachment Lifecycle (Migration 029) — Cron GC ──
  // wrangler.toml [triggers]: รันวันละครั้ง 01:00 น. เวลาไทย (18:00 UTC)
  // ลบไฟล์ TEMP (ไม่ถูก submit) อายุเกิน 7 วัน — idempotent ดู
  // lib/attachment-cleanup.ts
  async scheduled(
    controller: ScheduledController,
    env: Bindings,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(
      cleanupExpiredTempAttachments(drizzle(env.DB), env.R2_BUCKET)
        .then((result) => {
          console.log('[AttachmentCleanup] scheduled run:', result);
        })
        .catch((err) => {
          console.error('[AttachmentCleanup] scheduled run failed:', err);
        })
    );
  },
};