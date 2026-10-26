import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { FileUploadRequestSchema } from '../schemas/validators';
import { Bindings } from '../types';
import { rateLimitMiddleware } from '../middlewares/rate-limit.middleware';
import { sanitizeDisplayFilename } from '../utils/filename';
import { attachmentUploads } from '../db/schema';
import { hashDeleteToken, insertTempLedger } from '../lib/attachment-ledger';
import {
  ATTACHMENT_VIEW_TTL_TEMP,
  buildSignedAttachmentPath,
  verifyAttachmentSignature,
} from '../lib/attachment-signing';

const uploadRoutes = new Hono<{ Bindings: Bindings }>();

// ── Filename policy ──────────────────────────────────────────────────────────
// นโยบาย "display name ≠ object key" อยู่ที่ src/utils/filename.ts (ใช้ร่วมกับ
// submit + Excel export): key นำหน้าด้วย UUID กันชื่อชน, display คงชื่อต้นฉบับ

/** ตัวแปร ASCII ปลอดภัยสำหรับ HTTP header (ชื่อ non-ASCII → _) */
function asciiSafeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9.-]/g, '_').replace(/_{2,}/g, '_') || 'document.pdf';
}

/**
 * Content-Disposition ที่รองรับชื่อไทยโดยไม่ทำ header พัง:
 * filename= เป็น ASCII fallback, filename*= เป็นค่าจริงตาม RFC 5987
 */
function contentDispositionInline(displayName: string): string {
  return `inline; filename="${asciiSafeFilename(displayName)}"; filename*=UTF-8''${encodeURIComponent(displayName)}`;
}

/**
 * POST /api/v1/public/uploads/direct
 * Upload file โดยตรงผ่าน backend (ใช้ R2 Binding)
 * 
 * Flow:
 * 1. Frontend ขอ upload URL จาก /presigned-url
 * 2. Frontend POST file ไป /direct พร้อม metadata
 * 3. Backend บันทึกไฟล์ลง R2 ผ่าน c.env.R2_BUCKET.put()
 * 4. Frontend ได้ fileKey กลับมา
 */
uploadRoutes.post('/direct', rateLimitMiddleware(), async (c) => {
  try {
    // อ่าน Content-Type
    const contentType = c.req.header('Content-Type') || '';
    
    if (!contentType.includes('multipart/form-data')) {
      return c.json({ 
        success: false, 
        error: 'Content-Type must be multipart/form-data' 
      }, 400);
    }

    // อ่าน request body
    const formData = await c.req.formData();
    
    const file = formData.get('file') as File | null;
    if (!file) {
      return c.json({ 
        success: false, 
        error: 'No file provided' 
      }, 400);
    }

    // Validate file type
    if (file.type !== 'application/pdf') {
      return c.json({ 
        success: false, 
        error: 'Only PDF files are allowed' 
      }, 400);
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      return c.json({ 
        success: false, 
        error: 'File size must be less than 10MB' 
      }, 400);
    }

    // Filename policy: คงชื่อต้นฉบับ (Unicode ไทย/ช่องว่าง/วงเล็บ) สำหรับ display
    // แยกจาก object key — key ยังนำหน้าด้วย UUID เสมอ กันชื่อชนกัน
    const displayFilename = sanitizeDisplayFilename(file.name || 'document.pdf');

    // Generate unique file key
    const year = new Date().getFullYear();
    const fileKey = `uploads/documents/${year}/${crypto.randomUUID()}-${displayFilename}`;

    // Convert File to ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();

    // Upload to R2 using binding
    await c.env.R2_BUCKET.put(fileKey, arrayBuffer, {
      httpMetadata: {
        contentType: 'application/pdf',
        contentDisposition: contentDispositionInline(displayFilename),
      },
      customMetadata: {
        originalFilename: displayFilename,
        uploadedAt: new Date().toISOString(),
        size: file.size.toString(),
      }
    });

    // ── Attachment Lifecycle: ลงทะเบียนไฟล์เป็น TEMP (Migration 029) ──
    // ทุก object ที่เข้า bucket ต้องมี ledger row ไม่งั้น cron จะไม่เก็บ
    // ถ้า ledger insert ล้มเหลว (DB error) ยังคืน upload success — ไฟล์เส้น
    // เดิมใช้ได้ แต่จะไม่มี delete token และไม่ถูก GC (fail-open เพื่อไม่
    // บล็อกผู้สมัครทั้งคนด้วยความผิดพลาดของ ledger)
    let ledgerId: string | undefined;
    let deleteToken: string | undefined;
    try {
      const entry = await insertTempLedger(drizzle(c.env.DB), {
        r2Key: fileKey,
        originalFilename: displayFilename,
      });
      ledgerId = entry.ledgerId;
      deleteToken = entry.deleteToken;
    } catch (ledgerErr) {
      console.error('[Upload] Failed to create TEMP ledger entry:', ledgerErr);
    }

    // Signed view URL (TTL 7 วัน = horizon ของ TEMP cleanup) — ผู้สมัครใช้
    // เปิดดูไฟล์ตัวเองบนหน้า review โดยที่ key เปล่า ๆ เปิดจาก URL ตรงไม่ได้
    const viewUrl = await buildSignedAttachmentPath(fileKey, c.env.JWT_SECRET, ATTACHMENT_VIEW_TTL_TEMP);

    // Generate public URL for the file
    // รูปแบบ fileUrl เดิม (relative path ไม่มี signature) — ค่าที่เก็บลง
    // application_attachments ตอน submit ต้องเป็นค่านี้เท่านั้น
    const fileUrl = `/api/v1/public/uploads/files/${encodeURIComponent(fileKey)}`;

    return c.json({
      success: true,
      data: {
        fileKey,
        fileUrl,
        filename: displayFilename,
        size: file.size,
        contentType: 'application/pdf',
        // ── Attachment Lifecycle fields ──
        ledgerId,
        deleteToken,
        viewUrl,
      }
    }, 201);

  } catch (error) {
    console.error('Upload error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to upload file' 
    }, 500);
  }
});

/**
 * GET /api/v1/public/uploads/files/:key
 * Download/View file จาก R2 — ต้องมี signed URL เท่านั้น
 *
 * ── Authorization: Hybrid (signed URL + status enforcement) ──
 * เดิม endpoint นี้เปิดได้แบบไม่มีเงื่อนไข — Resume/Transcript ของผู้สมัคร
 * รั่วผ่าน URL ตรง ผู้สมัครไม่มีระบบ login จึงใช้ capability model:
 *   - signature (HMAC-SHA256 ด้วย JWT_SECRET) mint ให้ตอน upload / โดย admin
 *   - เงื่อนไขเพิ่มเติมจาก ledger: แถว DELETED → 404 แม้ object ยังอยู่ใน R2
 *     (กัน race: object ถูกลบไม่หมดแต่ lifecycle ปิดแล้ว)
 *   - ไม่มีแถว = legacy (ไฟล์ก่อน deploy) — signature ยังต้องถูกเสมอ
 *
 * Cache ต้องเป็น private เท่านั้น (เดิม public max-age=1 ปี — เพราะเคยเป็น
 * endpoint สาธารณะ) กัน CDN/cache กลางทางจับ response ที่ผ่าน access control
 */
uploadRoutes.get('/files/:key{.+}', async (c) => {
  try {
    const key = c.req.param('key');
    const decodedKey = decodeURIComponent(key);

    // ── 1) Signed URL check ──
    const exp = Number(c.req.query('exp') || 0);
    const sig = c.req.query('sig') || '';
    const nowSec = Math.floor(Date.now() / 1000);
    if (!exp || !sig || exp < nowSec) {
      return c.json({
        success: false,
        error: 'Missing or expired signature',
      }, 403);
    }
    const signatureValid = await verifyAttachmentSignature(decodedKey, exp, sig, c.env.JWT_SECRET);
    if (!signatureValid) {
      return c.json({
        success: false,
        error: 'Invalid signature',
      }, 403);
    }

    // ── 2) Ledger status check (DELETED = lifecycle ปิดแล้ว) ──
    const db = drizzle(c.env.DB);
    const ledgerRow = await db
      .select({ status: attachmentUploads.status })
      .from(attachmentUploads)
      .where(eq(attachmentUploads.r2Key, decodedKey))
      .get();
    if (ledgerRow?.status === 'DELETED') {
      return c.json({
        success: false,
        error: 'File not found',
      }, 404);
    }

    // ดึงไฟล์จาก R2
    const object = await c.env.R2_BUCKET.get(decodedKey);

    if (!object) {
      return c.json({
        success: false,
        error: 'File not found'
      }, 404);
    }

    // อ่าน metadata
    const metadata = object.httpMetadata || {};
    const customMeta = object.customMetadata || {};

    // ส่งไฟล์กลับ
    // customMetadata.originalFilename ของ object ใหม่เป็นชื่อ Unicode (ไทยได้)
    // → ต้องผ่าน contentDispositionInline เพื่อไม่ใส่ non-ASCII ลง header ตรงๆ
    return new Response(object.body, {
      headers: {
        'Content-Type': metadata.contentType || 'application/octet-stream',
        'Content-Disposition': metadata.contentDisposition
          || contentDispositionInline(customMeta.originalFilename || 'file.pdf'),
        'Content-Length': object.size.toString(),
        // ไฟล์ต่อ key ไม่เปลี่ยน แต่ access control อยู่บน signature —
        // cache ได้เฉพาะ private (browser เดียว) ห้าม public/CDN
        'Cache-Control': 'private, max-age=3600',
        'ETag': object.httpEtag,
      }
    });

  } catch (error) {
    console.error('Download error:', error);
    return c.json({
      success: false,
      error: 'Failed to retrieve file'
    }, 500);
  }
});

/**
 * DELETE /api/v1/public/uploads/direct/:ledgerId
 * ลบไฟล์ TEMP จริง — ปิดปัญหา "ปุ่มลบลบเฉพาะ React state"
 *
 * Capability model: ผู้สมัครไม่มี login จึงใช้ delete token ที่ออกตอน upload
 * (ครั้งเดียว ฝั่ง client เก็บใน draft) — เทียบ SHA-256 กับ delete_token_hash
 *
 *   404 = ไม่พบ ledger id / ถูกลบไปแล้ว
 *   403 = token ไม่ตรง / ไม่ได้แนบ token (legacy row ไม่มี token ก็ 403)
 *   409 = ไฟล์ถูก submit แล้ว (ACTIVE) — ห้ามลบผ่าน endpoint นี้
 *
 * Mark ledger TEMP → DELETED ก่อน (guard status='TEMP') แล้วจึงลบ R2 object —
 * ปิด race กับ submit promote: ถ้า mark กระทบ 0 แถว = แถวถูก promote เป็น
 * ACTIVE ไปแล้ว ต้อง 409 โดยไม่แตะ R2 (ถ้า mark สำเร็จแต่ลบ R2 ล้ม เหลือ
 * orphan object ที่ GET ไม่ได้เพราะ ledger เป็น DELETED แล้ว — ปลอดภัยกว่า
 * การลบไฟล์ของใบสมัครจริง)
 */
uploadRoutes.delete('/direct/:ledgerId', rateLimitMiddleware(), async (c) => {
  try {
    const ledgerId = c.req.param('ledgerId');
    const token = c.req.header('X-Attachment-Token') || c.req.query('token') || '';
    if (!token) {
      return c.json({ success: false, error: 'Missing delete token' }, 403);
    }

    const db = drizzle(c.env.DB);
    const row = await db
      .select({
        id: attachmentUploads.id,
        r2Key: attachmentUploads.r2Key,
        status: attachmentUploads.status,
        deleteTokenHash: attachmentUploads.deleteTokenHash,
      })
      .from(attachmentUploads)
      .where(eq(attachmentUploads.id, ledgerId))
      .get();

    if (!row || row.status === 'DELETED') {
      return c.json({ success: false, error: 'File not found' }, 404);
    }
    if (row.status === 'ACTIVE') {
      return c.json({
        success: false,
        error: 'File is already attached to a submitted application and cannot be deleted',
      }, 409);
    }
    if (!row.deleteTokenHash) {
      // legacy row — ไม่มี capability ที่ตรงกันได้เลย
      return c.json({ success: false, error: 'Invalid delete token' }, 403);
    }

    const tokenHash = await hashDeleteToken(token);
    if (tokenHash !== row.deleteTokenHash) {
      return c.json({ success: false, error: 'Invalid delete token' }, 403);
    }

    // Mark TEMP → DELETED ก่อนลบ R2 ด้วย guard status='TEMP' — ถ้า submit
    // promote แถวนี้เป็น ACTIVE ไปแล้ว UPDATE จะกระทบ 0 แถว และเราห้ามลบ
    // R2 object (ไม่งั้นใบสมัครที่เพิ่ง submit จะเสียไฟล์แนบถาวร)
    const markResult = await db
      .update(attachmentUploads)
      .set({ status: 'DELETED', deletedAt: new Date() })
      .where(and(eq(attachmentUploads.id, row.id), eq(attachmentUploads.status, 'TEMP')))
      .run();
    const marked = (markResult as any)?.meta?.changes ?? (markResult as any)?.changes ?? 0;
    if (marked === 0) {
      return c.json({
        success: false,
        error: 'File is already attached to a submitted application and cannot be deleted',
      }, 409);
    }

    await c.env.R2_BUCKET.delete(row.r2Key);

    return c.json({ success: true, data: { deleted: true } });
  } catch (error) {
    console.error('Delete temp attachment error:', error);
    return c.json({ success: false, error: 'Failed to delete file' }, 500);
  }
});

/**
 * POST /api/v1/public/uploads/presigned-url
 * ขอ presigned URL สำหรับ upload (ยังคงใช้ได้แต่แนะนำใช้ /direct แทน)
 * ปล่อยไว้เพื่อ backward compatibility
 */
uploadRoutes.post('/presigned-url', zValidator('json', FileUploadRequestSchema), async (c) => {
  const { filename } = c.req.valid('json');
  const displayFilename = sanitizeDisplayFilename(filename);
  const fileKey = `uploads/documents/${new Date().getFullYear()}/${crypto.randomUUID()}-${displayFilename}`;

  // แนะนำให้ใช้ /direct endpoint แทน presigned URL
  // เนื่องจาก R2 Binding ไม่ต้องใช้ API Token
  return c.json({ 
    success: true, 
    data: { 
      uploadUrl: '/api/v1/public/uploads/direct',
      method: 'POST',
      fileKey,
      instructions: 'POST file to uploadUrl with Content-Type: multipart/form-data and field name "file"'
    } 
  }, 200);
});

export { uploadRoutes };
