import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { FileUploadRequestSchema } from '../schemas/validators';
import { Bindings } from '../types';

const uploadRoutes = new Hono<{ Bindings: Bindings }>();

uploadRoutes.post('/presigned-url', zValidator('json', FileUploadRequestSchema), async (c) => {
  const { filename } = c.req.valid('json');
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
  const fileKey = `uploads/documents/${new Date().getFullYear()}/${crypto.randomUUID()}-${sanitizedFilename}`;

  const s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${c.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: c.env.R2_ACCESS_KEY_ID,
      secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
    },
  });

  const { url, fields } = await createPresignedPost(s3Client, {
    Bucket: c.env.R2_BUCKET_NAME,
    Key: fileKey,
    Conditions: [
      ['content-length-range', 1, 10 * 1024 * 1024],
      ['starts-with', '$Content-Type', 'application/pdf'],
      ['eq', '$key', fileKey]
    ],
    Fields: { 'Content-Type': 'application/pdf' },
    Expires: 600,
  });

  return c.json({ success: true, data: { uploadUrl: url, uploadFields: fields, fileKey } }, 201);
});

export { uploadRoutes };