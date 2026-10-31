# Recoverability Review — ระบบกู้คืนได้แค่ไหน

> **Sprint 2 — Task 7** | วันที่: 2026-10-31 | Branch: `feature/sprint2-recoverability-and-pdf`
>
> ตรวจโดยมุม "ถ้าเกิด X แล้วกู้ยังไง" ครบ 5 สถานการณ์ตามโจทย์ อ้างอิง: โครงสร้างจริงของ repo, `docs/D1_BACKUP_AND_RESTORE_PLAN.md`, `docs/RUNBOOK_INCIDENT_RESPONSE.md`, `docs/SECURITY_SWEEP_REPORT.md`, และงานของ sprint นี้ (backup workflow + restore drill)

---

## 0. คะแนนสรุป

| มิติ | ก่อน sprint นี้ | หลังเปิดใช้ backup ของ sprint นี้ |
|---|---|---|
| Current State (recoverability โดยรวม) | **3.5/10** | **6/10** |
| Recovery Readiness (พร้อมหน้างานเมื่อเกิดเหตุ) | 3/10 | 5.5/10 |
| หมายเหตุ | พึ่ง Time Travel 30 วันเท่านั้น — ไม่มี backup อัตโนมัติใด ๆ (`D1_BACKUP_AND_RESTORE_PLAN.md:244`) | D1 มี 2 ชั้น แต่ **R2 ไฟล์แนบยังศูนย์** และ backup จะทำงานจริงเมื่อตั้ง secrets แล้วเท่านั้น |

**เงื่อนไขสำคัญที่สุดของทั้งเอกสาร:** workflow `.github/workflows/d1-backup.yml` จะไม่ทำอะไรเลยจนกว่าจะตั้ง secrets (`CF_ACCOUNT_ID`, `CF_BACKUP_API_TOKEN`, แนะนำ `BACKUP_GPG_RECIPIENT`) — คะแนนหลังเปิดใช้ใช้ได้เมื่อขั้นตอน §7 ของ `D1_BACKUP_AUTOMATION.md` เสร็จจริง

---

## 1. สถานการณ์ A — Cloudflare Worker พัง

**คำตอบสั้น:** กู้ด้วย rollback ภายในนาที D1 ไม่ถูกกระทบจากการ rollback (`RUNBOOK_INCIDENT_RESPONSE.md:277`)

| กรณีย่อย | วิธีกู้ | เวลา (ประเมิน) |
|---|---|---|
| Deploy ล่าสุดทำระบบพัง | `cd backend && npx wrangler rollback` (ย้อนไป deployment ก่อนหน้า) | < 2 นาที |
| Runtime crash-loop ของโค้ดเดิมที่วิ่งมานาน | หา commit เก่าที่ดี → `git checkout <sha> && npx wrangler deploy` | 5-10 นาที |
| ลืม secret / secret พัง | แก้ใน dashboard (Workers → sao-recruitment-backend → Settings → Variables) หรือ `npx wrangler secret put <NAME>` | < 5 นาที |

- Frontend (Pages Git Integration): Pages dashboard → Deployments → **Instant rollback** ไป deployment ก่อน หรือ `git revert` + push (auto-deploy)
- **ช่องว่าง:** ไม่มี staging environment (deploy ตรง prod จากเครื่อง dev); คำสั่ง deploy ฝั่ง frontend ใช้ `--commit-dirty=true` (`frontend/package.json:49`) ทำให้ artifact อาจไม่ตรง git ทั้งหมด
- **ความพร้อม: สูง (7/10)** — แผนเขียนไว้แล้วใน runbook, การ rollback ของ Workers/Pages เป็นความสามารถแพลตฟอร์ม

## 2. สถานการณ์ B — D1 Database เสีย

**คำตอบสั้น:** 3 ชั้น — (1) Time Travel 30 วัน แม่นระดับวินาที, (2) backup รายวันบน R2 90 วัน (sprint นี้), (3) manual export ก่อน migration (ปฏิบัติอยู่แล้วตั้งแต่ 029/030)

| กรณีย่อย | เส้นทาง | RPO | RTO (ประเมิน) |
|---|---|---|---|
| ข้อมูลเสียเมื่อไม่กี่ชม./วัน (migration พลาด, ลบผิด) | `wrangler d1 time-travel restore sao-db --timestamp=...` + checklist §8 ของ RESTORE_DRILL | ~0 | 10-20 นาที |
| DB เสียเกิน 30 วัน / restore ย้อนหลายวัน | Backup จาก R2 → restore ลง DB ใหม่ → สลับ binding → deploy | ≤ 24 ชม. | 15-75 นาที (RESTORE_DRILL §7) |
| ตารางเดียวพัง / ข้อมูลชุดเดียวหาย | ดึงจาก dump เดียวกันด้วย filter (แผนเดิมระบุไว้ `D1_BACKUP_AND_RESTORE_PLAN.md:174`) | ≤ 24 ชม. | 10-30 นาที |

- **สิ่งที่อ่อน:** จนถึงวันนี้ (ก่อนตั้ง secrets) มีแค่ Time Travel + manual export — เหตุที่ทำข้อมูลเสียเงียบ ๆ แล้วพบวันที่ 35 จะไม่มีอะไรให้กู้เลยนอกจาก Time Travel ลึกสุด 30 วัน
- **ความพร้อม: ปานกลาง (5/10 วันนี้ → 7.5/10 เมื่อ backup ทำงานจริง + ซ้อม drill 1 ครั้ง)**

## 3. สถานการณ์ C — R2 หายบางไฟล์

**คำตอบสั้น:** แยกสองประเภท — PDF cache กู้ได้เอง, **ไฟล์แนบผู้สมัครกู้ไม่ได้ (ช่องว่างใหญ่ที่สุดของระบบ)**

| ประเภทไฟล์ | ลักษณะ | กู้ยังไง |
|---|---|---|
| `pdf/applications/*/v3.pdf` (PDF cache) | สร้างซ้ำได้จาก D1+descriptor | ลบทิ้งได้เลย — request ถัดไป render ใหม่ (`pdf.service.ts:58-144`) — ไม่ต้องกู้ |
| ไฟล์แนบใบสมัคร (`sao-storage/...`) — เอกสารแนบจริงของผู้สมัคร | upload ครั้งเดียว, ledger `attachment_uploads` เก็บ metadata แต่**ไม่มี copy ที่สอง**, R2 ไม่เปิด versioning/replication | **ไม่มีทางกู้จากระบบเรา** — ต้องพึ่งความทนทานของ R2 เอง (ซึ่ง Cloudflare รับประกัน redundancy ภายใน แต่ไม่ป้องกัน: ลบผิดพลาดโดยมนุษย์/โค้ด, account-level issue, โดนลบผ่าน API token ที่หลุด) |
| ไฟล์ BACKUP ที่อัปโหลดใหม่ (bucket `sao-recruitment-backups`) | copy แรกของ D1 | อยู่ bucket แยก ไม่มี lifecycle กว่า 90 วัน |

- โค้ดที่ลบ R2 มี 3 จุด: PDF cache invalidation (`pdf-cache-invalidation.ts:81,106`), GC TEMP attachments (`attachment-cleanup.ts:65`), applicant ลบไฟล์ตัวเอง (`upload.routes.ts:323`) — ทั้งหมด scoped key ชัดเจน ความเสี่ยง "ลบกว้าง" ต่ำ แต่ผิดพลาดจาก token รั่ว/มนุษย์ใน dashboard ยังเป็นไปได้
- **ความพร้อม: ต่ำสุด (2/10)** — ข้อแนะนำด่วน: (ก) คัดลอกไฟล์แนบ ACTIVE ออก bucket/account ที่สอง (rclone ผ่าน S3-API token อ่านอย่างเดียว รันทุกคืนคู่กับ d1-backup — เสนอเป็นงานถัดไป), (ข) เปิด R2 object versioning บน `sao-storage` ถ้าราคายอมรับได้

## 4. สถานการณ์ D — Deploy พลาด

**คำตอบสั้น:** ครอบคลุมโดยสถานการณ์ A — จุดพิเศษคือ "deploy พลาดแบบครึ่ง ๆ กลาง ๆ" (โค้ดใหม่ + schema เก่า หรือกลับกัน)

| กรณีย่อย | วิธีกู้ |
|---|---|
| Deploy แล้ว runtime error ทันที | `wrangler rollback` (backend) / Pages instant rollback (frontend) |
| Deploy โค้ดที่ต้องใช้ migration ใหม่ แต่ลืม apply | ระบบจะ error ที่ query — แก้โดย apply migration ตามลำดับ (`MIGRATION_GOVERNANCE.md`); rollback worker ถ้าต้องกลับเร็ว |
| Migration apply พลาดครึ่งทาง | wrangler d1 migrations apply atomic ต่อไฟล์ (ล้ม = rollback ไฟล์นั้น — พิสูจน์จาก comment 031) + มี Time Travel + มีนิติ pre-migration export บังคับ |
| Frontend deploy artifact เพี้ยน | Pages rollback + แก้ root cause (`--commit-dirty=true` ควรเลิกใช้) |

- **ช่องว่าง:** ไม่มี staging → ทุก deploy โดน prod ตรง ๆ; CI รันแค่ typecheck+test ไม่ได้ build (`ci.yml:8-11` ห้าม deploy ชัดเจน — ดีต่อความปลอดภัยแต่แปลว่า deploy path ทั้งหมดอยู่บนเครื่อง dev)
- **ความพร้อม: ปานกลาง-สูง (6/10)**

## 5. สถานการณ์ E — Developer ไม่อยู่

**คำตอบสั้น:** ความเสี่ยง bus factor สูงสุด — แต่ระบบเอกสารดีขึ้นมากต่อเนื่อง

| ทรัพยากร | สถานะ | ถ้าคนเดียวที่รู้หายไป |
|---|---|---|
| โค้ด + docs | GitHub `Badbunny191/recruitment` + docs/ ครบเครื่อง (runbook, migration governance, drill, audit) | ✓ ต่องานได้จากเอกสาร |
| Deploy backend | มือจากเครื่อง dev (`wrangler deploy`) — ไม่มี CI deploy | ✓ ใครที่มี CF access + repo ก็ deploy ได้ (ขั้นตอนอยู่ใน README) |
| **การเข้าถึง Cloudflare account** (`Thanet30@gmail.com's Account`, id 05621e...) | ไม่มีหลักฐานว่ามี escrow/ผู้มีสิทธิ์สำรอง | ✗ **จุดตายเดียวขององค์กร** — ถ้าบัญชีนี้เข้าไม่ได้ ทั้ง Workers/D1/R2/Pages ทำอะไรไม่ได้เลย |
| **Secrets** (JWT_SECRET, TURNSTILE_SECRET_KEY, GPG private key อนาคต) | อยู่ใน CF dashboard/.dev.vars เฉพาะเครื่อง — ไม่มี vault | ✗ สูญหายพร้อมคน |
| GitHub Actions backup (sprint นี้) | ทำงานเองใน repo — ไม่พึ่งเครื่องใคร | ✓ (ถ้า secrets ถูกตั้งแล้ว) |
| ความรู้โดเมน | docs/ ครอบสถาปัตยกรรม+ประวัติการตัดสินใจดีมากตั้งแต่เดือน 10 | ✓ |

- **ความพร้อม: ต่ำ (3/10)** — ข้อแนะนำ: (ก) ตั้งผู้ดูแลร่วม/อีเมล recovery บนบัญชี Cloudflare และ 2FA recovery codes เก็บที่ปลอดภัย, (ข) escrow secrets ใน password manager องค์กร (JWT_SECRET, CF token list, GPG private key คู่กับ backup), (ค) เขียน "1 หน้า: ใครมีสิทธิ์อะไรบนอะไร" ไว้ใน docs

---

## 6. RTO / RPO สรุปรวม (หลังเปิดใช้ backup แล้ว)

| สถานการณ์ | RPO | RTO |
|---|---|---|
| A Worker พัง | 0 | < 10 นาที |
| B D1 เสีย (ใกล้) | ~0 (Time Travel) | 10-20 นาที |
| B D1 เสีย (จาก backup) | ≤ 24 ชม. | 15-75 นาที |
| C R2 ไฟล์แนบหาย | — | **ไม่มีแผน (ช่องว่าง)** |
| D Deploy พลาด | 0 | < 10 นาที |
| E Developer ไม่อยู่ | — | ขึ้นกับการเข้าถึง account — **ไม่มีแผนเชิงบุคคล** |

## 7. Recommendations (จัดลำดับ)

1. **[ทำทันที, ~30 นาที]** ตั้ง secrets ให้ `d1-backup.yml` + รันครั้งแรก + ยืนยัน object จริงบน R2 (§7 ของ D1_BACKUP_AUTOMATION) — จนกว่าจะทำ ระบบยังอยู่สถานะ "ไม่มี backup"
2. **[1 สัปดาห์]** Backup ไฟล์แนบ ACTIVE จาก `sao-storage` ไปปลายทางที่สอง (rclone ทุกคืน หรือ R2 replication) — ปิดสถานการณ์ C
3. **[1 สัปดาห์]** Escrow การเข้าถึง: CF recovery + 2FA codes, GitHub, secrets ลง vault; กำหนดผู้ดูแลสำรอง ≥1 คน — ปิดสถานการณ์ E
4. **[ทุกเดือน]** รัน Restore Drill §1-5(ก) จริง 1 ครั้ง แล้วบันทึกเวลาจริงลง RESTORE_DRILL §7
5. **[เมื่อมีเวลา]** Staging environment (Worker/Pages ชุดที่สอง) + เลิก `--commit-dirty=true` — ลดโอกาสเกิดสถานการณ์ D
6. **[การตัดสินใจเจ้าของระบบ]** Rewrite git history เพื่อลบ PII (`full_backup.sql` ฯลฯ — SECURITY_SWEEP C-1) — backup workflow ใหม่ออกแบบให้ dump ไม่เคยแตะ git แล้ว แต่ประวัติเดิมยังค้าง
7. **[เมื่อเปิด email]** ให้ email notification แจ้ง backup failure เป็น use case แรก (`EMAIL_NOTIFICATION_RECOMMENDATION.md`)
