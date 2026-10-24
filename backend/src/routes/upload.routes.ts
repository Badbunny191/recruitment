import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { FileUploadRequestSchema } from '../schemas/validators';
import { Bindings } from '../types';
import { rateLimitMiddleware } from '../middlewares/rate-limit.middleware';
import { sanitizeDisplayFilename } from '../utils/filename';

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

    // Generate public URL for the file
    // R2 bucket มี public URL format: https://<bucket>.<account>.r2.dev/<key>
    // หรือใช้ Workers ที่ตั้งค่า custom domain
    const fileUrl = `/api/v1/public/uploads/files/${encodeURIComponent(fileKey)}`;

    return c.json({ 
      success: true, 
      data: { 
        fileKey,
        fileUrl,
        filename: displayFilename,
        size: file.size,
        contentType: 'application/pdf'
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
 * Download/View file จาก R2
 */
uploadRoutes.get('/files/:key{.+}', async (c) => {
  try {
    const key = c.req.param('key');
    const decodedKey = decodeURIComponent(key);

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
        'Cache-Control': 'public, max-age=31536000', // Cache 1 year for uploaded files
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
