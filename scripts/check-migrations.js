#!/usr/bin/env node

/**
 * Migration Linter
 *
 * ตรวจสอบ migration files ใน backend/migrations/ ว่า:
 *   1. Filename format ถูกต้อง (เฉพาะ migration ใหม่)
 *   2. ไม่มี duplicate prefix (เฉพาะ migration ใหม่)
 *   3. ไม่มี rollback/down/revert ในชื่อไฟล์ (เฉพาะ migration ใหม่)
 *
 * หมายเหตุ:
 *   - Migration เดิม (legacy) ที่อยู่ใน LEGACY_BASELINE จะถูก exclude จากการตรวจสอบ
 *   - ดูรายละเอียดใน docs/MIGRATION_GOVERNANCE.md > Legacy Migrations Exception Policy
 *
 * Usage:
 *   node scripts/check-migrations.js
 *   npm run migration:check
 *
 * Exit codes:
 *   0 = ไม่มีปัญหา
 *   1 = มีปัญหา (พร้อมรายละเอียด)
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ============================================================
// Configuration
// ============================================================

const MIGRATIONS_DIR = path.join(__dirname, '..', 'backend', 'migrations');

// Regex สำหรับ filename ที่ถูกต้อง: NNNN_description.sql
const VALID_FILENAME_REGEX = /^[0-9]{4}_[a-z0-9_]+\.sql$/;

// คำที่ห้ามอยู่ในชื่อไฟล์
const FORBIDDEN_KEYWORDS = ['rollback', 'down', 'revert', 'fix', 'drop'];

// ============================================================
// Legacy Baseline
// ============================================================
// ไฟล์ migration เดิมที่ apply production ไปแล้วและไม่สามารถ rename ได้
// ไฟล์เหล่านี้จะถูก EXCLUDE จากการตรวจสอบ filename format, duplicate prefix,
// และ forbidden keywords
//
// หากต้องการเพิ่ม legacy file ใหม่เข้า baseline นี้ กรุณา:
//   1. Verify ว่าไฟล์นั้น apply production ไปแล้วจริง
//   2. ได้รับ approval จาก Backend Lead
//   3. Update LEGACY_BASELINE_SET ด้านล่าง
//   4. เขียน comment อธิบายเหตุผล

const LEGACY_BASELINE = [
  // === 3-digit prefix (legacy, cannot rename due to production ledger) ===
  '002_field_master_enhancement.sql',
  '003_validation_required_fix.sql',
  '004_field_master_enhancement_phase0.sql',
  '005_organizations.sql',
  '006_sprint1_announcement_metadata.sql',
  '007_organizations_display_order.sql',
  '008_position_masters.sql',
  '009_template_sections.sql',
  '010_recover_negative_display_order.sql',
  '011_field_type_master_data.sql',
  '015_fix_template_fields_fk_target.sql',
  '015_rollback.sql',
  '016_templates_deleted_at.sql',
  '017_audit_logs_performance_indexes.sql',
  '018_add_template_field_validation_message.sql',

  // === 4-digit prefix (applied to production before governance adoption) ===
  '0000_normal_alex_wilder.sql',
  '0001_applications_management.sql',
  '0002_audit_trail.sql',
];

const LEGACY_BASELINE_SET = new Set(LEGACY_BASELINE);

// ============================================================
// ANSI Colors
// ============================================================

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

function colorize(text, color) {
  return process.stdout.isTTY ? `${colors[color]}${text}${colors.reset}` : text;
}

// ============================================================
// Helper Functions
// ============================================================

function getMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(colorize(`❌ Directory not found: ${MIGRATIONS_DIR}`, 'red'));
    process.exit(1);
  }

  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(file => file.endsWith('.sql'))
    .sort();
}

function checkFilenameFormat(files) {
  const errors = [];

  for (const file of files) {
    // Skip legacy files
    if (LEGACY_BASELINE_SET.has(file)) {
      continue;
    }

    if (!VALID_FILENAME_REGEX.test(file)) {
      errors.push({
        file,
        rule: 'FILENAME_FORMAT',
        message: `ชื่อไฟล์ migration ใหม่ไม่ตรง format NNNN_description.sql`,
        details: `ต้องเป็น: ^[0-9]{4}_[a-z0-9_]+\\.sql$`,
        examples: {
          correct: '0001_applications_management.sql',
          wrong: [
            '1_applications.sql (ขาด zero-pad)',
            '001_applications.sql (3 หลัก)',
            '0001-application.sql (ใช้ hyphen)',
            '0001Applications.sql (camelCase)',
            '0001_Applications.sql (ตัวพิมพ์ใหญ่)',
            '0001_applications (ขาด .sql)',
          ],
        },
      });
    }
  }

  return errors;
}

function checkDuplicatePrefix(files) {
  const errors = [];
  const prefixMap = new Map();

  for (const file of files) {
    const match = file.match(/^([0-9]{4})_/);
    if (!match) continue; // skip files with invalid format (already reported)

    const prefix = match[1];
    if (!prefixMap.has(prefix)) {
      prefixMap.set(prefix, []);
    }
    prefixMap.get(prefix).push(file);
  }

  for (const [prefix, fileList] of prefixMap.entries()) {
    if (fileList.length > 1) {
      // Separate legacy vs new files
      const legacyInGroup = fileList.filter(f => LEGACY_BASELINE_SET.has(f));
      const newInGroup = fileList.filter(f => !LEGACY_BASELINE_SET.has(f));

      // Only report if there are NEW files with duplicate prefix
      // (legacy duplicates are documented exceptions)
      if (newInGroup.length > 0) {
        const allFiles = [...newInGroup, ...legacyInGroup];
        errors.push({
          file: allFiles.join(', '),
          rule: 'DUPLICATE_PREFIX',
          message: `มี migration ใหม่ที่ใช้ prefix ${prefix} ซ้ำกับ migration อื่น`,
          details: `Wrangler จะมองว่าเป็น 2 migration ที่ต้อง apply ตามลำดับตัวอักษร → อาจเกิดลำดับผิด`,
          suggestion: `เปลี่ยน prefix ของ migration ใหม่ให้เป็น ${String(parseInt(prefix) + 1).padStart(4, '0')} หรือสูงกว่า`,
        });
      }
    }
  }

  return errors;
}

function checkForbiddenKeywords(files) {
  const errors = [];

  for (const file of files) {
    // Skip legacy files
    if (LEGACY_BASELINE_SET.has(file)) {
      continue;
    }

    const lowerFile = file.toLowerCase();
    for (const keyword of FORBIDDEN_KEYWORDS) {
      if (lowerFile.includes(keyword)) {
        errors.push({
          file,
          rule: 'FORBIDDEN_KEYWORD',
          message: `ชื่อไฟล์ migration ใหม่มีคำ "${keyword}" ซึ่งเป็นคำต้องห้าม`,
          details: `คำต้องห้าม: ${FORBIDDEN_KEYWORDS.join(', ')}`,
          reason: {
            rollback: 'Rollback script ต้องอยู่ใน backend/fixes/ ไม่ใช่ migrations/',
            down: 'ใช้ "down" ในชื่อไฟล์ทำให้สับสนกับ forward migration',
            revert: 'ใช้ "revert" ในชื่อไฟล์ทำให้สับสนกับ forward migration',
            fix: 'คำว่า "fix" ควรใช้กับ emergency fix ใน backend/fixes/',
            drop: 'คำว่า "drop" บ่งบอกว่าเป็น destructive operation ควรอยู่ใน backend/fixes/',
          }[keyword],
        });
      }
    }
  }

  return errors;
}

// ============================================================
// Report Functions
// ============================================================

function printHeader() {
  console.log('');
  console.log(colorize('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue'));
  console.log(colorize('  Migration Linter', 'bold'));
  console.log(colorize('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue'));
  console.log(colorize(`  Directory: ${MIGRATIONS_DIR}`, 'dim'));
  console.log(colorize(`  Legacy baseline: ${LEGACY_BASELINE.length} ไฟล์ (excluded from checks)`, 'dim'));
  console.log('');
}

function printSuccess(fileCount, newFileCount) {
  console.log(colorize('✅ ผ่านการตรวจสอบ', 'green'));
  console.log(`   - ${colorize('Total:', 'dim')} ${fileCount} ไฟล์`);
  console.log(`   - ${colorize('Legacy:', 'dim')} ${LEGACY_BASELINE.length} ไฟล์ (excluded)`);
  console.log(`   - ${colorize('New:', 'dim')} ${newFileCount} ไฟล์ (validated)`);
  console.log('');
}

function printErrors(errors, legacyCount, newFileCount) {
  console.log(colorize(`❌ พบปัญหา ${errors.length} รายการใน migration ใหม่`, 'red'));
  console.log('');
  console.log(colorize(`📊 สรุป:`, 'blue'));
  console.log(`   - Legacy files: ${legacyCount} ไฟล์ (excluded from checks)`);
  console.log(`   - New files: ${newFileCount} ไฟล์ (checked)`);
  console.log('');

  // Group errors by rule
  const grouped = {};
  for (const error of errors) {
    if (!grouped[error.rule]) {
      grouped[error.rule] = [];
    }
    grouped[error.rule].push(error);
  }

  let index = 1;
  for (const [rule, ruleErrors] of Object.entries(grouped)) {
    console.log(colorize(`[${rule}]`, 'yellow') + colorize(` (${ruleErrors.length} รายการ)`, 'dim'));
    console.log('');

    for (const error of ruleErrors) {
      console.log(`  ${colorize(`${index}.`, 'red')} ${colorize(error.file, 'bold')}`);
      console.log(`     ${colorize('→', 'dim')} ${error.message}`);

      if (error.details) {
        console.log(`     ${colorize('→', 'dim')} ${colorize(error.details, 'dim')}`);
      }

      if (error.examples) {
        console.log(`     ${colorize('→', 'dim')} ${colorize('ตัวอย่าง:', 'dim')}`);
        console.log(`        ${colorize('✓', 'green')} ${error.examples.correct}`);
        for (const wrong of error.examples.wrong) {
          console.log(`        ${colorize('✗', 'red')} ${wrong}`);
        }
      }

      if (error.suggestion) {
        console.log(`     ${colorize('→', 'dim')} ${colorize('วิธีแก้:', 'cyan')} ${error.suggestion}`);
      }

      if (error.reason) {
        console.log(`     ${colorize('→', 'dim')} ${colorize('เหตุผล:', 'cyan')} ${error.reason}`);
      }

      console.log('');
      index++;
    }
  }
}

function printFooter() {
  console.log(colorize('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue'));
  console.log(colorize('  เอกสารอ้างอิง:', 'dim'));
  console.log(colorize('    docs/MIGRATION_GOVERNANCE.md', 'dim'));
  console.log(colorize('    backend/migrations/README.md', 'dim'));
  console.log(colorize('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue'));
  console.log('');
}

// ============================================================
// Main
// ============================================================

function main() {
  printHeader();

  const files = getMigrationFiles();
  const newFiles = files.filter(f => !LEGACY_BASELINE_SET.has(f));

  console.log(colorize(`📁 พบ migration files: ${files.length} ไฟล์`, 'blue'));
  console.log(`   - ${colorize('Legacy:', 'dim')} ${LEGACY_BASELINE.length} ไฟล์ (excluded)`);
  console.log(`   - ${colorize('New:', 'dim')} ${newFiles.length} ไฟล์ (will be checked)`);
  console.log('');

  // Run all checks (only on non-legacy files)
  const allErrors = [
    ...checkFilenameFormat(files),
    ...checkDuplicatePrefix(files),
    ...checkForbiddenKeywords(files),
  ];

  if (allErrors.length === 0) {
    printSuccess(files.length, newFiles.length);
  } else {
    printErrors(allErrors, LEGACY_BASELINE.length, newFiles.length);
  }

  printFooter();

  // Exit with appropriate code
  process.exit(allErrors.length === 0 ? 0 : 1);
}

// Run
main();
