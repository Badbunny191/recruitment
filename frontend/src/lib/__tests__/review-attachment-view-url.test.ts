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
 *
 * Run: node --import tsx src/lib/__tests__/review-attachment-view-url.test.ts
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { getFileKey, buildAttachmentViewUrl } from '../attachment-url';

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
//  Source contract — review page
// =========================================================

test('F: href ของลิงก์ "เปิดดู" ต้องผ่าน buildAttachmentViewUrl ไม่ใช่ att.fileUrl ตรง ๆ', () => {
  assertTrue(
    source.includes('href={buildAttachmentViewUrl(att.fileUrl)}'),
    'ต้องเป็น href={buildAttachmentViewUrl(att.fileUrl)}'
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
