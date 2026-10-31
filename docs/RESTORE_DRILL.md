# Restore Drill — ขั้นตอนกู้คืน D1 จริงจากจุดจบถึงจุดเปิดระบบ

> **Sprint 2 — Task 5** | วันที่: 2026-10-31 | Branch: `feature/sprint2-recoverability-and-pdf`
>
> Runbook ปฏิบัติจริง คู่กับ `.github/workflows/d1-backup.yml` + `docs/D1_BACKUP_AUTOMATION.md`
> แก้ไขข้อความเดิมใน `D1_BACKUP_AND_RESTORE_PLAN.md`: wrangler 3.114.17 (เวอร์ชันที่ repo pin) **ไม่มี `wrangler d1 import`** — การ restore ใช้ `wrangler d1 execute <db> --remote --file=...` ซึ่ง wrangler แบ่ง statement เป็น batch ภายในเอง (พิสูจน์: `grep "d1 import" node_modules/wrangler/wrangler-dist/cli.js` = 0 จาก backend/node_modules เวอร์ชัน 3.114.17)

---

## 0. Scope และก่อนเริ่ม

**ใช้เมื่อ:** D1 สูญเสีย/เสียหายจนต้องกู้จาก backup หรือเป็นการ drill ตามรอบ (แนะนำทุก 1 เดือน หรือหลัง migration ใหญ่)
**ไม่ใช้เมื่อ:** เหตุเกิดภายใน 30 วันและข้อมูลก่อนหน้ายังอยู่ — ใช้ **Time Travel** แทน (เร็วกว่ามาก): `npx wrangler d1 time-travel info sao-db --timestamp="<RFC3339>"` แล้ว `npx wrangler d1 time-travel restore sao-db --timestamp="..."` (ยืนยันคำสั่งมีจริงใน wrangler 3.114.17) — อ่าน §6

**Prerequisites:**

- wrangler ≥ 3.114.17 (`cd backend && npx wrangler --version`)
- API token ที่มีสิทธิ์: **D1 Edit + D1 Create** (สร้าง DB ชั่วคราว) + **R2 Object Read** (bucket `sao-recruitment-backups`) — ต่างจาก token ของ backup workflow ที่ไม่ต้องมี Create ถ้า drill เป็นเพียงการทดสอบ ใช้ token แยกและลบทิ้งหลังจบ
- backup ล่าสุด ≤ 7 วัน (เกินกว่านั้นต้องประเมิน RPO ที่ยอมรับก่อน)
- ห้าม restore ทับ production DB เดิม — **สร้าง database ใหม่เสมอ** แล้วค่อยสลับ binding

**ขนาดปัจจุบันของระบบ (วันที่ 2026-10-31):** D1 ≈ 0.75 MB, head migration = `031_applications_submitted_at_sort_indexes.sql` (ยืนยันจาก d1_migrations บน prod)

---

## 1. Download Backup

```bash
# 1.1 เลือกรอบ backup ล่าสุดที่ผ่าน (ดูจาก Actions run ล่าสุดที่สีเขียว หรือ list R2)
npx wrangler r2 object get sao-recruitment-backups/d1/daily/2026/10/31/manifest-<TS>.json --file /tmp/manifest.json
cat /tmp/manifest.json | jq .

# 1.2 โหลด dump (ไฟล์ .gpg ถ้าเปิดใช้ encryption / .sql ถ้าไม่ได้เปิด)
npx wrangler r2 object get sao-recruitment-backups/d1/daily/2026/10/31/dump-<TS>.sql.gpg --file /tmp/dump.sql.gpg

# 1.3 ถอดรหัส (เฉพาะเมื่อเข้ารหัสไว้ — ต้องมี private key ของ BACKUP_GPG_RECIPIENT)
gpg --decrypt --output /tmp/dump.sql /tmp/dump.sql.gpg

# 1.4 ตรวจ checksum ให้ตรงกับ manifest ก่อนใช้ (บังคับ)
sha256sum /tmp/dump.sql   # ต้องเท่ากับ manifest.sha256
```

**ผ่านเกณฑ์เมื่อ:** sha256 ตรง + ขนาดไฟล์เท่า `manifest.size_bytes` (±0)

## 2. Restore Database (ลง database ใหม่เสมอ)

```bash
# 2.1 สร้าง DB เป้าหมาย restore (ตั้งชื่อตามเหตุการณ์)
npx wrangler d1 create sao-db-restore-<TS>
# จด database_id ที่คืนมาให้ครบ (ใช้ในขั้น 5)

# 2.2 นำเข้า dump ทั้งไฟล์ (wrangler แบ่ง statement เป็น batch เอง)
npx wrangler d1 execute sao-db-restore-<TS> --remote --file=/tmp/dump.sql -y
```

หมายเหตุสำหรับอนาคต: ถ้า dump ใหญ่เกิน (ปัจจุบัน 0.75 MB ไม่มีปัญหา) `d1 execute --file` มีเพดานขนาดต่อ request ของ API — ให้แบ่งไฟล์เป็นชิ้นตาม statement หรือใช้ `--local` เพื่อพัฒนาต่อ ห้ามรัน `migrations apply` บน DB ที่ restore แล้ว (dump มี schema+data ครบแล้ว และ d1_migrations ledger ถูก restore มาด้วย — การ apply ซ้ำจะ conflict)

## 3. Verify Data

เทียบกับ `manifest.facts` ของรอบ backup นั้น (baseline):

```bash
npx wrangler d1 execute sao-db-restore-<TS> --remote --json --command \
  "SELECT (SELECT COUNT(*) FROM applications) AS applications, \
          (SELECT COUNT(*) FROM audit_logs) AS audit_logs, \
          (SELECT COUNT(*) FROM attachment_uploads) AS attachment_uploads, \
          (SELECT COUNT(*) FROM admin_users) AS admin_users, \
          (SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1) AS migration_head"
```

| เช็ค | เกณฑ์ผ่าน |
|---|---|
| COUNT ทั้ง 4 ตาราง | **ตรงกับ manifest.facts ทุกตัว** (ไม่ผ่าน = import ไม่ครบ กลับไปขั้น 2) |
| ข้อมูลล่าสุด | `SELECT MAX(submitted_at) FROM applications;` ต้อง ≤ เวลา backup และใกล้เคียง (RPO 24h) |
| แถวสำคัญ sample | เลือก application ล่าสุด 1 รายการ ตรวจว่า formData อ่านได้ (JSON valid) |
| integrity ของไฟล์ | `npx wrangler d1 execute sao-db-restore-<TS> --remote --command "PRAGMA integrity_check"` ต้องคืน `ok` (ถ้า D1 ปฏิเสธ PRAGMA ให้ใช้เช็ค app-level ด้านล่างแทน) |
| FK ครบ | `PRAGMA foreign_key_check` ต้องว่างผล |

## 4. Verify Schema

```bash
npx wrangler d1 execute sao-db-restore-<TS> --remote --command \
  "SELECT name FROM sqlite_master WHERE type='index' AND name IN \
   ('idx_apps_round_email','idx_apps_round_submitted_sort','idx_apps_round_submitted_export')"
```

| เช็ค | เกณฑ์ผ่าน | เหตุผล |
|---|---|---|
| `idx_apps_round_email` มีอยู่ | ✓ | migration 030 (unique กันสมัครซ้ำ) |
| `idx_apps_round_submitted_sort` + `..._export` มีอยู่ | ✓ | migration 031 (sort — ยืนยันชุดเดียวกันกับ prod วันที่ 2026-10-31) |
| CHECK constraint | `SELECT sql FROM sqlite_master WHERE name='applications'` ต้องมี `chk_app_status` | สำคัญเฉพาะ dump เก่าก่อน 030 (2026-10-27) |
| `d1_migrations` head | ตรงกับ `manifest.facts.migration_head` | บอกว่า schema อยู่รุ่นไหน — ถ้าเก่ากว่าโค้ดที่จะ deploy ต้อง apply migration ที่ขาด**ก่อน**สลับ binding (ขั้น 5) |
| ledger `__old_*` tables | ต้อง**ไม่มี** (`SELECT name FROM sqlite_master WHERE name LIKE '%__old_%'`) | 030 ล้างทิ้งแล้วใน prod — ถ้าเจอแปลว่า dump เก่า/restore ไม่ครบ |

## 5. Verify Application (ก่อนขึ้นจริง)

สองระดับเลือกตามสถานการณ์:

**(ก) Drill / ซ้อมกู้ (ไม่แตะ production):** deploy Worker ชั่วคราวจากโค้ดเดียวกันชี้ไป restore DB

```bash
# 5.1 แก้ backend/wrangler.toml ชั่วคราว: database_id ของ binding "DB" = id ของ sao-db-restore-<TS>
# 5.2 deploy ชื่ออื่น (ไม่ทับ prod Worker):
cd backend && npx wrangler deploy --name sao-recruitment-backend-drill
# 5.3 ทดสอบผ่าน URL drill (ไม่ใช่ domain prod):
#   GET https://sao-recruitment-backend-drill.<account>.workers.dev/api/v1/health/ready  → 200 (เช็ค JWT_SECRET ขาดจะ fail — ต้อง secret ครบบน Worker drill ด้วย)
#   POST /api/v1/public/applications/lookup ด้วยข้อมูลจริง 1 รายการ → ต้องเจอ
#   login admin จริง 1 บัญชี → ผ่าน (พิสูจน์ admin_users + bcrypt hash มาครบ)
# 5.4 ลบทิ้งหลังจบ: npx wrangler delete --name sao-recruitment-backend-drill  + npx wrangler d1 delete sao-db-restore-<TS>
```

**(ข) เหตุการณ์จริง (cutover):** เมื่อขั้น 3-4 ผ่านครบ — freeze writes (ปิดหน้า public apply / แจ้งแอดมินหยุด) → แก้ `wrangler.toml` binding `DB` เป็น id ของ restore DB → `npx wrangler deploy` → unfreeze ลำดับต้องตรงนี้ เพราะ frontend ไม่ต้อง deploy ใหม่ (ชี้ API เดิม)

## 6. เส้นทาง Time Travel (สั้นกว่ามาก เมื่ออยู่ในกรอบ 30 วัน)

```bash
npx wrangler d1 time-travel info sao-db --timestamp="2026-10-31T10:00:00Z"   # ดู bookmark ณ จุดเวลา
npx wrangler d1 time-travel restore sao-db --timestamp="2026-10-31T10:00:00Z" # restore ทับ (ยืนยันตัวเล็งดี ๆ)
```

- ข้อจำกัด: restore ทับ DB เดิมทั้งก้อน (point-in-time เดียว) — เหมาะกับ "migration พลาด / ลบข้อมูลพลาดเมื่อกี้"; ไม่ช่วยกรณี account หาย/DB ถูกลบ
- หลัง restore ทับ ให้รัน checklist ขั้น 3-4 ซ้ำกับ prod เลย (ไม่ต้องสลับ binding)

## 7. Recovery Time Estimate (ประเมินตามขนาดวันนี้)

| ขั้น | เวลา (ประเมิน) |
|---|---|
| 1 Download + ถอดรหัส + checksum | 2-5 นาที |
| 2 create DB + execute --file | 2-5 นาที (0.75 MB) |
| 3-4 Verify data + schema | 5-10 นาที |
| 5 (ก) Drill deploy + smoke | 10-15 นาที |
| 5 (ข) Cutover deploy + unfreeze | 5 นาที |
| **รวม (drill แบบ ก)** | **≈ 20-35 นาที** |
| **รวม (เหตุจริงแบบ ข)** | **≈ 15-25 นาที** (ตัดส่วนซ้อม) |
| สเกลสมมติ 1 GB (รอบใหญ่ 5+ ปี) | ขั้น 2 โตเป็น 20-40 นาที → รวม ≈ 45-75 นาที — ยังต่ำกว่าเป้า RTO ≤ 1.5 ชม. ของแผน Phase 1 |

RPO = **24 ชั่วโมง** (backup รายวัน) คู่กับ Time Travel 30 วันสำหรับเหตุย้อนหลังใกล้ (RPO แทบ 0)

## 8. Validation Checklist (พิมพ์ไว้ใช้หน้างาน)

- [ ] sha256 dump ตรง manifest
- [ ] `CREATE TABLE applications` พบในไฟล์ (ก่อน import)
- [ ] COUNT 4 ตาราง ตรง manifest.facts
- [ ] `PRAGMA integrity_check` = ok (หรือ app-level check ผ่าน)
- [ ] `PRAGMA foreign_key_check` ว่าง
- [ ] มี `idx_apps_round_email` + `idx_apps_round_submitted_sort` + `idx_apps_round_submitted_export`
- [ ] มี `chk_app_status` ใน DDL ของ applications
- [ ] `d1_migrations` head ตรง manifest.facts.migration_head
- [ ] ไม่มี `__old_*` tables
- [ ] `/health/ready` = 200 บน Worker (drill หรือ prod ตามแบบ ก/ข)
- [ ] lookup ผู้สมัครจริง 1 รายการได้
- [ ] admin login จริง 1 บัญชีได้
- [ ] (เหตุจริง) R2 ไฟล์แนบ: ตรวจ `attachment_uploads` ที่ status='ACTIVE' แล้วเทียบกับ R2 `sao-storage` ว่า key ยังโหลดได้จริง ≥ ตัวอย่าง 5 รายการ — **R2 ไม่ได้ถูก backup โดย workflow นี้** (ดู RECOVERABILITY_REVIEW สถานการณ์ C)

## 9. Disaster Recovery Workflow (ความสัมพันธ์กับสถานการณ์)

| สถานการณ์ | เส้นทางหลัก | เอกสาร |
|---|---|---|
| ข้อมูลเสียหายเมื่อไม่กี่ชม./วัน | Time Travel restore ทับ → checklist §8 | §6 |
| DB หายทั้งก้อน / >30 วัน | Restore drill เต็ม §1-5(ข) | เอกสารนี้ |
| Worker พลาด (โค้ด) | rollback deploy — D1 ไม่เกี่ยว | `RUNBOOK_INCIDENT_RESPONSE.md` |
| Deploy พลาดทั้งระบบ | restore binding จาก git + redeploy | `RUNBOOK_INCIDENT_RESPONSE.md` |
| ซ้อมตามรอบ | §1-5(ก) ทุก 1 เดือน หรือหลัง migration ใหญ่ | เอกสารนี้ |

หลังทุก drill: บันทึกเวลาจริงต่อขั้นลงไฟล์นี้ (ตาราง §7) เพื่อปรับ RTO ให้เป็นตัวเลขจริง ไม่ใช่ประเมิน
