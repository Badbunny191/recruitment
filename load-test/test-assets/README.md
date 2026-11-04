# Test Assets

ไฟล์ทดสอบสำหรับอัปโหลดผ่านหน้าเว็บ — **ทุกไฟล์ขึ้นต้นด้วย `TEST-`**
(เงื่อนไขสำคัญ: cleanup ใช้ชื่อไฟล์นี้เป็นส่วนหนึ่งของ allowlist การลบใน R2)

| ไฟล์ | ชนิด | ใช้ทำอะไร |
|---|---|---|
| `TEST-resume.pdf` | PDF 1 หน้า (867 B) | อัปโหลดใน flow หลัก (ฟิลด์ `field-resume` — required) |
| `TEST-portfolio.pdf` | PDF 1 หน้า (761 B) | อัปโหลดเสริม (ฟิลด์ `field-portfolio` — optional, สุ่ม ~60%) |
| `TEST-idcard.png` | PNG 320×200 | ทดสอบ validation — ระบบจริง**ปฏิเสธ** (รับเฉพาะ PDF) |
| `TEST-photo.jpg` | JPEG | ทดสอบ validation — ระบบจริง**ปฏิเสธ** (รับเฉพาะ PDF) |

สร้าง/สร้างใหม่ด้วย:

```bash
node test-assets/generate-assets.mjs
```

ไฟล์ทั้งหมดสร้างโดยโปรแกรม (ไม่มีข้อมูลจริงของบุคคลใด) — PDF/PNG เขียน byte เอง, JPEG เป็น minimal baseline
