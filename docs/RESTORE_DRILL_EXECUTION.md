# Restore Drill Execution — เช็กลิสต์ปฏิบัติจริง แยก 4 เฟส

> **Sprint 3 — Task 3** | วันที่: 2026-10-31 | Branch: `feature/sprint3-backup-activation`
>
> แปลง `docs/RESTORE_DRILL.md` (Sprint 2 — เนื้อหาเชิงออกแบบ) เป็นเช็กลิสต์สั่งงานได้
> เฟส A → B → C → D ต้องผ่านตามลำดับ — ข้อใด fail ให้หยุดและบันทึกอาการก่อนไปขั้นถัดไป
> เป้า RTO อ้างอิง: drill เต็ม ≈ 20-35 นาที (RESTORE_DRILL §7)

**เลือกโหมดก่อนเริ่ม:**
- โหมด **ซ้อม (drill)** — Phase A-C เท่านั้น, deploy Worker ชั่วคราว, **ไม่แตะ production ทุกกรณี**
- โหมด **เหตุจริง (cutover)** — ทุกเฟส รวม Phase D, ต้องมีผู้อนุมัติ (เจ้าของระบบ) ยืนยันก่อนเริ่ม Phase D

**Prerequisites (ทั้งสองโหมด):**

- [ ] P1. มี backup ที่ผ่านเกณฑ์จาก `FIRST_BACKUP_RUNBOOK.md` อายุ ≤ 7 วัน (เกิน = ประเมิน RPO ที่ยอมรับก่อน)
- [ ] P2. Token ที่มีสิทธิ์: **D1 Edit + D1 Create** (สร้าง DB ชั่วคราว) + **R2 Object Read** (bucket `sao-recruitment-backups`) — drill ใช้ token ชั่วคราวและลบทิ้งหลังจบ
- [ ] P3. `cd backend && npx wrangler --version` ≥ 3.114.17
- [ ] P4. (ถ้า backup เข้ารหัส) private key GPG คู่กับ `BACKUP_GPG_RECIPIENT` พร้อมใช้
- [ ] P5. จดเวลาเริ่มต้น: ______ (เอาไว้วัด RTO จริง)

---

## Phase A — Restore Test Environment (เป้า ≈ 5-10 นาที)

> จุดจบของเฟส: มี database ใหม่ (`sao-db-restore-<TS>`) ที่ import dump ครบ และ (โหมดซ้อม) Worker drill ชี้มันอยู่

**A1. Download backup + ยืนยันก่อน import**

- [ ] A1.1 เลือกรอบ backup ล่าสุดที่ผ่าน (จาก Actions run สีเขียวล่าสุด / list R2)
- [ ] A1.2 `npx wrangler r2 object get sao-recruitment-backups/d1/daily/<YYYY>/<MM>/<DD>/manifest-<TS>.json --file /tmp/manifest.json && cat /tmp/manifest.json | jq .`
- [ ] A1.3 โหลด dump: `npx wrangler r2 object get "sao-recruitment-backups/d1/daily/<YYYY>/<MM>/<DD>/$(jq -r .file /tmp/manifest.json)" --file /tmp/dump.raw`
- [ ] A1.4 ถ้าไฟล์เป็น `.gpg`: `gpg --decrypt --output /tmp/dump.sql /tmp/dump.raw` — ผ่านโดยไม่มี warning
- [ ] A1.5 **`sha256sum /tmp/dump.sql` ต้องตรง `manifest.sha256` ทุกตัวอักษร** (ไม่ตรง = หยุด — dump เสีย กลับไปรอบ backup ก่อนหน้า)
- [ ] A1.6 `stat` ขนาดไฟล์ ตรง `manifest.size_bytes` ±0
- [ ] A1.7 `grep -q "CREATE TABLE.*applications" /tmp/dump.sql` พบ (ก่อนเสียเวลา import)

**A2. Restore ลง database ใหม่ (ห้าม restore ทับ prod เด็ดขาด)**

- [ ] A2.1 `npx wrangler d1 create sao-db-restore-<TS>` — จด `database_id` ที่ได้: ________________
- [ ] A2.2 `npx wrangler d1 execute sao-db-restore-<TS> --remote --file=/tmp/dump.sql -y` (wrangler แบ่ง statement เอง; **ห้าม** `migrations apply` — dump มี d1_migrations มาแล้ว)
- [ ] A2.3 (โหมดซ้อม) copy `backend/wrangler.toml` ชั่วคราว → แก้ `[[d1_databases]]` binding `DB` เป็น `database_id` จาก A2.1 **เฉพาะไฟล์ชั่วคราว** (ห้าม commit)
- [ ] A2.4 (โหมดซ้อม) `cd backend && npx wrangler deploy --name sao-recruitment-backend-drill` — จด URL drill: ________________
- [ ] A2.5 (โหมดซ้อม) ตั้ง secret ให้ Worker drill ครบเหมือน prod (อย่างน้อย `JWT_SECRET` — ขาดจะ fail ที่ /health/ready)

**จบเฟส A เมื่อ:** import ไม่ error + (โหมดซ้อม) deploy drill สำเร็จ

---

## Phase B — Database Validation (เป้า ≈ 5-10 นาที)

> เทียบทุกอย่างกับ `manifest.facts` ของรอบ backup นั้น — ไม่ใช่กับ prod ปัจจุบัน (prod โตต่อได้)

**B1. จำนวนแถวตรง baseline**

- [ ] B1.1 `npx wrangler d1 execute sao-db-restore-<TS> --remote --json --command "SELECT (SELECT COUNT(*) FROM applications) AS applications, (SELECT COUNT(*) FROM audit_logs) AS audit_logs, (SELECT COUNT(*) FROM attachment_uploads) AS attachment_uploads, (SELECT COUNT(*) FROM admin_users) AS admin_users, (SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1) AS migration_head"`
- [ ] B1.2 COUNT ทั้ง 4 ตาราง **ตรง manifest.facts ทุกตัว** (ไม่ตรง = import ไม่ครบ → กลับ A2.2)
- [ ] B1.3 `migration_head` ตรง `manifest.facts.migration_head` — ถ้าเก่ากว่าโค้ดที่จะ deploy: apply migration ที่ขาด**ก่อน**ขึ้น Phase D

**B2. ความถูกต้องเชิงเนื้อหา**

- [ ] B2.1 `SELECT MAX(submitted_at) FROM applications;` — ≤ เวลา backup และใกล้เคียง (RPO 24 ชม.)
- [ ] B2.2 เลือก application ล่าสุด 1 รายการ → `formData` parse เป็น JSON ได้
- [ ] B2.3 `PRAGMA foreign_key_check` — ผลว่าง (ถ้า D1 ปฏิเสธ PRAGMA ให้ผ่านด้วย B2.2 + app-level check ของ Phase C แทน)

**B3. Schema ครบ**

- [ ] B3.1 มี index `idx_apps_round_email` (migration 030 — กันสมัครซ้ำ) และ `idx_apps_round_submitted_sort` + `idx_apps_round_submitted_export` (031)
- [ ] B3.2 DDL ของ applications มี `chk_app_status` (`SELECT sql FROM sqlite_master WHERE name='applications'`)
- [ ] B3.3 **ไม่มี** `__old_*` tables (`SELECT name FROM sqlite_master WHERE name LIKE '%__old_%'` ว่าง) — เจอ = dump เก่าก่อน 030

**จบเฟส B เมื่อ:** B1-B3 ผ่านครบ — database ใช้งานได้ในระดับข้อมูล+โครงสร้าง

---

## Phase C — Application Validation (เป้า ≈ 10-15 นาที)

> พิสูจน์ "แอปทำงานกับข้อมูลที่ restore แล้ว" — ใช้ Worker drill (โหมดซ้อม) หรือ local `wrangler dev` ชี้ restore DB

- [ ] C1. `GET https://<drill-worker>.workers.dev/api/v1/health/ready` → **200**
- [ ] C2. Public lookup จริง 1 รายการ: `POST /api/v1/public/applications/lookup` ด้วย email + เลขใบสมัครที่มีจริง → พบข้อมูล (พิสูจน์ applications + formData + core fields)
- [ ] C3. Login admin จริง 1 บัญชี → ผ่าน (พิสูจน์ admin_users + bcrypt hash restore ครบ)
- [ ] C4. เข้าหน้า admin รายชื่อ → ตารางโหลด มีข้อมูล ตรงจำนวน B1 (list endpoint + pagination)
- [ ] C5. เปิดใบสมัคร 1 ใบ → ข้อมูลฟอร์มแสดงครบ (พิสูจน์ detail endpoint + formData)
- [ ] C6. (ถ้ามีไฟล์แนบในรอบ) เปิดไฟล์แนบ 1 รายการ → โหลดได้ — **ถ้า 404: ทราบว่า R2 แนบไม่ได้ถูก restore โดย drill นี้** (ดู `R2_ATTACHMENT_RECOVERY.md`) บันทึกอาการและถือว่า C6 เป็น "ทราบข้อจำกัด" ไม่ใช่ fail ของ D1 restore
- [ ] C7. PDF preview 1 ใบ → สร้างได้ (พิสูจน์ descriptor + template ครบ — PDF cache เก่าหายเป็นเรื่องปกติ เพราะสร้างซ้ำได้)
- [ ] C8. Export Excel 1 ครั้ง (รอบเล็ก) → ไฟล์โหลดได้ (พิสูจน์ path หลัง Sprint 3 ทำงานกับ DB restore ได้)

**จบเฟส C เมื่อ:** C1-C5 + C7-C8 ผ่าน (C6 ตามข้อจำกัดที่ระบุ) — สรุป: ข้อมูล restore ใช้งานได้จริงตั้งแต่ public ถึง admin

---

## Phase D — Cutover Validation (โหมดเหตุจริงเท่านั้น, เป้า ≈ 5 นาที)

> ⚠️ เฟสนี้เปลี่ยน production — ต้องมีผู้อนุมัติ sign-off และเวลา off-peak

**D1. เตรียมก่อนสลับ**

- [ ] D1.1 ผู้อนุมัติยืนยัน: ข้อมูลหลังเวลา backup ล่าสุด (≤ 24 ชม.) ยอมรับการสูญเสียได้ / หรือ Time Travel ใช้ไม่ได้กับกรณีนี้
- [ ] D1.2 แจ้งผู้ใช้ freeze: ปิดหน้า public apply (หรือประกาศช่วง maintenance) + แอดมินหยุดพิมพ์ข้อมูล
- [ ] D1.3 จดค่า `database_id` เดิมของ binding `DB` จาก `backend/wrangler.toml` (ใช้ rollback): ________________
- [ ] D1.4 ตรวจ diff ของ prod เทียบ restore: นับ applications ที่เกิดหลังเวลา backup (คือข้อมูลที่จะหาย) — ยอมรับโดยผู้อนุมัติ: ✓

**D2. สลับ**

- [ ] D2.1 แก้ `backend/wrangler.toml` binding `DB` → `database_id` ของ `sao-db-restore-<TS>` (commit เฉพาะบรรทัดนี้เพื่อ audit trail)
- [ ] D2.2 `cd backend && npx wrangler deploy` — frontend **ไม่ต้อง deploy ใหม่** (ชี้ API เดิม)
- [ ] D2.3 Smoke บน prod ทันที: `GET /api/v1/health/ready` = 200 + login admin ผ่าน + lookup ผู้สมัคร 1 รายการได้

**D3. หลังสลับ**

- [ ] D3.1 Unfreeze: เปิดหน้า apply กลับ
- [ ] D3.2 ตรวจ submit ทดสอบ 1 รายการ (หรือรอเหตุการณ์จริงรายการแรก) → ต้องเข้าและนับใน list
- [ ] D3.3 ตรวจ audit_logs เขียนได้ (เปิดหน้า audit ใน admin)
- [ ] D3.4 บันทึกเวลาจบ: ______ → RTO จริง = เวลาจบ − เวลาเริ่ม (P5): ______ นาที

**D4. Rollback (ถ้า D2.3 หรือ D3 fail)**

- [ ] D4.1 แก้ `wrangler.toml` binding `DB` กลับเป็น id เดิม (D1.3) → `npx wrangler deploy`
- [ ] D4.2 ยืนยัน /health/ready + login กลับมาปกติ แล้วไปวิเคราะห์สาเหตุต่อแบบ off-line

---

## เก็บกวาดหลังเสร็จ (ทั้งสองโหมด)

- [ ] ลบ Worker drill: `npx wrangler delete --name sao-recruitment-backend-drill`
- [ ] ลบ DB ชั่วคราว: `npx wrangler d1 delete sao-db-restore-<TS>` (ยืนยันชื่อก่อน Enter — ห้ามลบ sao-db)
- [ ] ลบ token ชั่วคราว (P2) ที่ใช้ drill
- [ ] คืน `wrangler.toml` จาก git (`git checkout -- backend/wrangler.toml`) ถ้ามีแก้ค้าง
- [ ] บันทึกผล drill ลงตารางด้านล่าง และอัปเดต RTO จริงใน `RESTORE_DRILL.md` §7

## บันทึกผล Drill (กรอกจริงทุกครั้ง)

| วันที่ | โหมด | Backup รุ่นที่ใช้ (TS) | เวลาเริ่ม | เวลาจบ | RTO จริง | เฟสที่ fail | บันทึก/ปัญหา |
|---|---|---|---|---|---|---|---|
| | | | | | | | |
