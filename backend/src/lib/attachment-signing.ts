/**
 * Attachment Signing — signed URL สำหรับเปิดไฟล์แนบ (Hybrid authz)
 * ============================================================================
 * ปิดช่องโหว่ "GET /public/uploads/files/:key เปิดได้แบบไม่มีเงื่อนไข":
 * endpoint ของไฟล์แนบต้องแนบ signature ที่ server mint เท่านั้น
 * (`?exp=<unix>&sig=<hex>` — HMAC-SHA256 ของ `<key>:<exp>` ด้วย JWT_SECRET)
 *
 * เหตุผลที่เลือก Hybrid (signed URL + จุด mint แยกตามบทบาท) แทน
 * Authenticated Endpoint ล้วน: ผู้สมัครไม่มีระบบ login — หน้า review
 * "เปิดดู" ทำงานด้วย capability ที่ได้ตอน upload เท่านั้น ส่วน admin
 * (มี JWT จริง) mint URL ระหว่างใช้งานผ่าน admin endpoint
 *
 * หลักการ:
 *   - secret เดียวกับ JWT (JWT_SECRET ที่จำเป็นอยู่แล้ว) — ไม่เพิ่ม binding
 *   - sig เป็น hex, เทียบแบบ constant-time, exp เป็น unix seconds
 *   - TTL ต่างกันตามบทบาท: TEMP (ผู้สมัคร) = 7 วัน เท่ากับ horizon ของ
 *     cron cleanup, ACTIVE (admin) = 60 นาที
 */

const SIGNATURE_TTL_TEMP_SECONDS = 7 * 24 * 60 * 60;
const SIGNATURE_TTL_ADMIN_SECONDS = 60 * 60;

export const ATTACHMENT_VIEW_TTL_TEMP = SIGNATURE_TTL_TEMP_SECONDS;
export const ATTACHMENT_VIEW_TTL_ADMIN = SIGNATURE_TTL_ADMIN_SECONDS;

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return toHex(signature);
}

/** เทียบ hex string แบบ constant-time (กับ timing attack บน signature) */
export function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * คำนวณ signature ของ object key ณ เวลาหมดอายุที่กำหนด
 * แยกออกจาก buildSignedAttachmentPath เพื่อให้ test คุม exp ได้ตรง ๆ
 */
export async function signAttachmentKey(
  key: string,
  exp: number,
  secret: string,
): Promise<string> {
  return hmacSha256Hex(secret, `${key}:${exp}`);
}

export type AttachmentSignature = { exp: number; sig: string };

/** Mint signature ด้วย TTL — exp = now + ttl (unix seconds) */
export async function createAttachmentSignature(
  key: string,
  secret: string,
  ttlSeconds: number,
): Promise<AttachmentSignature> {
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(ttlSeconds));
  return { exp, sig: await signAttachmentKey(key, exp, secret) };
}

/**
 * ตรวจ signature ของ key — false เมื่อรูปแบบเพี้ยน / ค่าไม่ตรง
 * หมายเหตุ: การหมดอายุ (exp < now) ให้ caller เช็คเอง เพื่อให้ test
 * ตรวจ "sig ถูกแต่หมดอายุ" แยกจาก "sig ผิด" ได้
 */
export async function verifyAttachmentSignature(
  key: string,
  exp: number,
  sig: string,
  secret: string,
): Promise<boolean> {
  if (!Number.isFinite(exp) || exp <= 0 || typeof sig !== 'string' || !sig) return false;
  const expected = await signAttachmentKey(key, exp, secret);
  return constantTimeEqual(expected, sig);
}

/**
 * ประกอบ relative view path ที่ติด signature แล้ว เช่น
 * `/api/v1/public/uploads/files/<encoded-key>?exp=...&sig=...`
 * key ถูก encodeURIComponent กันชื่อไทย/ช่องว่างพังบน URL
 */
export async function buildSignedAttachmentPath(
  key: string,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  const { exp, sig } = await createAttachmentSignature(key, secret, ttlSeconds);
  return `/api/v1/public/uploads/files/${encodeURIComponent(key)}?exp=${exp}&sig=${sig}`;
}
