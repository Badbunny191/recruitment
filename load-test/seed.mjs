/**
 * SEEDER: สร้างข้อมูลผู้สมัครจำลอง 50 / 100 / 250 / 500 คน ลง D1 เดิมโดยตรง
 * ---------------------------------------------------------------------------
 * วัตถุประสงค์: เติมข้อมูลจำนวนมากเพื่อทดสอบ Dashboard / Search / Export /
 * PDF Composer ฝั่ง admin (ไม่ได้ผ่านหน้าเว็บ — การสมัครจริงผ่านเว็บใช้
 * run-load-test.mjs เพราะต้องผ่าน Turnstile)
 *
 * วิธี: สร้าง SQL แล้วสั่ง `wrangler d1 execute sao-db --remote` (D1 เดิม)
 * สร้าง:
 *  - applications (applicationNo = TEST-000001... ตาม pattern ของรอบ)
 *  - audit_logs APPLICATION_SUBMIT (actor = SYSTEM row เดียวกับระบบจริง)
 *  - round_sequences (อัปเดต running number)
 *  - โหมด --with-files: อัปโหลด PDF จริงเข้า R2 + attachment_uploads +
 *    application_attachments (ใช้ทดสอบ PDF Composer ที่มีไฟล์แนบ)
 *
 * ใช้: node seed.mjs 250 [--start 1] [--with-files] [--dry-run] [--local]
 * ต้องรัน setup-round.mjs ก่อน
 */

import { cfg, parseArgs } from './config.mjs';
import { generateApplicants, buildFormData, makeRunStamp } from './lib/applicants.mjs';
import { d1Select, d1ExecuteChunked, r2Put } from './lib/wrangler.mjs';
import { adminLogin, adminFetch, findTestRound } from './lib/admin-api.mjs';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const args = parseArgs();
const count = Number(args._[0] ?? args.users ?? 250);
const startSeq = args.start ?? 1;

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const seqPad = (n) => String(n).padStart(6, '0');

async function main() {
  console.log('── SAO Recruitment Load Test: SEEDER ──');
  console.log(`target: ${cfg.target} | จำนวน: ${count} คน (seq ${seqPad(startSeq)}–${seqPad(startSeq + count - 1)})`);
  if (![50, 100, 250, 500].includes(count)) {
    console.log(`⚠ จำนวนที่แนะนำคือ 50 / 100 / 250 / 500 — รับค่า ${count} ได้ แต่ไม่อยู่ในชุดแนะนำ`);
  }

  // 1) หา round ทดสอบ
  await adminLogin().catch((e) => {
    throw new Error(`ต้องมี admin credentials (LOAD_TEST_ADMIN_EMAIL/PASSWORD): ${e.message}`);
  });
  const round = (await findTestRound()) ?? (() => {
    const state = cfg.paths.stateFile;
    try {
      const s = JSON.parse(readFileSync(state, 'utf8'));
      if (s.roundId) return { id: s.roundId, roundCode: s.roundCode ?? cfg.roundCode, title: cfg.roundTitle, applicationPattern: cfg.applicationPattern, templateVersionId: s.versionId };
      return null;
    } catch { return null; }
  })();
  if (!round) throw new Error('ไม่พบ round ทดสอบ — รัน `node setup-round.mjs` ก่อน');
  const roundId = round.id;
  console.log(`round: ${round.title} (${roundId})`);

  // 2) ฟิลด์ของ template (จาก public schema) เพื่อสร้าง formData ตรง fieldId จริง
  const schemaRes = await fetch(`${cfg.apiBaseUrl}/public/rounds/${roundId}/schema`);
  if (!schemaRes.ok) throw new Error(`ดึง schema ไม่สำเร็จ (${schemaRes.status}) — รอบต้อง ACTIVE`);
  const schema = (await schemaRes.json())?.data;
  const templateFields = schema.fields.map((f) => ({
    fieldId: f.fieldId,
    fieldType: f.type,
    options: f.options ?? null,
    isRequired: !!f.isRequired,
  }));

  // 3) หา seq ถัดไปจาก DB (รันซ้ำได้ — เดินหน้าต่อ ไม่ทับของเดิม)
  const existing = d1Select(
    `SELECT application_no, seq_in_round FROM applications
     WHERE round_id = ${q(roundId)} AND application_no GLOB ${q(`${roundCode}-*`)}
     ORDER BY seq_in_round DESC LIMIT 1;`,
    { remote: !args.local },
  );
  const dbMaxSeq = existing[0]?.seq_in_round
    ?? parseInt(String(existing[0]?.application_no ?? `${roundCode}-000000`).split('-').pop(), 10)
    ?? 0;
  const effectiveStart = Math.max(startSeq, (dbMaxSeq || 0) + 1);
  if (effectiveStart !== startSeq) {
    console.log(`• มีข้อมูลถึง ${appNo(dbMaxSeq)} แล้ว — เริ่มใหม่ที่ ${appNo(effectiveStart)}`);
  }
  const applicants = generateApplicants(effectiveStart, effectiveStart + count - 1, makeRunStamp());

  const year = new Date().getFullYear();
  const nowSec = Math.floor(Date.now() / 1000);
  // เลขที่ใบสมัครตาม pattern {ROUND_CODE}-{RUNNING:6} ของรอบ → "<roundCode>-000001"
  const roundCode = (round.roundCode ?? cfg.roundCode).toUpperCase();
  const appNo = (seq) => `${roundCode}-${String(seq).padStart(6, '0')}`;
  const stmts = [];
  const seededRows = [];

  for (let i = 0; i < applicants.length; i++) {
    const a = applicants[i];
    const id = randomUUID();
    const submittedAt = nowSec - (applicants.length - i) * 60; // กระจายเวลาเหมือนคนสมัครตามช่วง
    const formData = buildFormData(a, templateFields);
    stmts.push(
      `INSERT INTO applications (id, application_no, round_id, email, fullname, national_id, status, form_data, submitted_at, year, round_code, seq_in_round)
       VALUES (${q(id)}, ${q(appNo(a.seq))}, ${q(roundId)}, ${q(a.email)}, ${q(a.fullName)}, ${q(a.nationalId)}, 'SUBMITTED', ${q(JSON.stringify(formData))}, ${submittedAt}, ${year}, ${q(roundCode)}, ${a.seq});`,
    );
    // audit เหตุการณ์ submit (actor SYSTEM เดียวกับ flow จริง) — cleanup จะลบตาม entityId
    stmts.push(
      `INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, payload, ip_address, created_at)
       VALUES (${q(randomUUID())}, '00000000-0000-0000-0000-000000000000', 'APPLICATION_SUBMIT', 'APPLICATION', ${q(id)},
               ${q(JSON.stringify({ applicationNo: appNo(a.seq), roundId, roundTitle: round.title, attachmentCount: 0, seeded: true }))}, 'test.local', ${submittedAt});`,
    );
    seededRows.push({ id, seq: a.seq, applicationNo: appNo(a.seq), email: a.email, name: a.fullName });
  }

  // running number ของรอบ = seq สุดท้าย
  const lastSeq = applicants[applicants.length - 1].seq;
  stmts.push(
    `INSERT INTO round_sequences (round_id, current_value) VALUES (${q(roundId)}, ${lastSeq})
     ON CONFLICT(round_id) DO UPDATE SET current_value = MAX(current_value, ${lastSeq}), updated_at = unixepoch();`,
  );

  if (args.dryRun) {
    console.log(`\n(dry-run) จะรัน SQL ${stmts.length} statements ผ่าน wrangler d1 execute sao-db ${args.local ? '--local' : '--remote'}`);
    console.log(`ตัวอย่าง statement แรก:\n  ${stmts[0].slice(0, 220)}...`);
    return;
  }

  // 4) โหมด --with-files: อัปโหลด PDF จริงเข้า R2 + ตาราง ledger/attachments
  if (args.withFiles) {
    console.log('\nโหมด --with-files: อัปโหลด PDF ต่อ 1 ไฟล์/คน เข้า R2 เดิม (อาจใช้เวลาสักครู่)...');
    const resumePath = path.join(cfg.paths.assetsDir, 'TEST-resume.pdf');
    for (let i = 0; i < applicants.length; i++) {
      const a = applicants[i];
      const app = seededRows[i];
      const key = `uploads/documents/${year}/${appNo(a.seq)}-TEST-resume.pdf`;
      r2Put(key, resumePath, { remote: !args.local });
      const ledgerId = randomUUID();
      const fileUrl = `/api/v1/public/uploads/files/${encodeURIComponent(key)}`;
      const uploadedAt = nowSec - (applicants.length - i) * 60;
      stmts.push(
        `INSERT INTO attachment_uploads (id, r2_key, status, uploaded_at, application_id, original_filename, activated_at)
         VALUES (${q(ledgerId)}, ${q(key)}, 'ACTIVE', ${uploadedAt}, ${q(app.id)}, ${q('TEST-resume.pdf')}, ${uploadedAt});`,
        `INSERT INTO application_attachments (id, application_id, field_id, file_url, original_filename, uploaded_at)
         VALUES (${q(randomUUID())}, ${q(app.id)}, 'field-resume', ${q(fileUrl)}, ${q('TEST-resume.pdf')}, ${uploadedAt});`,
      );
      process.stdout.write(`  R2 upload ${i + 1}/${applicants.length}\r`);
    }
    console.log('');
  }

  // 5) รัน SQL (chunk 50 statements/ไฟล์ — d1 execute --file atomic ต่อไฟล์)
  console.log(`\nรัน ${stmts.length} statements ผ่าน wrangler (D1 เดิม, ${args.local ? '--local' : '--remote'})...`);
  await d1ExecuteChunked(stmts, { remote: !args.local, chunkSize: 50, label: 'seed' });

  // 6) บันทึก manifest สำหรับ report/cleanup
  mkdirSync(cfg.paths.resultsDir, { recursive: true });
  const manifestFile = path.join(cfg.paths.resultsDir, `seed-manifest-${Date.now()}.json`);
  writeFileSync(manifestFile, JSON.stringify({
    roundId, roundTitle: round.title, count, startSeq: effectiveStart,
    endSeq: applicants[applicants.length - 1].seq, withFiles: !!args.withFiles,
    target: cfg.target, at: new Date().toISOString(), rows: seededRows,
  }, null, 2));

  console.log(`\n✓ seed สำเร็จ: ${seededRows.length} ใบสมัคร (${appNo(effectiveStart)} → ${appNo(applicants[applicants.length - 1].seq)})`);
  console.log(`✓ manifest → ${path.relative(cfg.paths.repoRoot, manifestFile)}`);
  console.log('\nทดสอบฝั่ง admin ต่อได้เลย: npm run loadtest:check');
}

main().catch((err) => {
  console.error(`\n✗ SEED FAILED: ${err?.message ?? err}`);
  process.exit(1);
});
