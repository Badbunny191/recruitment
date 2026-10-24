/**
 * Filename Display Helper Tests (frontend)
 * ============================================================================
 * Run: node --import tsx src/lib/__tests__/filename.test.ts
 *
 * พฤติกรรมต้องสอดคล้องกับ backend/src/utils/filename.ts (และชุด test ของ
 * excel-export + upload ฝั่ง backend) — Admin Detail / Review ใช้ helper นี้
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import { attachmentDisplayName, attachmentDisplayFileName } from '../filename';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e: any) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`✗ ${name}: ${e?.message ?? e}`);
  }
}
function assertEqual(actual: any, expected: any, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function assertTrue(cond: any, msg = '') { if (!cond) throw new Error(msg || 'Expected true'); }

const enc = encodeURIComponent;

// ========== AI: original_filename มีค่า → ใช้ก่อนเสมอ ==========
test('AI: original_filename ชนะ URL basename', () => {
  assertEqual(
    attachmentDisplayName({
      originalFilename: 'เรซูเม่_ผู้สมัคร_2026.pdf',
      fileUrl: 'https://r2.example/files/11111111-2222-3333-4444-555555555556-resume.pdf',
    }),
    'เรซูเม่_ผู้สมัคร_2026.pdf',
  );
});

test('AI: original_filename เป็นค่าว่าง/whitespace → ไป fallback', () => {
  assertEqual(
    attachmentDisplayName({ originalFilename: '   ', fileUrl: 'https://r2.example/files/22222222-3333-4444-5555-666666666666-full.pdf' }),
    'full.pdf',
  );
  assertEqual(attachmentDisplayName({ originalFilename: '', fileUrl: 'x/y/a.pdf' }), 'a.pdf');
});

test('AI: original_filename มี control chars → ตัดแบบ defensive', () => {
  assertEqual(
    attachmentDisplayName({ originalFilename: 'เอกสาร\x01ไทย.pdf', fileUrl: '/f/x' }),
    'เอกสารไทย.pdf',
  );
});

// ========== AJ: ข้อมูลเก่า (NULL) → fallback ทุกรูปแบบ ==========
test('AJ: URL-encoded object key (รูปแบบที่ backend เก็บจริง)', () => {
  assertEqual(
    attachmentDisplayName({
      originalFilename: null,
      fileUrl: `/api/v1/public/uploads/files/${enc('uploads/documents/2026/cb189e11-64ab-4d46-a1d8-a495fe7fc846-media_6accd61b060ba_1791809051.pdf')}`,
    }),
    'media_6accd61b060ba_1791809051.pdf',
  );
});

test('AJ: URL-encoded key ชื่อไทย + AK: แสดงชื่อไทยเต็ม', () => {
  assertEqual(
    attachmentDisplayFileName(`/api/v1/public/uploads/files/${enc('uploads/documents/2026/b2a11f73-bdb4-4837-b2bd-5f4a6a905b66-ใบสมัคร-ฉบับแก้ไข.pdf')}`),
    'ใบสมัคร-ฉบับแก้ไข.pdf',
  );
});

test('AJ: raw object key', () => {
  assertEqual(
    attachmentDisplayFileName('uploads/documents/2026/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-raw-object-key.pdf'),
    'raw-object-key.pdf',
  );
});

test('AJ: full URL', () => {
  assertEqual(
    attachmentDisplayFileName('https://r2.example/files/ffffffff-1111-2222-3333-444444444444-full-url.pdf'),
    'full-url.pdf',
  );
});

test('AJ: backslash separator', () => {
  assertEqual(
    attachmentDisplayFileName('uploads\\documents\\2026\\\\12345678-1234-1234-1234-123456789012-backslash.pdf'),
    'backslash.pdf',
  );
});

test('AJ: ชื่อไม่มี UUID prefix ไม่ถูกตัด', () => {
  assertEqual(attachmentDisplayFileName('https://r2.example/files/a1b2c3d4-report.pdf'), 'a1b2c3d4-report.pdf');
});

test('AJ: malformed percent encoding ไม่ throw และไม่ปล่อย %2F ค้าง', () => {
  const name = attachmentDisplayFileName(`/api/v1/public/uploads/files/${enc('uploads/documents/2026/99999999-8888-7777-6666-555555555555-100%.pdf')}`);
  assertEqual(name, '100%.pdf');
});

test('AJ: ถอดไม่ได้ → คืน "" (component ใช้ fallback "ไฟล์")', () => {
  assertEqual(attachmentDisplayFileName('/api/v1/public/uploads/files/'), '');
  assertEqual(attachmentDisplayFileName(''), '');
});

test('AJ: query/hash ถูกตัดก่อน decode', () => {
  assertEqual(
    attachmentDisplayFileName('https://r2.example/files/44444444-4444-4444-4444-444444444444-doc.pdf?download=1#section'),
    'doc.pdf',
  );
});

// ========== draft fileName (หน้า review) ==========
test('review: fileName จาก draft ใช้ก่อน fallback จาก URL', () => {
  assertEqual(
    attachmentDisplayName({ fileName: 'ไฟล์แนบผู้สมัคร.pdf', fileUrl: '/f/uuid-อะไรก็ได้.pdf' }),
    'ไฟล์แนบผู้สมัคร.pdf',
  );
  assertEqual(
    attachmentDisplayName({ fileName: undefined, fileUrl: '/f/12121212-3434-5656-7878-909090909090-name.pdf' }),
    'name.pdf',
  );
  // ชื่อคล้าย uuid แต่ไม่เต็ม 36 ตัว → ไม่ถูกตัด (กฎเดียวกับ backend)
  assertEqual(attachmentDisplayName({ fileName: undefined, fileUrl: '/f/uuid-name.pdf' }), 'uuid-name.pdf');
});

// ========== สรุป ==========
console.log('\n========================================');
console.log(`ผลลัพธ์: ${passed} ผ่าน, ${failed} ล้ม`);
if (failures.length) failures.forEach((f) => console.log(`  ✗ ${f}`));
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
