# D1 Backup and Restore Plan (Design Only — Phase 2)

- **สถานะ:** Design เท่านั้น — ห้าม implement ใน Phase 1 ตามขอบเขตงาน เอกสารนี้เขียนให้นำไป implement ต่อได้ทันที
- **วันที่:** 2026-10-31
- **ระบบ:** Cloudflare D1 (`sao-db`), R2 (`sao-recruitment` — ไฟล์แนบ + PDF cache), GitHub Actions (repo `Badbunny191/recruitment`)
- **หลักการ:** backup ต้องอยู่ **นอก** Cloudflare account เดียวกัน (3-2-1 อย่างน้อย 2 สำเนา 2 สถานที่) และ **ต้องมี restore drill ทดสอบจริงอย่างน้อยเดือนละครั้ง**

---

## 1. D1 Export Strategy

### 1.1 วิธี export ที่เลือก: `wrangler d1 export`

```
wrangler d1 export sao-db --remote --output=dump-<ts>.sql
```

- คืน SQL dump (schema + data) ของ D1 จริงบน prod — นี่คือเครื่องมือทางการที่ Cloudflare รองรับ (จำกัดขนาดรวม ~50 GB, ระบบนี้ใช้ระดับหลักล้าน-แถว จึงเหลือ margin มาก)
- **คุณสมบัติสำคัญ:** `wrangler d1 export` รันใน transaction ที่ consistent ต่อ export — restore ได้ state เดียวกันทั้งไฟล์
- ห้ามใช้ `wrangler d1 execute --file` กลับทาง (restore) กับไฟล์ใหญ่ ๆ โดยตรง — ดูขั้น Restore

### 1.2 รอบเวลา (schedule)

| ประเภท | ความถี่ | เก็บไว้ |
|---|---|---|
| Daily full export | ทุกวัน 02:00 ICT (19:00 UTC) | 30 ไฟล์ล่าสุด |
| Weekly archive | วันอาทิตย์ 02:30 ICT | 12 สัปดาห์ |
| Pre-migration manual | ก่อนรัน migration ทุกครั้ง (029/030/031 ฯลฯ) | ถาวร (ตั้งชื่อ `premigration-<migration-id>`) |

### 1.3 สิ่งที่ backup ต้องครอบ

1. **D1** — `wrangler d1 export` (ข้างบน)
2. **R2 ไฟล์แนบจริง** — object ใน bucket ที่มี prefix ของ application attachments (ไม่รวม PDF cache ที่ build ใหม่ได้จาก D1) — ใช้ `rclone` (S3 endpoint ของ R2) sync ไปอีกที่
3. **Secrets ไม่ backup** — อยู่ที่ Cloudflare dashboard; เก็บเอกสารรายชื่อ secret ที่ต้อง re-enter ไว้ใน runbook

### 1.4 ความปลอดภัยของไฟล์ backup

ไฟล์ dump มี **PII เต็มรูป (email, nationalId, form_data)** — จัดการเหมือน secret:

- **ห้าม commit เข้า repo** (นี่คือ root cause ของ Critical C-1 ใน SECURITY_SWEEP_REPORT.md — `full_backup.sql` หลุดเข้า git history)
- เก็บใน private bucket/สถานที่จัดเก็บที่มีสิทธิ์เฉพาะคน
- ทุกไฟล์ GPG encrypt ด้วย public key ของเจ้าของระบบก่อนออกจาก runner:
  `gpg --encrypt --recipient ops@sao... dump-<ts>.sql`
- CI ต้องไม่ log เนื้อไฟล์ (เอา output ไปไว้ artifact เท่านั้น + ปิด debug logging)

## 2. R2 Retention Policy

| สำเนา | สถานที่ | Retention | เหตุผล |
|---|---|---|---|
| 1 | Cloudflare R2 bucket `sao-recruitment-backups` (account เดียวกัน) | 30 วัน | restore เร็วที่สุด |
| 2 | GitHub private repository `sao-recruitment-backups` (release artifact / LFS) หรือ S3 อื่น | 90 วัน | กันระดับ account (Cloudflare ล่ม/โดน lock) |
| 3 (ถ้ามี) | เครื่อง admin local (sync รายสัปดาห์) | 1 ปี | กันสุดท้าย |

- ลบอัตโนมัติตาม retention ด้วย **R2 lifecycle rule** (30 วัน) บน bucket backup — ไม่ใช้ cron ลบเอง
- ไฟล์ pre-migration ทั้งหมดไม่มี expiry (เก็บถาวรจนกว่า migration นั้นจะถือว่าเสถียร > 6 เดือน)

## 3. GitHub Actions Workflow Design

ไฟล์: `.github/workflows/d1-backup.yml`

```yaml
name: D1 Daily Backup
on:
  schedule:
    - cron: '0 19 * * *'   # 02:00 ICT = 19:00 UTC
  workflow_dispatch: {}     # ปุ่มรันมือ (ใช้ทำ pre-migration backup)

permissions:
  contents: read

concurrency:
  group: d1-backup
  cancel-in-progress: false

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install wrangler
        run: npm install -g wrangler@3

      - name: Export D1 (remote, consistent snapshot)
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_BACKUP_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
        run: |
          TS=$(date -u +%Y%m%dT%H%M%SZ)
          wrangler d1 export sao-db --remote --output="dump-${TS}.sql"
          echo "TS=${TS}" >> "$GITHUB_ENV"

      - name: Encrypt dump (GPG)
        env:
          GPG_RECIPIENT: ${{ secrets.BACKUP_GPG_RECIPIENT }}
          GPG_PRIVATE_KEY: ${{ secrets.BACKUP_GPG_KEY }}     # public key จริง
        run: |
          echo "$GPG_PRIVATE_KEY" | gpg --import
          gpg --encrypt --recipient "$GPG_RECIPIENT" "dump-${{ env.TS }}.sql"

      - name: Upload to R2 backup bucket
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_BACKUP_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
        run: |
          wrangler r2 object put "sao-recruitment-backups/daily/dump-${{ env.TS }}.sql.gpg" \
            --file "dump-${{ env.TS }}.sql.gpg" --remote

      - name: Verify (ขนาด + checksum ต้องไม่เป็นศูนย์)
        run: |
          test -s "dump-${{ env.TS }}.sql"
          sha256sum "dump-${{ env.TS }}.sql" > "dump-${{ env.TS }}.sha256"
          # ตรวจว่า dump มี INSERT จริง (ตัวอย่างเกณฑ์: ไฟล์ > 10KB)
          [ "$(stat -c%s dump-${{ env.TS }}.sql)" -gt 10240 ] || { echo "dump เล็กผิดปกติ"; exit 1; }

      - name: Notify on failure
        if: failure()
        run: echo "TODO: hook แจ้งเตือน (email/Slack/LINE) — ใส่ช่องทางจริงตอน implement"

      - name: Clean local artifacts
        if: always()
        run: rm -f dump-*.sql*
```

### ข้อกำหนดเพิ่มเติมตอน implement

1. **API token scope น้อยที่สุด:** `D1:Edit` (export), `R2:Edit` (เฉพาะ bucket backup) — ห้ามใช้ token ที่ deploy งาน
2. **Monthly restore drill workflow** (`workflow_dispatch` เท่านั้น) — ดูหัว 7
3. ห้ามใช้ `--local` ตัวแปรกับ remote ปนกัน (trap เดิมจาก local D1 ที่ schema ไม่ตรง)
4. ตั้ง **branch protection** ห้ามแก้ workflow นี้โดยไม่มี review (workflow มีสิทธิ์ถึง backup ทั้งหมด)

## 4. Restore Procedure

### 4.1 ผู้มีสิทธิ์

เจ้าของระบบ + ผู้ดูแลระบบที่ถือ `CF_BACKUP_API_TOKEN` — restore ผิดพลาดทำข้อมูลหายเพิ่ม จึงต้องมีคนสองคนตรวจ (one types, one verifies)

### 4.2 ขั้นตอน restore D1 ทั้งฐาน (disaster recovery)

> หลัก: **สร้างฐานใหม่แล้วสลับ** ไม่ truncate ฐานเดิม — เดิมคือ rollback ของเรา

```
# 1) ปิดรับ traffic เขียน (ปิด apply form: ตั้ง flag/env หรือ unpublish รอบ)
#    — กันข้อมูลใหม่หลุดค้างบนฐานเก่าระหว่าง restore

# 2) ดาวน์โหลด + ถอดรหัส backup ที่เลือก
wrangler r2 object get "sao-recruitment-backups/daily/dump-<TS>.sql.gpg" --file dump.gpg --remote
gpg --decrypt dump.gpg > dump.sql
sha256sum -c dump.sql.sha256          # ถ้ามี checksum ฝั่ง unencrypted

# 3) สร้าง D1 ชั่วคราว (ห้ามยุ่งกับ sao-db เดิม!)
wrangler d1 create sao-db-restore-<TS>

# 4) นำเข้า  — ไฟล์ใหญ่แบ่งด้วยการ import ของ wrangler (d1 import รองรับ streaming)
wrangler d1 import sao-db-restore-<TS> --remote --file dump.sql

# 5) ตรวจความถูกต้อง (ดู Validation Procedure หัว 6)
wrangler d1 execute sao-db-restore-<TS> --remote --command "
  SELECT (SELECT COUNT(*) FROM applications) AS apps,
         (SELECT COUNT(*) FROM recruitment_rounds) AS rounds,
         (SELECT COUNT(*) FROM admin_users) AS admins;"

# 6) สลับ binding: Worker/Pages env var DB → ชี้ไปฐานใหม่ แล้ว deploy
#    (หรือ rename ผ่าน dashboard) — verify /health/ready ก่อนเปิด traffic

# 7) เปิดรับ traffic + เก็บ log เวลาทั้งหมดไว้ใน incident note
```

### 4.3 Restore เฉพาะส่วน (point recovery — ตาราง/แถวเดียว)

ใช้กรณีลบพลาดเฉพาะก้อน (เช่น bulk update ผิด):

1. export ตารางที่สนใจจาก dump: `sqlite3 dump.sql ".dump <table>" > table.sql`
2. สร้าง scratch D1 → import ตาราง → เขียน SQL ย้ายเฉพาะแถว (id-based) กลับ prod ผ่าน `d1 execute --command` ทีละ batch ≤ 90 bind (trap: D1 bind limit — ชุด id ต้อง chunk)
3. audit log บันทึกเหตุ restore ทุกครั้ง (manual insert audit_logs)

### 4.4 Restore ไฟล์แนบ R2

- object หายเฉพาะจุด → copy กลับจาก `sao-recruitment-backups/r2/<prefix>` (sync รายวันด้วย rclone job เดียวกัน)
- ตรวจ consistency ด้วย ledger: `attachment_uploads` (029) ทุกแถว `status='ACTIVE'` ต้องมี object จริงใน R2 — สคริปต์เทียบ r2 list กับ ledger (เขียนตอน implement, ประมาณ 30 บรรทัด)

## 5. Recovery Time Estimate

| ขั้น | เวลา (ประมาณการ) |
|---|---|
| ตัดสินใจ + แจ้งเหตุ | 15 นาที |
| ดาวน์โหลด + ถอดรหัส + ตรวจ checksum | 10 นาที (dump ~10-50 MB ที่ขนาดข้อมูลปัจจุบัน) |
| สร้าง D1 ใหม่ + import | 10-30 นาที (โตตามขนาด dump) |
| ตรวจ validation หัว 6 | 15 นาที |
| สลับ binding + deploy + smoke test | 15 นาที |
| **รวม (RTO เป้าหมาย)** | **≤ 1.5 ชั่วโมง** ที่ขนาดข้อมูลปัจจุบัน; วางสูตรไว้ว่า import ~ 1 นาที ต่อ 10 MB dump |
| **RPO** | **≤ 24 ชั่วโมง** (daily) — ถ้าต้องการ RPO สั้นลงเพิ่มรอบ export เป็นทุก 6 ชม. (ราคาจ่ายด้วยเวลา backup) |

- ข้อมูลที่ยอมรับการสูญเสีย: PDF cache (build ใหม่ได้), TEMP ไฟล์แนบ (ยังไม่ submit)
- ข้อมูลห้ามสูญ: applications, audit_logs, attachment_uploads, admin_users

## 6. Validation Procedure (หลัง restore ทุกครั้ง)

รันเป็นชุด — ไม่ผ่านข้อไหน **ห้ามสลับ traffic**:

1. **Row counts vs baseline** — เทียบ count ของตารางหลัก (applications, admin_users, recruitment_rounds, audit_logs, attachment_uploads, template*) กับค่าที่จับไว้ตอน backup (จัดเก็บ `manifest.json` พร้อม dump ตอน backup: counts ต่อตาราง + sha256)
2. **Integrity check** — `PRAGMA foreign_key_check` และ `PRAGMA integrity_check` ผ่าน `d1 execute`
3. **CHECK constraint ยังครบ** — `SELECT sql FROM sqlite_master WHERE name='applications'` ต้องมี `chk_app_status` (กัน dump ยุคเก่าก่อน 030)
4. **Index ครบตาม migration ล่าสุด** — ตรวจ `idx_apps_round_submitted_sort`, `idx_apps_round_submitted_export` (031), `idx_apps_round_email` (030) อยู่จริง
5. **Smoke functional:**
   - login admin ด้วยบัญชีทดสอบ → 200
   - GET /health/ready → 200
   - GET /admin/applications (รอบล่าสุด) → แถวกลับมาตรง count
   - เปิดไฟล์แนบผ่าน signed URL → 200
6. **Spot check PII** — เปิดใบสมัคร 3 ใบแบบสุ่ม เทียบกับที่ backup manifest ระบุ (email/applicationNo)

## 7. Restore Drill Runbook (ทดสอบรายเดือน)

เจตนา: พิสูจน์ว่า backup ที่มี **ใช้ restore ได้จริง** — backup ที่ไม่เคย drill = ไม่มี backup

- **ช่องทาง:** GitHub Actions `workflow_dispatch` (`d1-restore-drill.yml`) หรือรันมือตามขั้นนี้
- **ความถี่:** รายเดือน (วันแรกของเดือน) + ครั้งแรกหลัง implement ทันที

```
GOAL      : พิสูจน์ restore ครบ end-to-end บนฐานชั่วคราว ไม่แตะ prod
PRECONDITIONS:
  [ ] มี backup ล่าสุดอายุ ≤ 7 วัน ใน sao-recruitment-backups/daily/
  [ ] token CF_BACKUP_API_TOKEN มีสิทธิ์ D1:Create + D1:Edit (ฐานชั่วคราว) + R2:Read
  [ ] แจ้งทีม "drill กำลังรัน" (ห้าม deploy ระหว่าง drill)
STEPS:
  1. เลือกไฟล์ backup ล่าสุด              บันทึกชื่อไฟล์ + วันที่
  2. ดาวน์โหลด + GPG decrypt + checksum   บันทึกเวลา
  3. wrangler d1 create sao-db-drill-<TS>  บันทึกเวลา
  4. wrangler d1 import (full dump)        บันทึกเวลา
  5. รัน Validation Procedure (หัว 6) ทั้ง 6 ข้อ — ต้องผ่านทุกข้อ
  6. เปิด wrangler dev ชี้ฐาน drill → login + ดูรายชื่อ + เปิด PDF ได้
  7. ลบฐาน drill + ไฟล์ local ทิ้ง          บันทึกเวลารวม
PASS CRITERIA:
  [ ] ทุกข้อ validation ผ่าน
  [ ] เวลารวม ≤ 1.5 ชม.
  [ ] ไม่มี request ใดเข้า prod D1 ระหว่าง drill (ตรวจ wrangler tail ก่อน-หลัง)
POST:
  [ ] เขียน drill report: วันที่ / รุ่น backup / เวลาแต่ละขั้น / ปัญหาที่พบ
  [ ] ถ้า fail → file issue + แก้ runbook ก่อน drill รอบถัดไป
```

### ช่องโหว่ที่ยังเปิดอยู่จนกว่า Phase 2 จะ implement (ยอมรับความเสี่ยงชั่วคราว)

- ปัจจุบัน **ไม่มี backup อัตโนมัติใด ๆ** — ข้อมูล prod พึ่ง Time Travel ของ D1 (rollback 30 วัน ระดับ point-in-time ที่ Cloudflare เก็บให้) ซึ่งครอบ "ย้อนเวลา" แต่ **ไม่ครอบ "หายทั้ง account"**
- ความเสี่ยงสูงสุดที่ยอมรับชั่วคราว: human error ระดับ account / การถูกระงับบัญชี → ข้อมูลหายถาวร
- ลดความเสี่ยงชั่วคราว: รัน `wrangler d1 export --remote` มือ **ทุกครั้งก่อน migration** (แนวปฏิบัติเดิมของ 029/030) และเก็บไฟล์นอก repo แบบ encrypted
