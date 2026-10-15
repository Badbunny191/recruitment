/**
 * Unit Tests: Application Number Pattern Validator
 * รัน: npx tsx src/utils/__tests__/application-pattern.test.ts
 * หรือ: node --import tsx src/utils/__tests__/application-pattern.test.ts
 */

import {
  validateApplicationPattern,
  renderPattern,
  buildPreview,
  DEFAULT_APPLICATION_PATTERN,
  extractRunningDigitCount,
  validateRoundCode,
} from '../application-pattern';

// =============================================================================
// Test framework ง่ายๆ (ไม่ต้องการ vitest/jest)
// =============================================================================

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
    console.log(`✗ ${name}: ${e.message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition: boolean, msg = '') {
  if (!condition) throw new Error(msg || 'Expected true');
}

function assertContains(haystack: string, needle: string, msg = '') {
  if (!haystack.includes(needle)) {
    throw new Error(`${msg} expected "${haystack}" to contain "${needle}"`);
  }
}

// =============================================================================
// validateApplicationPattern
// =============================================================================

console.log('\n=== validateApplicationPattern ===\n');

test('validates default pattern', () => {
  const r = validateApplicationPattern(DEFAULT_APPLICATION_PATTERN);
  assertTrue(r.valid, 'should be valid');
  if (r.valid) {
    assertEqual(r.digitCount, 4, 'digit count');
    assertEqual(r.maxCapacity, 9999, 'max capacity');
  }
});

test('accepts custom pattern with separator /', () => {
  const r = validateApplicationPattern('{YEAR}/{ROUND_CODE}/{RUNNING:5}');
  assertTrue(r.valid);
});

test('accepts pattern with only RUNNING (3 digits)', () => {
  const r = validateApplicationPattern('{RUNNING:3}');
  assertTrue(r.valid);
  if (r.valid) assertEqual(r.digitCount, 3);
});

test('rejects pattern without RUNNING', () => {
  const r = validateApplicationPattern('{YEAR}-{ROUND_CODE}');
  assertTrue(!r.valid);
  assertContains(getError(r), 'RUNNING');
});

type ValidationFailure = Extract<ReturnType<typeof validateApplicationPattern>, { valid: false }>;
function getError(r: ReturnType<typeof validateApplicationPattern>): string {
  if (r.valid) throw new Error('expected failure but got success');
  return (r as ValidationFailure).error;
}

test('rejects digit count = 2 (too small)', () => {
  const r = validateApplicationPattern('{YEAR}-{RUNNING:2}');
  assertTrue(!r.valid);
  assertContains(getError(r), 'จำนวนหลัก');
});

test('rejects digit count = 7 (too large)', () => {
  const r = validateApplicationPattern('{YEAR}-{RUNNING:7}');
  assertTrue(!r.valid);
});

test('rejects pattern starting with separator', () => {
  const r = validateApplicationPattern('-{YEAR}-{RUNNING:4}');
  assertTrue(!r.valid);
  assertContains(getError(r), 'ขึ้นต้น');
});

test('rejects pattern ending with separator', () => {
  const r = validateApplicationPattern('{YEAR}-{RUNNING:4}-');
  assertTrue(!r.valid);
  assertContains(getError(r), 'ลงท้าย');
});

test('rejects consecutive separators', () => {
  const r = validateApplicationPattern('{YEAR}--{RUNNING:4}');
  assertTrue(!r.valid);
  assertContains(getError(r), 'ตัวคั่นซ้ำ');
});

test('rejects unknown token (LEVEL removed in MVP)', () => {
  const r = validateApplicationPattern('{YEAR}-{LEVEL}-{RUNNING:4}');
  assertTrue(!r.valid);
  assertContains(getError(r), 'ไม่รู้จัก');
});

test('rejects unknown token (SEQ removed in MVP)', () => {
  const r = validateApplicationPattern('{YEAR}-{SEQ}-{RUNNING:4}');
  assertTrue(!r.valid);
  assertContains(getError(r), 'ไม่รู้จัก');
});

test('rejects duplicate token', () => {
  const r = validateApplicationPattern('{YEAR}-{YEAR}-{RUNNING:4}');
  assertTrue(!r.valid);
  assertContains(getError(r), 'ซ้ำ');
});

test('rejects empty pattern', () => {
  const r = validateApplicationPattern('');
  assertTrue(!r.valid);
});

test('rejects pattern exceeding max length', () => {
  const long = '{YEAR}-' + 'x'.repeat(200) + '-{RUNNING:4}';
  const r = validateApplicationPattern(long);
  assertTrue(!r.valid);
});

test('rejects RUNNING without digit count', () => {
  const r = validateApplicationPattern('{YEAR}-{RUNNING}');
  assertTrue(!r.valid);
  assertContains(getError(r), 'จำนวนหลัก');
});

test('rejects unbalanced braces', () => {
  const r = validateApplicationPattern('{YEAR-{RUNNING:4}');
  assertTrue(!r.valid);
});

// =============================================================================
// renderPattern / buildPreview
// =============================================================================

console.log('\n=== renderPattern / buildPreview ===\n');

test('renders default pattern correctly', () => {
  const preview = buildPreview(DEFAULT_APPLICATION_PATTERN, {
    year: 2026,
    roundCode: 'CHM01',
    running: 1,
  });
  assertEqual(preview, '2026-CHM01-0001');
});

test('pads RUNNING to N digits', () => {
  const preview = buildPreview('{YEAR}-{ROUND_CODE}-{RUNNING:5}', {
    year: 2026, roundCode: 'TEMP01', running: 42,
  });
  assertEqual(preview, '2026-TEMP01-00042');
});

test('renders pattern with only ROUND_CODE + RUNNING', () => {
  const preview = buildPreview('{ROUND_CODE}-{RUNNING:4}', {
    year: 2026, roundCode: 'AUDIT01', running: 1,
  });
  assertEqual(preview, 'AUDIT01-0001');
});

test('renders with slash separator', () => {
  const preview = buildPreview('{YEAR}/{ROUND_CODE}/{RUNNING:4}', {
    year: 2027, roundCode: 'PROMOTE01', running: 1,
  });
  assertEqual(preview, '2027/PROMOTE01/0001');
});

test('returns raw pattern when invalid (fallback)', () => {
  const preview = buildPreview('{INVALID}-{RUNNING:4}', { year: 2026, roundCode: 'x', running: 1 });
  assertEqual(preview, '{INVALID}-{RUNNING:4}');
});

test('supports all 4 digit counts (3, 4, 5, 6)', () => {
  for (const n of [3, 4, 5, 6]) {
    const r = validateApplicationPattern(`{YEAR}-{ROUND_CODE}-{RUNNING:${n}}`);
    assertTrue(r.valid, `RUNNING:${n} should be valid`);
    if (r.valid) assertEqual(r.digitCount, n);
  }
});

// =============================================================================
// extractRunningDigitCount
// =============================================================================

console.log('\n=== extractRunningDigitCount ===\n');

test('extracts digit count from valid pattern', () => {
  assertEqual(extractRunningDigitCount('{YEAR}-{RUNNING:5}'), 5);
  assertEqual(extractRunningDigitCount('{YEAR}-{RUNNING:3}'), 3);
  assertEqual(extractRunningDigitCount(DEFAULT_APPLICATION_PATTERN), 4);
});

test('returns null when no RUNNING', () => {
  assertEqual(extractRunningDigitCount('{YEAR}'), null);
});

// =============================================================================
// validateRoundCode
// =============================================================================

console.log('\n=== validateRoundCode ===\n');

test('accepts valid round code (uppercase)', () => {
  const r = validateRoundCode('CHM01');
  assertTrue(r.valid);
  if (r.valid) assertEqual(r.normalized, 'CHM01');
});

test('auto-uppercases lowercase input', () => {
  const r = validateRoundCode('chm01');
  assertTrue(r.valid);
  if (r.valid) assertEqual(r.normalized, 'CHM01');
});

test('accepts all example codes', () => {
  for (const code of ['CHM01', 'TEMP01', 'GOV01', 'PROMOTE01', 'AUDIT01', 'SAO2026A']) {
    const r = validateRoundCode(code);
    assertTrue(r.valid, `${code} should be valid`);
  }
});

type RoundCodeFailure = Extract<ReturnType<typeof validateRoundCode>, { valid: false }>;
function getCodeError(r: ReturnType<typeof validateRoundCode>): string {
  if (r.valid) throw new Error('expected failure but got success');
  return (r as RoundCodeFailure).error;
}

test('rejects too short (less than 3)', () => {
  const r = validateRoundCode('AB');
  assertTrue(!r.valid);
  assertContains(getCodeError(r), 'อย่างน้อย');
});

test('rejects too long (more than 20)', () => {
  const r = validateRoundCode('A'.repeat(21));
  assertTrue(!r.valid);
  assertContains(getCodeError(r), 'ไม่เกิน');
});

test('rejects empty', () => {
  const r = validateRoundCode('');
  assertTrue(!r.valid);
});

test('rejects null', () => {
  const r = validateRoundCode(null);
  assertTrue(!r.valid);
});

test('rejects spaces', () => {
  const r = validateRoundCode('CHM 01');
  assertTrue(!r.valid);
  assertContains(getCodeError(r), 'ตัวอักษรภาษาอังกฤษ');
});

test('rejects special chars', () => {
  for (const bad of ['CHM-01', 'CHM.01', 'CHM/01', 'CHM@01', 'ทดสอบ01']) {
    const r = validateRoundCode(bad);
    assertTrue(!r.valid, `${bad} should be invalid`);
  }
});

test('rejects thai chars', () => {
  const r = validateRoundCode('ชม01');
  assertTrue(!r.valid);
});

test('trims whitespace before validation', () => {
  const r = validateRoundCode('  CHM01  ');
  assertTrue(r.valid);
  if (r.valid) assertEqual(r.normalized, 'CHM01');
});

test('accepts minimum length 3', () => {
  const r = validateRoundCode('ABC');
  assertTrue(r.valid);
});

test('accepts maximum length 20', () => {
  const r = validateRoundCode('A'.repeat(20));
  assertTrue(r.valid);
});

// =============================================================================
// Summary
// =============================================================================

console.log('\n=== Summary ===\n');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).process.exit(1);
}
