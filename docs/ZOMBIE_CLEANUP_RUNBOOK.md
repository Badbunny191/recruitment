# Zombie Cleanup Runbook — Publish Invariant (Migration 033)

> ฉบับ production จริง — จัดทำ 2026-11-08 จากผลตรวจ prod D1 read-only
> งานที่เกี่ยว: conditional batch publish + clone protection (commit `a8a4374c`),
> invariant monitoring (commit `bd676e39`), migration 033 (branch
> `feat/q4-publish-invariant-monitoring`)
>
> **สถานะของ runbook นี้: ยังไม่ execute** — repository พร้อม deploy เท่านั้น
> ทำตามลำดับ §6 หลังอนุมัติ deploy

---

## 1. ข้อเท็จจริงจาก production (ยืนยัน 2026-11-08, read-only)

Template เดียวที่ผิด invariant:

| | |
|---|---|
| Template | `tpl-general-001` — "แบบฟอร์มรับสมัครตำแหน่งประเภทวิชาการ ระดับเชี่ยวชาญ 2569" |
| PUBLISHED ซ้ำ | v2, v3, v4, v5 (4 ตัว) — v1 เป็น ARCHIVED ถูกต้องแล้ว |

Version ที่เกี่ยว (id เต็ม สำหรับคำสั่งด้านล่าง):

| Version | id | สถานะ (11-08) | rounds ที่อ้างอิง | การตัดสิน |
|---|---|---|---|---|
| v2 | `40a803f9-691d-482f-b525-4f51664e47cb` | PUBLISHED (zombie) | **0** | **archive ได้** |
| v3 | `fe173457-8e22-4667-8c03-1f882dc5378a` | PUBLISHED (zombie) | **0** | **archive ได้** |
| v4 | `8f955e46-16f7-459c-9429-4a1808d330df` | PUBLISHED (zombie) | **0** | **archive ได้** |
| v5 | `fb967e3c-d591-4c3d-8ece-ec4a080c3d87` | PUBLISHED (ตัวจริง) | **2** (CC01 ACTIVE + round-uat-001 DRAFT) | **ห้ามแตะ** |

เหตุที่ archive ผ่าน API ได้: archive endpoint บล็อกเฉพาะเมื่อมี rounds อ้างอิง
(snapshot policy) — v2-v4 ไม่มีใครอ้าง → 3 PATCH ผ่านหมด และได้ audit trail
อัตโนมัติ (3 rows `TEMPLATE_VERSION`/`UPDATE`)

---

## 2. Preconditions — ทุกข้อต้องผ่านก่อนเริ่ม

| # | เงื่อนไข | วิธียืนยัน | สถานะ ณ 2026-11-08 |
|---|---|---|---|
| PR1 | **Deploy BE publish fix แล้ว** (commit `a8a4374c` — publish เป็น conditional batch) | Worker dashboard ดู version/deployment | ⬜ ต้องทำก่อนเสมอ |
| PR2 | backup ล่าสุด ≤ 24h + ordered verified | §4 V0 หรือดู Actions "D1 Backup"/"Backup Health" เขียว | ✅ run 19 (11-08 05:27 ICT) / run 11 เขียว |
| PR3 | zombie v2-v4 ยัง 0 rounds อ้างอิง | §4 V2 | ✅ 0 ทั้งสามตัว |
| PR4 | v5 ยังถูกอ้างโดย 2 rounds (ยืนยันว่าไม่แตะผิดตัว) | §4 V1 | ✅ 2 |
| PR5 | (แนะนำ) maintenance window 10 นาที ถ้า UptimeRobot ตั้งแล้ว | dashboard | ⬜ |

> ลำดับสำคัญ: **deploy BE fix ก่อน cleanup เสมอ** — ถ้า cleanup ก่อน deploy
> แล้วมี publish เกิดขึ้นก่อน fix ถึง โค้ดเก่าจะ archive แถว arbitrary ทำให้
> state แตกซ้ำกลาง runbook

---

## 3. Backups

- ปกติมี daily GPG dump อัตโนมัติแล้ว (R2 `sao-recruitment-backups`, 90-day retention,
  ordered dump verified FK-ON ทุกคืน) — เพียงพอเป็นหลักประกันหลัก
- ก่อนเริ่ม: trigger `workflow_dispatch` บน "D1 Backup" 1 ครั้งให้ snapshot สด
  + เก็บผล Validation Queries (§4) ทั้งก่อน/หลังลง PR/MR description เป็นหลักฐาน
- Insurance ชั้นสุดท้าย: **D1 Time Travel (30 วัน)** — restore point ก่อนทุก UPDATE;
  cleanup นี้เปลี่ยนแค่ 3 แถวของตาราง `template_versions`

---

## 4. Validation Queries — รันก่อนและหลัง เก็บผลทุกครั้ง

```bash
# V0 — สถานะ backup (หรือดู Actions เขียวแทนได้)
npx wrangler r2 object get "sao-recruitment-backups/d1/health/latest.json" --file /tmp/health.json \
  && jq '{backup_age: .backup.generated_at_utc, ordered_verified: .ordered.verified}' /tmp/health.json

# V1 — สถานะ versions ของ template (คาดหวัง: v2,v3,v4 PUBLISHED → v5 PUBLISHED; หลัง cleanup: v5 เดียว)
npx wrangler d1 execute sao-db --remote --command \
  "SELECT version_number, status FROM template_versions WHERE template_id='tpl-general-001' ORDER BY version_number"

# V2 — zombie ยังไม่ถูกอ้าง (คาดหวัง 0 ทุกตัว; หลัง cleanup: rows หายเพราะเปลี่ยนสถานะ)
npx wrangler d1 execute sao-db --remote --command \
  "SELECT version_number, (SELECT COUNT(*) FROM recruitment_rounds r WHERE r.template_version_id = tv.id) AS rounds_ref
   FROM template_versions tv WHERE tv.id IN
   ('40a803f9-691d-482f-b525-4f51664e47cb','fe173457-8e22-4667-8c03-1f882dc5378a','8f955e46-16f7-459c-9429-4a1808d330df')
   AND tv.status = 'PUBLISHED'"

# V3 — invariant query (ชุดเดียวกับ probe ใน d1-backup.yml) — คาดหวัง 1 กลุ่มก่อน, 0 หลัง
npx wrangler d1 execute sao-db --remote --command \
  "SELECT template_id, COUNT(*) AS published_count, GROUP_CONCAT(version_number) AS versions
   FROM template_versions WHERE status='PUBLISHED' GROUP BY template_id HAVING COUNT(*) > 1"
```

ผลจริงก่อน cleanup (11-08): V3 → 1 แถว `tpl-general-001 published_count=4 versions=2,3,4,5` ·
V2 → 0 rounds ทุกตัว · V1 → v1 ARCHIVED, v2-v5 PUBLISHED

---

## 5. Cleanup Steps (ทาง API — ได้ audit trail)

```bash
BASE=https://sao-recruitment-backend.hrmsao.workers.dev/api/v1/admin
TOKEN=<admin JWT>

# STEP 1-3: archive zombie ทีละตัว — เช็ค HTTP 200 ทุกครั้ง ห้ามข้าม
curl -X PATCH "$BASE/template-versions/40a803f9-691d-482f-b525-4f51664e47cb/archive" -H "Authorization: Bearer $TOKEN"   # v2
curl -X PATCH "$BASE/template-versions/fe173457-8e22-4667-8c03-1f882dc5378a/archive" -H "Authorization: Bearer $TOKEN"   # v3
curl -X PATCH "$BASE/template-versions/8f955e46-16f7-459c-9429-4a1808d330df/archive" -H "Authorization: Bearer $TOKEN"   # v4

# STEP 4: verify — V3 ต้องได้ 0 แถว, V1 ต้องเหลือ v5 เดียว PUBLISHED
# STEP 5: ยืนยัน audit — หน้า Admin → Audit Logs ต้องมี 3 rows TEMPLATE_VERSION/UPDATE
#          (หรือ query: SELECT * FROM audit_logs WHERE entity_type='TEMPLATE_VERSION'
#           AND entity_id IN (v2,v3,v4) AND created_at >= unixepoch()-3600)
```

ห้ามใช้ SQL ตรงเป็นทางเลือกแรก — API path มี audit trail ในตัว; SQL จองไว้เฉพาะ rollback

---

## 6. Deploy Checklist — ลำดับรวมทั้งงาน (ห้ามสลับ)

| ขั้น | งาน | เงื่อนไขผ่าน | Rollback ของขั้น |
|---|---|---|---|
| 1 | Merge branch `feat/q4-publish-invariant-monitoring` → main (Phase 1+2+3 commits) | CI เขียว (tsc + npm test) | revert merge commit |
| 2 | Deploy backend (Worker) | deploy สำเร็จ + `curl /health/ready` เห็น `checks.r2:"ok"` | Worker rollback ใน dashboard — โค้ด fix กับ state เก่า/ใหม่ใช้ร่วมได้ทั้งสองทิศ |
| 3 | Smoke publish จริง 1 ครั้ง (สร้าง DRAFT → publish → เช็ค response `archivedCount`) | 200 + archivedCount ถูก + invariant ไม่เตือน | — (สร้าง version ทดสอบใน template ทดสอบเท่านั้น) |
| 4 | **Cleanup zombie** — §5 STEP 1-5 (pre-flight §2 ผ่านครบ) | 3 PATCH ได้ 200 · V3 = 0 แถว · audit 3 rows | §7 ตาราง rollback |
| 5 | **Apply migration 033**: `wrangler d1 migrations apply sao-db --remote` (จาก backend/) | ขั้น 4 เสร็จสมบูรณ์ (V3=0) ก่อนเสมอ — ถ้ายังสกปรก index จะ **ล้มเหลวเอง** (fail-closed, พิสูจน์ใน test M4) · หลัง apply: `SELECT * FROM pragma_index_list('template_versions')` เห็น `unq_template_published` | `DROP INDEX unq_template_published` (ยังเป็นคำสั่ง DDL เดียว ไม่แตะข้อมูล) |
| 6 | Verify ปลายทาง: Clone CC01 → auto-select v5 เดียว · dropdown Create Round = ตัวเดียวต่อ template · dispatch "D1 Backup" 1 ครั้ง → snapshot v2 มี `invariant.violations = 0` → Backup Health ครั้งถัดไปเขียว 5/5 | — | ตามขั้นที่พัง |

> หมายเหตุ: migration 033 ต้อง apply **หลัง** deploy BE (ขั้น 2) — apply ก่อนโค้ดใหม่
> ขึ้น = publish โค้ดเก่าชน index เป็น 500 ได้

---

## 7. Rollback — เรียงตามจุดที่หยุด

| หยุดหลังขั้น | Rollback |
|---|---|
| ก่อน STEP 1 (cleanup) | ไม่ต้องทำอะไร |
| archive ผิดตัว (พิสูจน์แล้ว) | **ARCHIVED→PUBLISHED ไม่มี API path** — ใช้ SQL ตรง (จดเป็นหลักฐาน manual): `UPDATE template_versions SET status='PUBLISHED' WHERE id IN ('<ผิดตัว>');` — ยังทำได้ตราบใดที่ ≤1 PUBLISHED/template; ถ้า migration 033 apply แล้ว → `DROP INDEX unq_template_published` ก่อน แล้วคืนสถานะ แล้ว CREATE index กลับ |
| หลัง migration 033 apply | `DROP INDEX unq_template_published;` (pure DDL — ไม่กระทบข้อมูล) |
| เหนือกว่าทั้งหมด | D1 Time Travel restore จุดก่อนเริ่ม หรือ restore จาก GPG daily dump (RTO ตาม drill: ~15 นาที) |

---

## 8. หลักฐานความปลอดภัยของ migration 033 (จาก test M1-M4)

| Test | พิสูจน์ |
|---|---|
| M1 | ไฟล์ migration มี partial unique index ตรงแผน (`WHERE status='PUBLISHED'`) |
| M2 | apply บน state สะอาดสำเร็จ + publish flow ใหม่ (batch) ยังทำงานถูกเมื่อมี index |
| M3 | การเขียนให้มี 2 PUBLISHED โดน `UNIQUE constraint` ยิงกลับ — ไม่มีทาง state แตกเงียบ ๆ |
| M4 | apply ทับ zombie state (2 PUBLISHED) **ล้มเหลวเอง** — fail-closed precondition |

รัน: `node --import tsx src/routes/__tests__/template-publish-invariant.test.ts` (อยู่ใน chain `npm test` แล้ว)
