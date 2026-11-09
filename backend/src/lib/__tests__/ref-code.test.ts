/**
 * Ref Code Generator Tests
 * ========================
 *
 * Verifies:
 * 1. Output format matches ^ERR-[2-9A-HJ-NP-Z]{6}$
 * 2. Does NOT contain ambiguous characters (0, O, 1, I, L, U)
 * 3. 1,000 generated codes are unique (collision test)
 *
 * Run: node --import tsx src/lib/__tests__/ref-code.test.ts
 */

import { generateRefCode, isValidRefCode, REF_CODE_ALPHABET } from '../ref-code';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (!condition) {
    failed++;
    console.error(`  ✗ ${msg}`);
    throw new Error(msg);
  }
  passed++;
  console.log(`  ✓ ${msg}`);
}

async function run() {
  console.log('\n=== Test Suite: Ref Code Generator ===\n');

  // 1. Format check
  const code = generateRefCode();
  assert(typeof code === 'string' && code.startsWith('ERR-'), 'code has ERR- prefix');
  assert(code.length === 10, 'total length is 10 chars (ERR- + 6)');
  assert(isValidRefCode(code), 'passes isValidRefCode regex');

  // 2. Ambiguity check: must not contain 0, O, 1, I, L, U
  const forbidden = ['0', 'O', '1', 'I', 'L', 'U'];
  for (const ch of forbidden) {
    assert(!REF_CODE_ALPHABET.includes(ch), `alphabet does not contain forbidden char: ${ch}`);
  }

  // 3. Collision check over 1,000 samples
  const set = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const c = generateRefCode();
    assert(isValidRefCode(c), `sample ${i} is valid`);
    set.add(c);
  }
  assert(set.size === 1000, '1,000 generated codes are 100% unique');

  console.log(`\nRef Code Tests: ${passed} passed, ${failed} failed\n`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
