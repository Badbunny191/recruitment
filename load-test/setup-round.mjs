/**
 * SETUP: สร้าง Recruitment Round สำหรับทดสอบ (ใช้ Admin API ของระบบเดิมทั้งหมด)
 * ---------------------------------------------------------------------------
 * สร้าง: [TEST] template → version → publish → round "[TEST] Load Test 250 Users"
 * ใช้ resources เดิม (Worker/D1/R2 เดิม) — ไม่สร้างทรัพยากรใหม่เลย
 *
 * Idempotent: ถ้า round ชื่อเดียวกันมีอยู่แล้ว → แค่รายงาน id และออก
 * ใช้: node setup-round.mjs [--dry-run] [--local]
 * ต้องตั้ง LOAD_TEST_ADMIN_EMAIL / LOAD_TEST_ADMIN_PASSWORD ใน load-test/.env
 */

import { cfg, parseArgs } from './config.mjs';
import { adminLogin, adminFetch, getAdminUser } from './lib/admin-api.mjs';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const args = parseArgs();

/** field plan ของ template ทดสอบ (fieldId ต้องมีอยู่จริงใน field_master ของระบบ) */
const FIELD_PLAN = [
  { fieldId: 'field-fullname',     section: 'personal', order: 1, required: true  },
  { fieldId: 'field-national-id',  section: 'personal', order: 2, required: true  },
  { fieldId: 'field-email',        section: 'personal', order: 3, required: true  },
  { fieldId: 'field-phone',        section: 'personal', order: 4, required: true  },
  { fieldId: 'field-gender',       section: 'personal', order: 5, required: true  },
  { fieldId: 'field-address',      section: 'personal', order: 6, required: true  },
  { fieldId: 'field-education',    section: 'docs',     order: 1, required: true  },
  { fieldId: 'field-experience',   section: 'docs',     order: 2, required: false },
  { fieldId: 'field-resume',       section: 'docs',     order: 3, required: true  },
  { fieldId: 'field-portfolio',    section: 'docs',     order: 4, required: false },
];

const SECTIONS = [
  { tempId: 'personal', name: 'ข้อมูลส่วนตัว', displayOrder: 1 },
  { tempId: 'docs', name: 'การศึกษา ประสบการณ์ และเอกสารแนบ', displayOrder: 2 },
];

async function main() {
  console.log('── SAO Recruitment Load Test: SETUP ROUND ──');
  console.log(`target: ${cfg.target} → ${cfg.frontendBaseUrl}`);
  console.log(`api:    ${cfg.apiBaseUrl}\n`);

  if (args.dryRun) {
    console.log('(dry-run) จะดำเนินการดังนี้เมื่อรันจริง:');
    console.log(`  1. ตรวจ field_master มีฟิลด์ที่ต้องใช้ครบ (${FIELD_PLAN.length} ฟิลด์)`);
    console.log(`  2. สร้าง template "${cfg.templateName}" + version + publish`);
    console.log(`  3. สร้าง round "${cfg.roundTitle}" (roundCode=${cfg.roundCode}, pattern=${cfg.applicationPattern})`);
    console.log('  4. เขียน load-test/results/state.json');
    return;
  }

  // 1) login
  const me = await getAdminUser().catch((e) => { throw e; });
  console.log(`✓ admin login: ${me.email} (role=${me.role})`);

  // 2) ตรวจ field_master — template_fields ผูก FK กับ field_master จึงต้องมีอยู่จริง
  const fieldsRes = await adminFetch('/fields');
  if (!fieldsRes.ok) throw new Error(`GET /admin/fields ล้มเหลว (${fieldsRes.status})`);
  const masterFields = fieldsRes.body?.data ?? [];
  const masterIds = new Set(masterFields.map((f) => f.id));
  const missing = FIELD_PLAN.filter((f) => !masterIds.has(f.fieldId));
  if (missing.length) {
    throw new Error(
      `field_master ไม่มีฟิลด์ที่ template ทดสอบต้องใช้: ${missing.map((m) => m.fieldId).join(', ')}\n` +
      '→ ระบบจริงไม่ได้ seed field_master ชุดมาตรฐาน ดู TODO.md ข้อ 1',
    );
  }
  // submit ฝั่ง backend อ่านค่าหลักจาก formData['field-email'] / ['field-fullname'] เท่านั้น
  for (const must of ['field-email', 'field-fullname']) {
    const f = masterFields.find((x) => x.id === must);
    if (!f) throw new Error(`ไม่พบ ${must} ใน field_master (จำเป็นต่อการ submit)`);
  }
  console.log(`✓ field_master ครบ ${FIELD_PLAN.length}/${FIELD_PLAN.length} ฟิลด์`);

  // 3) idempotent — ถ้า round มีอยู่แล้วใช้ตัวเดิม
  const roundsRes = await adminFetch('/rounds');
  if (!roundsRes.ok) throw new Error(`GET /admin/rounds ล้มเหลว (${roundsRes.status})`);
  const existing = (roundsRes.body?.data ?? []).find(
    (r) => r.title === cfg.roundTitle && !r.deletedAt,
  );
  if (existing) {
    console.log(`✓ round ทดสอบมีอยู่แล้ว: id=${existing.id} (roundCode=${existing.roundCode ?? '-'}, ใช้ตัวเดิม — ไม่สร้างซ้ำ)`);
    saveState({ roundId: existing.id, roundCode: existing.roundCode ?? cfg.roundCode, reused: true });
    printNext(existing.id);
    return;
  }

  // 4) template (หาชื่อเดิมก่อน กันสร้างซ้ำเมื่อ round ถูกลบไปแล้วครึ่งทาง)
  let templateId;
  const templatesRes = await adminFetch('/templates');
  if (templatesRes.ok) {
    const found = (templatesRes.body?.data ?? []).find((t) => t.name === cfg.templateName && !t.deletedAt);
    if (found) {
      templateId = found.id;
      console.log(`✓ template ทดสอบมีอยู่แล้ว: id=${templateId}`);
    }
  }
  if (!templateId) {
    const created = await adminFetch('/templates', { method: 'POST', json: { name: cfg.templateName, description: 'Template เฉพาะการทดสอบ load — ลบได้ทั้งชุด' } });
    if (!created.ok) throw new Error(`POST /admin/templates ล้มเหลว (${created.status}): ${JSON.stringify(created.body)}`);
    templateId = created.body.id;
    console.log(`✓ สร้าง template: id=${templateId}`);
  }

  // 5) version + fields (ถ้ามี version ที่สร้างค้างไว้ให้ reuse ตัวล่าสุดที่ยังไม่มี round)
  let versionId;
  const versionsRes = await adminFetch(`/templates/${templateId}/versions`);
  if (versionsRes.ok) {
    const versions = versionsRes.body?.data ?? [];
    const draftOrPublished = versions
      .filter((v) => v.status === 'DRAFT' || v.status === 'PUBLISHED')
      .sort((a, b) => b.versionNumber - a.versionNumber)[0];
    // ใช้ version เดิมได้เมื่อยังไม่มี round ผูกอยู่ (round ที่มีอยู่ถูกจับคู่ไปแล้วด้านบน)
    const roundsOfVersion = draftOrPublished
      ? (roundsRes.body?.data ?? []).filter((r) => r.templateVersionId === draftOrPublished.id && !r.deletedAt).length
      : 1;
    if (draftOrPublished && roundsOfVersion === 0) {
      versionId = draftOrPublished.id;
      console.log(`✓ ใช้ version เดิม: id=${versionId} (v${draftOrPublished.versionNumber}, ${draftOrPublished.status})`);
    }
  }
  if (!versionId) {
    const versionRes = await adminFetch(`/templates/${templateId}/versions`, {
      method: 'POST',
      json: {
        templateId,
        status: 'DRAFT',
        sections: SECTIONS,
        fields: FIELD_PLAN.map((f) => ({
          fieldId: f.fieldId,
          sectionId: f.section,
          displayOrder: f.order,
          isRequired: f.required,
        })),
      },
    });
    if (!versionRes.ok) {
      throw new Error(`POST /admin/templates/:id/versions ล้มเหลว (${versionRes.status}): ${JSON.stringify(versionRes.body)}`);
    }
    versionId = versionRes.body.versionId;
    console.log(`✓ สร้าง template version: id=${versionId}`);
  }

  // 6) publish (idempotent — publish ซ้ำตอบ error ก็ข้าม)
  const pub = await adminFetch(`/template-versions/${versionId}/publish`, { method: 'PATCH' });
  if (pub.ok) console.log('✓ publish version');
  else console.log(`• publish ข้าม (${pub.status} — น่าจะ published แล้ว)`);

  // 7) round — openDate/closeDate เก็บเป็น "Bangkok wall clock as UTC" (คอมเมนต์ใน
  //    frontend/apply/page.tsx) จึงเผื่อ offset +7h แล้วเปิด "เมื่อวาน" ปิดอีก 30 วัน
  // pattern: validator อนุญาตเฉพาะ {YEAR}/{ROUND_CODE}/{RUNNING:n} + ตัวคั่น - / . _
  //          → {ROUND_CODE}-{RUNNING:6} + roundCode TEST = "TEST-000001"
  // roundCode unique ต่อปี (409 ถ้าซ้ำ) → ลองตามลำดับ fallback ที่ config
  const nowSec = Math.floor(Date.now() / 1000);
  const BANGKOK_OFFSET = 7 * 3600;
  const openDate = nowSec - BANGKOK_OFFSET - 86400;
  const closeDate = nowSec - BANGKOK_OFFSET + 30 * 86400;

  const candidates = [cfg.roundCode, ...(cfg.roundCodeFallbacks ?? [])];
  let roundRes = null;
  let usedRoundCode = null;
  for (const candidate of candidates) {
    const attempt = await adminFetch('/rounds', {
      method: 'POST',
      json: {
        templateVersionId: versionId,
        title: cfg.roundTitle,
        positionLevel: cfg.positionLevel,
        openDate,
        closeDate,
        status: 'ACTIVE',
        roundCode: candidate,
        applicationPattern: cfg.applicationPattern,
        announcementTitle: '[TEST] รอบทดสอบระบบ (Load Test)',
        announcementDescription:
          'รอบนี้เป็นรอบทดสอบระบบเท่านั้น ผู้สมัครจำลองจะใช้อีเมลลงท้าย test.local และเลขที่ใบสมัครขึ้นต้นด้วย TEST- ข้อมูลทั้งหมดถูกลบออกหลังการทดสอบ',
        contactInformation: '[TEST] ไม่มีเบอร์ติดต่อจริง — รอบทดสอบอัตโนมัติ',
        remark: 'สร้างโดย load-test/setup-round.mjs — ลบด้วย npm run cleanup:test-data',
      },
    });
    if (attempt.ok) {
      roundRes = attempt;
      usedRoundCode = candidate;
      break;
    }
    const msg = JSON.stringify(attempt.body ?? {});
    if (attempt.status === 409 || /ถูกใช้แล้ว|already/i.test(msg)) {
      console.log(`• roundCode "${candidate}" ถูกใช้แล้วในปีนี้ (409) — ลองตัวถัดไป`);
      continue;
    }
    throw new Error(`POST /admin/rounds ล้มเหลว (${attempt.status}): ${msg}`);
  }
  if (!roundRes) {
    throw new Error(`roundCode ทั้งหมดถูกใช้แล้ว: ${candidates.join(', ')} — เพิ่ม fallback ใน config.mjs (TEST_MARKERS.roundCodeFallbacks)`);
  }
  const roundId = roundRes.body.id;
  console.log(`✓ สร้าง round: id=${roundId} | roundCode=${usedRoundCode} | pattern=${cfg.applicationPattern} → เลขที่ "TEST-000001"...`);

  // 8) ตรวจว่าหน้า public เห็นรอบจริง (GET /public/rounds/active)
  const activeRes = await fetch(`${cfg.apiBaseUrl}/public/rounds/active`);
  const activeJson = await activeRes.json().catch(() => ({}));
  const visible = (activeJson?.data ?? []).some((r) => r.id === roundId);
  console.log(visible
    ? '✓ หน้าเว็บ public เห็นรอบทดสอบแล้ว (รายการรอบเปิดรับ)'
    : '⚠ รอบยังไม่ปรากฏใน /public/rounds/active — ตรวจสถานะ/วันที่ของรอบ');

  saveState({ roundId, templateId, versionId, roundCode: usedRoundCode, reused: false });
  printNext(roundId);
}

function saveState(extra) {
  mkdirSync(cfg.paths.resultsDir, { recursive: true });
  const prev = existsSync(cfg.paths.stateFile)
    ? JSON.parse(readFileSync(cfg.paths.stateFile, 'utf8'))
    : {};
  const state = {
    ...prev,
    ...extra,
    roundTitle: cfg.roundTitle,
    roundCode: cfg.roundCode,
    templateName: cfg.templateName,
    target: cfg.target,
    frontendBaseUrl: cfg.frontendBaseUrl,
    apiBaseUrl: cfg.apiBaseUrl,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(cfg.paths.stateFile, JSON.stringify(state, null, 2));
  console.log(`\n✓ บันทึก state → ${path.relative(cfg.paths.repoRoot, cfg.paths.stateFile)}`);
}

function printNext(roundId) {
  console.log('\nขั้นตอนต่อไป:');
  console.log(`  1. ทดสอบเบา ๆ ก่อน:   npm run loadtest:run -- --users 5`);
  console.log(`  2. รันเต็ม 250 คน:     npm run loadtest:run`);
  console.log(`  3. เติมข้อมูล Seeder:  npm run loadtest:seed -- 250`);
  console.log(`  4. รายงาน:            npm run loadtest:report`);
  console.log(`  5. ลบข้อมูลทดสอบ:      npm run cleanup:test-data`);
  console.log(`\nหน้าสมัครของรอบนี้: ${cfg.frontendBaseUrl}/apply?id=${roundId}`);
}

main().catch((err) => {
  console.error(`\n✗ SETUP FAILED: ${err.message}`);
  process.exit(1);
});
