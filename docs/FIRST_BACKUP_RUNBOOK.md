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
| V2 | **Manifest ครบ (v2)** | อ่าน field ทั้งหมด (§ขั้น 5) | ครบ + `facts` เป็น object ไม่ใช่ `null` + `schema_version: 2` + `ordered.available: true` |
| V3 | **Checksum** | `sha256sum` dump ที่โหลดกลับ เทียบ manifest (ordered → `.ordered.sha256` / raw → `.sha256`) | ตรงกันทุกตัวอักษร + size ตรง byte |
| V4 | **Lifecycle** | `r2 bucket lifecycle list` | มี rule `d1-backup-expire-90d` |
| V5 | **Retention** | นับ backup ครบ 2 รอบถัดมา + คำนวณอายุ | มี object ใหม่ทุกคืน และรู้ว่า object อายุ >90 วันจะถูกลบเอง |

run บน Actions เป็นสีเขียว **ยังไม่พอ** — สีเขียวบอกว่า command ไม่ error แต่ V1-V5 คือหลักฐานว่า "มีไฟล์กู้ได้จริง" อยู่ปลายทาง

---

## ขั้นตอน

### ขั้น 1 — เช็ค run บน Actions

Actions → **D1 Backup** → run ล่าสุด (trigger = workflow_dispatch ครั้งแรก)

- [ ] Job `backup` สีเขียว ทุก step ผ่าน (13 steps — รวม `Build ordered dump (best-effort)`)
- [ ] Job summary มีตาราง: `database = sao-db`, `r2 key (raw) = d1/daily/…`, `size`, `sha256` และแถว ordered (`ordered key (restore-ready)` + `ordered verify = FK-ON replay + parity OK` — ถ้าเห็น `unavailable (code)` ดู `D1_BACKUP_AUTOMATION.md` §5.1 ตาม code)
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

- [ ] มี field ครบ: `schema_version` (= 2), `generated_at_utc, database, file, r2_key, size_bytes, sha256, run_url, facts` และ block `ordered` (Phase 2)
- [ ] `ordered.available == true` — พร้อม `ordered.file/r2_key/sha256/verified: true` (ถ้า `false`: รอบนั้นเป็น raw-only backup — ดู `D1_BACKUP_AUTOMATION.md` §5.1 ตาม `ordered.error_code`)
- [ ] `facts` เป็น **object** (ไม่ใช่ `null`) ที่มี: `applications, audit_logs, attachment_uploads, admin_users, migration_head`
  - ตัวอย่างที่ควรเห็นวันแรก (ค่าจริง prod 2026-10-31): `applications ≈ 20`, `admin_users = 5`, `migration_head = "031_applications_submitted_at_sort_indexes.sql"`
  - ถ้า `facts = null`: workflow เก่าที่ยังใช้ jq ผิด — ยืนยัน `main` มี fix `.[0].results[0]` แล้วรันใหม่
- [ ] `run_url` ชี้กลับมา run นี้ (audit trail)

### ขั้น 4 — โหลด dump กลับ + ตรวจ checksum (V3) — หัวใจของ "สำเร็จจริง"

```bash
# โหลด ordered dump ก่อนเสมอ (Phase 2) — ชื่อไฟล์ = manifest.ordered.file
# ต่อเมื่อ ordered.available == false จึงโหลด raw (manifest.file) แทน
npx wrangler r2 object get "sao-recruitment-backups/$PREFIX/$(jq -r '.ordered.available ? .ordered.file : .file' /tmp/manifest.json)" --file /tmp/dump-check

# ถ้าเป็น .gpg: ถอดก่อน (ต้องมี private key ของ BACKUP_GPG_RECIPIENT)
# gpg --decrypt --output /tmp/dump-check.sql /tmp/dump-check

sha256sum /tmp/dump-check
stat -c%s /tmp/dump-check   # linux / บน macOS ใช้: stat -f%z
```

- [ ] `sha256` **ตรง `manifest.ordered.sha256` (หรือ `manifest.sha256` ถ้าใช้ raw) ทุกตัวอักษร**
- [ ] `size` ตรง `manifest.ordered.size_bytes` (หรือ `manifest.size_bytes`) ±0
- [ ] `grep -c "CREATE TABLE" /tmp/dump-check` ต้อง > 10 (schema ครบ)
- [ ] `grep -q "CREATE TABLE.*applications" /tmp/dump-check` ต้องพบ
- [ ] (ordered เท่านั้น) หัวไฟล์ไม่มี `INSERT` ก่อน `CREATE TABLE` ครบทุกตาราง — ordered dump จัดเรียง FK-safe แล้ว (`manifest.ordered.verified: true` ยืนยัน replay ผ่านมาแล้วตอน build)

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

1. **กู้จริงได้จริง** — ต้องรัน restore drill อย่างน้อย 1 ครั้ง (ตั้งแต่ Phase 2 2026-11-01 workflow replay-verify ordered dump ให้ทุกคืนแล้ว — ที่ต้องซ้อมคือเส้นทางปลายทาง: โหลดจาก R2 → import → verify บน DB ใหม่)
2. **ไฟล์แนบ R2 (`sao-storage`) ยังไม่อยู่ใน backup นี้** — ดู `docs/R2_ATTACHMENT_RECOVERY.md`
3. **GPG ถอดกลับได้** — ถ้าเปิด encryption ครั้งแรก ให้ทดลอง `gpg --decrypt` ตั้งแต่วันแรกด้วย private key ที่เก็บไว้ (อย่ารอวันเกิดเหตุ)
