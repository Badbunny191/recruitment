# Email Notification Recommendation

> **Sprint 2 — Task 6** | วันที่: 2026-10-31 | Branch: `feature/sprint2-recoverability-and-pdf`
>
> **สถานะ: Discovery only — ห้าม implement ตามข้อกำหนดของ sprint**

---

## 1. สถานะปัจจุบันของระบบ (พิสูจน์จากโค้ด)

**ไม่มีการส่ง email ใด ๆ ทั้งระบบ** — หลักฐาน:

- ไม่มี email library ใน dependency ทั้ง backend/frontend (ค้น `nodemailer|resend|postmark|smtp|mailchannels` ใน `backend/package.json`, `backend/src`, `frontend/package.json` = 0 ผล)
- ฟอร์มสมัครเก็บ email ผู้สมัคร (`applications.email`) ใช้เพื่อ lookup และกันสมัครซ้ำ (index 030) เท่านั้น — ไม่มีตาราง/คิว/flag ของการแจ้งเตือน
- รหัสผ่านแอดมิน: `POST /admin/users/:id/reset-password` (`backend/src/routes/admin.routes.ts:4427-4474`) สร้าง temp password แล้ว**คืนใน HTTP response ครั้งเดียว** ให้ SUPER_ADMIN ส่งต่อผู้ใช้นอกระบบ — ไม่มี self-service "ลืมรหัสผ่าน"
- ตาราง `password_reset_tokens` สร้างไว้ใน migration 020_auth_hardening แต่**ไม่มีโค้ดใดอ้างถึง** (ค้นทั้ง schema import และ routes = 0) — เป็นเสาหลังบ้านรอเตรียม flow อนาคต

## 2. Use Cases ตามโจทย์ พร้อมจุดแทรกในโค้ด (สำหรับวันที่จะทำจริง)

| # | Use case | จุดแทรก (file:line ของ handler วันนี้) | หมายเหตุ |
|---|---|---|---|
| 1 | สมัครสำเร็จ (ใบเลข + ลิงก์ lookup) | `public.routes.ts:794-838` หลัง insert สำเร็จคืน 201 | ต้องไม่ชะลอ submit — ส่งแบบ `ctx.waitUntil` หลังตอบ client |
| 2 | เปลี่ยนสถานะ (ผ่าน/ไม่ผ่าน/นัดสัมภาษณ์) | `admin.routes.ts` PATCH application + bulk-status (`:2674-2778` แถว) | กลุ่มเป้าเป็นชุด — ต้องมี rate/quota ต่อรอบ และ template ไทยชัดเจน |
| 3 | Reset password | อนาคต: เปิด self-service ใช้ `password_reset_tokens` (มีโครงอยู่แล้ว) พร้อมลิงก์อายุสั้น | ใช้ email ที่ล็อกอินด้วยเท่านั้น; flow ปัจจุบัน (แอดมินส่งรหัสเอง) ยังใช้ได้โดยไม่ต้องมี email |
| 4 | Admin notification | เหตุ: มีผู้สมัครใหม่/รอบปิดในไม่ช้า/attachment GC ล้มเหลว | อย่างต่ำต้องแจ้ง "backup workflow fail" ของ Task 4 (ช่องทางเสริม GitHub notification) |

**ข้อกำหนดทางกฎหมายที่ต้องวางก่อนเปิดใช้ (PDPA):** consent ตอนกรอกฟอร์ม + unsubscribe ในทุกฉบับ — ปัจจุบันไม่มีระบบ consent เลย (ตาม roadmap audit) จึงควรเริ่มจาก use case 1 (transactional ที่จำเป็นต่อการใช้บริการ) ไม่ใช่การตลาด

## 3. เปรียบเทียบ Provider (ข้อมูล 2026-10-31)

| เกณฑ์ | **Resend** | Postmark | SES | MailChannels |
|---|---|---|---|---|
| เข้ากันกับ Cloudflare Workers | ✓ เป็นทางการ (REST/fetch, guide ของ Cloudflare เอง) | ✓ REST/fetch | ✓ REST/fetch (SMTP ไม่ใช้บน Workers ได้) | ✗ **ปิดฟรีตั้งแต่ 30 มิ.ย. 2024** |
| Free tier | 3,000 ฉบับ/เดือน (จำกัด **100/วัน**, 1 domain) | 100 ฉบับทดสอบ/เดือน | 62,000/เดือน **เฉพาะส่งจาก EC2** (ไม่ใช่ Workers) → จาก Workers คิดเงินตั้งแต่ฉบับแรก | — |
| ราคาต่อ 10,000 ฉบับ (paid) | ~$4 ($20/เดือน ครอบ 50k) | $15 (แพ็กเกจ 10k) | **$1** ($0.10/1k) | — |
| Deliverability | ดี (ต้อง verify domain + DKIM/SPF) | **ดีที่สุด** เชิง transactional, คุมมาตรฐานเข้ม | ดี แต่ account ใหม่ติด sandbox ต้องขอยกเว้น + warm-up | — |
| Complexity ติดตั้ง | ต่ำสุด (สร้าง API key + verify domain, ~ครึ่งวัน) | ต่ำ | กลาง (AWS account, IAM policy, ขอออก sandbox) | — |
| ความเสี่ยง lock-in | ต่ำ (REST ธรรมดา ย้ายง่าย) | ต่ำ | กลาง | — |
| เหมาะกับ | **ผู้ส่งรายเล็ก-กลางที่ใช้ Workers** | องค์กรที่ต้องการ deliverability สูงสุดและยอมจ่าย | ผู้ส่งรายใหญ่/ราคาถูกสุด | ไม่มีใคร |

ข้อเท็จจริงอ้างอิง: MailChannels ประกาศยุติ API ฟรีสำหรับ Workers ตั้งแต่ 30 มิ.ย. 2024 (บล็อกทางการ MailChannels); ราคา Resend: Free 3k/เดือน (100/วัน), Pro $20/เดือน 50k (เว็บไซต์ Resend pricing); Postmark $15/เดือน 10k; SES $0.10/1,000 ฉบับ (ราคาเผยแพร่ของ AWS) — ตัวเลขควรตรวจซ้ำวันตัดสินใจจริง

## 4. ประมาณการปริมาณของระบบนี้

ระบบรับสมัครงานระดับ อปท./หน่วยงาน — รอบหนึ่งสิบ ๆ ถึงร้อย ๆ ใบ (ขนาด D1 วันนี้ ~20 แถว applications):

- สมัครสำเร็จ: ≈ 1 ฉบับ/ใบ → รอบ 200 ใบ = 200 ฉบับ
- เปลี่ยนสถานะ: ≈ 1-3 ฉบับ/ใบ/รอบ
- รวมทั้งปี (สมมติ 6 รอบ × 200 ใบ): **ประมาณ 1,000-4,000 ฉบับ/ปี** → อยู่ใน free tier ของ Resend สบาย (แต่ระวังเพดาน 100 ฉบับ/วันตอนประกาศผลพร้อมกันทั้งรอบ)

## 5. Recommendation

**เลือก Resend** เป็น provider แรก เหตุผล:

1. free tier ครอบปริมาณจริงของระบบ (§4) — ต้นทุน 0 จนกว่าจะเกิน 3,000 ฉบับ/เดือน
2. Workers-native (fetch) ติดตั้งครึ่งวัน, ไม่ต้องเปิด AWS account ใหม่, ไม่ต้องขอออก sandbox
3. ย้ายออกง่ายในอนาคต (REST ธรรมดา — ถักเปียเป็น `email.service.ts` เดียว มี interface `sendEmail()` กัน provider lock-in)

**ลำดับถัดไปถ้าโต:** เกิน 50k/เดือน หรือต้นทุนกลายเป็นประเด็น → ย้ายไป **SES** ($0.10/1k ถูกสุด) ผ่าน interface เดิม; ถ้าเจอปัญหา deliverability เชิงธุรกิจ (ตกกระต๋อย) → พิจารณา **Postmark**

**ไม่พิจารณา MailChannels** (ปิดบริการฟรีกับ Workers แล้ว)

**แผนหยาบเมื่อได้รับอนุมัติ (ยังไม่ทำ):** 1) verify domain + DNS SPF/DKIM ครึ่งวัน, 2) `email.service.ts` + retry/waitUntil ครึ่งวัน, 3) hook use case 1 วัน, 4) hook use case 2 + เทมเพลตไทย 1 วัน, 5) consent checkbox + unsubscribe 1 วัน — รวม ~4 วัน
