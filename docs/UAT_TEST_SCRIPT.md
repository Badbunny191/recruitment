# UAT Test Script - PHASE 0.5
# Date: 2026-10-08
# Environment: Development

## Test Cases

### TC-01: Create Field
**URL:** `/admin/fields`
**Steps:**
1. Login to admin panel
2. Go to Field Master page
3. Click "เพิ่ม Field ใหม่"
4. Fill in: Label="ทดสอบ TEXT", Type=TEXT
5. Fill in Help Text="ช่วยอธิบาย"
6. Fill in Placeholder="กรอกข้อมูลที่นี่"
7. Click "บันทึก"

**Expected Result:** Field created successfully, appears in list

---

### TC-02: Create DROPDOWN Field with Options
**URL:** `/admin/fields`
**Steps:**
1. Click "เพิ่ม Field ใหม่"
2. Fill in: Label="ระดับการศึกษา", Type=DROPDOWN
3. Fill in Options: ปริญญาตรี\nปริญญาโท\nปริญญาเอก
4. Click "บันทึก"

**Expected Result:** DROPDOWN field created with options

---

### TC-03: Create FILE Field with Config
**URL:** `/admin/fields`
**Steps:**
1. Click "เพิ่ม Field ใหม่"
2. Fill in: Label="อัปโหลดเอกสาร", Type=FILE
3. Select allowed types: PDF, JPG
4. Set Max Files=3
5. Set Max Size=5 MB
6. Click "บันทึก"

**Expected Result:** FILE field created with config saved

---

### TC-04: Edit Field
**URL:** `/admin/fields`
**Steps:**
1. Find the "ทดสอบ TEXT" field from TC-01
2. Click "แก้ไข"
3. Change Help Text to "แก้ไขแล้ว"
4. Click "บันทึก"

**Expected Result:** Field updated successfully

---

### TC-05: Create Template
**URL:** `/admin/templates`
**Steps:**
1. Click "+ สร้าง Template"
2. Fill in: Name="แบบฟอร์มทดสอบ"
3. Fill in: Description="ใช้สำหรับ UAT"
4. Click "บันทึก"

**Expected Result:** Template created successfully

---

### TC-06: Edit Template (Builder)
**URL:** `/admin/templates/builder?id={templateId}`
**Steps:**
1. Click "Builder" on the test template
2. Add "ทดสอบ TEXT" field
3. Add "ระดับการศึกษา" DROPDOWN field
4. Click "Publish New Version"

**Expected Result:** Version published, fields saved

---

### TC-07: Create Recruitment Round
**URL:** `/admin/rounds`
**Steps:**
1. Click "+ สร้างรอบใหม่"
2. Fill in: Title="รอบทดสอบ UAT"
3. Fill in: Position Level="ระดับ 1"
4. Select Template Version
5. Set Open Date = today
6. Set Close Date = today + 7 days
7. Set Status = ACTIVE
8. Click "สร้างรอบ"

**Expected Result:** Round created successfully

---

### TC-08: Open Apply Page (Public)
**URL:** `/apply?id={roundId}`
**Steps:**
1. Navigate to public apply page
2. Verify form loads correctly
3. Check all field types render:
   - TEXT field
   - DROPDOWN field
   - Date should show "ไม่กำหนด" gracefully if missing

**Expected Result:** Form renders all fields correctly

---

### TC-09: Submit Application
**URL:** `/apply?id={roundId}`
**Steps:**
1. Fill in personal info (fullname, nationalId, email)
2. Fill in form fields
3. Check consent checkboxes
4. Click "ยืนยันการส่งใบสมัคร"

**Expected Result:** Application submitted, redirected to success page

---

### TC-10: View Application (Admin)
**URL:** `/admin/applications`
**Steps:**
1. Go to Applications page
2. Find the submitted application
3. Click to view details

**Expected Result:** Application details displayed correctly

---

### TC-11: Date Format Test
**URL:** `/` (Public Home)
**Steps:**
1. Check if any rounds show "Invalid Date"
2. Verify dates display as Thai format

**Expected Result:** All dates formatted correctly, no "Invalid Date"

---

## Summary

| Test Case | Status | Notes |
|-----------|--------|-------|
| TC-01: Create Field | ? | |
| TC-02: Create DROPDOWN | ? | |
| TC-03: Create FILE | ? | |
| TC-04: Edit Field | ? | |
| TC-05: Create Template | ? | |
| TC-06: Edit Template | ? | |
| TC-07: Create Round | ? | |
| TC-08: Open Apply Page | ? | |
| TC-09: Submit Application | ? | |
| TC-10: View Application | ? | |
| TC-11: Date Format | ? | |
