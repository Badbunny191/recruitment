# UAT Test Script - Hard Delete Master Data

## Test Environment Setup

### Prerequisite Data
1. Create at least 1 Organization (e.g., "สำนักงานใหญ่")
2. Create at least 2 Job Families (e.g., "Engineering", "Marketing")
3. Create at least 2 Position Levels (e.g., "Junior", "Senior")
4. Create at least 2 Positions (e.g., "Software Engineer", "Marketing Manager")

---

## Test Cases

### TC-001: Organizations - No Delete Button
**Objective**: Verify that Organizations page does NOT have a Delete button

**Steps**:
1. Navigate to **Master Data > Organizations**
2. Observe the action buttons in the table

**Expected Result**:
- Only "แก้ไข" (Edit) and "ปิดใช้งาน/เปิดใช้งาน" (Disable/Enable) buttons are shown
- **NO** "ลบ" (Delete) button

**Status**: ⬜ Pass / ⬜ Fail

---

### TC-002: Organizations - Enable/Disable Only
**Objective**: Verify Organizations can only be enabled/disabled (soft delete)

**Steps**:
1. Create a new Organization "หน่วยงานทดสอบ"
2. Click "ปิดใช้งาน" (Disable) button
3. Observe the status badge

**Expected Result**:
- Organization status changes to "ปิดใช้งาน" (Disabled)
- Organization data remains in database
- No hard delete occurs

**Status**: ⬜ Pass / ⬜ Fail

---

### TC-003: Job Families - Hard Delete Success
**Objective**: Verify Job Family can be hard deleted when no references exist

**Prerequisites**:
- Create a Job Family with no associated Positions

**Steps**:
1. Navigate to **Master Data > Job Families**
2. Click "ลบ" (Delete) button for a Job Family with no positions
3. Confirm in the dialog

**Expected Result**:
- Confirmation dialog appears: "คุณต้องการลบ Job Family นี้ใช่หรือไม่? การดำเนินการนี้ไม่สามารถย้อนกลับได้"
- Record is permanently deleted from database
- Table refreshes and shows updated list

**Status**: ⬜ Pass / ⬜ Fail

---

### TC-004: Job Families - Hard Delete Blocked by Reference
**Objective**: Verify Job Family cannot be deleted when referenced by Positions

**Prerequisites**:
- Create a Job Family "IT"
- Create a Position "System Analyst" linked to "IT"

**Steps**:
1. Navigate to **Master Data > Job Families**
2. Click "ลบ" (Delete) button for "IT" Job Family
3. Observe the error

**Expected Result**:
- Error alert displayed in Thai:
  ```
  ไม่สามารถลบ Job Family "IT" ได้ เนื่องจากมี Position ที่อ้างอิงถึงอยู่ 1 รายการ
  ```
- Job Family remains in the database
- Table is not refreshed (no changes)

**Status**: ⬜ Pass / ⬜ Fail

---

### TC-005: Position Levels - Hard Delete Success
**Objective**: Verify Position Level can be hard deleted when no references exist

**Prerequisites**:
- Create a Position Level with no associated Positions

**Steps**:
1. Navigate to **Master Data > Position Levels**
2. Click "ลบ" (Delete) button for a Position Level with no positions
3. Confirm in the dialog

**Expected Result**:
- Confirmation dialog appears
- Record is permanently deleted from database
- Table refreshes and shows updated list

**Status**: ⬜ Pass / ⬜ Fail

---

### TC-006: Position Levels - Hard Delete Blocked by Reference
**Objective**: Verify Position Level cannot be deleted when referenced by Positions

**Prerequisites**:
- Create a Position Level "Manager"
- Create a Position "Engineering Manager" linked to "Manager"

**Steps**:
1. Navigate to **Master Data > Position Levels**
2. Click "ลบ" (Delete) button for "Manager" Position Level
3. Observe the error

**Expected Result**:
- Error alert displayed in Thai:
  ```
  ไม่สามารถลบ Position Level "Manager" ได้ เนื่องจากมี Position ที่อ้างอิงถึงอยู่ 1 รายการ
  ```
- Position Level remains in the database

**Status**: ⬜ Pass / ⬜ Fail

---

### TC-007: Positions - Hard Delete with Confirmation
**Objective**: Verify Position can be hard deleted with confirmation dialog

**Prerequisites**:
- Create a Position "Software Engineer"

**Steps**:
1. Navigate to **Master Data > Positions**
2. Click "ลบ" (Delete) button for "Software Engineer"
3. Confirm in the dialog

**Expected Result**:
- Confirmation dialog appears:
  ```
  คุณต้องการลบตำแหน่ง Software Engineer ใช่หรือไม่?
  การดำเนินการนี้ไม่สามารถย้อนกลับได้
  ```
- Record is permanently deleted from database
- Table refreshes and shows updated list

**Status**: ⬜ Pass / ⬜ Fail

---

### TC-008: Delete Confirmation Dialog - Cancel
**Objective**: Verify cancel button in delete confirmation dialog

**Steps**:
1. Navigate to any Master Data page with Delete button
2. Click "ลบ" (Delete) button
3. Click "ยกเลิก" (Cancel) button

**Expected Result**:
- Dialog closes
- No deletion occurs
- Record remains in database

**Status**: ⬜ Pass / ⬜ Fail

---

### TC-009: API Response - Thai Error Message
**Objective**: Verify API returns Thai error messages for FK violations

**Steps**:
1. Create a Job Family "Test"
2. Create a Position linked to "Test"
3. Try to delete "Test" via API or UI

**Expected Result**:
- Error response contains Thai message
- Response includes `referenceCount` and `references` fields

**Status**: ⬜ Pass / ⬜ Fail

---

### TC-010: Cascade Scenario - Delete Position then Job Family
**Objective**: Verify that after deleting a Position, its parent Job Family can be deleted

**Steps**:
1. Create Job Family "Test Family"
2. Create Position "Test Position" linked to "Test Family"
3. Delete "Test Position"
4. Try to delete "Test Family"

**Expected Result**:
- After deleting Position, Job Family can be deleted successfully
- No error message about references

**Status**: ⬜ Pass / ⬜ Fail

---

## Test Summary

| Test Case | Description | Status |
|-----------|-------------|--------|
| TC-001 | Organizations - No Delete Button | ⬜ |
| TC-002 | Organizations - Enable/Disable Only | ⬜ |
| TC-003 | Job Families - Hard Delete Success | ⬜ |
| TC-004 | Job Families - Hard Delete Blocked | ⬜ |
| TC-005 | Position Levels - Hard Delete Success | ⬜ |
| TC-006 | Position Levels - Hard Delete Blocked | ⬜ |
| TC-007 | Positions - Hard Delete with Confirmation | ⬜ |
| TC-008 | Delete Confirmation - Cancel | ⬜ |
| TC-009 | API - Thai Error Message | ⬜ |
| TC-010 | Cascade - Delete Position then Job Family | ⬜ |

---

## Notes

- All tests should be performed in a development/staging environment
- Create backup of database before running destructive tests
- Verify database records are actually deleted (not just soft deleted) after successful hard deletes
