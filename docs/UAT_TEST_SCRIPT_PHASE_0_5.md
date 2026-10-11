# UAT Test Script - PHASE 0.5
# Recruitment System - Bug Fix Verification
# Date: 2026-10-08

---

## 🧪 Test Environment Setup

### Deploy Backend First
```bash
cd backend
npx wrangler deploy --var JWT_SECRET:your_secret
```

### Deploy Frontend
```bash
cd frontend
vercel --prod
```

---

## ✅ TC-01: Create Basic TEXT Field

**URL:** `/admin/fields`
**Bug Fixed:** #1, #2 (options parsing)

| Step | Action | Expected Result | PASS/FAIL |
|------|--------|-----------------|-----------|
| 1 | Login to admin | Redirected to dashboard | ⬜ |
| 2 | Click "Field Master" in menu | Page loads | ⬜ |
| 3 | Click "เพิ่ม Field ใหม่" | Modal opens | ⬜ |
| 4 | Select Type: TEXT | Type dropdown works | ⬜ |
| 5 | Enter Label: "ทดสอบ TEXT" | Label entered | ⬜ |
| 6 | Enter Help Text: "กรุณากรอกชื่อจริง" | Help text entered | ⬜ |
| 7 | Enter Placeholder: "เช่น นายสมชาย" | Placeholder entered | ⬜ |
| 8 | Click "บันทึก" | Success toast, field appears in list | ⬜ |

**Screenshot:** Capture the created field in the list

---

## ✅ TC-02: Create DROPDOWN Field with Options

**URL:** `/admin/fields`
**Bug Fixed:** #1, #2 (options.join error)

| Step | Action | Expected Result | PASS/FAIL |
|------|--------|-----------------|-----------|
| 1 | Click "เพิ่ม Field ใหม่" | Modal opens | ⬜ |
| 2 | Select Type: DROPDOWN | Options section appears | ⬜ |
| 3 | Enter Label: "ระดับการศึกษา" | Label entered | ⬜ |
| 4 | Enter Options (one per line):<br>ปริญญาตรี<br>ปริญญาโท<br>ปริญญาเอก | Options entered | ⬜ |
| 5 | Click "บันทึก" | Success, field created | ⬜ |
| 6 | **Reload page** | Field still shows options | ⬜ |

**Screenshot:** Capture the DROPDOWN field with options

---

## ✅ TC-03: Create FILE Field with Config

**URL:** `/admin/fields`
**Bug Fixed:** #3 (fileConfig not persisting)

| Step | Action | Expected Result | PASS/FAIL |
|------|--------|-----------------|-----------|
| 1 | Click "เพิ่ม Field ใหม่" | Modal opens | ⬜ |
| 2 | Select Type: FILE | File config section appears | ⬜ |
| 3 | Enter Label: "อัปโหลดเอกสาร" | Label entered | ⬜ |
| 4 | Check "PDF" | PDF checkbox checked | ⬜ |
| 5 | Check "JPG" | JPG checkbox checked | ⬜ |
| 6 | Set Max Files: 3 | Max files = 3 | ⬜ |
| 7 | Set Max Size: 5 | Max size = 5 MB | ⬜ |
| 8 | Click "บันทึก" | Success, field created | ⬜ |
| 9 | **Edit the FILE field** | Config loads correctly | ⬜ |
| 10 | **Reload page** | Config still persists | ⬜ |

**Screenshot:** Capture file config UI and saved field

---

## ✅ TC-04: Create NUMBER Field

**URL:** `/admin/fields`
**Bug Fixed:** #5 (Apply page NUMBER field)

| Step | Action | Expected Result | PASS/FAIL |
|------|--------|-----------------|-----------|
| 1 | Click "เพิ่ม Field ใหม่" | Modal opens | ⬜ |
| 2 | Select Type: NUMBER | Type selected | ⬜ |
| 3 | Enter Label: "อายุ" | Label entered | ⬜ |
| 4 | Click "บันทึก" | Success | ⬜ |

**Screenshot:** Capture NUMBER field created

---

## ✅ TC-05: Create DATE Field

**URL:** `/admin/fields`
**Bug Fixed:** #5 (Apply page DATE field)

| Step | Action | Expected Result | PASS/FAIL |
|------|--------|-----------------|-----------|
| 1 | Click "เพิ่ม Field ใหม่" | Modal opens | ⬜ |
| 2 | Select Type: DATE | Type selected | ⬜ |
| 3 | Enter Label: "วันเกิด" | Label entered | ⬜ |
| 4 | Click "บันทึก" | Success | ⬜ |

**Screenshot:** Capture DATE field created

---

## ✅ TC-06: Create Template

**URL:** `/admin/templates`
**Bug Fixed:** General stability

| Step | Action | Expected Result | PASS/FAIL |
|------|--------|-----------------|-----------|
| 1 | Click "+ สร้าง Template" | Modal opens | ⬜ |
| 2 | Enter Name: "แบบฟอร์มทดสอบ UAT" | Name entered | ⬜ |
| 3 | Enter Description: "ใช้สำหรับทดสอบ UAT Phase 0.5" | Description entered | ⬜ |
| 4 | Click "บันทึก" | Success, template appears in list | ⬜ |

**Screenshot:** Capture created template

---

## ✅ TC-07: Edit Template (Add Fields)

**URL:** `/admin/templates/builder?id={templateId}`
**Bug Fixed:** #6 (Template Builder loads existing fields)

| Step | Action | Expected Result | PASS/FAIL |
|------|--------|-----------------|-----------|
| 1 | Click "Builder" on test template | Builder page opens | ⬜ |
| 2 | Verify fields from previous versions load | Existing fields shown | ⬜ |
| 3 | Add "ทดสอบ TEXT" field | Field added | ⬜ |
| 4 | Add "ระดับการศึกษา" DROPDOWN | Field added | ⬜ |
| 5 | Add "อายุ" NUMBER | Field added | ⬜ |
| 6 | Add "วันเกิด" DATE | Field added | ⬜ |
| 7 | Reorder fields using ↑↓ buttons | Order changes | ⬜ |
| 8 | Verify helpText and placeholder show | Fields show in UI | ⬜ |
| 9 | Click "Publish New Version" | Success message | ⬜ |
| 10 | Verify version appears in history | Version v1 shown | ⬜ |

**Screenshot:** Capture builder with fields and published version

---

## ✅ TC-08: Create Recruitment Round

**URL:** `/admin/rounds`
**Bug Fixed:** General stability

| Step | Action | Expected Result | PASS/FAIL |
|------|--------|-----------------|-----------|
| 1 | Click "+ สร้างรอบใหม่" | Modal opens | ⬜ |
| 2 | Enter Title: "รอบทดสอบ UAT Phase 0.5" | Title entered | ⬜ |
| 3 | Enter Position Level: "ระดับ 1" | Level entered | ⬜ |
| 4 | Select Template Version | Version selected | ⬜ |
| 5 | Set Open Date: Today | Date set | ⬜ |
| 6 | Set Close Date: Today + 7 days | Date set | ⬜ |
| 7 | Set Status: ACTIVE | Status = ACTIVE | ⬜ |
| 8 | Click "สร้างรอบ" | Success, round in list | ⬜ |

**Screenshot:** Capture created round in list

---

## ✅ TC-09: Open Public Apply Page

**URL:** `/apply?id={roundId}`
**Bug Fixed:** #5 (All field types render)

| Step | Action | Expected Result | PASS/FAIL |
|------|--------|-----------------|-----------|
| 1 | Navigate to apply page | Page loads without errors | ⬜ |
| 2 | Verify TEXT field renders | TEXT input shown | ⬜ |
| 3 | Verify DROPDOWN renders | Dropdown with options | ⬜ |
| 4 | Verify NUMBER field renders | Number input | ⬜ |
| 5 | Verify DATE field renders | Date picker | ⬜ |
| 6 | Check Help Text displays | Help text shown | ⬜ |
| 7 | Check Placeholder displays | Placeholder in input | ⬜ |
| 8 | **No "Invalid Date" visible** | No date errors | ⬜ |

**Screenshot:** Capture all field types rendering

---

## ✅ TC-10: Submit Application

**URL:** `/apply?id={roundId}`
**Bug Fixed:** All bugs fixed

| Step | Action | Expected Result | PASS/FAIL |
|------|--------|-----------------|-----------|
| 1 | Enter Fullname: "นายทดสอบ ระบบ" | Fullname entered | ⬜ |
| 2 | Enter National ID: "1234567890123" | ID entered | ⬜ |
| 3 | Enter Email: "test@example.com" | Email entered | ⬜ |
| 4 | Fill TEXT field | Text entered | ⬜ |
| 5 | Select DROPDOWN option | Option selected | ⬜ |
| 6 | Enter NUMBER value | Number entered | ⬜ |
| 7 | Select DATE | Date selected | ⬜ |
| 8 | Check consent 1 | Checkbox checked | ⬜ |
| 9 | Check consent 2 | Checkbox checked | ⬜ |
| 10 | Click "ยืนยันการส่งใบสมัคร" | Submitted successfully | ⬜ |
| 11 | Verify redirect to success page | Redirected to success | ⬜ |

**Screenshot:** Capture success page with application number

---

## ✅ TC-11: View Application (Admin)

**URL:** `/admin/applications`
**Bug Fixed:** General stability

| Step | Action | Expected Result | PASS/FAIL |
|------|--------|-----------------|-----------|
| 1 | Navigate to Applications | Page loads | ⬜ |
| 2 | Find submitted application | Application shown | ⬜ |
| 3 | Click to view details | Details modal opens | ⬜ |
| 4 | Verify form data matches submission | Data correct | ⬜ |
| 5 | Verify schema displays correctly | All fields shown | ⬜ |

**Screenshot:** Capture application details

---

## ✅ TC-12: Date Format Test

**URL:** `/` (Public Home)
**Bug Fixed:** #4 (Invalid Date)

| Step | Action | Expected Result | PASS/FAIL |
|------|--------|-----------------|-----------|
| 1 | Navigate to public home | Page loads | ⬜ |
| 2 | Look for round cards | Cards shown | ⬜ |
| 3 | Check close dates | Thai date format | ⬜ |
| 4 | **No "Invalid Date" visible** | Dates formatted correctly | ⬜ |

**Screenshot:** Capture date display in Thai format

---

## 📋 Test Summary Sheet

| Test Case | Description | Status | Screenshots | Tested By | Date |
|-----------|-------------|--------|--------------|-----------|------|
| TC-01 | Create TEXT Field | ⬜ | 1 | | |
| TC-02 | Create DROPDOWN Field | ⬜ | 1 | | |
| TC-03 | Create FILE Field with Config | ⬜ | 2 | | |
| TC-04 | Create NUMBER Field | ⬜ | 1 | | |
| TC-05 | Create DATE Field | ⬜ | 1 | | |
| TC-06 | Create Template | ⬜ | 1 | | |
| TC-07 | Edit Template (Builder) | ⬜ | 2 | | |
| TC-08 | Create Round | ⬜ | 1 | | |
| TC-09 | Open Apply Page | ⬜ | 1 | | |
| TC-10 | Submit Application | ⬜ | 2 | | |
| TC-11 | View Application (Admin) | ⬜ | 1 | | |
| TC-12 | Date Format Test | ⬜ | 1 | | |

---

## 📊 Bug Fix Verification Checklist

| Bug # | Description | Test Case | Verified |
|-------|-------------|-----------|----------|
| #1 | defaultOptions.join is not a function | TC-01, TC-02 | ⬜ |
| #2 | options.map is not a function | TC-02 | ⬜ |
| #3 | File Configuration not persisting | TC-03 | ⬜ |
| #4 | Invalid Date display | TC-12 | ⬜ |
| #5 | Apply Page missing field types | TC-04, TC-05, TC-09 | ⬜ |
| #6 | Template Builder not loading | TC-07 | ⬜ |

---

## 🚀 Sign-off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Tester | | | |
| Reviewer | | | |
| Approver | | | |

---

## 📝 Notes

_Add any additional notes, issues found, or recommendations here._

