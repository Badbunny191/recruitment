/**
 * wrangler helpers — รัน D1 / R2 คำสั่งผ่าน wrangler ที่ติดตั้งไว้แล้วใน backend/
 * ---------------------------------------------------------------------------
 * ⚠️ ใช้ทรัพยากรเดิมทั้งหมด: D1 `sao-db` + R2 `sao-storage` (ตาม backend/wrangler.toml)
 *    ไม่มีการสร้าง Worker / D1 / R2 ใหม่ในทุกกรณี
 *
 * หมายเหตุจากประสบการณ์เดิม:
 * - wrangler d1 execute --file ทำงานแบบ atomic ต่อไฟล์ (error เดียว rollback ทั้งไฟล์)
 * - ต้องรันจาก cwd = backend เพื่อใช้ config + wrangler เวอร์ชันโปรเจกต์
 * - stdout อาจมี preamble → parse JSON ด้วยการหาตัวเปิด array/object แรก
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cfg } from '../config.mjs';

const R2_BUCKET = 'sao-storage';

/**
 * รัน `wrangler d1 execute sao-db` — คืน stdout ดิบ
 *
 * ⚠️ พฤติกรรมของ wrangler 3.x ที่พบจากการพิสูจน์จริง (สำคัญ!):
 *  - `--file`   → ใช้ D1 import API: คืน "สถิติ" (Total queries executed / Rows read)
 *                 **ไม่ใช่แถวข้อมูล** — ใช้ได้กับ INSERT/DELETE เท่านั้น
 *  - `--command` → ใช้ query API: คืนแถวข้อมูลจริงใน results[] — SELECT ต้องใช้ทางนี้
 */
export function d1ExecuteRaw(sql, { remote = true, viaCommand = false } = {}) {
  const tmpFile = path.join(mkdtempSync(path.join(tmpdir(), 'sao-lt-')), 'stmt.sql');
  // LT_WRANGLER_PERSIST = ระบุ state dir แยกของ miniflare (ใช้สร้าง DB ทดสอบแยกจาก .wrangler จริง)
  // ใช้ได้เฉพาะ --local (wrangler ปฏิเสธ --persist-to กับ --remote)
  const persistTo = !remote && process.env.LT_WRANGLER_PERSIST
    ? ['--persist-to', process.env.LT_WRANGLER_PERSIST]
    : [];
  try {
    const mode = remote ? '--remote' : '--local';
    const base = ['wrangler', 'd1', 'execute', 'sao-db', mode, ...persistTo];
    const args = viaCommand
      ? [...base, '--json', '--yes', '--command', sql]
      : (() => {
          writeFileSync(tmpFile, sql, 'utf8');
          return [...base, '--file', tmpFile, '--json', '--yes'];
        })();
    const out = execFileSync('npx', args, {
      cwd: cfg.paths.backendDir,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out;
  } catch (err) {
    // แสดง stderr จริง (ตัด npm notice ทิ้ง) — ไม่งั้น error จะถูกกลืน
    const stderr = String(err?.stderr ?? '').replace(/^npm notice.*$/gm, '').trim();
    const stdoutTail = String(err?.stdout ?? '').split('\n').filter(Boolean).slice(-3).join('\n');
    throw new Error(
      `wrangler d1 execute ล้มเหลว${stderr ? `:\n${stderr}` : ''}${stdoutTail ? `\n(stdout tail): ${stdoutTail}` : ''}`,
      { cause: err },
    );
  } finally {
    try { rmSync(path.dirname(tmpFile), { recursive: true, force: true }); } catch { /* ข้าม */ }
  }
}

/** รัน SQL แล้ว parse เป็นผลลัพธ์ JSON ของ D1 (SELECT ต้องส่ง viaCommand=true) */
export function d1Execute(sql, opts = {}) {
  const out = d1ExecuteRaw(sql, opts);
  const start = out.search(/[[{]/);
  if (start < 0) return null;
  try {
    return JSON.parse(out.slice(start));
  } catch {
    return null;
  }
}

/** SELECT helper → rows (ใช้ --command เพราะ --file ไม่คืนแถว — ดูหมายเหตุ d1ExecuteRaw) */
export function d1Select(sql, opts = {}) {
  const parsed = d1Execute(sql, { ...opts, viaCommand: true });
  if (!parsed) return [];
  if (Array.isArray(parsed)) {
    return parsed.flatMap((r) => (Array.isArray(r?.results) ? r.results : []));
  }
  return Array.isArray(parsed?.results) ? parsed.results : [];
}

/**
 * รัน SQL หลาย statement เป็นหลาย ๆ ไฟล์ (chunk) — คืนจำนวนไฟล์ที่รันสำเร็จ
 * ขนาด chunk ต่ำเพื่อกันความยาวเกินขีดจำกัดของ D1
 */
export function d1ExecuteChunked(statements, { remote = true, chunkSize = 50, label = 'sql' } = {}) {
  let done = 0;
  for (let i = 0; i < statements.length; i += chunkSize) {
    const chunk = statements.slice(i, i + chunkSize);
    const sql = chunk.join('\n');
    d1ExecuteRaw(sql, { remote });
    done += chunk.length;
    process.stdout.write(`  [${label}] ${Math.min(i + chunkSize, statements.length)}/${statements.length} statements\r`);
  }
  if (statements.length) process.stdout.write('\n');
  return done;
}

/** อัปโหลดไฟล์เข้า R2 (ทรัพยากรเดิม) */
export function r2Put(key, filePath, { remote = true, contentType = 'application/pdf' } = {}) {
  const persistTo = !remote && process.env.LT_WRANGLER_PERSIST
    ? ['--persist-to', process.env.LT_WRANGLER_PERSIST]
    : [];
  execFileSync('npx', [
    'wrangler', 'r2', 'object', 'put', `${R2_BUCKET}/${key}`,
    '--file', filePath,
    '--content-type', contentType,
    ...(remote ? ['--remote'] : ['--local']),
    ...persistTo,
  ], {
    cwd: cfg.paths.backendDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** ลบ object จาก R2 — ไม่ throw เมื่อ object ไม่มีอยู่ (ลบซ้ำได้) */
export function r2Delete(key, { remote = true } = {}) {
  const persistTo = !remote && process.env.LT_WRANGLER_PERSIST
    ? ['--persist-to', process.env.LT_WRANGLER_PERSIST]
    : [];
  try {
    execFileSync('npx', [
      'wrangler', 'r2', 'object', 'delete', `${R2_BUCKET}/${key}`,
      ...(remote ? ['--remote'] : ['--local']),
      ...persistTo,
    ], {
      cwd: cfg.paths.backendDir,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch (err) {
    const msg = String(err?.stderr || err?.message || '');
    // object ไม่มีอยู่ = ลบสำเร็จตามเป้าหมาย (ไม่มีซาก)
    if (/not found|notfound|10007|NoSuchKey/i.test(msg)) return true;
    throw err;
  }
}

/** รัน R2 delete หลาย key แบบคู่ขนานจำกัด */
export async function r2DeleteMany(keys, { remote = true, concurrency = 4, label = 'r2' } = {}) {
  let deleted = 0;
  const queue = [...keys];
  const workers = Array.from({ length: Math.min(concurrency, queue.length || 1) }, async () => {
    while (queue.length) {
      const key = queue.shift();
      if (!key) break;
      r2Delete(key, { remote });
      deleted++;
      if (deleted % 25 === 0) {
        process.stdout.write(`  [${label}] ${deleted} objects deleted\r`);
      }
    }
  });
  await Promise.all(workers);
  if (keys.length) process.stdout.write(`  [${label}] ${deleted} objects deleted\n`);
  return deleted;
}
