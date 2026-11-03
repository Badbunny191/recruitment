// @ts-nocheck
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import HomePage from '../../app/(public)/page';
import LookupPage from '../../app/(public)/lookup/page';

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
    failures.push(`${name}: ${e.message}`);
    console.error(`✗ ${name}`);
    console.error(`  ${e.stack || e.message}`);
  }
}

function assert(condition: any, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

console.log('\n========================================');
console.log('Applicant Lookup UI Component Tests');
console.log('========================================\n');

test('HomePage puts recruitment rounds above the lookup box', () => {
  const html = renderToStaticMarkup(<HomePage />);

  // ยังมี lookup อยู่ (ห้ามลบ) — แค่ลดความเด่นลงเป็น secondary action
  assert(html.includes('ค้นหาใบสมัคร'), 'Home page should have "ค้นหาใบสมัคร"');
  assert(html.includes('href="/lookup"'), 'Home page lookup button links to /lookup');
  assert(
    html.includes('สมัครแล้วต้องการตรวจสอบสถานะ?'),
    'Home page should have the lookup subtitle',
  );

  // section หลักของหน้าแรกคือการสมัคร
  assert(
    html.includes('กำลังเปิดรับสมัคร'),
    'Home page should have the "กำลังเปิดรับสมัคร" section',
  );
  assert(
    !html.includes('รอบรับสมัครที่เปิดอยู่'),
    'Old header "รอบรับสมัครที่เปิดอยู่" must be gone (it was misleading)',
  );

  // ลำดับ: rounds มาก่อน lookup (Primary = สมัคร, Secondary = ค้นหา)
  const roundsIndex = html.indexOf('กำลังเปิดรับสมัคร');
  const lookupIndex = html.indexOf('ค้นหาใบสมัคร');
  assert(
    roundsIndex !== -1 && lookupIndex !== -1 && roundsIndex < lookupIndex,
    'Recruitment rounds must appear above the lookup box',
  );
});

test('HomePage has exactly one h1 and no emoji icons', () => {
  const html = renderToStaticMarkup(<HomePage />);

  // PHASE 6: h1 หลักมีตัวเดียว (เดิม layout มี h1 + หน้าแรกมี h1 อีก = ซ้ำ)
  const h1Count = (html.match(/<h1[\s>]/g) || []).length;
  assert(h1Count === 0, `HomePage must not render its own <h1> (found ${h1Count})`);

  // PHASE 5: เลิกใช้ emoji ในหน้าแรก
  for (const emoji of ['🔍', '📅', '⏳']) {
    assert(!html.includes(emoji), `HomePage must not use emoji ${emoji}`);
  }
});

test('LookupPage renders the form fields required by spec', () => {
  const html = renderToStaticMarkup(<LookupPage />);
  assert(html.includes('ค้นหาใบสมัคร'), 'Lookup page has title');
  assert(html.includes('รอบรับสมัคร'), 'Lookup page has "รอบรับสมัคร" label');
  assert(html.includes('อีเมล'), 'Lookup page has "อีเมล" label');
  assert(html.includes('เบอร์โทรศัพท์'), 'Lookup page has "เบอร์โทรศัพท์" label');
  assert(html.includes('type="email"'), 'Email field has email type');
  assert(html.includes('type="tel"'), 'Phone field has tel type');
  assert(html.includes('ค้นหาใบสมัคร</button>'), 'Has submit button');
  assert(!html.includes('เลขที่ใบสมัคร *'), 'Does NOT use application number as input key');
  assert(!html.includes('เลขบัตรประชาชน'), 'Does NOT use citizen ID as input key');
  assert(!html.includes('วันเกิด'), 'Does NOT use birthday as input key');
});

console.log(`\n=== Summary ===\nPassed: ${passed}\nFailed: ${failed}\n`);
if (failed > 0) {
  process.exit(1);
}
