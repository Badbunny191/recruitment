/**
 * Date Formatting Utilities Tests
 * 
 * Tests for date normalization and formatting functions.
 * 
 * Run: node --import tsx src/lib/__tests__/date.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing

import { normalizeDate, formatDateThai, formatLastLogin, formatPasswordChanged } from '../date';

// ========== TEST RUNNER ==========

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

function assertNotEqual(actual: any, expected: any, msg = '') {
  if (actual === expected) {
    throw new Error(`${msg} expected not ${JSON.stringify(expected)}`);
  }
}

// ========== TESTS ==========

console.log('========================================');
console.log('Date Formatting Utilities Tests');
console.log('========================================\n');

// normalizeDate tests
test('null returns null', () => {
  assertEqual(normalizeDate(null), null);
});

test('undefined returns null', () => {
  assertEqual(normalizeDate(undefined), null);
});

test('empty string returns null', () => {
  assertEqual(normalizeDate(''), null);
});

test('whitespace string returns null', () => {
  assertEqual(normalizeDate('   '), null);
});

test('valid Date object returns Date', () => {
  const date = new Date('2024-01-15T10:30:00Z');
  const result = normalizeDate(date);
  if (!(result instanceof Date)) throw new Error('Expected Date instance');
});

test('Invalid Date object returns null', () => {
  const invalidDate = new Date('invalid');
  assertEqual(normalizeDate(invalidDate), null);
});

test('Unix seconds (< 10,000,000,000) converts to milliseconds', () => {
  const result = normalizeDate(1705318200);
  if (!(result instanceof Date)) throw new Error('Expected Date instance');
  // 1705318200 seconds = 1705318200000 milliseconds
  assertEqual(result.getTime(), 1705318200000);
});

test('Unix milliseconds (>= 10,000,000,000) stays as milliseconds', () => {
  const result = normalizeDate(1705318200000);
  if (!(result instanceof Date)) throw new Error('Expected Date instance');
  assertEqual(result.getTime(), 1705318200000);
});

test('ISO string parses correctly', () => {
  const result = normalizeDate('2024-01-15T10:30:00Z');
  if (!(result instanceof Date)) throw new Error('Expected Date instance');
});

test('Numeric string (seconds) parses correctly', () => {
  const result = normalizeDate('1705318200');
  if (!(result instanceof Date)) throw new Error('Expected Date instance');
});

test('Invalid string returns null', () => {
  assertEqual(normalizeDate('not-a-date'), null);
});

// formatLastLogin tests
test('formatLastLogin: null returns "ยังไม่เคยเข้าสู่ระบบ"', () => {
  assertEqual(formatLastLogin(null), 'ยังไม่เคยเข้าสู่ระบบ');
});

test('formatLastLogin: undefined returns "ยังไม่เคยเข้าสู่ระบบ"', () => {
  assertEqual(formatLastLogin(undefined), 'ยังไม่เคยเข้าสู่ระบบ');
});

test('formatLastLogin: empty string returns "ยังไม่เคยเข้าสู่ระบบ"', () => {
  assertEqual(formatLastLogin(''), 'ยังไม่เคยเข้าสู่ระบบ');
});

test('formatLastLogin: valid Date object formats correctly', () => {
  const result = formatLastLogin(new Date('2024-01-15'));
  assertNotEqual(result, 'ยังไม่เคยเข้าสู่ระบบ', 'Should not be null message');
  assertNotEqual(result, '-', 'Should not be dash');
});

test('formatLastLogin: Unix seconds formats correctly', () => {
  const result = formatLastLogin(1705318200);
  assertNotEqual(result, 'ยังไม่เคยเข้าสู่ระบบ', 'Should not be null message');
  assertNotEqual(result, '-', 'Should not be dash');
});

test('formatLastLogin: invalid string returns dash', () => {
  assertEqual(formatLastLogin('not-a-date'), '-');
});

test('formatLastLogin: invalid Date returns dash', () => {
  assertEqual(formatLastLogin(new Date('invalid')), '-');
});

test('formatLastLogin: includes time in output', () => {
  // Use a specific timestamp: 2024-01-15 10:30:45 UTC
  // 1705318245 seconds = 1705318245000 milliseconds
  const result = formatLastLogin(1705318245);
  // Result should contain time (colon pattern like "10:30" or "17:30")
  if (!/:\d{2}/.test(result)) {
    throw new Error(`Expected time in output, got: ${result}`);
  }
});

// formatPasswordChanged tests
test('formatPasswordChanged: null returns "ยังไม่เคยเปลี่ยน"', () => {
  assertEqual(formatPasswordChanged(null), 'ยังไม่เคยเปลี่ยน');
});

test('formatPasswordChanged: undefined returns "ยังไม่เคยเปลี่ยน"', () => {
  assertEqual(formatPasswordChanged(undefined), 'ยังไม่เคยเปลี่ยน');
});

test('formatPasswordChanged: valid Date formats correctly', () => {
  const result = formatPasswordChanged(new Date('2024-01-15'));
  assertNotEqual(result, 'ยังไม่เคยเปลี่ยน', 'Should not be null message');
  assertNotEqual(result, '-', 'Should not be dash');
});

// formatDateThai tests
test('formatDateThai: valid date formats correctly', () => {
  const result = formatDateThai(new Date('2024-06-15'));
  // Just check that it returns a non-empty string (timezone agnostic)
  if (typeof result !== 'string' || result.length === 0) {
    throw new Error('Should return a non-empty string');
  }
});

test('formatDateThai: null returns dash', () => {
  assertEqual(formatDateThai(null), '-');
});

test('formatDateThai: invalid string returns dash', () => {
  assertEqual(formatDateThai('invalid'), '-');
});

// ========== SUMMARY ==========

console.log('\n=== Summary ===\n');
console.log(`Total: ${passed} passed, ${failed} failed`);

if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
}

if (failed > 0) {
  process.exit(1);
}
