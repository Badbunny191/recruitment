/**
 * สร้างไฟล์ทดสอบ (Test Assets) — PDF / JPG / PNG ขึ้นต้นด้วย "TEST-"
 * ---------------------------------------------------------------------------
 * ไฟล์ทั้งหมดเป็นไฟล์จริง (valid) เพื่อผ่านการอัปโหลดของระบบ:
 *  - TEST-resume.pdf      → ใช้อัปโหลดใน flow หลัก (ระบบรับเฉพาะ PDF)
 *  - TEST-portfolio.pdf   → ไฟล์แนบเสริม (ฟิลด์ optional)
 *  - TEST-idcard.png      → ใช้ทดสอบ validation (ระบบจริงปฏิเสธ — ดู TODO.md)
 *  - TEST-photo.jpg       → ใช้ทดสอบ validation (ระบบจริงปฏิเสธ — ดู TODO.md)
 *
 * ไม่ใช้ dependency ภายนอก: PDF เขียน byte ตรง / PNG เขียนด้วย zlib (built-in)
 * / JPG ฝัง base64 ของ minimal JPEG
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)));

// ---------------------------------------------------------------------------
// 1) PDF — minimal valid single/multi page PDF (offset คำนวณจริง)
// ---------------------------------------------------------------------------
function buildPdf(lines) {
  const objects = [];
  // header จะถูกใส่ตอน serialize
  const contentText = lines
    .map((l, i) => `BT /F1 ${i === 0 ? 16 : 11} Tf 60 ${760 - i * 32} Td (${l.replace(/[\\()]/g, '')}) Tj ET`)
    .join('\n');
  const stream = `${contentText}\n`;

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`;
  objects[3] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`;
  objects[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
  objects[5] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`;

  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = Buffer.byteLength(out, 'latin1');
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(out, 'latin1');
  const size = objects.length; // object สูงสุด + 1
  out += `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) {
    out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// ---------------------------------------------------------------------------
// 2) PNG — encoder เล็ก ๆ ด้วย zlib (CRC32 เขียนเอง)
// ---------------------------------------------------------------------------
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** สร้าง PNG w×h มีแถบสี (เป็นรูปจริง ไม่ใช่ 1×1) */
function buildPng(width, height) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let p = 0;
  const palette = [
    [200, 30, 45], [240, 200, 40], [30, 90, 160], [30, 140, 70], [120, 60, 160],
  ];
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter none
    for (let x = 0; x < width; x++) {
      const c = palette[Math.floor(((x + y) / 16) % palette.length)];
      raw[p++] = c[0]; raw[p++] = c[1]; raw[p++] = c[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// 3) JPG — minimal valid JPEG (base64 มาตรฐาน 16×16)
// ---------------------------------------------------------------------------
const MINIMAL_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAACAAIBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

// ---------------------------------------------------------------------------

const FILES = [
  { name: 'TEST-resume.pdf', build: () => buildPdf([
    'TEST - LOAD TEST DOCUMENT (RESUME)',
    'This is a generated test file for SAO Recruitment load testing.',
    'Applicant data is fictitious. All records use the TEST- prefix.',
    'SAO Recruitment - Load Test 250 Users',
  ]), type: 'application/pdf' },
  { name: 'TEST-portfolio.pdf', build: () => buildPdf([
    'TEST - LOAD TEST DOCUMENT (PORTFOLIO)',
    'Generated portfolio placeholder for load testing.',
    'SAO Recruitment - Load Test 250 Users',
  ]), type: 'application/pdf' },
  { name: 'TEST-idcard.png', build: () => buildPng(320, 200), type: 'image/png' },
  { name: 'TEST-photo.jpg', build: () => Buffer.from(MINIMAL_JPEG_BASE64, 'base64'), type: 'image/jpeg' },
];

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const f of FILES) {
    const buf = f.build();
    const dest = path.join(OUT_DIR, f.name);
    writeFileSync(dest, buf);
    console.log(`สร้าง ${dest} (${buf.length.toLocaleString()} bytes, ${f.type})`);
  }
  console.log('\nเสร็จสิ้น — ไฟล์ทุกไฟล์ขึ้นต้นด้วย TEST- (ใช้เป็นเงื่อนไข cleanup ได้)');
}

main();
