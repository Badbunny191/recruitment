import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { FileUploadRequestSchema } from '../schemas/validators';
import { Bindings } from '../types';

const uploadRoutes = new Hono<{ Bindings: Bindings }>();

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
uploadRoutes.post('/direct', async (c) => {
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

    // Sanitize filename
    const originalFilename = file.name || 'document.pdf';
    const sanitizedFilename = originalFilename.replace(/[^a-zA-Z0-9.-]/g, '_');
    
    // Generate unique file key
    const year = new Date().getFullYear();
    const fileKey = `uploads/documents/${year}/${crypto.randomUUID()}-${sanitizedFilename}`;

    // Convert File to ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    
    // Upload to R2 using binding
    await c.env.R2_BUCKET.put(fileKey, arrayBuffer, {
      httpMetadata: {
        contentType: 'application/pdf',
        contentDisposition: `inline; filename="${sanitizedFilename}"`,
      },
      customMetadata: {
        originalFilename: sanitizedFilename,
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
        filename: sanitizedFilename,
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
uploadRoutes.get('/files/:key{*}', async (c) => {
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
    return new Response(object.body, {
      headers: {
        'Content-Type': metadata.contentType || 'application/octet-stream',
        'Content-Disposition': metadata.contentDisposition || `inline; filename="${customMeta.originalFilename || 'file.pdf'}"`,
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
 * DELETE /api/v1/public/uploads/files/:key
 * Delete file จาก R2
 */
uploadRoutes.delete('/files/:key{*}', async (c) => {
  try {
    const key = c.req.param('key');
    const decodedKey = decodeURIComponent(key);

    await c.env.R2_BUCKET.delete(decodedKey);

    return c.json({ 
      success: true, 
      message: 'File deleted successfully' 
    });

  } catch (error) {
    console.error('Delete error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to delete file' 
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
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
  const fileKey = `uploads/documents/${new Date().getFullYear()}/${crypto.randomUUID()}-${sanitizedFilename}`;

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
