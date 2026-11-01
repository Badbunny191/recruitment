/**
 * Replay verification ในเครื่องด้วย better-sqlite3 in-memory (SPEC.md §5.3-5.4)
 * — ไม่มี network, ไม่เรียก Cloudflare: พิสูจน์ว่าไฟล์ restore ได้จริงภายใต้
 * foreign_keys=ON โดยเลียนแบบพฤติกรรมสำคัญของ D1 remote: `PRAGMA
 * defer_foreign_keys=TRUE` หมดผลท้าย transaction (statement แบบ autocommit =
 * ทันที) ดังนั้น "พ่อยังไม่ถูกสร้าง" ล้มทันทีเหมือนบน D1
 */

import Database from 'better-sqlite3';

export interface ReplayResult {
  /** row count ต่อตาราง (ตัดตาราง internal sqlite_*) */
  counts: Record<string, number>;
  /** จำนวนแถวที่ PRAGMA foreign_key_check รายงาน (0 = สะอาด) */
  foreignKeyCheckRows: number;
  /** ค่า PRAGMA foreign_keys จริงหลัง exec (ต้องเป็น 1 เมื่อ replay แบบ on) */
  foreignKeysSetting: number;
}

export function replay(sql: string, foreignKeys: 'on' | 'off'): ReplayResult {
  const db = new Database(':memory:');
  try {
    db.pragma(`foreign_keys = ${foreignKeys === 'on' ? 'ON' : 'OFF'}`);
    db.exec(sql);
    const setting = db.pragma('foreign_keys', { simple: true }) as number;
    const fkCheck = db.prepare('PRAGMA foreign_key_check').all();
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
        name: string;
      }[]
    )
      .map((r) => r.name)
      .filter((name) => !name.startsWith('sqlite_'));
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const safe = table.replace(/"/g, '""');
      counts[table] = (db.prepare(`SELECT COUNT(*) AS c FROM "${safe}"`).get() as { c: number }).c;
    }
    return {
      counts,
      foreignKeyCheckRows: fkCheck.length,
      foreignKeysSetting: setting,
    };
  } finally {
    db.close();
  }
}
