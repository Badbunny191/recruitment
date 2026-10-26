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
