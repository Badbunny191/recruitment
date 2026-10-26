/**
 * Attachment view URL — pattern เดียวกับ ApplicationDetailClient (ฝั่ง admin)
 * ---------------------------------------------------------------------------
 * fileUrl ที่ backend ตอบกลับตอน upload (/public/uploads/direct) เป็น
 * relative path (/api/v1/...) แต่ frontend เป็น static export คนละ origin
 * กับ API — ใช้ค่านั้นตรง ๆ ใน <a href> browser จะยิงไปโดน frontend origin
 * เองแล้ว 404 ทั้งที่ไฟล์อยู่ใน R2 ครบ ต้องถอด object key ออกจาก path
 * แล้วประกอบ absolute URL ต่อกับ API origin ใหม่ทุกครั้งที่ render
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787/api/v1';

/** ถอด object key จาก fileUrl (คงค่า encoded ไว้เหมือน inline logic ของ admin) */
export function getFileKey(fileUrl: string): string {
  const match = fileUrl.match(/\/files\/(.+)$/);
  return match ? match[1] : fileUrl;
}

/** ประกอบ absolute URL สำหรับเปิดไฟล์แนบผ่าน GET /public/uploads/files/:key */
export function buildAttachmentViewUrl(fileUrl: string): string {
  return `${API_URL}/public/uploads/files/${encodeURIComponent(getFileKey(fileUrl))}`;
}

/**
 * ต่อ path บน API origin เข้ากับ API_URL — กัน prefix /api/v1 ซ้ำ
 * ---------------------------------------------------------------------------
 * path จาก backend (fileUrl และ viewUrl จาก buildSignedAttachmentPath)
 * มี `/api/v1` นำหน้าเป็นส่วนหนึ่งของ contract แต่ API_URL ก็ลงท้ายด้วย
 * `/api/v1` เช่นกัน (เช่น https://api.example.com/api/v1) — join ตรง ๆ
 * จะได้ /api/v1/api/v1/... จึงต้องตัด prefix ซ้ำออกก่อน
 * (path ที่ไม่มี prefix ก็ยังใช้ได้ — ตัดเมื่อมีเท่านั้น)
 */
export function joinApiUrl(path: string): string {
  const base = API_URL.replace(/\/+$/, '');
  const stripped = path.replace(/^\/api\/v1(?=\/)/, '');
  return `${base}${stripped.startsWith('/') ? '' : '/'}${stripped}`;
}

/**
 * ประกอบ absolute URL จาก view path ที่ backend ติด signature ให้แล้ว
 * (Attachment Lifecycle — GET /files/:key ต้องมี ?exp=&sig= เสมอ)
 * viewPath เป็น relative path บน origin ที่มี mount prefix มาแล้ว เช่น
 * `/api/v1/public/uploads/files/<enc>?exp=...&sig=...`
 * รับ absolute URL กลับมาคืนตรง ๆ (defensive) และคงค่า fallback เดิม
 * buildAttachmentViewUrl ไว้สำหรับ draft เก่าที่ไม่มี viewUrl
 */
export function buildAttachmentUrlFromPath(viewPath: string): string {
  if (!viewPath) return '';
  if (/^https?:\/\//i.test(viewPath)) return viewPath;
  return joinApiUrl(viewPath);
}
