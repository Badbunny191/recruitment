// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * Review Page Attachment "เปิดดู" URL Tests
 * =======================================================================
 *
 * ก่อนหน้านี้ review page ใช้ `href={att.fileUrl}` ตรง ๆ — fileUrl ที่
 * backend ตอบตอน upload เป็น relative path (/api/v1/...) บน frontend
 * static export ที่คนละ origin กับ API ทำให้ browser ยิงไปโดน frontend
 * เองแล้ว 404 การแก้คือใช้ pattern เดียวกับ ApplicationDetailClient:
 * ถอด key ด้วย regex `/\/files\/(.+)$/` แล้วประกอบ absolute URL ใหม่
 * ด้วย API_URL + encodeURIComponent
 *
 *   A–C. getFileKey  ถอด key จาก relative/absolute URL + fallback
 *   D–E. buildAttachmentViewUrl ให้ผลเหมือน inline logic ของ admin
 *         ทุกประการ (parity) รวมถึงชื่อไฟล์ภาษาไทย
 *   F–H. Source contract ของ review page — ใช้ helper ใน href,
 *         และ submit payload ยังส่ง fileUrl ดิบเหมือนเดิม (ห้ามแตะ)
 *   I–K. buildAttachmentUrlFromPath / joinApiUrl — กัน prefix /api/v1
 *         ซ้ำ (/api/v1/api/v1/...) เมื่อ viewUrl จาก backend มี
 *         mount prefix มาเองแล้ว (prod bug 2026-10-27)
 *   L.   Source contract ของ ApplicationDetailClient — ห้าม concat
 *        `${API_URL}${path}` ตรง ๆ (จุดเกิด bug ฝั่ง admin)
 *
 * Run: node --import tsx src/lib/__tests__/review-attachment-view-url.test.ts
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { getFileKey, buildAttachmentViewUrl, buildAttachmentUrlFromPath, joinApiUrl } from '../attachment-url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const libPath = join(__dirname, '..', 'attachment-url.ts');
const reviewPagePath = join(__dirname, '..', '..', 'app', '(public)', 'apply', 'review', 'page.tsx');
const source = readFileSync(reviewPagePath, 'utf8');
const libSource = readFileSync(libPath, 'utf8');

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`  ✗ ${name}: ${e?.message ?? e}`);
  }
}

function assertTrue(condition, msg) {
  if (!condition) throw new Error(msg);
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}\n  expected: ${expected}\n  actual:   ${actual}`);
  }
}

// ค่าที่ backend ตอบกลับตอน /public/uploads/direct (upload.routes.ts)
// — key ถูก encodeURIComponent แล้วหนึ่งชั้นอยู่ในตัว path
const STORED_FILE_URL = '/api/v1/public/uploads/files/uploads%2Fdocuments%2F2026%2Fab12cd34-%E0%B9%80%E0%B8%AD%E0%B8%81%E0%B8%AA%E0%B8%B2%E0%B8%A3.pdf';
const STORED_KEY_ENCODED = 'uploads%2Fdocuments%2F2026%2Fab12cd34-%E0%B9%80%E0%B8%AD%E0%B8%81%E0%B8%AA%E0%B8%B2%E0%B8%A3.pdf';

// inline logic ของ admin (ApplicationDetailClient.handleViewFile) — ใช้เทียบ parity
const ADMIN_API_URL = process.env.NEXT_PUBLIC_API_URL || '';
const adminBuildUrl = (fileUrl) =>
  `${ADMIN_API_URL}/public/uploads/files/${encodeURIComponent(
    fileUrl.match(/\/files\/(.+)$/)?.[1] ?? fileUrl
  )}`;

// =========================================================
//  getFileKey — ถอด key
// =========================================================

test('A: ถอด key (ยัง encode อยู่) จาก relative fileUrl ที่เก็บใน draft', () => {
  assertEqual(getFileKey(STORED_FILE_URL), STORED_KEY_ENCODED, 'key ที่ถอดได้ต้องตรงกับส่วนหลัง /files/');
});

test('B: รองรับ absolute URL ที่อาจมาในอนาคต (regex จับ /files/ ได้เหมือน admin)', () => {
  const absolute = `https://api.example.com/api/v1/public/uploads/files/${STORED_KEY_ENCODED}`;
  assertEqual(getFileKey(absolute), STORED_KEY_ENCODED, 'absolute URL ต้องถอด key ได้เหมือนกัน');
});

test('C: ไม่มี segment /files/ → คืนค่าเดิม (fallback เดียวกับ admin)', () => {
  assertEqual(getFileKey('uploads/documents/2026/x.pdf'), 'uploads/documents/2026/x.pdf', 'fallback คืนค่าเดิม');
});

// =========================================================
//  buildAttachmentViewUrl — parity กับ admin
// =========================================================

test('D: key-encoding chain เหมือน inline logic ของ admin ทุกประการ', () => {
  const mine = buildAttachmentViewUrl(STORED_FILE_URL).split('/public/uploads/files/')[1];
  const admin = adminBuildUrl(STORED_FILE_URL).split('/public/uploads/files/')[1];
  // ส่วนหลัง /public/uploads/files/ คือ encodeURIComponent(getFileKey(...))
  // ของทั้งสองฝั่ง — ต้องตรงกัน (origin ต่างกันได้เพราะ fallback ต่าง)
  assertEqual(mine, admin, 'encoded key ต้องเหมือน admin');
});

test('E: ชื่อไฟล์ภาษาไทย encode ถูกต้องและพาธขึ้นต้นด้วย /public/uploads/files/', () => {
  const url = buildAttachmentViewUrl(STORED_FILE_URL);
  assertTrue(url.includes('/public/uploads/files/uploads%252Fdocuments%252F'), 'ต้องเห็น %252F จากการ encode ซ้ำ (Hono ถอดชั้นแรก, backend ถอดชั้นสอง)');
  assertTrue(url.includes('%25E0%25B9%2580'), 'ชื่อไฟล์ไทยต้องถูก encode ต่อจากค่าที่เก็บ');
});

// =========================================================
//  buildAttachmentUrlFromPath — signed view path จาก backend (Migration 029)
// =========================================================

test('I: viewPath ที่มี /api/v1 นำหน้า → ตัด prefix ซ้ำ ไม่ให้เป็น /api/v1/api/v1/ (prod bug)', () => {
  const path = '/api/v1/public/uploads/files/uploads%2Fdocuments%2F2026%2Fabc-x.pdf?exp=1790000000&sig=deadbeef';
  const url = buildAttachmentUrlFromPath(path);
  assertTrue(url.includes('/api/v1/public/uploads/files/'), 'คง path เดิม');
  assertTrue(!url.includes('/api/v1/api/v1/'), 'ห้ามมี prefix /api/v1 ซ้ำ');
  assertTrue(url.includes('exp=1790000000') && url.includes('sig=deadbeef'), 'คง query ของ signature ไว้ครบ');
  assertTrue(url.endsWith('/public/uploads/files/uploads%2Fdocuments%2F2026%2Fabc-x.pdf?exp=1790000000&sig=deadbeef'), 'ต้องต่อกับ API origin เพียงชั้นเดียว');
});

test('I2: viewPath ที่ไม่มี /api/v1 นำหน้า → ต่อกับ API_URL ได้ปกติ (tolerate ทั้งสองรูปแบบ)', () => {
  const path = '/public/uploads/files/abc-x.pdf?exp=1&sig=a';
  const url = buildAttachmentUrlFromPath(path);
  assertTrue(!url.includes('/api/v1/api/v1/'), 'ห้ามมี prefix ซ้ำ');
  assertTrue(url.includes('/public/uploads/files/abc-x.pdf?exp=1&sig=a'), 'คง path และ query ไว้');
});

test('J: absolute URL ผ่านเข้ามา → คืนตรง ๆ / ค่าว่าง → คืนว่าง', () => {
  const abs = 'https://api.example.com/api/v1/public/uploads/files/x.pdf?exp=1&sig=2';
  assertEqual(buildAttachmentUrlFromPath(abs), abs, 'absolute ต้องไม่ถูกต่อซ้ำ');
  assertEqual(buildAttachmentUrlFromPath(''), '', 'ค่าว่าง → ค่าว่าง');
});

// =========================================================
//  joinApiUrl — กัน prefix /api/v1 ซ้ำ (hotfix signed URL ซ้ำ)
// =========================================================

test('K: joinApiUrl ตัด /api/v1 ซ้ำเมื่อ path มี prefix มาเอง', () => {
  const url = joinApiUrl('/api/v1/public/uploads/files/x.pdf?exp=1&sig=a');
  assertTrue(!url.includes('/api/v1/api/v1/'), `ห้ามซ้ำ: ${url}`);
  assertTrue(url.includes('/public/uploads/files/x.pdf?exp=1&sig=a'), 'คง path+query ครบ');
});

test('K2: joinApiUrl ตัดเฉพาะ prefix นำหน้า ไม่แตะ /api/v1 ที่อยู่กลาง path', () => {
  const url = joinApiUrl('/api/v1/public/uploads/files/xx/api/v1.pdf');
  assertTrue(!url.includes('/api/v1/api/v1/'), `ห้ามซ้ำ: ${url}`);
  assertTrue(url.includes('/public/uploads/files/xx/api/v1.pdf'), 'segment กลาง path ต้องคงอยู่');
});

test('K3: joinApiUrl tolerate path ไม่นำหน้า / และ base ที่ลงท้าย /', () => {
  const url = joinApiUrl('public/uploads/files/x.pdf');
  assertTrue(url.includes('/public/uploads/files/x.pdf'), `ต้องเติม slash ให้: ${url}`);
});

// =========================================================
//  Source contract — ApplicationDetailClient (จุดเกิด prod bug ที่สอง)
// =========================================================

test('L: admin detail ต้อง join viewUrl ผ่าน joinApiUrl ห้าม concat API_URL ตรง ๆ', () => {
  const adminClientPath = join(__dirname, '..', '..', 'app', '(admin)', 'admin', 'application-detail', 'ApplicationDetailClient.tsx');
  const adminSource = readFileSync(adminClientPath, 'utf8');
  assertTrue(
    adminSource.includes("from '@/lib/attachment-url'"),
    'ต้อง import helper จาก lib/attachment-url'
  );
  assertTrue(
    !/\$\{API_URL\}\$\{path\}/.test(adminSource),
    'ห้าม `${API_URL}${path}` — viewUrl มี /api/v1 มาเอง จะซ้ำเป็น /api/v1/api/v1/'
  );
  assertTrue(
    adminSource.includes('joinApiUrl(path)'),
    'getSignedViewUrl ต้องใช้ joinApiUrl'
  );
});

// =========================================================
//  Source contract — review page
// =========================================================

test('F: href ของลิงก์ "เปิดดู" ต้องใช้ signed viewUrl ก่อน (Migration 029) fallback buildAttachmentViewUrl', () => {
  // Attachment Lifecycle — GET /files/:key บังคับ signature แล้ว ไฟล์ที่
  // อัปโหลดผ่านระบบใหม่ต้องเปิดด้วย viewUrl (?exp=&sig=) เสมอ
  assertTrue(
    source.includes('att.viewUrl ? buildAttachmentUrlFromPath(att.viewUrl) : buildAttachmentViewUrl(att.fileUrl)'),
    'ต้องเลือก viewUrl ก่อนเสมอ แล้ว fallback เส้นทางเดิมสำหรับ draft เก่า'
  );
  assertTrue(
    source.includes('buildAttachmentUrlFromPath'),
    'ต้อง import buildAttachmentUrlFromPath จาก lib'
  );
  assertTrue(
    !/href=\{att\.fileUrl\}/.test(source),
    'ห้ามใช้ href={att.fileUrl} โดยตรง (relative path → 404 บน frontend origin)'
  );
});

test('G: submit payload ยังส่ง fileUrl ดิบเหมือนเดิม — ห้ามแตะ backend contract', () => {
  assertTrue(
    source.includes('fileUrl: a.fileUrl'),
    'attachments ใน body ของ /public/applications/submit ต้องส่ง fileUrl เดิมจาก draft'
  );
});

test('H: helper อยู่ใน lib ระดับ module พร้อม API_URL ตาม pattern admin (page export เฉพาะ default)', () => {
  assertTrue(libSource.includes('const API_URL = process.env.NEXT_PUBLIC_API_URL'), 'API_URL resolution ต้องอยู่ที่ module level ใน lib');
  assertTrue(libSource.includes('\\/files\\/(.+)$/'), 'regex ถอด key ต้องตรงกับของ admin (/\\/files\\/(.+)$/)');
  assertTrue(
    source.includes("from '@/lib/attachment-url'"),
    'review page ต้อง import buildAttachmentViewUrl จาก lib'
  );
  assertTrue(
    !/export (function|const) (getFileKey|buildAttachmentViewUrl)/.test(source),
    'ห้าม export helper จาก page module (Next.js page export contract)'
  );
});

// =========================================================
console.log('\n========================================');
if (failed > 0) {
  console.log(`FAIL: ${failed} failed, ${passed} passed`);
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
} else {
  console.log(`PASS: all ${passed} tests passed`);
}
