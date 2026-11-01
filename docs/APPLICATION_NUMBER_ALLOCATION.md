# Application Number Allocation

> อัปเดต: 2026-11-01 (fix/application-number-race) — แก้ race การออกเลขที่ใบสมัคร

เลขที่ใบสมัครมี 2 กลไกตามชนิดรอบ (`recruitment_rounds.application_pattern`):

## Strategy A — Format เดิม `APP-YYYY-NNNN` (pattern = NULL, นับรวมทั้งปี)

1. หา sequence สูงสุดของปี (Bangkok) ด้วย `getMaxSequenceForYear`
   (`backend/src/services/application-number.service.ts`):
   `MAX(CAST(SUBSTR(application_no, 10) AS INTEGER))` บนแถวที่
   `application_no LIKE 'APP-YYYY-%'`
2. บวก 1 → format ด้วย `buildApplicationNo` (`padStart(4)` ไม่ truncate —
   ข้าม 9,999 ได้เป็น `APP-2026-10000`)
3. INSERT ใบสมัคร (batch รวม attachments) — ถ้าชน
   `applications.application_no` UNIQUE (race: สอง request อ่าน MAX เดียวกัน)
   → re-read MAX แล้วลองใหม่ **bounded 5 ครั้ง** → หมดแล้วตอบ 503
   `APP_NO_COLLISION`

**ห้ามใช้ lexical MAX** (`ORDER BY application_no DESC`): `application_no` เป็น
TEXT ทำให้ `'APP-2026-9999' > 'APP-2026-10000'` — เมื่อข้าม 9,999 ทุก submit
จะคำนวณเลขซ้ำเดิมและ 503 ถาวร

## Strategy B — Pattern กำหนดเอง เช่น `{YEAR}-{ROUND_CODE}-{RUNNING:4}` (นับต่อรอบ)

1. Claim เลข **atomic ใน statement เดียว** จาก `round_sequences`
   (`backend/src/services/round-sequence.service.ts`):
   `INSERT ... ON CONFLICT(round_id) DO UPDATE SET current_value = current_value + 1
   RETURNING current_value` อ่านค่าผ่าน drizzle d1 `db.all()` (จำเป็น —
   `db.run()` ของ D1 ไม่คืน RETURNING rows เลย ถึงจะเขียน RETURNING ก็ตาม)
2. Render pattern เป็น string ฝั่ง TS → INSERT ใน batch เดียวกับ attachments
3. ถ้า INSERT ชน `application_no` UNIQUE (sequence ถูก reset ต่ำกว่าเลขเดิม
   หรือ pattern ไม่ unique) → claim เลขใหม่ **bounded 5 ครั้ง**
4. ชน `idx_apps_round_email` (duplicate email) → 400 `ท่านได้สมัครรอบนี้แล้ว`
   ตามเดิม (Migration 030 TOCTOU backstop)

## ข้อตกลงที่สำคัญ

- **เลขข้าม (gap) เป็น behavior ที่ยอมรับ**: claim sequence เสร็จก่อน INSERT
  ใบสมัคร ถ้า INSERT ล้ม เลขที่ claim ไปจะถูกเผา (ไม่ rollback) — ใบถัดไปใช้
  เลขถัดจากเลขที่เผา เลขไม่ถูกนำกลับมาใช้ซ้ำ (application_no เป็น immutable)
  การ rollback ทั้งคู่ทำได้ถ้าย้าย claim เข้า batch เดียวกับ INSERT แต่
  D1 batch ส่งค่า RETURNING ไป bind ให้ statement ถัดไปไม่ได้ และ pattern
  render เป็นฝั่ง TS จึงไม่ทำ
- **UNIQUE constraint เป็น safety net** ไม่ใช่กลไกหลัก — กลไกหลักคือ
  statement เดียวของ Strategy B และ bounded retry ของ Strategy A
- **ห้าม SELECT หลัง UPSERT** เพื่ออ่าน sequence — สอง request จะอ่านค่าเดิม
  พร้อมกันจนเลขซ้ำ (root cause เดิม: `extractReturnedValue()` คืน null เสมอ
  แล้ว fallback ไป SELECT)
- `round_sequences.current_value` ห้าม reset ย้อนหลัง (มี
  `resetRunningNumber` สำหรับ emergency เท่านั้น) — reset ต่ำกว่าเลขเดิมจะทำ
  ให้ชน UNIQUE และเข้า bounded retry แทน

## Migration

ไม่มี migration เพิ่ม — ใช้ `round_sequences` (019), UNIQUE
`applications.application_no`, `idx_apps_round_email` (030) ที่มีอยู่เดิม

## Tests

- `backend/src/routes/__tests__/application-number-race.test.ts` (AN1-AN12):
  ครอบ concurrent allocation (gated interleaving พิสูจน์ race), crossing
  9,999, gap policy, first/existing sequence row, legacy data, duplicate,
  result-shape regression (ห้ามกลับไปพึ่ง SELECT-after-UPSERT)
- fail-before-fix: โค้ดเก่าล้ม 6/14 (AN2, AN3, AN4, AN5, AN11, AN12);
  โค้ดใหม่ผ่าน 14/14
