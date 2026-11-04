/**
 * ADMIN-SIDE CHECKS: ทดสอบ Search / Excel Export / PDF Composer / Dashboard
 * กับข้อมูลทดสอบในรอบ [TEST] และวัดเวลาตอบของแต่ละ endpoint
 * ---------------------------------------------------------------------------
 * รันหลัง load test / seed เพื่อป้อนส่วน "Search Summary / Export Summary /
 * PDF Summary / Performance Summary" ของ load-test-report.md
 *
 * ใช้: node admin-check.mjs [--local]
 * ผลลัพธ์: results/admin-checks-<ts>.json
 */

import { cfg, parseArgs, R2 } from './config.mjs';
import { adminLogin, adminFetch, getAdminUser, findTestRound } from './lib/admin-api.mjs';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const args = parseArgs();

async function main() {
  console.log('── SAO Recruitment Load Test: ADMIN CHECKS ──');
  console.log(`api: ${cfg.apiBaseUrl}\n`);

  await adminLogin();
  const me = await getAdminUser();
  console.log(`✓ login ${me.email} (role=${me.role})`);

  const state = existsSync(cfg.paths.stateFile) ? JSON.parse(readFileSync(cfg.paths.stateFile, 'utf8')) : null;
  const round = (await findTestRound()) || (state ? { id: state.roundId, title: state.roundTitle } : null);
  if (!round) throw new Error('ไม่พบ round ทดสอบ — รัน setup-round.mjs ก่อน');
  const roundId = round.id ?? state.roundId;
  console.log(`round: ${round.title ?? state?.roundTitle} (${roundId})\n`);

  const checks = [];
  const record = (name, group, res, extra = {}) => {
    const entry = {
      name, group, status: res.status, ok: res.ok, ms: res.ms,
      bytes: res.body instanceof ArrayBuffer ? res.body.byteLength : undefined,
      ...extra,
    };
    checks.push(entry);
    const size = entry.bytes ? ` ${(entry.bytes / 1024).toFixed(0)}KB` : '';
    console.log(`${entry.ok ? '✓' : '✗'} [${group}] ${name} → ${res.status} ${res.ms}ms${size}`);
  };

  // ── 1) Search (list + search param) ───────────────────────────────────
  for (const [name, qs] of [
    ['list หน้าแรก (50 แถว)', `?roundId=${roundId}&page=1&pageSize=50`],
    ['search "TEST-" (ทั่วไป)', `?roundId=${roundId}&search=TEST-&page=1&pageSize=50`],
    ['search เจาะจง TEST-000001', `?roundId=${roundId}&search=TEST-000001&page=1&pageSize=50`],
    ['search ชื่อภาษาไทย', `?roundId=${roundId}&search=สมชาย&page=1&pageSize=50`],
    ['filter status=SUBMITTED', `?roundId=${roundId}&status=SUBMITTED&page=1&pageSize=50`],
  ]) {
    const res = await adminFetch(`/applications${qs}`);
    const total = res.body?.pagination?.total ?? res.body?.data?.length ?? 0;
    record(name, 'Search', res, { total });
  }

  // ── 2) Excel Export ───────────────────────────────────────────────────
  const exp = await adminFetch(`/applications/export?roundId=${roundId}`);
  record('Excel export ทั้งรอบ', 'Export', exp);
  const expFiltered = await adminFetch(`/applications/export?roundId=${roundId}&search=TEST-0000`);
  record('Excel export (filter TEST-0000)', 'Export', expFiltered);

  // ── 3) PDF Composer (ดาวน์โหลดใบสมัครรายใบ — cache-on-download) ───────
  const list = await adminFetch(`/applications?roundId=${roundId}&page=1&pageSize=5`);
  const sampleIds = (list.body?.data ?? []).slice(0, 5).map((r) => r.id);
  for (let i = 0; i < sampleIds.length; i++) {
    const res = await adminFetch(`/applications/${sampleIds[i]}/pdf`);
    record(`PDF ใบสมัคร #${i + 1}`, 'PDF', res);
  }

  // ── 4) Dashboard ──────────────────────────────────────────────────────
  const dash = await adminFetch('/dashboard/overview');
  record('Dashboard overview', 'Dashboard', dash);

  // ── 5) Audit logs (เฉพาะ SUPER_ADMIN — endpoint นี้จำกัด role) ────────
  if (me.role === 'SUPER_ADMIN') {
    const audit = await adminFetch(`/audit-logs?page=1&pageSize=50&action=APPLICATION_SUBMIT`);
    record('Audit logs (APPLICATION_SUBMIT)', 'Audit', audit);
  } else {
    checks.push({ name: 'Audit logs', group: 'Audit', status: 0, ok: true, ms: 0, note: `ข้าม (role=${me.role} — ต้อง SUPER_ADMIN)` });
    console.log(`• [Audit] ข้าม (role=${me.role} — endpoint อนุญาตเฉพาะ SUPER_ADMIN)`);
  }

  // ── 6) เช็คซาก PDF cache ใน R2 ที่ควรมีหลังดาวน์โหลด (ข้อมูลเชิงรายงาน) ──
  // (แค่รายงานจำนวน key ที่คาดไว้ — ไม่เรียก R2 API จาก script นี้)
  checks.push({
    name: 'R2 PDF cache key format',
    group: 'PDF',
    status: 0, ok: true, ms: 0,
    note: `pdf/applications/<id>/${R2.pdfCacheVersions.at(-1)}.pdf — cleanup ลบตาม format นี้`,
  });

  // ── บันทึกผล ──────────────────────────────────────────────────────────
  mkdirSync(cfg.paths.resultsDir, { recursive: true });
  const outFile = path.join(cfg.paths.resultsDir, `admin-checks-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
  writeFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), roundId, role: me.role, checks }, null, 2));
  console.log(`\n✓ บันทึกผล → ${path.relative(cfg.paths.repoRoot, outFile)}`);

  const failed = checks.filter((c) => !c.ok);
  if (failed.length) {
    console.log(`\n⚠ มี ${failed.length} รายการที่ไม่ผ่าน — รายละเอียดอยู่ในไฟล์ผลลัพธ์`);
    process.exit(1);
  }
  console.log('\nผ่านทั้งหมด — สร้างรายงานรวมด้วย: npm run loadtest:report');
}

main().catch((err) => {
  console.error(`\n✗ ADMIN CHECK FAILED: ${err?.message ?? err}`);
  process.exit(1);
});
