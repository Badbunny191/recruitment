/**
 * LOAD TEST: จำลองผู้สมัคร 250 คน ผ่านหน้าเว็บจริงด้วย Playwright
 * ---------------------------------------------------------------------------
 * ข้อกำหนดที่บังคับใช้ในโค้ดนี้:
 *  - Batch ละ 5 คน (ห้ามยิงพร้อมกันทั้ง 250)
 *  - Think-time สุ่ม 5-30 วินาที/คน กระจายเป็นพักระหว่างกรอก
 *  - ใช้เบราว์เซอร์จริง ไม่ bypass Turnstile/Bot Protection ทุกกรณี
 *    → เจอ challenge ค้าง: หยุดทั้งรัน + บันทึกปัญหา + รายงาน
 *  - เจอ HTTP 429: ถอยหลังตาม Retry-After (พฤติกรรมผู้ใช้จริง) แล้วนับเหตุการณ์
 *  - เก็บ log: สำเร็จ/ล้มเหลว, เวลาแต่ละขั้น, error ทั้งหมด, screenshot ตอน error, URL
 *
 * ใช้: node run-load-test.mjs [--users 250] [--batch 5] [--headed] [--no-report]
 *      node run-load-test.mjs --users 5   (smoke test ก่อนรันจริง)
 * ต้องรัน `node setup-round.mjs` ก่อน (ได้ results/state.json)
 */

import { cfg, parseArgs } from './config.mjs';
import { generateApplicants, makeRunStamp } from './lib/applicants.mjs';
import { runApplicantFlow } from './lib/user-flow.mjs';
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = parseArgs();
const RESULTS_DIR = cfg.paths.resultsDir;
const SHOTS_DIR = cfg.paths.screenshotsDir;
mkdirSync(RESULTS_DIR, { recursive: true });
mkdirSync(SHOTS_DIR, { recursive: true });

const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('════════════════════════════════════════════════════════');
  console.log(' SAO Recruitment — Load Test (Playwright, real browser)');
  console.log('════════════════════════════════════════════════════════');
  console.log(`target: ${cfg.target} → ${cfg.frontendBaseUrl}`);

  // ── Preflight ─────────────────────────────────────────────────────────
  const state = existsSync(cfg.paths.stateFile) ? JSON.parse(readFileSync(cfg.paths.stateFile, 'utf8')) : null;
  if (!state?.roundId) {
    console.error('\n✗ ยังไม่มี round ทดสอบ — รัน `node setup-round.mjs` ก่อน');
    process.exit(1);
  }
  const roundId = process.env.LOAD_TEST_ROUND_ID || state.roundId;
  for (const asset of ['TEST-resume.pdf', 'TEST-portfolio.pdf']) {
    if (!existsSync(path.join(cfg.paths.assetsDir, asset))) {
      console.error(`\n✗ ไม่พบ ${asset} — รัน \`node test-assets/generate-assets.mjs\` ก่อน`);
      process.exit(1);
    }
  }

  // playwright ต้องติดตั้งแล้ว (npm install ใน load-test/)
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error('\n✗ ยังไม่ติดตั้ง Playwright — รัน: cd load-test && npm install && npx playwright install chromium');
    process.exit(1);
  }
  const pwOk = spawnSync('npx', ['playwright', 'install', '--dry-run', 'chromium'], { cwd: cfg.paths.loadTestDir, encoding: 'utf8' });
  if (pwOk.status !== 0) {
    console.error('\n✗ Chromium ของ Playwright ยังไม่ถูกติดตั้ง — รัน: cd load-test && npx playwright install chromium');
    process.exit(1);
  }

  // ── ดึง schema จริงของรอบ (dynamic form) ─────────────────────────────
  const schemaRes = await fetch(`${cfg.apiBaseUrl}/public/rounds/${roundId}/schema`);
  if (schemaRes.status === 403) {
    console.error('\n✗ รอบทดสอบยังไม่เปิดรับ (DRAFT/CLOSED/หมดช่วงเวลา) — ตรวจ round หรือ setup ใหม่');
    process.exit(1);
  }
  if (!schemaRes.ok) {
    console.error(`\n✗ ดึง schema ไม่สำเร็จ (${schemaRes.status}) — รอบอาจถูกลบ`);
    process.exit(1);
  }
  const schema = (await schemaRes.json())?.data;
  console.log(`round: ${roundId} | fields: ${schema.fields.length} | sections: ${schema.sections.length}`);

  const users = Number(args.users ?? cfg.totalUsers);
  const batch = Math.max(1, Number(args.batch ?? cfg.batchSize));
  const startSeq = Number(args.start ?? 1);
  // ตัวตนของรันนี้ — email/บัตร/เบอร์ ฝัง stamp → ไม่ชนข้อมูลของรันก่อนหน้าในรอบเดียวกัน
  const runStamp = makeRunStamp();
  const applicants = generateApplicants(startSeq, startSeq + users - 1, runStamp);

  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const resultsFile = path.join(RESULTS_DIR, `results-${stamp}.json`);
  const jsonlFile = path.join(RESULTS_DIR, `live-${stamp}.jsonl`);
  const jsonl = createWriteStream(jsonlFile, { flags: 'a' });

  const run = {
    config: {
      target: cfg.target, frontendBaseUrl: cfg.frontendBaseUrl, roundId,
      users, batch, thinkMinSec: cfg.thinkMinSec, thinkMaxSec: cfg.thinkMaxSec,
      batchGapMinSec: cfg.batchGapMinSec, batchGapMaxSec: cfg.batchGapMaxSec,
      turnstileTimeoutSec: cfg.turnstileTimeoutSec,
      headed: !!args.headed,
      manualTurnstileTimeoutSec: cfg.manualTurnstileTimeoutSec,
      runStamp,
    },
    startedAt: startedAt.toISOString(),
    results: [],
    abort: null,
  };
  // ธงหยุดทั้งรัน (Turnstile challenge / เหตุผลอื่น)
  const abort = { aborted: false, reason: null };

  console.log(`users: ${users} | batch: ${batch} | think: ${cfg.thinkMinSec}-${cfg.thinkMaxSec}s`);
  console.log(`runStamp: ${runStamp} | ตัวอย่างอีเมล: ${applicants[0].email}`);
  console.log(`results: ${path.relative(cfg.paths.repoRoot, resultsFile)}\n`);

  // ── รันเป็น batch ─────────────────────────────────────────────────────
  const batches = Math.ceil(applicants.length / batch);
  const browser = await chromium.launch({ headless: !args.headed });

  if (args.headed) {
    console.log(`\n🖥  โหมด HEADED (Manual Turnstile Assist) — จะเปิดหน้าต่างเบราว์เซอร์จริง ${batch} หน้าต่าง/บรรทัด`);
    console.log(`   เมื่อเห็นช่อง "ยืนยันว่าคุณเป็นมนุษย์" (Cloudflare) กรุณาคลิกด้วยตนเองในแต่ละหน้าต่าง`);
    console.log(`   สคริปต์จะรอไม่เกิน ${cfg.manualTurnstileTimeoutSec}s ต่อคน แล้วกดส่งต่อให้อัตโนมัติ — ห้ามสคริปต์คลิกแทน/แก้ token ทุกกรณี\n`);
  }

  for (let b = 0; b < batches; b++) {
    if (abort.aborted) break;
    const chunk = applicants.slice(b * batch, (b + 1) * batch);
    const batchStart = Date.now();
    process.stdout.write(`── batch ${b + 1}/${batches} (users ${chunk[0].applicationNo}–${chunk[chunk.length - 1].applicationNo}) `);

    const settled = await Promise.all(
      chunk.map((applicant) =>
        runApplicantFlow({ browser, applicant, cfg, roundId, schema, abort, screenshotDir: SHOTS_DIR })
          .catch((err) => ({
            seq: applicant.seq, applicationNo: applicant.applicationNo, email: applicant.email,
            name: applicant.fullName, status: 'FAILED',
            errors: [{ step: 'runner', message: String(err?.message ?? err) }],
            timings: {}, screenshots: [], uploads: { attempted: 0, succeeded: 0 }, rateLimited: 0,
          })),
      ),
    );

    for (const r of settled) {
      run.results.push(r);
      jsonl.write(JSON.stringify(r) + '\n');
      const icon = r.status === 'SUCCESS' ? '✓' : r.status === 'SKIPPED' ? '–' : '✗';
      const got = r.applicationNoReceived ? ` → เลขจริง ${r.applicationNoReceived}` : '';
      const tw = r.turnstile?.waitMs ? ` (Turnstile รอ ${(r.turnstile.waitMs / 1000).toFixed(0)}s${r.turnstile.manual ? ' รอผู้ใช้คลิก' : ''})` : '';
      console.log(`${icon} ${r.applicationNo} ${r.status}${got}${tw}${r.rateLimited ? ` (429×${r.rateLimited})` : ''}`);
    }

    const elapsed = ((Date.now() - batchStart) / 1000).toFixed(0);
    const ok = settled.filter((r) => r.status === 'SUCCESS').length;
    console.log(`   batch ใช้ ${elapsed}s | สำเร็จ ${ok}/${settled.length} | รวมสำเร็จ ${run.results.filter((r) => r.status === 'SUCCESS').length}/${run.results.length}\n`);

    // เว้นช่วงระหว่าง batch (สุ่ม) — ไม่ใช่การ bypass แค่ pacing เหมือนผู้ใช้จริง
    if (b < batches - 1 && !abort.aborted) {
      await sleep(randInt(cfg.batchGapMinSec * 1000, cfg.batchGapMaxSec * 1000));
    }
  }

  await browser.close();

  // ถ้า abort — จำนวนที่ยังไม่ได้รันถือเป็น SKIPPED
  if (abort.aborted) {
    const doneSeqs = new Set(run.results.map((r) => r.seq));
    for (const a of applicants) {
      if (!doneSeqs.has(a.seq)) {
        run.results.push({
          seq: a.seq, applicationNo: a.applicationNo, email: a.email, name: a.fullName,
          status: 'SKIPPED', skipReason: abort.reason, errors: [], screenshots: [],
          uploads: { attempted: 0, succeeded: 0 }, rateLimited: 0, timings: {},
        });
      }
    }
    run.abort = { reason: abort.reason, at: new Date().toISOString() };
    console.log(`\n⚠ หยุดก่อนกำหนด: ${abort.reason}`);
  }

  run.finishedAt = new Date().toISOString();
  jsonl.end();
  writeFileSync(resultsFile, JSON.stringify(run, null, 2));
  console.log(`\n✓ ผลลัพธ์ดิบ → ${path.relative(cfg.paths.repoRoot, resultsFile)}`);
  console.log(`  live log  → ${path.relative(cfg.paths.repoRoot, jsonlFile)}`);

  // ── สรุปสั้นทันทีท้ายคอนโซล ───────────────────────────────────────────
  const s = run.results.filter((r) => r.status === 'SUCCESS').length;
  const f = run.results.filter((r) => r.status === 'FAILED').length;
  const k = run.results.filter((r) => r.status === 'SKIPPED').length;
  console.log(`\nสรุป: สำเร็จ ${s} | ล้มเหลว ${f} | ข้าม ${k} | ทั้งหมด ${run.results.length}`);
  console.log('สร้างรายงานเต็ม: npm run loadtest:report');

  if (!args.noReport) {
    const env = { ...process.env, LT_RESULTS_FILE: resultsFile };
    spawnSync('node', [path.join(cfg.paths.loadTestDir, 'report.mjs')], { stdio: 'inherit', env });
  }

  // exit code: มี failure → 1 (ให้ CI/ผู้รันเห็นสถานะ)
  process.exit(f > 0 || abort.aborted ? 1 : 0);
}

main().catch((err) => {
  console.error(`\n✗ LOAD TEST FAILED: ${err?.stack ?? err}`);
  process.exit(1);
});
