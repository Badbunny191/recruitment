// @ts-nocheck
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sql } from 'drizzle-orm';
import * as schema from '../../db/schema';
import {
  normalizePhone,
  extractPhoneCandidates,
  isPhoneMatch,
  lookupApplication,
  getLookupRoundOptions,
} from '../applicant-lookup.service';

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });

  sqlite.exec(`
    CREATE TABLE recruitment_rounds (
      id TEXT PRIMARY KEY,
      template_version_id TEXT NOT NULL,
      title TEXT NOT NULL,
      position_level TEXT NOT NULL,
      open_date INTEGER NOT NULL,
      close_date INTEGER NOT NULL,
      status TEXT DEFAULT 'ACTIVE',
      created_at INTEGER DEFAULT (unixepoch()),
      deleted_at INTEGER,
      announcement_title TEXT,
      announcement_description TEXT,
      contact_information TEXT,
      remark TEXT,
      application_pattern TEXT,
      round_code TEXT
    );

    CREATE TABLE applications (
      id TEXT PRIMARY KEY,
      application_no TEXT UNIQUE,
      round_id TEXT NOT NULL REFERENCES recruitment_rounds(id),
      email TEXT NOT NULL,
      fullname TEXT NOT NULL,
      national_id TEXT,
      status TEXT DEFAULT 'SUBMITTED',
      status_reason TEXT,
      verified_by TEXT,
      verified_at INTEGER,
      form_data TEXT NOT NULL,
      submitted_at INTEGER DEFAULT (unixepoch()),
      deleted_at INTEGER,
      year INTEGER,
      round_code TEXT,
      seq_in_round INTEGER
    );
  `);

  return { sqlite, db };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log('\n========================================');
  console.log('Applicant Lookup Service Tests');
  console.log('========================================\n');

  let passed = 0;

  // 1. Phone Normalization tests
  console.log('[1] normalizePhone tests');
  assert(normalizePhone('087-543-3363') === '0875433363', 'strips hyphens');
  assert(normalizePhone('+66 87 543 3363') === '0875433363', 'converts +66 to 0');
  assert(normalizePhone('66875433363') === '0875433363', 'converts 66 prefix to 0');
  assert(normalizePhone('02-123-4567') === '021234567', 'supports landline');
  console.log('✓ normalizePhone works for various formats');
  passed++;

  // 2. Phone Extraction tests
  console.log('[2] extractPhoneCandidates tests');
  const fd1 = { 'field-phone': '0812345678', 'field-email': 'test@test.com' };
  assert(extractPhoneCandidates(fd1).includes('0812345678'), 'extracts field-phone');

  const fd2 = { phone: '0899999999' };
  assert(extractPhoneCandidates(fd2).includes('0899999999'), 'extracts phone');

  const fd3 = { custom_telephone_no: '023334444' };
  assert(extractPhoneCandidates(fd3).includes('023334444'), 'extracts key containing telephone');
  console.log('✓ extractPhoneCandidates works across keys');
  passed++;

  // 3. Database lookup tests
  console.log('[3] lookupApplication integration tests');
  const { sqlite, db } = createTestDb();

  // Seed rounds
  sqlite.exec(`
    INSERT INTO recruitment_rounds (id, template_version_id, title, position_level, open_date, close_date, status, created_at)
    VALUES 
      ('round-001', 'tplver-1', 'รับสมัครพนักงานใหม่ ประจำปี 2569', 'ชำนาญการ', 1700000000, 1800000000, 'ACTIVE', 1700000000),
      ('round-002', 'tplver-1', 'รอบที่ปิดแล้ว', 'ปฏิบัติการ', 1600000000, 1650000000, 'CLOSED', 1600000000),
      ('round-draft', 'tplver-1', 'รอบร่าง', 'ชำนาญการพิเศษ', 1700000000, 1800000000, 'DRAFT', 1700000000);
  `);

  // Seed applications
  sqlite.exec(`
    INSERT INTO applications (id, application_no, round_id, email, fullname, status, form_data, submitted_at)
    VALUES
      ('app-1', 'APP-2026-0001', 'round-001', 'somchai@example.com', 'สมชาย สายลม', 'SUBMITTED', '{"field-phone":"0812345678","field-fullname":"สมชาย สายลม"}', 1705000000),
      ('app-2', 'APP-2026-0002', 'round-001', 'somying@example.com', 'สมหญิง จริงใจ', 'QUALIFIED', '{"field-phone":"089-876-5432"}', 1705100000),
      ('app-3', 'APP-2026-0003', 'round-002', 'closed_user@example.com', 'ผู้สมัคร รอบปิด', 'UNDER_REVIEW', '{"phone":"029998888"}', 1620000000);
  `);

  // Test 3.1: Successful lookup with exact match
  const res1 = await lookupApplication(db, {
    roundId: 'round-001',
    email: 'somchai@example.com',
    phone: '0812345678',
  });
  assert(res1.ok === true, 'res1 should be ok');
  assert(res1.data.applicationNo === 'APP-2026-0001', 'correct applicationNo');
  assert(res1.data.positionTitle === 'ชำนาญการ', 'correct positionTitle');
  assert(res1.data.status === 'SUBMITTED', 'correct status');
  console.log('✓ exact match succeeds');
  passed++;

  // Test 3.2: Successful lookup with phone format variation and email case difference
  const res2 = await lookupApplication(db, {
    roundId: 'round-001',
    email: 'SOMYING@EXAMPLE.COM',
    phone: '+66 89 876 5432',
  });
  assert(res2.ok === true, 'res2 should be ok');
  assert(res2.data.applicationNo === 'APP-2026-0002', 'correct applicationNo');
  assert(res2.data.status === 'QUALIFIED', 'correct status QUALIFIED');
  console.log('✓ case-insensitive email and formatted phone lookup succeeds');
  passed++;

  // Test 3.3: Lookup for closed round works
  const res3 = await lookupApplication(db, {
    roundId: 'round-002',
    email: 'closed_user@example.com',
    phone: '02-999-8888',
  });
  assert(res3.ok === true, 'res3 should be ok');
  assert(res3.data.applicationNo === 'APP-2026-0003', 'correct applicationNo for closed round');
  console.log('✓ closed round lookup succeeds');
  passed++;

  // Test 3.4: Rejects when phone does not match
  const resWrongPhone = await lookupApplication(db, {
    roundId: 'round-001',
    email: 'somchai@example.com',
    phone: '0899999999',
  });
  assert(resWrongPhone.ok === false, 'wrong phone should fail');
  assert(resWrongPhone.error === 'NOT_FOUND', 'returns NOT_FOUND');
  console.log('✓ wrong phone fails cleanly with NOT_FOUND');
  passed++;

  // Test 3.5: Rejects when round does not match
  const resWrongRound = await lookupApplication(db, {
    roundId: 'round-002',
    email: 'somchai@example.com',
    phone: '0812345678',
  });
  assert(resWrongRound.ok === false, 'wrong round should fail');
  console.log('✓ wrong round fails cleanly');
  passed++;

  // Test 3.6: Rejects invalid inputs
  const resInvalid = await lookupApplication(db, {
    roundId: '',
    email: '',
    phone: '123',
  });
  assert(resInvalid.ok === false, 'invalid input rejected');
  assert(resInvalid.error === 'INVALID_INPUT', 'returns INVALID_INPUT');
  console.log('✓ invalid input rejected');
  passed++;

  // Test 4: getLookupRoundOptions
  const roundOptions = await getLookupRoundOptions(db);
  assert(roundOptions.length === 2, 'returns ACTIVE and CLOSED rounds (excludes DRAFT)');
  assert(roundOptions.some(r => r.id === 'round-001'), 'includes active round');
  assert(roundOptions.some(r => r.id === 'round-002'), 'includes closed round');
  assert(!roundOptions.some(r => r.id === 'round-draft'), 'excludes draft round');
  console.log('✓ getLookupRoundOptions returns active + closed rounds');
  passed++;

  console.log(`\n=== Summary ===\nPassed: ${passed}\nFailed: 0\n`);
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
