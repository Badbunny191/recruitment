# First Backup Runbook — รัน backup ครั้งแรกและยืนยันว่า "สำเร็จจริง"

> **Sprint 3 — Task 2** | วันที่: 2026-10-31 | Branch: `feature/sprint3-backup-activation`
>
> ใช้หลังทำ `docs/BACKUP_ACTIVATION_CHECKLIST.md` §3.1-3.4 เสร็จ (secrets ครบ + กด Run workflow แล้ว)
> คำถามหลักที่เอกสารนี้ตอบ: **"จะรู้ได้อย่างไรว่า backup สำเร็จจริง?"**

---

## คำตอบสั้น: สำเร็จจริง = ผ่าน 5 เกณฑ์

| # | เกณฑ์ | วิธีตรวจ | เกณฑ์ผ่าน |
|---|---|---|---|
| V1 | **Object upload** | Download manifest กลับจาก R2 ด้วยมือ (§ขั้น 4) | get สำเร็จ + JSON parse ได้ |
| V2 | **Manifest ครบ** | อ่าน field ทั้ง 9 ตัว (§ขั้น 5) | ครบ + `facts` เป็น object ไม่ใช่ `null` |
| V3 | **Checksum** | `sha256sum` dump ที่โหลดกลับ เทียบ manifest | ตรงกันทุกตัวอักษร + size ตรง byte |
| V4 | **Lifecycle** | `r2 bucket lifecycle list` | มี rule `d1-backup-expire-90d` |
| V5 | **Retention** | นับ backup ครบ 2 รอบถัดมา + คำนวณอายุ | มี object ใหม่ทุกคืน และรู้ว่า object อายุ >90 วันจะถูกลบเอง |

run บน Actions เป็นสีเขียว **ยังไม่พอ** — สีเขียวบอกว่า command ไม่ error แต่ V1-V5 คือหลักฐานว่า "มีไฟล์กู้ได้จริง" อยู่ปลายทาง

---

## ขั้นตอน

### ขั้น 1 — เช็ค run บน Actions

Actions → **D1 Backup** → run ล่าสุด (trigger = workflow_dispatch ครั้งแรก)

- [ ] Job `backup` สีเขียว ทุก step ผ่าน (13 steps)
- [ ] Job summary มีตาราง: `database = sao-db`, `r2 key = d1/daily/…`, `size`, `sha256`
- ถ้าสีแดง: ไป `BACKUP_ACTIVATION_CHECKLIST.md` §4 (Failure Recovery) ตาม step ที่ fail

จดค่าจาก summary: `TS` (จากชื่อไฟล์ dump-<TS>.sql) และ `PREFIX` = `d1/daily/YYYY/MM/DD` (วัน UTC ของ run)

### ขั้น 2 — ยืนยัน object อยู่ใน R2 (list จาก local)

```bash
cd backend
npx wrangler r2 object get "sao-recruitment-backups/$PREFIX/manifest-$TS.json" --file /tmp/manifest.json
```

- [ ] คำสั่ง exit 0 (object มีจริง — นี่คือ V1)

### ขั้น 3 — อ่าน manifest ให้ครบ (V2)

```bash
cat /tmp/manifest.json | jq .
```

- [ ] มีครบ 9 fields: `generated_at_utc, database, file, r2_key, size_bytes, sha256, run_url, facts`
- [ ] `facts` เป็น **object** (ไม่ใช่ `null`) ที่มี: `applications, audit_logs, attachment_uploads, admin_users, migration_head`
  - ตัวอย่างที่ควรเห็นวันแรก (ค่าจริง prod 2026-10-31): `applications ≈ 20`, `admin_users = 5`, `migration_head = "031_applications_submitted_at_sort_indexes.sql"`
  - ถ้า `facts = null`: workflow เก่าที่ยังใช้ jq ผิด — ยืนยัน `main` มี fix `.[0].results[0]` แล้วรันใหม่
- [ ] `run_url` ชี้กลับมา run นี้ (audit trail)

### ขั้น 4 — โหลด dump กลับ + ตรวจ checksum (V3) — หัวใจของ "สำเร็จจริง"

```bash
# ชื่อไฟล์ = manifest.file (dump-$TS.sql หรือ .sql.gpg ถ้าเปิด GPG)
npx wrangler r2 object get "sao-recruitment-backups/$PREFIX/$(jq -r .file /tmp/manifest.json)" --file /tmp/dump-check

# ถ้าเป็น .gpg: ถอดก่อน (ต้องมี private key ของ BACKUP_GPG_RECIPIENT)
# gpg --decrypt --output /tmp/dump-check.sql /tmp/dump-check

sha256sum /tmp/dump-check
stat -c%s /tmp/dump-check   # linux / บน macOS ใช้: stat -f%z
```

- [ ] `sha256` **ตรง manifest.sha256 ทุกตัวอักษร**
- [ ] `size` ตรง `manifest.size_bytes` ±0
- [ ] `grep -c "CREATE TABLE" /tmp/dump-check` ต้อง > 10 (schema ครบ)
- [ ] `grep -q "CREATE TABLE.*applications" /tmp/dump-check` ต้องพบ

> เกณฑ์นี้เข้มกว่าตัว workflow เอง: workflow ยืนยันแค่ re-download manifest; ขั้นนี้พิสูจน์ว่า **dump เอง** โหลดกลับมาและตรง checksum — ปิดช่อง "put สำเร็จแต่ไฟล์เสียระหว่างทาง"

### ขั้น 5 — ยืนยัน lifecycle rule (V4)

```bash
npx wrangler r2 bucket lifecycle list sao-recruitment-backups
```

- [ ] มี rule ชื่อ `d1-backup-expire-90d` ที่ `expire-days = 90`

### ขั้น 6 — ยืนยัน retention ทำงาน (V5)

- [ ] รอ run อัตโนมัติคืนถัดไป (02:00 Asia/Bangkok) → Actions สีเขียว → object ชุดใหม่ใน prefix วันใหม่ (ตรวจด้วยขั้น 2 กับ TS ใหม่)
- [ ] (อธิบายกลไก ไม่ต้องรอจริง) object ทุก key ใน bucket นี้ถูกลบเองเมื่ออายุเกิน 90 วันจากวันอัปโหลดโดย rule จากขั้น 5 — ต้นทุน storage คงที่ ≈ 90 รอบ × ขนาด dump (ปัจจุบัน 0.75 MB → รวม < 70 MB)
- [ ] หลังผ่านครบ: บันทึก "backup ใช้งานจริงตั้งแต่ <วันที่>" กลับที่ `RECOVERABILITY_DELTA.md`

---

## ถ้าทุก checkbox ผ่าน

ระบบเปลี่ยนสถานะเป็น **"มี backup อัตโนมัติ RPO 24 ชม. + Time Travel 30 วัน"** — งานถัดไปคือซ้อม restore ตาม `docs/RESTORE_DRILL_EXECUTION.md` (Phase A-D)

## สิ่งที่ run แรกนี้ยังไม่พิสูจน์ (อย่าลืม)

1. **กู้จริงได้จริง** — ต้องรัน restore drill อย่างน้อย 1 ครั้ง (dump ที่ checksum ผ่านยังอาจ restore ไม่ได้เมื่อ statement ชนกัน)
2. **ไฟล์แนบ R2 (`sao-storage`) ยังไม่อยู่ใน backup นี้** — ดู `docs/R2_ATTACHMENT_RECOVERY.md`
3. **GPG ถอดกลับได้** — ถ้าเปิด encryption ครั้งแรก ให้ทดลอง `gpg --decrypt` ตั้งแต่วันแรกด้วย private key ที่เก็บไว้ (อย่ารอวันเกิดเหตุ)
