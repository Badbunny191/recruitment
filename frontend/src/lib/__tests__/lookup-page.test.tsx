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

test('HomePage renders the lookup box above recruitment rounds', () => {
  const html = renderToStaticMarkup(<HomePage />);
  assert(html.includes('ค้นหาใบสมัคร'), 'Home page should have "ค้นหาใบสมัคร"');
  assert(html.includes('สมัครแล้วและต้องการกลับมาดูข้อมูล?'), 'Home page should have subtitle 1');
  assert(html.includes('ตรวจสอบสถานะการสมัครย้อนหลังได้ที่นี่'), 'Home page should have subtitle 2');
  assert(html.includes('href="/lookup"'), 'Home page lookup button links to /lookup');
  assert(html.includes('รอบรับสมัครที่เปิดอยู่'), 'Home page still has "รอบรับสมัครที่เปิดอยู่" header');
  
  // Verify order: lookup box appears before the round list header
  const lookupIndex = html.indexOf('ค้นหาใบสมัคร');
  const roundsHeaderIndex = html.indexOf('รอบรับสมัครที่เปิดอยู่');
  assert(lookupIndex !== -1 && roundsHeaderIndex !== -1 && lookupIndex < roundsHeaderIndex,
    'Lookup card must appear above "รอบรับสมัครที่เปิดอยู่"');
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
