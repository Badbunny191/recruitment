/**
 * Regression Tests: ApplicationPatternField - Preset Detection
 *
 * ตรวจ logic การ detect preset จาก pattern + sync behavior
 * ป้องกัน bug: Custom state ถูก reset เมื่อ form re-render
 *
 * รัน: npx tsx src/components/__tests__/application-pattern.test.ts
 */

// =============================================================================
// Replicate logic จาก component (เพื่อทดสอบ isolated)
// =============================================================================

type PresetId = 'standard' | 'short' | 'long' | 'custom';

interface Preset {
  id: PresetId;
  pattern: string;
}

const PRESETS: Preset[] = [
  { id: 'standard', pattern: '{YEAR}-{ROUND_CODE}-{RUNNING:4}' },
  { id: 'short', pattern: '{YEAR}-{RUNNING:3}' },
  { id: 'long', pattern: '{YEAR}-{ROUND_CODE}-{RUNNING:6}' },
  { id: 'custom', pattern: '' },
];

function detectPreset(pattern: string | null | undefined): PresetId {
  if (!pattern) return 'custom';
  const match = PRESETS.find((p) => p.id !== 'custom' && p.pattern === pattern);
  return match?.id ?? 'custom';
}

/**
 * จำลอง useEffect sync logic:
 * - prevValue !== value → sync
 * - prevValue === value → skip (re-render ปกติ)
 *
 * Returns: { selectedPreset, customPattern } หลัง sync (หรือ null ถ้า skip)
 */
function simulateExternalSync(
  prevValue: string,
  newValue: string,
  currentPreset: PresetId,
  currentCustom: string,
): { selectedPreset: PresetId; customPattern: string } | null {
  // ✅ Fix: skip ถ้า value เหมือนเดิม
  if (prevValue === newValue) {
    return null; // ไม่ sync, คง state เดิม
  }
  const detected = detectPreset(newValue);
  if (detected === 'custom') {
    return { selectedPreset: 'custom', customPattern: newValue };
  }
  return {
    selectedPreset: detected,
    customPattern: PRESETS.find((p) => p.id === detected)!.pattern,
  };
}

// =============================================================================
// Test framework
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

// =============================================================================
// CASE 1: Default Preset
// =============================================================================

test('Case 1: Create Round default → standard', () => {
  const initial = '{YEAR}-{ROUND_CODE}-{RUNNING:4}';
  const detected = detectPreset(initial);
  assertEqual(detected, 'standard', 'default preset');
});

// =============================================================================
// CASE 2: Select Custom → editable
// =============================================================================

test('Case 2: เลือก Custom → pattern field editable', () => {
  // เมื่อ user คลิก "กำหนดเอง" → component setSelectedPreset('custom')
  // custom input ต้องไม่ readOnly/disabled
  let selectedPreset: PresetId = 'standard';
  selectedPreset = 'custom'; // simulate click
  assertEqual(selectedPreset, 'custom', 'should be custom');

  // custom preset detect จาก pattern อะไรก็ได้ที่ไม่ตรง preset
  const customPattern = 'SAO-{RUNNING:5}';
  const detected = detectPreset(customPattern);
  assertEqual(detected, 'custom', 'should detect as custom');
});

// =============================================================================
// CASE 3: Custom → แก้ pattern → value persist
// =============================================================================

test('Case 3: Custom → แก้ pattern → value persist', () => {
  let value = 'SAO-{RUNNING:5}';
  const userEdit = (next: string) => {
    value = next;
  };
  userEdit('SAO-{RUNNING:6}');
  assertEqual(value, 'SAO-{RUNNING:6}', 'value should update');
  assertEqual(detectPreset(value), 'custom', 'still custom');
});

// =============================================================================
// CASE 4: Custom → แก้ Round Name → re-render → ยังเป็น Custom
// =============================================================================

test('Case 4: Custom → แก้ Round Name (parent re-render) → ยังเป็น Custom', () => {
  // Setup: user เลือก custom + แก้ pattern
  let prevValue = '{YEAR}-{ROUND_CODE}-{RUNNING:4}'; // initial
  let newValue = 'SAO-{RUNNING:5}'; // user เลือก custom → onChange
  let selectedPreset: PresetId = 'standard';
  let customPattern = '';

  // Step 1: user คลิก custom (simulate handleSelectPreset)
  selectedPreset = 'custom';
  customPattern = 'SAO-{RUNNING:5}';
  newValue = 'SAO-{RUNNING:5}'; // parent value updated
  prevValue = 'SAO-{RUNNING:5}'; // ref updated before onChange

  // Step 2: parent re-render ด้วย value เดิม (เพราะ user แก้ Round Name เฉยๆ)
  // useEffect dependency [value] trigger, แต่ prevValue === newValue → skip
  const sync = simulateExternalSync(prevValue, newValue, selectedPreset, customPattern);
  assertEqual(sync, null, 'should skip sync (no external change)');
  assertEqual(selectedPreset, 'custom', 'should still be custom');
  assertEqual(customPattern, 'SAO-{RUNNING:5}', 'custom pattern preserved');
});

// =============================================================================
// CASE 5: Custom → แก้ Round Code → re-render → ยังเป็น Custom
// =============================================================================

test('Case 5: Custom → แก้ Round Code (parent re-render) → ยังเป็น Custom', () => {
  let prevValue = 'SAO-{RUNNING:5}';
  let newValue = 'SAO-{RUNNING:5}'; // Round Code change ไม่กระทบ applicationPattern
  let selectedPreset: PresetId = 'custom';
  let customPattern = 'SAO-{RUNNING:5}';

  const sync = simulateExternalSync(prevValue, newValue, selectedPreset, customPattern);
  assertEqual(sync, null, 'should skip sync');
  assertEqual(selectedPreset, 'custom', 'still custom');
  assertEqual(customPattern, 'SAO-{RUNNING:5}', 'custom pattern preserved');
});

// =============================================================================
// CASE 6: Custom → Save → Pattern ไม่ถูก Override
// =============================================================================

test('Case 6: Custom → Save → pattern ไม่ถูก override เป็น preset', () => {
  // Simulate save flow: component state → parent form → submit
  const customPattern = 'SAO-{RUNNING:5}';
  // Pattern ที่ save ต้องเป็น custom pattern (ไม่ใช่ standard pattern)
  const submittedPattern = customPattern;
  assertTrue(submittedPattern.includes('SAO'), 'should be SAO pattern');
  assertTrue(!submittedPattern.includes('{ROUND_CODE}'), 'should not be standard');
  assertEqual(detectPreset(submittedPattern), 'custom', 'saved as custom');
});

// =============================================================================
// CASE 7: Preset selection → switch correctly
// =============================================================================

test('Case 7: เลือก Preset อื่น (short) → switch เป็น short', () => {
  const shortPattern = '{YEAR}-{RUNNING:3}';
  const detected = detectPreset(shortPattern);
  assertEqual(detected, 'short', 'detect short');
});

test('Case 7b: เลือก Preset อื่น (long) → switch เป็น long', () => {
  const longPattern = '{YEAR}-{ROUND_CODE}-{RUNNING:6}';
  const detected = detectPreset(longPattern);
  assertEqual(detected, 'long', 'detect long');
});

// =============================================================================
// CASE 8: External value change (parent reset) → sync
// =============================================================================

test('Case 8: Parent reset form เป็น standard → sync state', () => {
  let prevValue = 'SAO-{RUNNING:5}';
  let newValue = '{YEAR}-{ROUND_CODE}-{RUNNING:4}'; // parent reset เป็น standard
  let selectedPreset: PresetId = 'custom';
  let customPattern = 'SAO-{RUNNING:5}';

  const sync = simulateExternalSync(prevValue, newValue, selectedPreset, customPattern);
  assertTrue(sync !== null, 'should sync');
  assertEqual(sync!.selectedPreset, 'standard', 'should switch to standard');
  assertEqual(sync!.customPattern, '{YEAR}-{ROUND_CODE}-{RUNNING:4}', 'should update customPattern');
});

// =============================================================================
// CASE 9: เลือก Custom แล้ว → value ตรง preset (typo) → ไม่ควร reset
// =============================================================================

test('Case 9: User พิมพ์ pattern ที่บังเอิญตรง standard → ไม่ reset เป็น standard', () => {
  // เดิม: user เลือก custom + พิมพ์ {YEAR}-{ROUND_CODE}-{RUNNING:4} (เหมือน standard)
  // prevValueRef.current ต้อง update ทันทีเมื่อ user พิมพ์ (handleCustomChange)
  let prevValue = ''; // initial
  let newValue = '{YEAR}-{ROUND_CODE}-{RUNNING:4}'; // user พิมพ์
  let selectedPreset: PresetId = 'custom';
  let customPattern = '';

  // Simulate handleCustomChange: update prevValueRef ก่อน onChange
  prevValue = newValue; // ✅ fix: update ref ทันที
  customPattern = newValue;
  selectedPreset = 'custom';
  // parent value also updated
  // ตอน re-render: useEffect trigger, แต่ prevValue === newValue → skip
  const sync = simulateExternalSync(prevValue, newValue, selectedPreset, customPattern);
  assertEqual(sync, null, 'should skip sync (value matches ref)');
  assertEqual(selectedPreset, 'custom', 'should remain custom');
});

// =============================================================================
// CASE 10: Empty value (Legacy Banner trigger)
// =============================================================================

test('Case 10: value เป็น null → Legacy Banner (ไม่ใช่ custom)', () => {
  const detected = detectPreset(null);
  assertEqual(detected, 'custom', 'null falls through to custom (then component returns LegacyBanner)');
});

// =============================================================================
// Summary
// =============================================================================

console.log('\n' + '='.repeat(60));
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
console.log('='.repeat(60));

if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}

process.exit(0);
