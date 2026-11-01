# Backup Health Monitoring

> **Sprint: Backup Health** | วันที่: 2026-11-01 | Branch: `feature/backup-health-monitoring`
> ระบบตรวจสุขภาพ D1 backup แบบไม่มี UI — แจ้งเตือนผ่าน GitHub Issue
>
> **ขอบเขตที่ห้าม (ประกาศชัด):** ไม่ restore · ไม่แก้ฐานข้อมูล · ไม่ลบ R2 object · ไม่ list R2 objects ด้วย Wrangler · ไม่สร้างหน้า Admin · ไม่แตะ production database · ไม่แก้ migration · ไม่ทำ Restore Automation

| Workflow | บทบาท | หมายเหตุ |
|---|---|---|
| `.github/workflows/d1-backup.yml` (D1 Backup) | ผู้ผลิตสถานะ — เขียน `d1/health/latest.json` หลัง manifest ผ่าน verify (best-effort) | ไม่แตะ step เดิมทุก step |
| `.github/workflows/backup-health.yml` (Backup Health) | ผู้ตรวจ — cron `30 21 * * *` UTC = **04:30 Asia/Bangkok ทุกวัน** + `workflow_dispatch` | read-only 100% ต่อ D1 และ R2 |

ออกแบบต่อยอดจาก `docs/D1_BACKUP_AUTOMATION.md` (§5.1, §6 manifest v2)

---

## 1. Architecture

หลักการ: **backup เป็นผู้ประกาศสถานะตัวเอง (write), health check เป็นผู้อ่านอย่างเดียว (read-only)** — แยก workflow แยะ cron กัน จึงครอบเคสที่ก่อนหน้านี้ไม่มีใครครอบ เช่น backup workflow ไม่ยิงเลยทั้งคืน (schedule ถูกปิด, Actions ล่ม)

เหตุผลที่มี `d1/health/latest.json`: ผู้ตรวจต้องหา manifest ล่าสุดได้โดยไม่ list R2 → backup เขียน **stable key เดียว (overwrite ทุกคืน)** สรุปสถานะคืนล่าสุด ทุกค่า derive จาก manifest ที่ verify ผ่านแล้วด้วย jq (ไม่พิมพ์ค่าซ้ำ → ไม่มี drift)

```
d1-backup.yml (02:00 ICT)                        backup-health.yml (04:30 ICT)
  export → validate → ordered → manifest →       1. GET  d1/health/latest.json
  verify →                                        2. GET  <backup.r2_key> (known key)
    ✚ PUT d1/health/latest.json  ──────R2──────►  3. ประเมิน 4 เช็ค
    (best-effort — พัง = warning, job เขียว)       4. Issue: เปิด/อัปเดต/ปิด + fingerprint
                                                  5. เช็คแดง → job แดง (D1)
```

## 2. Health snapshot — `d1/health/latest.json` (schema v1)

```json
{
  "schema_version": 1,
  "updated_at_utc": "2026-11-01T19:05:00Z",
  "database": "sao-db",
  "backup": {
    "generated_at_utc": "2026-11-01T19:00:00Z",
    "r2_key": "d1/daily/2026/11/01/dump-20261101T190000Z.sql.gpg",
    "sha256": "…", "size_bytes": 765000, "encrypted": true,
    "run_url": "https://github.com/Badbunny191/recruitment/actions/runs/…"
  },
  "ordered": {
    "available": true, "verified": true,
    "r2_key": "…/dump-20261101T190000Z.ordered.sql.gpg",
    "error_code": null
  },
  "facts": { "migration_head": "031_applications_submitted_at_sort_indexes.sql" }
}
```

กฎ:

- derive จาก `manifest-<TS>.json` ที่ผ่าน verify ทั้งหมด — `backup.*` = raw dump (source of truth), `ordered.*` = restore-ready artifact, `facts.migration_head` = schema ตอน dump
- ค่า sha256/size_bytes อ้างถึงไฟล์ **plaintext ก่อน GPG** ตาม convention ของ manifest v2 (`D1_BACKUP_AUTOMATION.md` §6)
- อยู่ภายใต้ lifecycle rule 90 วันเดิม (ไม่ได้แก้ lifecycle) — ถ้าไม่ถูกอัปเดต 90 วัน = ระบบแดงมานานแล้ว ไม่มีผลเพิ่ม
- **การเขียนเป็น best-effort**: พัง = `::warning` + job ยังเขียว (raw + manifest ขึ้น R2 และ verify ผ่านแล้วทั้งคู่) — รอบตรวจคืนถัดไปเช็ค `BACKUP_FRESH` จะจับแทน (self-covering)

## 3. เช็คทั้ง 4 + เกณฑ์อายุ

| เช็ค | ผ่านเมื่อ | หมายเหตุ |
|---|---|---|
| `BACKUP_FRESH` | อายุจาก `backup.generated_at_utc` ≤ `MAX_BACKUP_AGE_HOURS` | **D2:** ค่าเดียว configurable ที่ job env ของ `backup-health.yml` (default `"24"`) — ห้าม hardcode กระจายหลายจุด (ตัดสินใจเป็น**วินาที** แสดงผลเป็น ชม./นาท.) |
| `RAW_PRESENT` | `wrangler r2 object get <backup.r2_key>` สำเร็จ + ไฟล์ไม่ว่าง | known-key GET — ไม่ list; ไม่เทียบ checksum เพราะไฟล์บน R2 อาจเป็น `.gpg` (sha256 ของ manifest อ้าง plaintext ก่อนเข้ารหัส) |
| `ORDERED_AVAILABLE` | `ordered.available == true` | แดง → แสดง `error_code` (`SETUP`/`PARSE`/`UNSUPPORTED`/`CYCLE`/`PARITY`/`INVARIANT`/`VERIFY`/`IO`/`GPG`/`UPLOAD`) |
| `ORDERED_VERIFIED` | `ordered.verified == true` | ปกติมาพร้อมกัน (available=false → ทั้งคู่แดง) |

กรณีอ่าน `d1/health/latest.json` ไม่ได้เลย (404 / JSON เสีย) → สถานะพิเศษ `HEALTH_MISSING` แทนที่ทั้ง 4 เช็ค แล้วรายงานเป็นแดงเดียว

**ทำไม cron 04:30 ICT:** buffer 2.5 ชม. หลัง backup 02:00 — รอบปกติอายุ ≈ 2.5 ชม.; คืนที่ backup ไม่สำเร็จ/ไม่ยิง รอบเช้าจะอ่านอายุ ≈ 26.5 ชม. > 24 → แดงพอดี

## 4. Alert policy (GitHub Issue)

- การระบุ issue ของระบบ: **title prefix `[backup-health]` + state open** (ค้นด้วย `gh issue list` + jq `startswith` — ไม่พึ่ง label จึงไม่มี failure mode เรื่อง label)
- แดง → เปิด **1 issue รวมทุกเช็คที่แดง** (ไม่แตกหลายใบต่อวัน); title = `[backup-health] 🔴 แดง: <เช็คที่แดง>`
- แดงซ้ำวันถัดไป → **ไม่เปิดซ้ำ**: อัปเดต body เป็นสถานะล่าสุดเสมอ + comment เฉพาะเมื่อ **fingerprint เปลี่ยน** (D3 — hash 16 ตัวอักษรของ ชุดเช็คที่แดง + ordered error_code, ฝัง `<!-- backup-health-fingerprint:… -->` ใน body)
- ผ่านครบทุกเช็ค → comment "✅ กลับมาปกติ" + **ปิด issue เดิมอัตโนมัติ**; ถ้าไม่มี issue เปิดอยู่ → ไม่ทำอะไร (แค่ job summary)
- กันเหนียว: ถ้าพบ issue ที่ตรงเงื่อนไขหลายใบ → เก็บใบเลขต่ำสุดไว้ใช้ และปิดใบซ้ำทันที
- เนื้อหา issue เป็น **metadata ล้วน** (repo public): เช็ค/อายุ/error_code/r2 key/run URL — ไม่มี PII, ไม่มี SQL, ไม่มีข้อมูลผู้สมัคร
- **D1:** เมื่อแดง → เปิด/อัปเดต issue ก่อนแล้ว **job แดงด้วย** (exit 1) — email notification ของ GitHub เป็นชั้นสัญญาณที่สอง; เมื่อผ่าน → job เขียว

## 5. Failure policy

| กรณี | พฤติกรรม |
|---|---|
| เขียน health snapshot ใน D1 Backup พัง | `::warning` + job เขียว — raw + manifest ไม่ถูกกระทบ (หลักเดียวกับ ordered best-effort §5.1 ของ `D1_BACKUP_AUTOMATION.md`); คืนถัดไป `BACKUP_FRESH` จับแทน |
| Backup Health รันเองไม่ได้ (install wrangler fail / R2 auth fail / gh API fail — ก่อนประเมินเสร็จ) | job แดง → GitHub default failure notification เป็น backstop (ช่วงนี้ระบบ issue ใช้ไม่ได้เอง — step Manage alert issue ถูก skip เพราะไม่มีสถานะให้รายงาน) |
| เช็คแดงแต่ pipeline ปกติ | เปิด/อัปเดต issue ก่อน → job แดง (D1) |
| Backup ไม่ยิงเลยทั้งคืน | `BACKUP_FRESH` แดง → issue — เคสที่ก่อนหน้านี้ไม่มีใครครอบ |
| health snapshot หาย/JSON เสีย | `HEALTH_MISSING` → issue พร้อมวิธี seed (dispatch D1 Backup 1 ครั้ง) |
| `gh issue edit/create` fail ขณะจัดการ issue แดง | job แดง (exit 1) — notification backstop |
| `gh issue close` fail ขณะ recovery | `::warning` เท่านั้น — เช็คผ่านครบแล้ว ไม่ล้ม job เขียว (ปิดเองภายหลังได้) |
| รันซ้อน | `concurrency: backup-health` + `cancel-in-progress: false` |

**หลักการห้ามกระทบ backup (ข้อ 6 ของโจทย์):** monitor แยก workflow คนละ schedule และ read-only — ทุก failure ของ monitor จบที่ monitor เอง

## 6. Drill (ซ้อมกลไกแจ้งเตือนโดยไม่รอความพังจริง)

`workflow_dispatch` → input `drill_scenario` (string; **ปล่อยว่าง = ตรวจของจริงเสมอ** — ค่า input ต่อ dispatch ไม่ persist):

| ค่า | บังคับผล | พิสูจน์ |
|---|---|---|
| `stale` | แดงเฉพาะ `BACKUP_FRESH` | เปิด issue + job แดง |
| `ordered_unavailable` | แดง `ORDERED_AVAILABLE` + `ORDERED_VERIFIED` | เส้นทาง error_code |
| `raw_missing` | แดงเฉพาะ `RAW_PRESENT` | เส้นทาง object-get fail |
| `healthy` | ผ่านทั้งหมด | ปิด issue อัตโนมัติ |

- run ที่เป็น drill มีหมายเหตุกำกับใน issue body; ค่าที่ไม่รู้จัก = ตรวจของจริง
- ลำดับซ้อมแนะนำ: `ordered_unavailable` (เปิดใบแรก) → รันซ้ำค่าเดิม (ยัง 1 ใบ, body อัปเดต, ไม่มี comment ใหม่) → `stale` (comment "fingerprint เปลี่ยน") → `healthy` (comment กลับมาปกติ + ปิด)

## 7. Runbook — แดงแล้วต้องทำอะไร

| เช็คที่แดง | ความหมาย | การตาม |
|---|---|---|
| `BACKUP_FRESH` | ไม่มี backup ใหม่ภายในเกณฑ์ — backup fail หรือไม่ยิงเลย (หรือเขียน health snapshot พัง) | ดู Actions → "D1 Backup" รอบคืนล่าสุด: ถ้าแดงตาม log ใน run; ถ้าเขียวแต่ยัง stale → ดู `::warning` step "Write health snapshot" แล้ว dispatch ใหม่ |
| `RAW_PRESENT` | manifest ชี้ raw object ที่อ่านไม่ได้ (ถูกลบ/เสียหาย) | ตรวจ R2 dashboard; พิจารณาใช้ backup ก่อนหน้า (`d1/daily/…` วันก่อน) หรือ D1 Time Travel — อย่าปล่อยทิ้งเพราะนี่คือ source of truth |
| `ORDERED_AVAILABLE` | คืนนั้นไม่มี ordered dump (`error_code` บอกสาเหตุ) | raw ยังอยู่ = **ไม่ใช่ข้อมูลหาย** — ตาม `backend/scripts/reorder-dump/SPEC.md` §7-8; UNSUPPORTED หลัง migration ใหม่ = เพิ่ม capability ให้ utility ไม่ใช่เหตุฉุกเฉิน |
| `ORDERED_VERIFIED` | ordered มีแต่ไม่ผ่าน verify (ปริศนา — ปกติเป็นคู่กับ AVAILABLE) | ตามเหมือนแถวบน + ดู job log รอบ backup คืนนั้น |
| `HEALTH_MISSING` | อ่าน `d1/health/latest.json` ไม่ได้ | backup อาจยังสำเร็จ — dispatch "D1 Backup" 1 ครั้งเพื่อ seed; ถ้า backup เขียวอยู่แล้วให้ดู warning step health snapshot |

## 8. ขอบเขต & ความปลอดภัย

- **Read-only พิสูจน์ด้วย grep** บน `backup-health.yml`: ไม่มี `d1 execute` / `d1 export` / `r2 object put` / `r2 object ls` / `r2 bucket`
- ไม่มี checkout — ไม่รันโค้ดจาก repo, สิ่งที่รันคือไฟล์ workflow ที่ review โดยตรง
- Permission ของ `github.token`: `contents: read` + `issues: write` เท่านั้น
- **D4 — Token:** MVP reuse `CF_BACKUP_API_TOKEN` (เหมือน d1-backup.yml) ทั้งที่ health ใช้แค่ `r2 object get` — **TODO: อนาคตควรแยก token read-only (Account | Workers R2 Storage | Object Read) เฉพาะ health เป็น secret ใหม่ เช่น `CF_HEALTH_API_TOKEN` เพื่อ least privilege เต็มรูปแบบ** — ตอนนั้นแก้ env ใน `backup-health.yml` จุดเดียว
- ไม่มี secret ใหม่ต้องตั้งใน MVP

## 9. Rollout & Acceptance

**Rollout:** merge → dispatch "D1 Backup" 1 ครั้ง (seed `d1/health/latest.json`) → dispatch "Backup Health" (คาดหวังเขียว 4/4, ไม่มี issue) → drill ตาม §6 → ปล่อย cron ทำงาน

**Acceptance criteria:**

| # | เกณฑ์ |
|---|---|
| A1 | backup รอบใหม่มี `d1/health/latest.json` ตรง manifest ของรอบนั้นทุกฟิลด์ (เทียบด้วย jq) |
| A2 | สถานะปกติ → job เขียว, ไม่เปิด issue, summary ผ่าน 4/4 |
| A3 | drill `ordered_unavailable` → เปิด 1 ใบ; รันซ้ำ → ยัง 1 ใบ (ไม่เปิดซ้ำ), body อัปเดต, ไม่มี comment ใหม่เมื่อ fingerprint เดิม |
| A4 | drill `healthy` ขณะ issue เปิด → comment "กลับมาปกติ" + issue ถูกปิด |
| A5 | drill `stale` / `raw_missing` → issue ระบุเช็คที่แดง + อายุ + `run_url` ถูกต้อง |
| A6 | grep พิสูจน์ read-only (§8) และ job แดงเมื่อเช็คแดง (D1) |
| A7 | step เดิมของ `d1-backup.yml` ไม่ถูกแก้ — diff มีเฉพาะ step "Write health snapshot" |
| A8 | drill_scenario ว่าง (default) = ตรวจของจริงเสมอ |
