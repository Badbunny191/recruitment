# R2 Attachment Recovery Review — ไฟล์แนบผู้สมัครกู้คืนได้แค่ไหน

> **Sprint 3 — Task 6** | วันที่: 2026-10-31 | Branch: `feature/sprint3-backup-activation`
>
> วิเคราะห์จากข้อมูล prod จริง (วัด read-only ผ่าน `wrangler d1 execute` วันที่ 2026-10-31)
> ตอบ 4 คำถามของโจทย์: backup หรือยัง / หายแล้วกู้ได้ไหม / ต้อง replication ไหม / ต้นทุนเท่าไร

---

## คำตอบสั้น 4 คำถาม

| คำถาม | คำตอบ |
|---|---|
| 1. Attachment ปัจจุบัน backup หรือยัง? | **ยัง** — `d1-backup.yml` ที่เปิดใช้ sprint นี้ dump เฉพาะ D1 ไฟล์แนบบน R2 bucket `sao-storage` ยังไม่มี copy ที่สองใด ๆ |
| 2. ถ้า R2 object หาย กู้ได้หรือไม่? | **กู้ไม่ได้จากระบบเรา** — หลังผู้สมัคร submit แล้วไฟล์มี copy เดียว; สิ่งที่เหลือคือความทนทานภายในของ R2 (redundancy ระดับ hardware แบบ 11 nines) เท่านั้น — ไม่ครอบคลุมการลบผิดพลาด/ลบโดย token รั่ว/ปัญหาระดับ account |
| 3. ต้องใช้ replication หรือไม่? | **ควรมี copy ที่สอง แต่ replication ไม่ใช่ตัวเลือกแรก** — แนะนำ rclone ทุกคืนไป destination **นอก account** (ปิดทั้งกรณีลบผิดพลาดและ account-level); R2 bucket replication ใน account เดิมช่วยแค่ jurisdiction ไม่ช่วยกรณี account โดนโจมตี |
| 4. ต้นทุน? | **≈ 0 บาทในระดับปัจจุบันและระดับที่คาดการณ์** (รายละเอียด §4) — อุปสรรคจริงคือ "ต้องลงมือทำ" ไม่ใช่เงิน |

---

## 1. สถานะปัจจุบัน (วัดจริง 2026-10-31)

**ข้อมูล prod:**

| แหล่ง | ค่าที่วัด | หมายเหตุ |
|---|---|---|
| `attachment_uploads` ledger | ACTIVE = **1**, DELETED = 10, TEMP = 2 | ผ่าน `SELECT status, COUNT(*)` บน prod |
| `application_attachments` | **0 แถว** (ทั้งตาราง) | ไม่มีไฟล์ผูกกับใบสมัครใดยัง |
| ACTIVE 1 ตัว | `application_id = NULL`, key `uploads/documents/2026/<uuid>-…pdf` | ยังไม่ถูก promote เข้าใบสมัครใด |
| ขนาด D1 ทั้งฐาน | 765,952 bytes (≈ 0.75 MB) | meta.size_after |

**การตีความ:** ระบบเพิ่ง go-live ไฟล์แนบจริงที่อยู่รอดคือ **1 object** (อีก 12 เป็นไฟล์ทดสอบที่ถูกลบ/รอ GC 7 วัน) — ความเสี่ยงวันนี้ต่ำมาก **แต่** ทุกใบสมัครที่เข้ามาใหม่จากนี้จะเพิ่มไฟล์แนบที่กู้ไม่ได้ถ้าไม่มี copy ที่สอง จึงถูกต้องที่จะแก้ "ก่อน" ปริมาณโต

**กลไกที่มีอยู่ (เกี่ยวข้องกับการหายของไฟล์):**

- Cron GC รายวัน (01:00 ICT, `backend/wrangler.toml` crons) ลบเฉพาะ `status='TEMP'` อายุ > 7 วัน (`attachment-cleanup.ts`) — scoped ชัดเจน
- ผู้สมัครลบไฟล์ตัวเองได้เฉพาะ TEMP ด้วย delete token (`upload.routes.ts`)
- PDF cache invalidation ลบเฉพาะ key `pdf/…` (`pdf-cache-invalidation.ts`) — ต่าง prefix จากแนบ
- **ทุกจุดลบเป็น key-level ไม่มีจุดลบกว้างในโค้ด** — ความเสี่ยงที่เหลือจึงมาจาก "นอกโค้ด": มนุษย์ใน dashboard, API token รั่ว, account-level incident

## 2. ถ้า object หาย — กู้ยังไง แยกตามสาเหตุ

| สาเหตุที่ไฟล์หาย | กู้จากไหนได้ | สรุป |
|---|---|---|
| ผู้สมัครลบเอง (TEMP, มี token) | ไม่มี — ตั้งใจ (ผู้สมัครไม่ควรลบของที่ submit ไปแล้วได้อยู่แล้ว เพราะ ACTIVE ลบผ่านแอปไม่ได้) | by design |
| โค้ด/มนุษย์ลบผิด key เดียว | ไม่มี copy ที่สอง | **กู้ไม่ได้** |
| Token รั่ว → ลบเป็นชุด | ไม่มี copy ที่สอง (R2 ไม่เปิด versioning บน `sao-storage`) | **กู้ไม่ได้** |
| Bucket/account-level หาย | ไม่มี (bucket `sao-storage` ไม่มี replication) | **กู้ไม่ได้** |
| Disk/corruption ภายใน Cloudflare | R2 internal redundancy (11 nines durability) | ครอบกรณีนี้เท่านั้น |

**ช่องโหว่เชิงตรรกะที่ควรรู้:** ไฟล์แนบผูกกับใบสมัครผ่าน `application_attachments.fileUrl` (และ formData) — ตารางนี้ **อยู่ใน D1 dump** ดังนั้นหลัง restore D1 ระบบ "จะยังชี้ไปหาไฟล์ที่หาย" แบบรู้ตัวว่า key อะไรขาด ทำให้เช็กความครบถ้วนหลัง restore ทำได้ (compare ledger vs R2 list) — แต่ข้อมูลเองกู้กลับไม่ได้

## 3. ต้องใช้ replication หรือไม่ (ทางเลือก + คำแนะนำ)

| ทางเลือก | กันอะไรได้ | กันไม่ได้ | ประเมิน |
|---|---|---|---|
| **A. rclone ทุกคืน → destination นอก account** (B2 / S3 / R2 ของ account ที่สอง) | ลบผิดพลาด, token รั่ว, account โดนโจมตี, jurisdiction | เหตุในช่วง 24 ชม. (RPO = 1 วัน) | **แนะนำ** — ปิดกรณีเสี่ยงจริงทั้งหมด; ต่อยอดเป็น step ใน `.github/workflows` ชุดเดียวกับ d1-backup ได้ (S3-compatible credentials + rclone, ไม่พึ่งเครื่องใคร) |
| B. R2 bucket replication (`sao-storage` → bucket ที่สอง, คนละ jurisdiction, account เดิม) | ภัยระดับ bucket/region | **account-level ทั้งหมด** (token รั่ว ลบได้ทั้งสอง bucket เพราะ token เดียวกัน) | ตั้งง่ายที่สุด แต่ครอบคลุมน้อยกว่า A อย่างมีนัยสำคัญ |
| C. R2 object versioning บน `sao-storage` | ลบผิดพลาด/ลบเป็นชุด (noncurrent versions กู้ได้) | account-level; ต้องมี lifecycle purge ไม่งั้น noncurrent กองโต | ดีเป็นชั้นเสริมร่วมกับ A — ไม่พอตัวเดียว |
| D. ไม่ทำอะไร | — | — | ยอมรับได้**เฉพาะตอนนี้** (ไฟล์จริง 1 ตัว) — ไม่ยอมรับได้เมื่อรอบจริงเริ่มมีผู้สมัครแนบเอกสาร |

**คำแนะนำ (เรียงลำดับ):** A ก่อน (ปิดช่องใหญ่สุดด้วยต้นทุน 0), พิจารณา C เสริมเมื่อปริมาณไฟล์เริ่มจริงจัง, B ไม่จำเป็นถ้ามี A
รายละเอียดเส้นทาง implement A อยู่ใน `D1_BACKUP_AND_RESTORE_PLAN.md` §Scope (S3 API token อ่านอย่างเดียว + rclone) — เสนอเป็นงานเปิด sprint ถัดไป

## 4. ต้นทุน (ราคา R2 ปัจจุบัน, 2026)

ราคา: storage **$0.015/GB-เดือน** (ฟรี 10 GB-เดือนแรก), Class A (เขียน/list) $4.50/ล้าน ops, Class B (อ่าน) $0.36/ล้าน ops, **egress ฟรี**

| สเกล | สมมติฐาน | Storage/เดือน | Ops/เดือน (sync รายคืน) | รวม |
|---|---|---|---|---|
| **ปัจจุบัน** (1 ACTIVE object) | ~1 MB | $0 (อยู่ใน free tier) | $0 | **≈ $0** |
| รอบจริงรอบแรก (500 ใบ × 2 ไฟล์ × 2 MB) | ~2 GB | $0 (free tier) | ~$0.01 (Class A ~15k/เดือน) | **≈ $0-0.01** |
| ระบบโตเต็มปี (5 รอบสะสม + retention 90 วัน) | ~10-20 GB | $0.15-0.30 (+ เท่าตัวถ้ามี copy ที่สองบน R2) | <$0.05 | **≈ $0.30-0.70** |
| กรณีสมมติขนาดใหญ่มาก (10,000 ใบ × 2 MB สะสม) | ~20-40 GB | $0.30-0.60 ×2 ถ้ามี replica | <$0.10 | **≈ $1/เดือน** |

ถ้าใช้ปลายทางนอก Cloudflare (เช่น B2 $0.006/GB-เดือน) ต้นทุน storage copy ที่สองยิ่งต่ำกว่านี้ และไม่มีค่า egress จาก R2 ออก — สรุป: **ต้นทุนไม่ใช่ข้อจำกัดของงานนี้เลยในทุกสเกลที่เป็นไปได้**

## 5. สิ่งที่เอกสารนี้ตัดสินแทนผู้บริหารไม่ได้

1. เลือก destination นอก account (ทีมต้องตัดสิน vendor + ใครถือ credentials)
2. RPO ของไฟล์แนบที่ยอมรับ (24 ชม. จาก nightly sync พอไหม)
3. กำหนดการ: ควรเปิด copy ที่สอง **ก่อนรอบรับสมัครแรกที่มีผู้สมัครจริงแนบเอกสารจำนวนมาก**
