# SAO Recruitment — Load Test Report

- **Round:** bb5a0d6f-37c1-4bcb-ad8d-61b98d2c3eca — "[TEST] Load Test 250 Users"
- **Target:** remote → https://sao-recruitment-frontend.pages.dev
- **เริ่ม:** 2026-11-04T18:17:21.594Z  |  **จบ:** 2026-11-04T18:18:06.284Z  |  **รวมเวลา:** 45 s
- **ผู้สมัครจำลอง:** 250 คน (batch 50 คน/batch, think-time 0-0 วิ/คน)

## 1. ผลรวม (Total / Success / Failed)

| ตัวชี้วัด | ค่า |
|---|---|
| Total users | **250** |
| Success | **250** (100.0%) |
| Failed | **0** (0.0%) |
| Skipped (ไม่ได้รัน — หยุดก่อนกำหนด) | 0 |
| เหตุการณ์ Rate limit (HTTP 429) | 0 |
| Turnstile บล็อกการทดสอบ | ไม่มี |

## 2. Response Time (เฉพาะที่สำเร็จ)

| ตัวชี้วัด | Submit API | รวมทั้ง flow (เปิดเว็บ→ส่ง) |
|---|---|---|
| Average | 799 ms | 7.8 s |
| Fastest | 507 ms | 5.1 s |
| Slowest | 1101 ms | 10.4 s |
| Median (p50) | 779 ms | 7.9 s |
| p95 | 1028 ms | 8.7 s |

**ช้าสุด:** TEST-000161 (10.4 s) · ธนกฤต ใจดี
**เร็วสุด:** TEST-000128 (5.1 s) · กัญญาณัฐ ศรีสุวรรณ

## 3. Upload Summary (ไฟล์แนบ)

| ตัวชี้วัด | ค่า |
|---|---|
| ครั้งที่พยายามอัปโหลด | 399 |
| อัปโหลดสำเร็จ | 399 (100.0%) |
| อัปโหลดล้มเหลว | 0 |

> ระบบจริงรับเฉพาะ PDF — flow ใช้ TEST-resume.pdf / TEST-portfolio.pdf (ดู TODO.md ข้อ 3 สำหรับ JPG/PNG)

## 4. Search / Export / PDF / Dashboard

> ยังไม่มีผล admin checks — รัน `npm run loadtest:check` ก่อนสร้างรายงานฉบับเต็ม

## 5. Error Summary

ไม่มี error 🎉

## 6. Screenshot เมื่อเกิด Error

ไม่มี

## 7. Performance Summary

| ตัวชี้วัด | ค่า |
|---|---|
| Throughput เฉลี่ย (ที่สำเร็จ) | 333.3 ใบสมัคร/นาที |
| ขนาด batch | 50 คน (พร้อมกันสูงสุด) |
| เวลาเฉลี่ยขั้น "กรอกฟอร์ม" | 1.3 s |
| เวลาเฉลี่ยขั้น "อัปโหลดไฟล์" | 1.6 s |
| เวลาเฉลี่ยขั้น "submit" | 799 ms |
| เวลารอ Turnstile เฉลี่ย | 0.0 s (0/250 คน รอผู้ใช้คลิกเองแบบ headed) |
| 429 ที่ retry สำเร็จ | 0 user |

## 9. ข้อจำกัดของการทดสอบนี้ (โปรดอ่านก่อนสรุป)

1. ทดสอบจาก **IP เดียว** — rate limit 5 req/min/IP ของระบบ (submit + upload) จึงตีค่า 429 สูงกว่าผู้ใช้จริงที่กระจาย IP; ตัวเลข 429 ในรายงานคือเพดานล่างของความจุฝั่งระบบ ไม่ใช่ปริมาณผู้ใช้พร้อมกันสูงสุดจริง
2. ระบบป้องกันถูกเคารพ 100% — ไม่มีการ bypass Turnstile / Bot Protection / Rate Limit ทุกกรณี; ถ้า Turnstile บล็อก จะหยุดทั้งรันและบันทึกเหตุการณ์ไว้ที่นี่
3. Cloudflare edge cache / Workers isolates ทำให้ latency ที่วัดได้แปรผันตามเวลาและภูมิภาค — อย่าสรุปความจุจากรอบเดียว
