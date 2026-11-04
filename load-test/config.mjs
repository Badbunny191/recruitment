/**
 * Shared configuration ของชุดทดสอบ SAO Recruitment Load Test
 * ---------------------------------------------------------------------------
 * ทุก script (setup-round / seed / run-load-test / admin-check / cleanup)
 * อ่านค่าจากไฟล์นี้ + load-test/.env (ไม่ต้องพึ่ง dotenv package)
 *
 * ค่า default ชี้ไปที่ Cloudflare environment ปัจจุบัน (production) ตามข้อกำหนด
 * "ใช้ Cloudflare Environment ปัจจุบัน ห้ามสร้าง Worker/D1/R2 ใหม่"
 * รันโหมด local ด้วย flag --local (frontend :3000, backend :8787)
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** โหลด .env แบบง่าย (KEY=VALUE ต่อบรรทัด) — ไม่ override ค่าที่มีอยู่แล้วใน process.env */
export function loadDotEnv(file = path.join(HERE, '.env')) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

/** ตัวระบุตัวตนของข้อมูลทดสอบ — Cleanup ใช้ allowlist ชุดนี้เท่านั้น */
export const TEST_MARKERS = {
  roundTitle: '[TEST] Load Test 250 Users',
  // โค้ดรอบ: alphanumeric A-Z0-9 เท่านั้น (validateRoundCode ของ backend, unique ต่อปี)
  // pattern {ROUND_CODE}-{RUNNING:6} + roundCode 'TEST' → เลขที่ใบสมัคร TEST-000001...
  // (validator ของ pattern อนุญาตเฉพาะ token + ตัวคั่น - / . _ — ห้ามตัวอักษรลอยอย่าง "TEST-")
  roundCode: 'TEST',
  // ถ้า roundCode 'TEST' ถูกใช้แล้วในปีนี้ (409 ROUND_CODE_TAKEN) → ลองตัวถัดไป
  // (cleanup อนุพันธ์ prefix จาก round_code จริงใน DB จึงใช้โค้ดไหนก็ลบได้ครบ)
  roundCodeFallbacks: ['TEST1', 'TEST2', 'TEST3', 'TEST4', 'TEST5'],
  positionLevel: 'TEST-POSITION',
  templateName: '[TEST] Load Test Template',
  // pattern ของ backend รองรับเฉพาะ {YEAR} {ROUND_CODE} {RUNNING:3..6} + ตัวคั่น - / . _
  // {ROUND_CODE}-{RUNNING:6} → "TEST-000001" (ตรงรูปแบบ TEST-xxxxxx ที่กำหนด)
  applicationPattern: '{ROUND_CODE}-{RUNNING:6}',
  appNoPrefix: 'TEST-',
  emailDomain: 'test.local',
  // ชื่อไฟล์แนบขึ้นต้นด้วย TEST เสมอ → r2_key GLOB '*TEST-*' ใช้เป็นเงื่อนไข cleanup ได้
  assetPrefix: 'TEST-',
};

export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  // boolean flag → property name (camelCase ที่สคริปต์ต่าง ๆ อ้างถึง)
  const BOOLEAN_FLAGS = new Map([
    ['--local', 'local'],
    ['--remote', 'remote'],
    ['--dry-run', 'dryRun'],
    ['--yes', 'yes'],
    ['--headed', 'headed'],
    ['--no-report', 'noReport'],
    ['--include-orphan-temp', 'includeOrphanTemp'],
    ['--with-files', 'withFiles'],
  ]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (BOOLEAN_FLAGS.has(a)) {
      args[BOOLEAN_FLAGS.get(a)] = true;
    } else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        args[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        // รองรับ --key value (เช่น --r2-keys-file path.txt) — ค่าถัดไปที่ไม่ใช่ --flag
        if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
          args[a.slice(2)] = argv[++i];
        } else {
          args[a.slice(2)] = true;
        }
      }
    } else args._.push(a);
  }
  return args;
}

export function buildConfig(args = {}) {
  loadDotEnv();

  const local = args.local || process.env.LOAD_TEST_LOCAL === '1';
  // ห้ามใช้ local และ remote พร้อมกัน (เผื่อสับสน)
  const target = local ? 'local' : 'remote';

  const frontendBaseUrl = (
    local ? (process.env.LOAD_TEST_LOCAL_FRONTEND_URL || 'http://localhost:3000') : (process.env.LOAD_TEST_FRONTEND_URL || 'https://sao-recruitment-frontend.pages.dev')
  ).replace(/\/$/, '');

  const apiBaseUrl = (
    local ? (process.env.LOAD_TEST_LOCAL_API_URL || 'http://localhost:8787/api/v1') : (process.env.LOAD_TEST_API_URL || 'https://sao-recruitment-backend.hrmsao.workers.dev/api/v1')
  ).replace(/\/$/, '');

  const cfg = {
    target,
    frontendBaseUrl,
    apiBaseUrl,
    adminEmail: process.env.LOAD_TEST_ADMIN_EMAIL || '',
    adminPassword: process.env.LOAD_TEST_ADMIN_PASSWORD || '',
    // จำนวนผู้สมัครจำลอง + batch (spec: batch ละ 5 คน ห้ามยิงพร้อมกัน 250)
    totalUsers: args.users ?? Number(process.env.LOAD_TEST_USERS || 250),
    batchSize: args.batch ?? Number(process.env.LOAD_TEST_BATCH || 5),
    // สุ่มเวลา think-time รวมของแต่ละ user ต่อการเดิน flow หนึ่งรอบ (วินาที)
    // CLI: --think <n> (ตั้งทั้งคู่, 0 = stress mode) หรือ --think-min/--think-max
    thinkMinSec: Number(args['think'] ?? args['think-min'] ?? (process.env.LOAD_TEST_THINK_MIN || 5)),
    thinkMaxSec: Number(args['think'] ?? args['think-max'] ?? (process.env.LOAD_TEST_THINK_MAX || 30)),
    // ช่องเว้นระหว่าง batch (วินาที) — CLI: --batch-gap <n> หรือ --batch-gap-min/max
    batchGapMinSec: Number(args['batch-gap'] ?? args['batch-gap-min'] ?? (process.env.LOAD_TEST_BATCH_GAP_MIN || 2)),
    batchGapMaxSec: Number(args['batch-gap'] ?? args['batch-gap-max'] ?? (process.env.LOAD_TEST_BATCH_GAP_MAX || 8)),
    // Turnstile: รอ token นานสุดเท่านี้ก่อนยอมแพ้ → ABORT ทั้งรัน (ห้าม bypass)
    turnstileTimeoutSec: Number(process.env.LOAD_TEST_TURNSTILE_TIMEOUT || 120),
    // โหมด --headed (Manual Turnstile Assist): รอผู้ใช้คลิก Turnstile เองได้นานขนาดนี้
    manualTurnstileTimeoutSec: Number(
      args['manual-timeout'] ?? (process.env.LOAD_TEST_MANUAL_TURNSTILE_TIMEOUT || 900),
    ),
    // เบราว์เซอร์แบบมีหน้าจอ (ตั้งจาก --headed)
    headed: !!args.headed,
    ...TEST_MARKERS,
    paths: {
      loadTestDir: HERE,
      repoRoot: ROOT,
      backendDir: path.join(ROOT, 'backend'),
      resultsDir: path.join(HERE, 'results'),
      screenshotsDir: path.join(HERE, 'results', 'screenshots'),
      assetsDir: path.join(HERE, 'test-assets'),
      stateFile: path.join(HERE, 'results', 'state.json'),
    },
  };
  return cfg;
}

/** Singleton config สำหรับ lib/* (build จาก argv + .env ครั้งเดียวต่อ process) */
export const cfg = buildConfig(parseArgs());

/** ทรัพยากร R2 ที่ระบบสร้างเอง — cleanup ต้องตามลบให้หมด */
export const R2 = {
  bucket: 'sao-storage',
  pdfCachePrefix: 'pdf/applications',
  // เวอร์ชัน cache ที่เคย deploy (pdf-types.ts PDF_CACHE_VERSION ปัจจุบัน = v3)
  pdfCacheVersions: ['v1', 'v2', 'v3'],
};

export const STATE = {
  read() {
    try {
      return JSON.parse(readFileSync(this.file(), 'utf8'));
    } catch {
      return null;
    }
  },
  write(obj) {
    return import('node:fs').then((fs) =>
      fs.writeFileSync(this.file(), JSON.stringify(obj, null, 2)),
    );
  },
  file() {
    return path.join(HERE, 'results', 'state.json');
  },
};
