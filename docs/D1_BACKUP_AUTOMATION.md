# D1 Backup Automation

> **Sprint 2 — Task 4** | วันที่: 2026-10-31 | Branch: `feature/sprint2-recoverability-and-pdf`
> **Phase 2** | วันที่: 2026-11-01 | Branch: `feature/d1-backup-phase2` — ผูก reorder utility (`backend/scripts/reorder-dump`, commit 190b6ef2) เข้ากับ workflow: ผลิต **raw + ordered dump คู่กันทุกคืน** + manifest v2
>
> Workflow: `.github/workflows/d1-backup.yml`
> ออกแบบต่อยอดจาก `docs/D1_BACKUP_AND_RESTORE_PLAN.md` (Phase 1 design) — เอกสารนี้คือ implementation spec ฉบับที่ใช้จริง

---

## 1. สิ่งที่ implement

รัน `wrangler d1 export sao-db --remote` (dump เต็ม: schema + data = **raw, source of truth**) วันละครั้ง, แปลงเป็น **ordered dump (restore-ready)** ด้วย reorder utility, ตรวจความสมบูรณ์, ใส่ manifest v2, อัปโหลดทั้งหมดไป R2 bucket `sao-recruitment-backups` พร้อม lifecycle rule ลบอัตโนมัติที่ 90 วัน

| ข้อกำหนด | ที่ implement |
|---|---|
| Daily Backup | `schedule: cron "0 19 * * *"` = 02:00 Asia/Bangkok ทุกวัน + `workflow_dispatch` สำหรับรันมือ (เช่น ก่อน apply migration ใหญ่) |
| D1 Export | `npx wrangler d1 export sao-db --remote --output dump-<UTC timestamp>.sql` (wrangler 3.114.17 — เวอร์ชันเดียวกับ lockfile ทั้ง repo) |
| Ordered Dump (Phase 2) | `backend/scripts/reorder-dump` แปลง raw → `dump-<TS>.ordered.sql` (FK-safe: CREATE แม่ก่อนลูก + DML ตาม topo) พร้อม verify 3 ชั้น — topology/invariant, multiset parity, replay in-memory แบบ `foreign_keys=ON` + `PRAGMA foreign_key_check` ว่าง + เทียบ row count กับ raw ทุกตาราง (best-effort — ดู §5.1) |
| Upload ไป R2 | `npx wrangler r2 object put sao-recruitment-backups/d1/daily/YYYY/MM/DD/<file>` — ขึ้น **raw + ordered + manifest JSON ข้างกัน** (raw ขึ้นก่อนเสมอ) |
| 90 Day Retention | R2 lifecycle rule `d1-backup-expire-90d` (`--expire-days 90`) — workflow สร้าง rule ให้เองถ้ายังไม่มี (idempotent) — rule filter ครอบทุก key รวม raw/ordered/manifest |
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
| Ordered dump build fail (utility exit 1 หรือ npm ci fail — Phase 2) | `::warning::` + รอบนั้นยังขึ้น **raw + manifest ครบ** (`ordered.available = false`, `error_code` บอกสาเหตุ: PARSE/UNSUPPORTED/CYCLE/PARITY/INVARIANT/VERIFY/IO/SETUP) — **job ยังสีเขียว** |
| Ordered dump encrypt/upload fail (Phase 2) | เหมือนข้างบน — manifest สร้าง*หลัง*พยายาม upload เสมอ จึงบันทึกสถานะจริงของคืนนั้น |
| GPG ไม่ได้ตั้ง | อัปโหลด plain (ทั้ง raw และ ordered) + `::warning::` ใน log เตือนชัดเจน |
| รันซ้อน | `concurrency: d1-backup` + `cancel-in-progress: false` — รอบใหม่รอรอบเดิมจบ |

### 5.1 Ordered dump failure policy (Phase 2 — ตัดสินใจ 2026-11-01)

**Raw dump คือ source of truth — สาย raw เป็น fatal เหมือนเดิมทุกจุด (export/validate/facts/encrypt/upload/verify)**
**Ordered dump คือ restore-ready artifact — best-effort ทั้งสาย (build → encrypt → upload)**

ถ้า ordered ล้มที่จุดใดจุดหนึ่ง: รอบนั้นยังขึ้น raw + manifest ครบ, มี `::warning`, และ **job ยังสีเขียว** (ไม่ใช้ fail-gate — เจตนา: raw ยังสำเร็จอยู่และไม่ต้องการ alert fatigue) เหตุผลที่ปลอดภัย: ordered สร้างใหม่จาก raw ได้ทุกเมื่อ (`npm run dump:reorder -- --verify`) การเสีย ordered จึงเป็น "เสียความสะดวก" ไม่ใช่ "เสียข้อมูล"

สุขภาพ ordered ตรวจรายคืนจาก **ตาราง job summary (แถว ordered)** — ถ้าเห็น `unavailable (code)` ติดกันหลายคืน ให้ตามอาการตาม `backend/scripts/reorder-dump/SPEC.md` §7-§8 (code UNSUPPORTED หลัง migration ใหม่ = ต้องเพิ่ม capability ให้ utility, ไม่ใช่เหตุฉุกเฉินข้อมูล)

การตรวจติดตามประจำวัน: ดู Actions tab (หรือเปิด email notification ของ GitHub สำหรับ workflow failure) — แนะนำให้แอดมินสั่ง "send notification for failed workflows only" ให้ครบ

## 6. Manifest v2 (ไฟล์ที่อัปโหลดคู่กันทุกวัน — Phase 2, additive)

`d1/daily/YYYY/MM/DD/manifest-<TS>.json`:

```json
{
  "schema_version": 2,
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
  },
  "ordered": {
    "available": true,
    "file": "dump-20261031T190000Z.ordered.sql.gpg",
    "r2_key": "d1/daily/2026/10/31/dump-20261031T190000Z.ordered.sql.gpg",
    "size_bytes": 765000,
    "sha256": "...",
    "encrypted": true,
    "tool": "reorder-dump",
    "verified": true,
    "statement_counts": { "input": 131, "output": 131, "pragma": 1, "table": 22, "index": 42, "view": 0, "dml": 66 },
    "table_order": ["d1_migrations", "admin_users", "…"],
    "insert_table_order": ["d1_migrations", "…"],
    "replay": { "orderedFkOn": true, "foreignKeyCheckRows": 0, "rawFkOffCountMatch": true },
    "warnings": [],
    "error_code": null
  }
}
```

กฎของ schema:

- **Backward compatible — field ระดับบนเดิมทุกตัวคงความหมายเดิม 100% และหมายถึง raw dump** (source of truth) consumer เดิมใช้ต่อได้ทันที
- consumer ใหม่ต้องอ่าน ordered ผ่าน **`.ordered.available // false`** เสมอ — ถ้า `false` จะมี `file/r2_key/sha256 = null` + `error_code` บอกสาเหตุ (`SETUP`, `PARSE`, `UNSUPPORTED`, `CYCLE`, `PARITY`, `INVARIANT`, `VERIFY`, `IO`, `GPG`, `UPLOAD`)
- `sha256`/`size_bytes` ทั้งของ raw และ ordered อ้างถึง **ไฟล์ plaintext ก่อน GPG** (convention เดิม) — `encrypted: true` บอกว่าไฟล์บน R2 คือ `.gpg` การเทียบ checksum ต้องถอดรหัสก่อน
- `ordered.replay` = ผล verify ที่ utility รันทุกคืน (replay FK-ON ผ่าน + `foreign_key_check` ว่าง + row count ตรง raw ทุกตาราง) — พิสูจน์ว่าไฟล์นี้ restore ได้ในตัวเอง
- `error.message` ของ utility *ไม่* ถูกบันทึกลง manifest (มีเฉพาะ `error_code`) — กัน SQL snippet หลุดเข้า artifact ที่เก็บถาวร, message เต็มอยู่ใน job log

`facts` ใช้เป็น baseline เทียบตอน restore (ขั้นตอนที่ 3 ของ `RESTORE_DRILL.md`) และ `migration_head` ใช้ตัดสินว่า dump นั้นมาจาก schema ไหน (สำคัญมากกับ migration 030 ที่ rebuild ตาราง applications) — **การ restore ให้ใช้ ordered dump ก่อนเสมอเมื่อ `ordered.available == true`** (ดู `RESTORE_DRILL.md` §1-2)

## 7. ขั้นตอนเปิดใช้งานครั้งแรก (แอดมิน)

1. สร้าง API token ตาม §3 แล้วตั้ง secrets `CF_ACCOUNT_ID` + `CF_BACKUP_API_TOKEN`
2. (แนะนำ) สร้างคู่ GPG key สำหรับ backup, ตั้ง `BACKUP_GPG_RECIPIENT` (public key) — เก็บ private key ไว้ที่เครื่องแอดมิน ≥2 ที่ (สำหรับ restore)
3. กด "Run workflow" (workflow_dispatch) ครั้งแรกเพื่อทดสอบ — bucket และ lifecycle rule จะถูกสร้างเอง
4. ตรวจผล: Actions tab → run ล่าสุด → job summary ต้องแสดง r2 key + size + แถว ordered (คาดหวัง: `ordered key (restore-ready)` + `ordered verify = FK-ON replay + parity OK`; ถ้าเห็น `unavailable (code)` ดู §5.1); เช็คใน dashboard R2 ว่ามี object ใน `d1/daily/2026/...` — รอบปกติต้องได้ 3 objects: raw, ordered, manifest
5. ยืนยัน lifecycle rule: `npx wrangler r2 bucket lifecycle list sao-recruitment-backups`

## 8. สิ่งที่ยังไม่ครอบคลุม (ช่องว่างที่จดไว้)

1. **R2 ไฟล์แนบผู้สมัคร (`sao-storage`) ยังไม่มี backup** — งานนี้ dump เฉพาะ D1 ตามโจทย์ (แผนเต็มใน `D1_BACKUP_AND_RESTORE_PLAN.md` §Scope: rclone ทุกคืน) — ความเสี่ยงอยู่ใน `RECOVERABILITY_REVIEW.md` สถานการณ์ C
2. **Single-copy** — คัดลอกออก account เดียว (copy 2/3 ของแผนเดิม) ยังไม่ได้ทำ
3. **Restore drill อัตโนมัติ** (`d1-restore-drill.yml`) ยังไม่ implement — รันตามขั้นตอนมือใน `RESTORE_DRILL.md`
4. Time Travel bookmark ไม่สามารถจับอัตโนมัติผ่าน API สาธารณะ — จด bookmark ด้วยมือก่อน apply migration ใหญ่ (ตาม MIGRATION_GOVERNANCE)
