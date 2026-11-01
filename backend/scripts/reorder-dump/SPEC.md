# SPEC — reorder-dump: raw D1 dump → FK-safe ordered dump

Utility แปลงไฟล์ dump จาก `wrangler d1 export` (raw) ให้เป็น **ordered dump ที่ restore ได้ด้วย
`wrangler d1 execute --file` ขณะเปิด foreign keys (FK-ON)** — แก้ปัญหาที่พบจาก Restore Drill Lite
(2026-10-31): raw dump เรียง INSERT แบบ child-before-parent และหัวไฟล์ `PRAGMA defer_foreign_keys=TRUE`
ที่ D1 remote import engine ไม่รองรับ → restore ล้ม `no such table: main.<parent>`

ขอบเขตของ utility: **pure Node.js, ไม่เรียก Cloudflare, ไม่มี network** — อ่านไฟล์ SQL เข้า เขียนไฟล์ SQL ออก
(replay-verify ในเครื่องด้วย `better-sqlite3` in-memory เมื่อส่ง `--verify`)

---

## 1. Input contract (รูปแบบที่รองรับ)

ไฟล์ในรูปแบบที่ `wrangler d1 export` สร้าง:

- statement คั่นด้วย `;` — statement หนึ่งอาจกินหลายบรรทัด (CREATE TABLE, CREATE INDEX, INSERT ที่ค่า
  string มี newline ฝัง — พบจริง 10/66 statements ใน dump วันที่ 2026-10-31)
- ชนิด statement ที่รองรับ:
  | ชนิด | ตัวอย่าง | ที่อยู่ปลายทาง |
  |---|---|---|
  | `PRAGMA` | `PRAGMA defer_foreign_keys=TRUE;` | ปักหัวไฟล์ ตามลำดับเดิม |
  | `BEGIN` / `COMMIT` / `END TRANSACTION` | (ถ้ามี) | BEGIN ปักหัว / COMMIT ปักท้าย |
  | `CREATE TABLE` | ชื่อตาราง quote ได้ด้วย `"..."` / `` `...` `` / `[...]` / bare, รองรับ `IF NOT EXISTS`, `TEMP` | กลุ่ม schema เรียง topo |
  | `CREATE [UNIQUE] INDEX` | รวม partial index (`WHERE ...`), expression | หลัง CREATE TABLE ทั้งหมด ตามลำดับเดิม |
  | `CREATE VIEW` | — | หลัง CREATE TABLE ทั้งหมด (เหมือน index) |
  | DML: `INSERT INTO` / `REPLACE INTO` / `DELETE FROM` / `UPDATE` | ปกติ dump มีเฉพาะ INSERT (+DELETE ของ sqlite_sequence) | จัดกลุ่มตามตาราง เรียง topo |
  | comment-only residual ท้ายไฟล์ | `-- end` | คงไว้ท้ายสุด |
- statement อื่น ๆ ที่ไม่อยู่ในตาราง (เช่น `ANALYZE`, `VACUUM`, **`CREATE TRIGGER`**) → **ล้มดัง (loud fail)**
  พร้อมบรรทัดที่เจอ — ห้ามเดา ห้ามเงียบ เพราะไฟล์นี้คือ backup สุดท้ายของระบบ

## 2. กฎการ split (quote-aware)

State machine ระดับตัวอักษร (ไม่ใช่ regex ต่อบรรทัด) — `;` จบ statement เฉพาะเมื่ออยู่นอก:

- single-quoted string `'...'` (escape ด้วย `''`) — **ทน newline จริงใน string**
- double-quoted identifier `"..."` (escape ด้วย `""`)
- backtick identifier `` `...` `` (escape ด้วย ``` `` ```)
- bracket identifier `[...]` (escape ด้วย `]]`)
- line comment `-- ...` และ block comment `/* ... */` (ไม่ nesting ตาม SQLite)

statement ถูกย้ายทั้งก้อน **byte-identical (trim ขอบเท่านั้น)** — ไม่มีการ rewrite SQL ใด ๆ
code ที่ไม่มี `;` ปิดท้ายไฟล์ → `SqlParseError`

## 3. กฎการเรียง (ลำดับที่พิสูจน์แล้วจาก drill — import ผ่านทั้ง wrangler 3.114.17 / 4.156.0)

```
1. PRAGMA            ตามลำดับเดิม          (ความถูกต้องต้องไม่พึ่ง pragma ใด ๆ)
2. BEGIN             (ถ้ามี)
3. CREATE TABLE      topo-sort แม่→ลูก     (Kahn, tie-break = ลำดับเดิมใน dump → deterministic)
4. CREATE INDEX/VIEW ตามลำดับเดิม          (หลังตารางครบทุกตัวเสมอ)
5. DML               จัดกลุ่มตามตาราง เรียง topo เดียวกับข้อ 3 (ข้อมูลแม่ก่อนลูก)
                     กลุ่มของตารางที่ไม่มี CREATE ใน dump → ท้ายกลุ่ม DML + warning
6. sqlite_sequence   DELETE FROM sqlite_sequence ก่อน INSERT INTO "sqlite_sequence"
                     (คงลำดับภายในกลุ่ม) — ปักท้ายสุดหลัง DML ทุกตาราง เพราะ:
                     - ตารางนี้เกิดอัตโนมัติเมื่อมี AUTOINCREMENT → ต้องมี CREATE ก่อนแล้ว
                     - การ insert แถวที่ระบุ id จะ update counter อัตโนมัติ → ต้องล้างแล้วเขียนทับท้ายสุด
7. comment epilogue, COMMIT
```

หลักการสำคัญ: **reorder-only** — output ต้องมีชุด statement เท่ากับ input แบบ multiset
(เทียบแบบไม่สนลำดับ, byte-identical ต่อ statement) ตรวจทุกครั้งที่รัน; ไม่ตรง → `ParityError`

## 4. FK graph

- ดึง edge จาก token `REFERENCES` (case-insensitive) ใน CREATE TABLE เท่านั้น — ทั้งแบบ column-level
  (`col TEXT REFERENCES t(id)`) และ table-level (`FOREIGN KEY (...) REFERENCES t(...)`) รองรับชื่อ
  quote ทุกแบบ + schema-qualified (`main`.`x` → ใช้ `x`)
- สิ่งที่**ไม่**นับเป็น edge: `REFERENCES` ใน string literal, ชื่อตารางใน `CHECK("t"."col" IN ...)`,
  self-reference (ตารางอ้างตัวเอง — ไม่ใช่ cycle)
- FK ไปตารางที่ไม่อยู่ใน dump → ไม่สร้าง edge + warning (ข้อมูลที่อ้างพ่อที่ไม่มีจริง restore FK-ON
  ไม่ได้อยู่แล้วไม่ว่าลำดับใด — replay จะจับตอน `--verify`)
- **Cycle detection**: Kahn เสร็จแล้วเหลือ node → trace วงจรจาก parent edges → `ReorderCycleError`
  พร้อม path `a -> b -> a` — exit 1, **ไม่เขียนไฟล์ output** (FK cycle ไม่มีทาง restore FK-ON ได้เลย
  ไม่ว่าลำดับใด จึงต้องให้คนมาแก้สคีมา ไม่ใช่งัดแง้นไฟล์)

## 5. Verification (ทุกครั้ง + ขยายด้วย `--verify`)

ทุกการรัน (เสมอ):

1. **multiset parity** — ชุด statement ต้นทาง ≡ ปลายทาง (ไม่สนลำดับ, byte-identical ต่อ statement)
2. **invariant re-check** — อ่าน output กลับเข้ามาตรวจอิสระจาก pipeline: CREATE TABLE ทุกตัวมาก่อน
   index/view/DML ทุกตัว, แม่มาก่อนลูกทั้ง schema และ DML, sqlite_sequence อยู่หลัง DML อื่นทั้งหมด

เมื่อส่ง `--verify` (ใช้ใน backup pipeline):

3. **replay ในเครื่อง** ด้วย `better-sqlite3` in-memory: ไฟล์ ordered ลง DB ใหม่ด้วย `PRAGMA foreign_keys=ON`
   ต้องผ่านทุก statement + `PRAGMA foreign_key_check` ว่าง + ตรวจว่า `foreign_keys` ยังเป็น ON จริง
4. **parity กับ raw**: replay raw ด้วย FK-OFF แล้วเทียบ row count ต่อตารางกับ ordered — ต้องเท่ากันทุกตาราง

หมายเหตุ: ต่อให้ engine รองรับ `defer_foreign_keys` การ "พ่อยังไม่ถูกสร้าง" (`no such table`) ก็เป็น
error ทันทีที่ INSERT ไม่ใช่ deferred violation — ลำดับ CREATE และลำดับ DML ต้องถูกทั้งคู่เสมอ ซึ่ง
กฎข้อ 3 ครอบครั้งเดียว

## 6. CLI

```
node --import tsx scripts/reorder-dump/reorder-dump.ts \
  --input  <raw.sql> \
  --output <ordered.sql> \
  [--report <report.json>]   # JSON สำหรับ backup manifest (ดู §7)
  [--verify]                 # replay ด้วย better-sqlite3 ในเครื่อง (§5.3-5.4)
```

Exit codes: `0` สำเร็จ · `1` ล้ม (PARSE / UNSUPPORTED / CYCLE / PARITY / INVARIANT / VERIFY / IO) —
**ไม่เขียนไฟล์ output เมื่อล้ม** และเขียน report รูป `{ ok:false, error:{ code, message } }` ถ้าระบุ `--report` ·
`2` usage ผิด / ไฟล์ input ไม่มี

npm alias: `npm run dump:reorder -- --input ... --output ...`

## 7. Report schema (input ของ Phase 2: d1-backup.yml manifest)

```json
{
  "tool": "reorder-dump",
  "ok": true,
  "input": "...", "output": "...",
  "inputSha256": "...", "outputSha256": "…  ← manifest field ordered_sha256",
  "inputBytes": 399625, "outputBytes": 399625,
  "statementCounts": { "input": 131, "output": 131, "pragma": 1, "table": 22, "index": 42, "view": 0, "dml": 66 },
  "multisetParity": true,
  "invariantsOk": true,
  "tableOrder": ["d1_migrations", "admin_users", "…  ← ลำดับ CREATE ทั้งหมด"],
  "insertTableOrder": ["d1_migrations", "…  ← เฉพาะตารางที่มี DML (manifest field insert_table_order)"],
  "warnings": [],
  "verify": { "replayed": true, "orderedFkOn": true, "foreignKeyCheckRows": 0,
              "rawFkOffCountMatch": true, "rowCounts": { "applications": 591, "…": 0 } }
}
```

Failure policy ที่ Phase 2 (workflow) ต้องทำเมื่อ utility exit 1: ยัง upload **raw** + manifest โดย
`ordered_file: null` + `::warning` แล้ว fail job (loud — backup ไม่สะดุด, restore ยังพึ่ง raw ได้)
— เอกสารไว้ที่นี่เพื่อให้ contract ครบ แต่**ไม่อยู่ในขอบเขตของ utility นี้**

## 8. Limitations (ประกาศชัด — ล้มดัง ไม่เดา)

- `CREATE TRIGGER` → ล้ม (trigger body มี `;` ภายใน BEGIN…END ต้องแยกด้วย parser ระดับอื่น —
  schema ปัจจุบันไม่มี trigger ยืนยันจาก migration ทั้ง 30 ไฟล์; ถ้าอนาคตมี ให้ backup fail ดังแล้วเพิ่ม
  capability เป็นเรื่อง ๆ)
- view ที่อ้าง view อื่น → ยังไม่ track dependency (วางหลัง CREATE TABLE ทุกตัวเสมอ — ครอบเคส
  view-อ้าง-ตาราง ทั้งหมด)
- statement นอกชุดที่ `d1 export` สร้าง → ล้ม (§1)

## 9. แผนที่ test

`__tests__/reorder-dump.test.ts` (harness เดียวกับ `src/middlewares/__tests__/turnstile.test.ts`)

| กลุ่ม | ไฟล์ fixture / input | โค้ดเคส |
|---|---|---|
| S1-S9 splitter | fixtures + inline SQL | multi-line, `;`/newline/`''` ใน string, comment, CRLF, epilogue, unterminated |
| C1-C5 classify | inline SQL | TRIGGER ล้ม, unknown ล้ม, PRAGMA/BEGIN/COMMIT, ชื่อ quote ทุกแบบ, IF NOT EXISTS |
| G1-G7 fk-graph | fixtures | REFERENCES ทุกรูปแบบ, CHECK/string ไม่ false edge, self-FK, topo, cycle path, missing parent |
| R1-R8 reorder | fixtures | ลำดับครบ 7 ชั้น, parity, idempotent, deterministic, unknown DML, BEGIN/COMMIT |
| V1-V5 verify | fixtures | raw ล้ม FK-ON (fail-before-fix), ordered ผ่าน FK-ON, foreign_key_check ว่าง, sqlite_sequence counter, count parity raw↔ordered |
| L1-L4 CLI | fixtures + tmp dir | exit 0/report/summary, cycle exit 1 + ไม่มีไฟล์, usage exit 2, --verify |

fixture ทั้งหมดสังเคราะห์ ไม่มี PII — ชื่อ `raw-*.sql` ไม่เข้าเงื่อนไข gitignore กลุ่ม PII
(`*.backup.sql`, `backend/test-*.sql`, `backend/backups/*.sql`)
