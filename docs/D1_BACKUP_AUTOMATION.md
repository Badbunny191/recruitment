# D1 Backup Automation

> **Sprint 2 — Task 4** | วันที่: 2026-10-31 | Branch: `feature/sprint2-recoverability-and-pdf`
>
> Workflow: `.github/workflows/d1-backup.yml` (ไฟล์ใหม่, พร้อมใช้หลังตั้ง secrets)
> ออกแบบต่อยอดจาก `docs/D1_BACKUP_AND_RESTORE_PLAN.md` (Phase 1 design) — เอกสารนี้คือ implementation spec ฉบับที่ใช้จริง

---

## 1. สิ่งที่ implement

รัน `wrangler d1 export sao-db --remote` (dump เต็ม: schema + data) วันละครั้ง, ตรวจความสมบูรณ์, ใส่ manifest, อัปโหลดไป R2 bucket `sao-recruitment-backups` พร้อม lifecycle rule ลบอัตโนมัติที่ 90 วัน

| ข้อกำหนด | ที่ implement |
|---|---|
| Daily Backup | `schedule: cron "0 19 * * *"` = 02:00 Asia/Bangkok ทุกวัน + `workflow_dispatch` สำหรับรันมือ (เช่น ก่อน apply migration ใหญ่) |
| D1 Export | `npx wrangler d1 export sao-db --remote --output dump-<UTC timestamp>.sql` (wrangler 3.114.17 — เวอร์ชันเดียวกับ lockfile ทั้ง repo) |
| Upload ไป R2 | `npx wrangler r2 object put sao-recruitment-backups/d1/daily/YYYY/MM/DD/<file>` + manifest JSON ข้างกัน |
| 90 Day Retention | R2 lifecycle rule `d1-backup-expire-90d` (`--expire-days 90`) — workflow สร้าง rule ให้เองถ้ายังไม่มี (idempotent) |
| GitHub Actions | ไฟล์เดียวจบ ไม่ใช้ third-party action (นอกจาก `actions/checkout@v4`, `actions/setup-node@v4`), `permissions: contents: read`, concurrency lock `d1-backup`, `timeout-minutes: 20` |
| Least Privilege Token | Custom API token 2 permission (ดู §3) |

## 2. Schedule & เหตุผลเวลา

- `0 19 * * *` UTC = **02:00 น. Asia/Bangkok** — นอกเวลาใช้งานสูงสุด, ตั้งหลัง cron GC ของ Worker (18:00 UTC = 01:00 ICT, `backend/wrangler.toml:9-10`) เพื่อให้ cleanup ของคืนเดียวกันรันก่อน dump
- RPO เป้าหมาย = **24 ชั่วโมง** (คู่กับ D1 Time Travel 30 วันที่ครอบช่วงสั้นกว่านั้น — ดู `docs/RECOVERABILITY_REVIEW.md`)

## 3. Required Secrets และการสร้าง Token (least privilege)

ตั้งใน GitHub → repo **Badbunny191/recruitment** → Settings → Secrets and variables → Actions:

| Secret | ค่า |
|---|---|
| `CF_ACCOUNT_ID` | Account ID ของ Cloudflare (หน้า dashboard หลัก) |
| `CF_BACKUP_API_TOKEN` | Custom token ที่สร้างตามตารางด้านล่าง |
| `BACKUP_GPG_RECIPIENT` | (แนะนำอย่างยิ่ง) public key fingerprint/email สำหรับเข้ารหัส dump ก่อนอัปโหลด |
| `BACKUP_GPG_KEY` | ไม่ใช้ตอน backup (ใช้แค่ public key) — สงวนไว้สำหรับ restore drill workflow ในอนาคต |

**การสร้าง `CF_BACKUP_API_TOKEN`** (Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom):

| Permission | Scope | เหตุผล |
|---|---|---|
| Account \| D1 \| **Edit** | account เดียวนี้ | `d1 export` + `d1 execute --json` (อ่านข้อมูลเพื่อ dump และนับ manifest) |
| Account \| Workers R2 Storage \| **Object Read & Write** | bucket: `sao-recruitment-backups` เท่านั้น | put/get object, สร้าง bucket ครั้งแรก, set lifecycle rule |
| Account Resources | **Include → เฉพาะ account นี้** | จำกัดขอบเขต |
| Zone Resources | ไม่เลือก (ไม่ต้องมี zone) | ไม่แตะ domain |
| IP filtering / TTL | ตามสะดวก (โดย default ไม่จำกัด) | ปรับได้ภายหลัง |

ข้อจำกัดที่ยอมรับ: token นี้อ่านข้อมูลผู้สมัครทั้งหมดได้ผ่าน D1 (จำเป็นสำหรับ dump) — จึง (ก) ตั้งชื่อชัดว่า backup, (ข) หมุนเวียนทุก 6-12 เดือน, (ค) **ต้องเข้ารหัส GPG ก่อนอัปโหลด** เพราะ dump มี PII เต็ม (บทเรียนจาก `docs/SECURITY_SWEEP_REPORT.md` C-1: `full_backup.sql` เคยหลุดเข้า git history)

## 4. Retention Policy

- กลไก: R2 object lifecycle rule บน bucket `sao-recruitment-backups`: ลบ object ทุก key เมื่ออายุเกิน **90 วันนับจากวันอัปโหลด** (workflow ตรวจและสร้าง rule ให้เองทุกรอบ — ป้องกันกรณีใครลบ rule ทิ้ง)
- ผลลัพธ์: คงไว้ ≈ 90 backup รายวัน, ต้นทุน storage คงที่ (D1 ปัจจุบัน ≈ 0.75 MB — ผ่าน `d1 execute` meta `size_after` วันที่ 2026-10-31 — แม้โต 1,000 เท่าก็ยัง < 1 GB/90 วัน)
- **เกิน 90 วัน = หายถาวรจาก R2 นี้** — เอกสารแผน Phase 1 เสนอ copy ที่ 2 (repo อื่น/S3, 1 ปี) และ copy ที่ 3 (เครื่องแอดมิน) ยังไม่ได้ทำ จดเป็นช่องว่างที่ระดับความเสี่ยง Medium ใน `RECOVERABILITY_REVIEW.md`
- Time Travel ของ D1 (30 วัน) อยู่นอกเหนือการควบคุมเรา (ไม่มีสิทธิ์ export bookmark อัตโนมัติ) — ใช้เป็นความลึกชั้นที่ 2 ไม่ใช่แผนหลัก

## 5. Failure Handling

| กรณี | พฤติกรรม |
|---|---|
| Export fail (API/network) | step fail → job fail → GitHub ส่ง notification ให้ผู้ watch repo (default) — ไม่มีผลกับ backup ของคืนก่อน |
| Dump ผิดปกติ (เล็กกว่า 10 KB / ไม่มี `CREATE TABLE ... applications`) | step "Validate dump" fail ก่อนอัปโหลด — กันไฟล์เสียเข้า R2 |
| D1 query manifest fail | fail ก่อนอัปโหลด (manifest สำคัญเท่า dump — ใช้เทียบตอน restore) |
| Upload fail | job fail; ไฟล์บางส่วนไม่เกิดขึ้นเพราะ put เป็นราย object (dump ผ่านแล้ว manifest ไม่ผ่าน → manifest ขาด จะถูกจับที่ verify step) |
| Verify step (re-download manifest เทียบ sha256) | ยืนยันว่า object อยู่จริงและตรง checksum ถ้าไม่ตรง → fail |
| GPG ไม่ได้ตั้ง | อัปโหลด plain + `::warning::` ใน log เตือนชัดเจน |
| รันซ้อน | `concurrency: d1-backup` + `cancel-in-progress: false` — รอบใหม่รอรอบเดิมจบ |

การตรวจติดตามประจำวัน: ดู Actions tab (หรือเปิด email notification ของ GitHub สำหรับ workflow failure) — แนะนำให้แอดมินสั่ง "send notification for failed workflows only" ให้ครบ

## 6. Manifest (ไฟล์ที่อัปโหลดคู่กันทุกวัน)

`d1/daily/YYYY/MM/DD/manifest-<TS>.json`:

```json
{
  "generated_at_utc": "2026-10-31T19:00:00Z",
  "database": "sao-db",
  "file": "dump-20261031T190000Z.sql.gpg",
  "r2_key": "d1/daily/2026/10/31/dump-20261031T190000Z.sql.gpg",
  "size_bytes": 765000,
  "sha256": "...",
  "run_url": "https://github.com/Badbunny191/recruitment/actions/runs/...",
  "facts": {
    "applications": 20,
    "audit_logs": 1200,
    "attachment_uploads": 35,
    "admin_users": 5,
    "migration_head": "031_applications_submitted_at_sort_indexes.sql"
  }
}
```

`facts` ใช้เป็น baseline เทียบตอน restore (ขั้นตอนที่ 3 ของ `RESTORE_DRILL.md`) และ `migration_head` ใช้ตัดสินว่า dump นั้นมาจาก schema ไหน (สำคัญมากกับ migration 030 ที่ rebuild ตาราง applications)

## 7. ขั้นตอนเปิดใช้งานครั้งแรก (แอดมิน)

1. สร้าง API token ตาม §3 แล้วตั้ง secrets `CF_ACCOUNT_ID` + `CF_BACKUP_API_TOKEN`
2. (แนะนำ) สร้างคู่ GPG key สำหรับ backup, ตั้ง `BACKUP_GPG_RECIPIENT` (public key) — เก็บ private key ไว้ที่เครื่องแอดมิน ≥2 ที่ (สำหรับ restore)
3. กด "Run workflow" (workflow_dispatch) ครั้งแรกเพื่อทดสอบ — bucket และ lifecycle rule จะถูกสร้างเอง
4. ตรวจผล: Actions tab → run ล่าสุด → job summary ต้องแสดง r2 key + size; เช็คใน dashboard R2 ว่ามี object ใน `d1/daily/2026/...`
5. ยืนยัน lifecycle rule: `npx wrangler r2 bucket lifecycle list sao-recruitment-backups`

## 8. สิ่งที่ยังไม่ครอบคลุม (ช่องว่างที่จดไว้)

1. **R2 ไฟล์แนบผู้สมัคร (`sao-storage`) ยังไม่มี backup** — งานนี้ dump เฉพาะ D1 ตามโจทย์ (แผนเต็มใน `D1_BACKUP_AND_RESTORE_PLAN.md` §Scope: rclone ทุกคืน) — ความเสี่ยงอยู่ใน `RECOVERABILITY_REVIEW.md` สถานการณ์ C
2. **Single-copy** — คัดลอกออก account เดียว (copy 2/3 ของแผนเดิม) ยังไม่ได้ทำ
3. **Restore drill อัตโนมัติ** (`d1-restore-drill.yml`) ยังไม่ implement — รันตามขั้นตอนมือใน `RESTORE_DRILL.md`
4. Time Travel bookmark ไม่สามารถจับอัตโนมัติผ่าน API สาธารณะ — จด bookmark ด้วยมือก่อน apply migration ใหญ่ (ตาม MIGRATION_GOVERNANCE)
