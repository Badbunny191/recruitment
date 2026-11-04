/**
 * CLEANUP: ลบข้อมูลทดสอบทั้งหมดแบบ HARD DELETE (npm run cleanup:test-data)
 * ---------------------------------------------------------------------------
 * กฎเหล็ก:
 *  1. Hard Delete เท่านั้น — ห้าม Soft Delete / Archive / Deleted Flag / Hidden / Trash
 *  2. ลบเฉพาะข้อมูลทดสอบ (allowlist):
 *      - applications ในรอบ [TEST] หรือ application_no GLOB 'TEST-*'
 *      - recruitment_rounds ชื่อขึ้นต้น '[TEST]'
 *      - templates ชื่อขึ้นต้น '[TEST]'
 *      - attachment/audit ที่ผูกกับรายการข้างบนเท่านั้น
 *  3. ก่อนลบ: แสดงรายการทั้งหมด (Safety Check) + พิมพ์ DELETE เพื่อยืนยัน
 *     (หรือใช้ --yes สำหรับ non-interactive)
 *  4. ถ้าพบใบสมัครจริง (application_no ไม่ขึ้นต้น TEST-) ในรอบ [TEST] →
 *     หยุดทันที ไม่ลบอะไรเลย แล้วรายงาน
 *  5. หลังลบ: ตรวจซากซ้ำ — ต้องเหลือ 0 ทุกตาราง ไม่งั้น exit 1
 *
 * ลบครอบคลุม: applications / answers (form_data อยู่ใน applications) /
 * application_attachments / attachment_uploads + ไฟล์ใน R2 / PDF cache ที่
 * generate ไว้ / audit_logs ที่เกี่ยวข้อง / round_sequences / recruitment_rounds /
 * template_versions + sections + fields + templates
 *
 * ใช้: node cleanup-test-data.mjs --remote [--yes] [--dry-run] [--include-orphan-temp]
 *      node cleanup-test-data.mjs --local  [--yes]
 * ต้องระบุ --remote หรือ --local ชัดเจนเสมอ (กันลบผิด target)
 */

import { cfg, parseArgs, R2 } from './config.mjs';
import { d1Select, d1ExecuteChunked, r2DeleteMany } from './lib/wrangler.mjs';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import readline from 'node:readline/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const args = parseArgs();
const remote = args.local ? false : args.remote ? true : null;

if (remote === null) {
  console.error('✗ ต้องระบุ target ชัดเจน: --remote (Cloudflare จริง) หรือ --local (เครื่องนี้)');
  console.error('  ตัวอย่าง: npm run cleanup:test-data -- --remote --yes');
  process.exit(1);
}
const targetLabel = remote ? 'REMOTE (Cloudflare จริง)' : 'LOCAL (miniflare เครื่องนี้)';

const chunk = (arr, n = 100) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};
const inList = (ids, cast = (x) => `'${x.replace(/'/g, "''")}'`) =>
  ids.length ? `(${ids.map(cast).join(',')})` : '(NULL)';

// ── Discovery (SELECT เท่านั้น — ยังไม่ลบอะไร) ─────────────────────────────
function discover() {
  const inv = {};

  inv.rounds = d1Select(
    `SELECT id, title, round_code, status, open_date, close_date FROM recruitment_rounds
     WHERE title LIKE '[TEST]%' AND deleted_at IS NULL;`,
    { remote },
  );

  // เลขที่ใบสมัครอนุพันธ์จาก round_code จริงของรอบทดสอบ (pattern {ROUND_CODE}-{RUNNING:n})
  // + 'TEST-' เผื่อข้อมูล legacy — ใช้เป็น allowlist ของ application_no เสมอ
  const prefixes = [
    ...new Set([
      ...inv.rounds.map((r) => (r.round_code ? `${String(r.round_code).toUpperCase()}-` : null)).filter(Boolean),
      'TEST-',
    ]),
  ];
  const globChain = prefixes.map((p) => `application_no GLOB '${p}*'`).join(' OR ');
  inv.testPrefixes = prefixes;

  const roundIds = inv.rounds.map((r) => r.id);

  inv.templates = d1Select(
    `SELECT id, name FROM templates WHERE name LIKE '[TEST]%' AND deleted_at IS NULL;`,
    { remote },
  );
  const templateIds = inv.templates.map((t) => t.id);
  inv.templateVersions = templateIds.length
    ? d1Select(`SELECT id, template_id, version_number, status FROM template_versions WHERE template_id IN ${inList(templateIds)};`, { remote })
    : [];
  const versionIds = inv.templateVersions.map((v) => v.id);

  // ⚠️ รอบ "จริง" ที่อ้าง template_version ของทดสอบ → FK RESTRICT จะบล็อกการลบ
  // version กลางคัน — ต้อง abort ก่อนเริ่มลบเลย (ข้อมูลจริงห้ามแตะ)
  inv.foreignRoundsOnTestVersions = versionIds.length
    ? d1Select(
        `SELECT id, title, round_code, template_version_id FROM recruitment_rounds
         WHERE template_version_id IN ${inList(versionIds)} AND title NOT LIKE '[TEST]%';`,
        { remote },
      )
    : [];

  inv.applications = roundIds.length
    ? d1Select(
        `SELECT id, application_no, round_id, email, fullname, status, submitted_at
         FROM applications WHERE round_id IN ${inList(roundIds)} AND (${globChain}) AND deleted_at IS NULL;`,
        { remote },
      )
    : [];
  // ใบสมัครในรอบทดสอบที่เลขที่ "ไม่ตรง" prefix ของรอบ → น่าจะเป็นข้อมูลจริงหลุดเข้ารอบ
  inv.foreignApplications = roundIds.length
    ? d1Select(
        `SELECT id, application_no, round_id, email, fullname FROM applications
         WHERE round_id IN ${inList(roundIds)} AND NOT (${globChain});`,
        { remote },
      )
    : [];
  // กันเหนียว: เลขที่ตรง prefix ทดสอบแต่อยู่รอบอื่น (ข้อมูลทดสอบที่หลงรอบ)
  inv.strayApplications = d1Select(
    `SELECT id, application_no, round_id, email FROM applications
     WHERE (${globChain}) AND round_id NOT IN ${inList(roundIds.length ? roundIds : ['__none__'])};`,
    { remote },
  );

  const appIds = [
    ...inv.applications.map((a) => a.id),
    ...inv.foreignApplications.map((a) => a.id), // ใช้ค้นหาเพื่อรายงานเท่านั้น ไม่ลบ
    ...inv.strayApplications.map((a) => a.id),
  ];

  inv.attachments = appIds.length
    ? d1Select(`SELECT id, application_id, field_id, file_url, original_filename FROM application_attachments WHERE application_id IN ${inList(appIds)};`, { remote })
    : [];
  inv.ledgerActive = appIds.length
    ? d1Select(`SELECT id, r2_key, status, application_id, original_filename FROM attachment_uploads WHERE application_id IN ${inList(appIds)};`, { remote })
    : [];
  // ไฟล์ทดสอบค้าง TEMP (อัปโหลดแล้วไม่ได้ submit) — ชื่อไฟล์ทดสอบขึ้นต้น TEST เสมอ
  inv.ledgerOrphanTemp = d1Select(
    `SELECT id, r2_key, status, uploaded_at FROM attachment_uploads
     WHERE status = 'TEMP' AND r2_key GLOB '*TEST-*';`,
    { remote },
  );

  // audit logs ที่ผูกกับ entity ทดสอบทุกชนิด (app / ledger / round / template / version)
  // + fallback กรณี ledger insert ล้มแล้ว audit ใช้ fileKey เป็น entityId (มี TEST- ในชื่อ)
  const entityIds = [
    ...appIds,
    ...inv.ledgerActive.map((l) => l.id),
    ...inv.ledgerOrphanTemp.map((l) => l.id),
    ...roundIds,
    ...templateIds,
    ...versionIds,
  ];
  inv.auditByEntity = [];
  for (const group of chunk(entityIds)) {
    inv.auditByEntity.push(
      ...d1Select(
        `SELECT id, action, entity_type, entity_id FROM audit_logs WHERE entity_id IN ${inList(group)};`,
        { remote },
      ),
    );
  }
  inv.auditByTestFilename = d1Select(
    `SELECT id, action, entity_type, entity_id FROM audit_logs
     WHERE entity_type = 'ATTACHMENT' AND entity_id LIKE '%TEST-%';`,
    { remote },
  );

  // round_sequences ของรอบทดสอบ
  inv.roundSequences = roundIds.length
    ? d1Select(`SELECT round_id, current_value FROM round_sequences WHERE round_id IN ${inList(roundIds)};`, { remote })
    : [];

  // R2 keys ที่จะลบ
  const fileUrlToKey = (fileUrl) => {
    try {
      const seg = fileUrl.split('/uploads/files/')[1] ?? '';
      return decodeURIComponent(seg);
    } catch {
      return null;
    }
  };
  const r2Keys = new Set();
  for (const l of [...inv.ledgerActive, ...inv.ledgerOrphanTemp]) if (l.r2_key) r2Keys.add(l.r2_key);
  for (const a of inv.attachments) {
    const key = fileUrlToKey(a.file_url);
    if (key) r2Keys.add(key);
  }
  inv.r2UploadKeys = [...r2Keys];

  // PDF cache keys (ทุกเวอร์ชันที่เคย deploy)
  inv.r2PdfCacheKeys = [];
  for (const appId of appIds) {
    for (const v of R2.pdfCacheVersions) {
      inv.r2PdfCacheKeys.push(`${R2.pdfCachePrefix}/${appId}/${v}.pdf`);
    }
  }

  inv.roundIds = roundIds;
  inv.templateIds = templateIds;
  inv.versionIds = versionIds;
  inv.appIds = appIds.filter((id) =>
    [...inv.applications.map((a) => a.id), ...inv.strayApplications.map((a) => a.id)].includes(id),
  );
  return inv;
}

// ── แสดง inventory (Safety Check) ──────────────────────────────────────────
function printInventory(inv) {
  const line = (label, n, extra = '') =>
    console.log(`  ${String(label).padEnd(46)} ${String(n).padStart(6)}  ${extra}`);

  console.log('\n┌─ SAFETY CHECK — รายการที่จะถูกลบ (Hard Delete) ─────────────');
  console.log(`  allowlist เลขที่ใบสมัคร (จาก round_code จริง): ${inv.testPrefixes.join('  ')}`);
  line('recruitment_rounds ([TEST]*)', inv.rounds.length, inv.rounds.map((r) => r.round_code ?? r.id.slice(0, 8)).join(', '));
  line('applications (TEST-* ในรอบ [TEST])', inv.applications.length);
  line('applications (TEST-* หลงอยู่รอบอื่น)', inv.strayApplications.length);
  line('application_attachments', inv.attachments.length);
  line('attachment_uploads (ACTIVE ผูกใบสมัคร)', inv.ledgerActive.length);
  line('attachment_uploads (TEMP ค้าง — ไฟล์ TEST)', inv.ledgerOrphanTemp.length, args.includeOrphanTemp ? '(จะลบ)' : '(จะข้าม เว้นแต่ --include-orphan-temp)');
  line('audit_logs (ผูก entity ทดสอบ)', inv.auditByEntity.length);
  line('audit_logs (ATTACHMENT entityId มี TEST-)', inv.auditByTestFilename.length);
  line('round_sequences', inv.roundSequences.length);
  line('templates ([TEST]*)', inv.templates.length);
  line('template_versions', inv.templateVersions.length);
  line('R2 objects — ไฟล์แนบ', inv.r2UploadKeys.length);
  line('R2 objects — PDF cache (v1/v2/v3)', inv.r2PdfCacheKeys.length);
  console.log('└──────────────────────────────────────────────────────────────');

  if (inv.rounds.length) {
    console.log('\n  รอบที่จะลบ:');
    for (const r of inv.rounds) console.log(`   • ${r.title} (code=${r.round_code ?? '-'}, id=${r.id})`);
  }
  if (inv.applications.length) {
    const sample = inv.applications.slice(0, 5);
    console.log(`\n  ตัวอย่างใบสมัครที่จะลบ (จาก ${inv.applications.length} ใบ):`);
    for (const a of sample) console.log(`   • ${a.application_no} | ${a.email} | ${a.fullname}`);
  }
  // ── เงื่อนไขหยุด ──
  if (inv.foreignRoundsOnTestVersions.length) {
    console.error(`\n✗ พบรอบ "ไม่ใช่ [TEST]" จำนวน ${inv.foreignRoundsOnTestVersions.length} รอบ ที่อ้าง template_version ของทดสอบ:`);
    for (const r of inv.foreignRoundsOnTestVersions) {
      console.error(`   • ${r.title} (code=${r.round_code ?? '-'}, id=${r.id}) → version ${r.template_version_id}`);
    }
    console.error('  → ห้ามลบเด็ดขาด — ย้าย/ลบรอบเหล่านี้ออกจาก template ทดสอบก่อน (ข้อมูลจริง)');
    process.exit(1);
  }
  if (inv.foreignApplications.length) {
    console.error(`\n✗ พบใบสมัคร "ไม่ใช่ TEST-*" จำนวน ${inv.foreignApplications.length} ใบ ในรอบ [TEST]:`);
    for (const a of inv.foreignApplications.slice(0, 10)) {
      console.error(`   • ${a.application_no} | ${a.email} | ${a.fullname}`);
    }
    console.error('  → ห้ามลบเด็ดขาด (ไม่ใช่ข้อมูลทดสอบ) — ตรวจรอบ [TEST] ด้วยตนเองก่อน');
    process.exit(1);
  }
}

// ── สร้าง DELETE statements (ลำดับ FK-safe) ────────────────────────────────
function buildDeletes(inv) {
  const stmts = [];
  const pushIn = (sql, ids, cast) => {
    for (const g of chunk(ids)) stmts.push(sql.replace('__IDS__', inList(g, cast)));
  };

  const deleteOrphanTemp = args.includeOrphanTemp;

  // 1) audit_logs
  const auditIds = new Set([
    ...inv.auditByEntity.map((a) => a.id),
    ...inv.auditByTestFilename.map((a) => a.id),
  ]);
  pushIn(`DELETE FROM audit_logs WHERE id IN __IDS__;`, [...auditIds]);
  // 2) attachment_uploads (ledger)
  pushIn(`DELETE FROM attachment_uploads WHERE application_id IN __IDS__;`, inv.appIds);
  if (deleteOrphanTemp) {
    pushIn(`DELETE FROM attachment_uploads WHERE id IN __IDS__;`, inv.ledgerOrphanTemp.map((l) => l.id));
  }
  // 3) application_attachments (cascade อยู่แล้วแต่ลบชัดเจนเพื่อนับ)
  pushIn(`DELETE FROM application_attachments WHERE application_id IN __IDS__;`, inv.appIds);
  // 4) applications
  pushIn(`DELETE FROM applications WHERE id IN __IDS__;`, inv.appIds);
  // 5-6) round_sequences + rounds
  pushIn(`DELETE FROM round_sequences WHERE round_id IN __IDS__;`, inv.roundIds);
  pushIn(`DELETE FROM recruitment_rounds WHERE id IN __IDS__;`, inv.roundIds);
  // 7-10) template fields → sections → versions → templates
  pushIn(`DELETE FROM template_fields WHERE template_version_id IN __IDS__;`, inv.versionIds);
  pushIn(`DELETE FROM template_sections WHERE template_version_id IN __IDS__;`, inv.versionIds);
  pushIn(`DELETE FROM template_versions WHERE id IN __IDS__;`, inv.versionIds);
  pushIn(`DELETE FROM templates WHERE id IN __IDS__;`, inv.templateIds);

  return stmts;
}

// ── R2 deletes ─────────────────────────────────────────────────────────────
async function deleteR2Objects(inv) {
  const keys = new Set([...inv.r2UploadKeys]);
  if (args.includeOrphanTemp) inv.ledgerOrphanTemp.forEach((l) => l.r2_key && keys.add(l.r2_key));
  inv.r2PdfCacheKeys.forEach((k) => keys.add(k));
  // โหมด --r2-keys-file: ลบ key ค้างจากรอบ cleanup ก่อนหน้า (กรณี D1 ลบสำเร็จแต่ R2 ล้ม —
  // rerun ปกติจะหา key ไม่เจอแล้วเพราะ ledger row หายไปพร้อม D1)
  if (args['r2-keys-file']) {
    const extra = readFileSync(args['r2-keys-file'], 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
    extra.forEach((k) => keys.add(k));
    console.log(`(--r2-keys-file) เพิ่ม ${extra.length} keys จากไฟล์`);
  }
  if (!keys.size) return 0;
  console.log(`\nลบ R2 objects ${keys.size} รายการ (${R2.bucket})...`);
  return r2DeleteMany([...keys], { remote, concurrency: 6, label: 'r2' });
}

// ── Verify ว่าไม่เหลือซาก ──────────────────────────────────────────────────
function verifyZeroResidue(inv) {
  const globChain = (inv?.testPrefixes ?? ['TEST-'])
    .map((p) => `application_no GLOB '${p}*'`).join(' OR ');
  const checks = [
    ['recruitment_rounds [TEST]', `SELECT COUNT(*) AS n FROM recruitment_rounds WHERE title LIKE '[TEST]%'`],
    ['applications (prefix ทดสอบ)', `SELECT COUNT(*) AS n FROM applications WHERE (${globChain})`],
    ['application_attachments ของใบสมัคร TEST', `SELECT COUNT(*) AS n FROM application_attachments WHERE original_filename GLOB 'TEST-*'`],
    ['audit_logs APPLICATION_SUBMIT ของ TEST', `SELECT COUNT(*) AS n FROM audit_logs WHERE entity_type='APPLICATION' AND entity_id IN (SELECT id FROM applications WHERE (${globChain}))`],
    ['templates [TEST]', `SELECT COUNT(*) AS n FROM templates WHERE name LIKE '[TEST]%'`],
  ];
  // ไฟล์ TEMP ค้าง: ลบเฉพาะเมื่อ --include-orphan-temp — ไม่งั้นถือว่า "ข้ามตามการตั้งค่า"
  if (args.includeOrphanTemp) {
    checks.push(['attachment_uploads r2_key มี TEST-', `SELECT COUNT(*) AS n FROM attachment_uploads WHERE r2_key GLOB '*TEST-*'`]);
  } else {
    const rows = d1Select(`SELECT COUNT(*) AS n FROM attachment_uploads WHERE status='TEMP' AND r2_key GLOB '*TEST-*';`, { remote });
    const n = Number(rows[0]?.n ?? 0);
    console.log(`  • attachment_uploads TEMP ค้าง (ไฟล์ TEST): ${n} ${n > 0 ? '(ข้ามตามการตั้งค่า — รันซ้ำด้วย --include-orphan-temp เพื่อลบ)' : ''}`);
  }
  const residue = [];
  for (const [label, sql] of checks) {
    const rows = d1Select(`${sql};`, { remote });
    const n = Number(rows[0]?.n ?? 0);
    console.log(`  ${n === 0 ? '✓' : '✗'} ${label}: ${n}`);
    if (n > 0) residue.push({ label, n });
  }
  return residue;
}

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('── SAO Recruitment Load Test: CLEANUP ──');
  console.log(`target: ${targetLabel}`);
  console.log(`mode:   HARD DELETE ONLY (ห้าม soft delete ทุกชนิด)\n`);

  const inv = discover();
  printInventory(inv);

  const totalDelete =
    inv.rounds.length + inv.applications.length + inv.strayApplications.length +
    inv.attachments.length + inv.ledgerActive.length + inv.auditByEntity.length +
    inv.auditByTestFilename.length + inv.templates.length + inv.templateVersions.length +
    (args.includeOrphanTemp ? inv.ledgerOrphanTemp.length : 0);

  if (args.dryRun) {
    console.log(`\n(dry-run) จะลบทั้งหมด ${totalDelete} แถว + R2 ${inv.r2UploadKeys.length + (args.includeOrphanTemp ? inv.ledgerOrphanTemp.length : 0) + inv.r2PdfCacheKeys.length} objects`);
    console.log('(dry-run) ไม่มีการลบจริง — รันอีกครั้งโดยไม่มี --dry-run เพื่อลบ (ต้อง --remote/--local + ยืนยัน)');
    return;
  }

  const hasR2KeysFromFile = args['r2-keys-file'] && existsSync(args['r2-keys-file']);
  if (totalDelete === 0 && inv.r2UploadKeys.length === 0 && inv.r2PdfCacheKeys.length === 0 && !hasR2KeysFromFile) {
    console.log('\n✓ ไม่มีข้อมูลทดสอบค้างอยู่เลย — สะอาดอยู่แล้ว');
    return;
  }

  // ── ยืนยันก่อนลบ (Safety Check) ──
  if (!args.yes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ans = (await rl.question(`\nยืนยัน HARD DELETE ทั้งหมด ${totalDelete} แถว + R2 objects บน ${targetLabel}?\nพิมพ์คำว่า DELETE เพื่อยืนยัน (อย่างอื่น = ยกเลิก): `)).trim();
    rl.close();
    if (ans !== 'DELETE') {
      console.log('ยกเลิก — ไม่ลบอะไรเลย');
      return;
    }
  } else {
    console.log(`\n(--yes) ข้ามการยืนยันมือ — ลบทั้งหมด ${totalDelete} แถว`);
  }

  // ── ลบ ──
  // เซฟ inventory ก่อนลบเสมอ — ถ้า D1 ลบสำเร็จแต่ R2 ล้ม จะใช้ไฟล์นี้
  // ลบ R2 ซ้ำได้ด้วย --r2-keys-file (เพราะ rerun หา key จาก DB ไม่เจอแล้ว)
  mkdirSync(cfg.paths.resultsDir, { recursive: true });
  const invFile = path.join(cfg.paths.resultsDir, `cleanup-inventory-${Date.now()}.json`);
  writeFileSync(invFile, JSON.stringify({
    at: new Date().toISOString(), target: targetLabel,
    r2KeysAll: [...new Set([...inv.r2UploadKeys, ...inv.r2PdfCacheKeys, ...(args.includeOrphanTemp ? inv.ledgerOrphanTemp.map((l) => l.r2_key) : [])])],
    r2UploadKeys: inv.r2UploadKeys, r2PdfCacheKeys: inv.r2PdfCacheKeys,
    orphanTempKeys: inv.ledgerOrphanTemp.map((l) => l.r2_key),
    rows: { rounds: inv.roundIds.length, applications: inv.appIds.length, audit: inv.auditByEntity.length + inv.auditByTestFilename.length },
  }, null, 2));
  console.log(`✓ เซฟ inventory → ${path.relative(cfg.paths.repoRoot, invFile)} (ถ้า R2 ลบไม่หมด ใช้ --r2-keys-file ไฟล์นี้ซ้ำได้)`);

  const stmts = buildDeletes(inv);
  console.log(`\nรัน DELETE ${stmts.length} statements (chunk 100 ids/statement)...`);
  if (stmts.length) await d1ExecuteChunked(stmts, { remote, chunkSize: 1, label: 'delete' });

  await deleteR2Objects(inv);

  // ── ตรวจซาก ──
  console.log('\nตรวจซากหลังลบ (ต้องเป็น 0 ทั้งหมด):');
  const residue = verifyZeroResidue(inv);
  if (residue.length) {
    console.error(`\n✗ ยังเหลือซาก ${residue.length} รายการ — รายงานด้านบน (อย่าลืมตรวจ R2 ด้วยภาพตา)`);
    process.exit(1);
  }
  console.log(`\n✓ CLEANUP สำเร็จ — ไม่เหลือข้อมูลทดสอบแม้แต่รายการเดียว (target: ${targetLabel})`);
  console.log('  ตรวจซ้ำได้ด้วย: node cleanup-test-data.mjs --dry-run ' + (remote ? '--remote' : '--local'));
}

main().catch((err) => {
  console.error(`\n✗ CLEANUP FAILED: ${err?.message ?? err}`);
  if (process.env.LT_DEBUG) console.error(err?.stack ?? '');
  process.exit(1);
});
