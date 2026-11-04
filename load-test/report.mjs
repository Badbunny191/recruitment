/**
 * REPORT: สร้าง load-test-report.md จากผลลัพธ์ของ load test + admin checks
 * ---------------------------------------------------------------------------
 * ใช้: node report.mjs [ไฟล์ results-*.json เจาะจง]  (ไม่ใส่ = หยิบไฟล์ล่าสุด)
 * ออก: load-test/load-test-report.md
 *
 * รายงานครอบคลุม: Total/Success/Failed, เวลาตอบ (avg/min/max/p95), เร็วสุด-ช้าสุด,
 * Error Summary, Upload Summary, PDF Summary (จาก admin-checks), Rate Limit events,
 * Turnstile เหตุการณ์, Performance Summary
 */

import { cfg } from './config.mjs';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const RESULTS_DIR = cfg.paths.resultsDir;

function latestFile(prefix) {
  if (!existsSync(RESULTS_DIR)) return null;
  const files = readdirSync(RESULTS_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .sort();
  return files.length ? path.join(RESULTS_DIR, files[files.length - 1]) : null;
}

const fmtMs = (ms) => (ms == null ? '-' : `${Number(ms).toFixed(0)} ms`);
const fmtSec = (ms) => (ms == null ? '-' : `${(ms / 1000).toFixed(1)} s`);
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '-');

function percentile(sortedArr, p) {
  if (!sortedArr.length) return null;
  const idx = Math.min(sortedArr.length - 1, Math.ceil((p / 100) * sortedArr.length) - 1);
  return sortedArr[Math.max(0, idx)];
}

function pickResultsFile() {
  const explicit = process.argv[2] || process.env.LT_RESULTS_FILE;
  if (explicit && existsSync(explicit)) return explicit;
  return latestFile('results-');
}

function main() {
  const resultsFile = pickResultsFile();
  const adminFile = latestFile('admin-checks-');
  const seedFile = latestFile('seed-manifest-');

  if (!resultsFile) {
    console.error('✗ ไม่พบไฟล์ผลลัพธ์ load test — รัน `npm run loadtest:run` ก่อน (หรือส่ง path เป็น argument)');
    process.exit(1);
  }
  const run = JSON.parse(readFileSync(resultsFile, 'utf8'));
  const admin = adminFile ? JSON.parse(readFileSync(adminFile, 'utf8')) : null;
  const seed = seedFile ? JSON.parse(readFileSync(seedFile, 'utf8')) : null;

  const results = run.results ?? [];
  const success = results.filter((r) => r.status === 'SUCCESS');
  const failed = results.filter((r) => r.status === 'FAILED');
  const skipped = results.filter((r) => r.status === 'SKIPPED');

  const submitMs = success.map((r) => r.timings?.submitMs).filter((v) => v != null).sort((a, b) => a - b);
  const totalMs = success.map((r) => r.timings?.totalMs).filter((v) => v != null).sort((a, b) => a - b);
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const slowest = (arr, key = 'totalMs') =>
    [...results].filter((r) => r.status === 'SUCCESS' && r.timings?.[key] != null)
      .sort((a, b) => b.timings[key] - a.timings[key])[0] ?? null;
  const fastest = (arr, key = 'totalMs') =>
    [...results].filter((r) => r.status === 'SUCCESS' && r.timings?.[key] != null)
      .sort((a, b) => a.timings[key] - b.timings[key])[0] ?? null;

  const rateLimitEvents = results.reduce((s, r) => s + (r.rateLimited || 0), 0);
  const uploadAttempted = results.reduce((s, r) => s + (r.uploads?.attempted || 0), 0);
  const uploadSucceeded = results.reduce((s, r) => s + (r.uploads?.succeeded || 0), 0);
  const turnstileBlocked = results.filter((r) => r.turnstileBlocked).length;

  // error breakdown
  const errorCounts = new Map();
  for (const r of failed) {
    for (const e of r.errors ?? []) {
      const key = `${e.step}: ${String(e.message).slice(0, 80)}`;
      errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
    }
  }
  const errorsSorted = [...errorCounts.entries()].sort((a, b) => b[1] - a[1]);

  const durSec = run.startedAt && run.finishedAt
    ? ((new Date(run.finishedAt) - new Date(run.startedAt)) / 1000).toFixed(0)
    : '-';

  const L = [];
  L.push('# SAO Recruitment — Load Test Report');
  L.push('');
  L.push(`- **Round:** ${run.config?.roundId} — "${cfg.roundTitle}"`);
  L.push(`- **Target:** ${run.config?.target} → ${run.config?.frontendBaseUrl}`);
  L.push(`- **เริ่ม:** ${run.startedAt}  |  **จบ:** ${run.finishedAt}  |  **รวมเวลา:** ${durSec} s`);
  L.push(`- **ผู้สมัครจำลอง:** ${results.length} คน (batch ${run.config?.batch} คน/batch, think-time ${run.config?.thinkMinSec}-${run.config?.thinkMaxSec} วิ/คน)`);
  L.push('');
  L.push('## 1. ผลรวม (Total / Success / Failed)');
  L.push('');
  L.push('| ตัวชี้วัด | ค่า |');
  L.push('|---|---|');
  L.push(`| Total users | **${results.length}** |`);
  L.push(`| Success | **${success.length}** (${pct(success.length, results.length)}) |`);
  L.push(`| Failed | **${failed.length}** (${pct(failed.length, results.length)}) |`);
  L.push(`| Skipped (ไม่ได้รัน — หยุดก่อนกำหนด) | ${skipped.length} |`);
  if (run.abort) L.push(`| สาเหตุที่หยุดก่อนกำหนด | **${run.abort.reason}** |`);
  L.push(`| เหตุการณ์ Rate limit (HTTP 429) | ${rateLimitEvents} |`);
  L.push(`| Turnstile บล็อกการทดสอบ | ${turnstileBlocked > 0 ? `**ใช่ (${turnstileBlocked} user) — ดู Error Summary**` : 'ไม่มี'} |`);
  L.push('');

  L.push('## 2. Response Time (เฉพาะที่สำเร็จ)');
  L.push('');
  L.push('| ตัวชี้วัด | Submit API | รวมทั้ง flow (เปิดเว็บ→ส่ง) |');
  L.push('|---|---|---|');
  L.push(`| Average | ${fmtMs(avg(submitMs))} | ${fmtSec(avg(totalMs))} |`);
  L.push(`| Fastest | ${fmtMs(submitMs[0])} | ${fmtSec(totalMs[0])} |`);
  L.push(`| Slowest | ${fmtMs(submitMs[submitMs.length - 1])} | ${fmtSec(totalMs[totalMs.length - 1])} |`);
  L.push(`| Median (p50) | ${fmtMs(percentile(submitMs, 50))} | ${fmtSec(percentile(totalMs, 50))} |`);
  L.push(`| p95 | ${fmtMs(percentile(submitMs, 95))} | ${fmtSec(percentile(totalMs, 95))} |`);
  const slowU = slowest(results);
  const fastU = fastest(results);
  if (slowU) L.push(`\n**ช้าสุด:** ${slowU.applicationNo} (${fmtSec(slowU.timings?.totalMs)}) · ${slowU.name}`);
  if (fastU) L.push(`**เร็วสุด:** ${fastU.applicationNo} (${fmtSec(fastU.timings?.totalMs)}) · ${fastU.name}`);
  L.push('');

  L.push('## 3. Upload Summary (ไฟล์แนบ)');
  L.push('');
  L.push('| ตัวชี้วัด | ค่า |');
  L.push('|---|---|');
  L.push(`| ครั้งที่พยายามอัปโหลด | ${uploadAttempted} |`);
  L.push(`| อัปโหลดสำเร็จ | ${uploadSucceeded} (${pct(uploadSucceeded, uploadAttempted)}) |`);
  L.push(`| อัปโหลดล้มเหลว | ${uploadAttempted - uploadSucceeded} |`);
  L.push('');
  L.push('> ระบบจริงรับเฉพาะ PDF — flow ใช้ TEST-resume.pdf / TEST-portfolio.pdf (ดู TODO.md ข้อ 3 สำหรับ JPG/PNG)');
  L.push('');

  if (admin) {
    L.push('## 4. Search / Export / PDF / Dashboard (Admin-side checks)');
    L.push('');
    const groups = [...new Set(admin.checks.map((c) => c.group))];
    for (const g of groups) {
      L.push(`### ${g}`);
      L.push('');
      L.push('| รายการ | สถานะ | เวลา | ขนาด/หมายเหตุ |');
      L.push('|---|---|---|---|');
      for (const c of admin.checks.filter((x) => x.group === g)) {
        const size = c.bytes ? `${(c.bytes / 1024).toFixed(0)} KB` : (c.total != null ? `total=${c.total}` : (c.note ?? ''));
        L.push(`| ${c.name} | ${c.ok ? '✓' : '✗'} ${c.status || ''} | ${c.ms} ms | ${size} |`);
      }
      L.push('');
    }
    const pdfChecks = admin.checks.filter((c) => c.group === 'PDF' && c.bytes);
    if (pdfChecks.length) {
      L.push('**PDF Summary:** ดาวน์โหลดสำเร็จ ' +
        `${pdfChecks.filter((c) => c.ok).length}/${pdfChecks.length} ใบ · เฉลี่ย ${fmtMs(avg(pdfChecks.map((c) => c.ms)))} · ` +
        `เร็วสุด ${fmtMs(Math.min(...pdfChecks.map((c) => c.ms)))} · ช้าสุด ${fmtMs(Math.max(...pdfChecks.map((c) => c.ms)))}`);
      L.push('');
    }
  } else {
    L.push('## 4. Search / Export / PDF / Dashboard');
    L.push('');
    L.push('> ยังไม่มีผล admin checks — รัน `npm run loadtest:check` ก่อนสร้างรายงานฉบับเต็ม');
    L.push('');
  }

  L.push('## 5. Error Summary');
  L.push('');
  if (!errorsSorted.length) {
    L.push('ไม่มี error 🎉');
  } else {
    L.push('| จำนวน | Step + ข้อความ (ตัดสั้น) |');
    L.push('|---|---|');
    for (const [msg, n] of errorsSorted.slice(0, 25)) {
      L.push(`| ${n} | ${msg.replace(/\|/g, '\\|')} |`);
    }
  }
  L.push('');

  const screenshots = results.flatMap((r) => (r.screenshots ?? []).map((s) => ({ app: r.applicationNo, s })));
  L.push('## 6. Screenshot เมื่อเกิด Error');
  L.push('');
  if (!screenshots.length) L.push('ไม่มี');
  else {
    L.push('| ผู้สมัคร | ไฟล์ |');
    L.push('|---|---|');
    for (const { app, s } of screenshots.slice(0, 50)) L.push(`| ${app} | \`load-test/results/screenshots/${s}\` |`);
    if (screenshots.length > 50) L.push(`| ... | อีก ${screenshots.length - 50} ไฟล์ |`);
  }
  L.push('');

  L.push('## 7. Performance Summary');
  L.push('');
  L.push('| ตัวชี้วัด | ค่า |');
  L.push('|---|---|');
  L.push(`| Throughput เฉลี่ย (ที่สำเร็จ) | ${durSec !== '-' && success.length ? (success.length / (Number(durSec) / 60)).toFixed(1) : '-'} ใบสมัคร/นาที |`);
  L.push(`| ขนาด batch | ${run.config?.batch} คน (พร้อมกันสูงสุด) |`);
  L.push(`| เวลาเฉลี่ยขั้น "กรอกฟอร์ม" | ${fmtSec(avg(success.map((r) => r.timings?.fillMs).filter((v) => v != null)))} |`);
  L.push(`| เวลาเฉลี่ยขั้น "อัปโหลดไฟล์" | ${fmtSec(avg(success.map((r) => r.timings?.uploadMs).filter((v) => v != null)))} |`);
  L.push(`| เวลาเฉลี่ยขั้น "submit" | ${fmtMs(avg(submitMs))} |`);
  const twResults = results.filter((r) => r.turnstile?.waitMs != null);
  if (twResults.length) {
    const twAvg = avg(twResults.map((r) => r.turnstile.waitMs));
    const twManual = twResults.filter((r) => r.turnstile.manual).length;
    L.push(`| เวลารอ Turnstile เฉลี่ย | ${fmtSec(twAvg)} (${twManual}/${twResults.length} คน รอผู้ใช้คลิกเองแบบ headed) |`);
  }
  L.push(`| 429 ที่ retry สำเร็จ | ${results.filter((r) => r.rateLimited > 0 && r.status === 'SUCCESS').length} user |`);
  L.push('');

  if (seed) {
    L.push('## 8. Seeder');
    L.push('');
    L.push(`- seed ล่าสุด: ${seed.count} คน (TEST-${String(seed.startSeq).padStart(6, '0')} → TEST-${String(seed.endSeq).padStart(6, '0')}${seed.withFiles ? ', มีไฟล์แนบใน R2' : ''}) เมื่อ ${seed.at}`);
    L.push('');
  }

  L.push('## 9. ข้อจำกัดของการทดสอบนี้ (โปรดอ่านก่อนสรุป)');
  L.push('');
  L.push('1. ทดสอบจาก **IP เดียว** — rate limit 5 req/min/IP ของระบบ (submit + upload) จึงตีค่า 429 สูงกว่าผู้ใช้จริงที่กระจาย IP; ตัวเลข 429 ในรายงานคือเพดานล่างของความจุฝั่งระบบ ไม่ใช่ปริมาณผู้ใช้พร้อมกันสูงสุดจริง');
  L.push('2. ระบบป้องกันถูกเคารพ 100% — ไม่มีการ bypass Turnstile / Bot Protection / Rate Limit ทุกกรณี; ถ้า Turnstile บล็อก จะหยุดทั้งรันและบันทึกเหตุการณ์ไว้ที่นี่');
  L.push('3. Cloudflare edge cache / Workers isolates ทำให้ latency ที่วัดได้แปรผันตามเวลาและภูมิภาค — อย่าสรุปความจุจากรอบเดียว');
  L.push('');

  const out = path.join(cfg.paths.loadTestDir, 'load-test-report.md');
  writeFileSync(out, L.join('\n'), 'utf8');
  console.log(`✓ รายงาน → ${path.relative(cfg.paths.repoRoot, out)}`);
  console.log(`  จากผล: ${path.relative(cfg.paths.repoRoot, resultsFile)}${admin ? ` + ${path.relative(cfg.paths.repoRoot, adminFile)}` : ''}`);
}

main();
