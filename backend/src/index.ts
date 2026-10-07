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
// 2. Worker Export (รวม HTTP & Queue)
// ==========================================
export default {
  // รับ Request แบบ HTTP
  fetch: app.fetch,

  // รับ Request แบบ Queue (Background Job สร้าง PDF)
  //async queue(batch: MessageBatch<any>, env: Bindings): Promise<void> {
  //  for (const message of batch.messages) {
    //  try {
      //  const { applicationId, roundId } = message.body;
        //console.log(`Processing PDF for App: ${applicationId}, Round: ${roundId}`);
        // ที่นี่จะเรียกใช้ pdf-generator.service.ts ในอนาคต
        //message.ack();
      //} catch (error) {
        //console.error(`Queue error:`, error);
        //message.retry();
      //}
    //}
  //}
};