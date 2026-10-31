/**
 * PDF Thai Date/Time Format — Timezone Policy Test
 * --------------------------------------------
 * บั๊กที่พิสูจน์บน production (2026-10-31): formatter ของ PDF engine
 * ใช้ local getters (getDate/getMonth/getFullYear/getHours) กับ unixepoch
 * ซึ่งบน Cloudflare Workers local timezone = UTC ตลอดเวลา
 * → {APPLICATION_DATE} ผิด 1 วันสำหรับใบที่ส่งช่วง 00:00-06:59 Asia/Bangkok
 *   และเวลาข้างลายเซ็น (formatThaiTime) ผิด 7 ชม.ทุกใบ
 *
 * Policy ที่ถูกต้อง = เดียวกับหน้า public (public.routes.ts:36-55) และ
 * Excel (bangkokDateTimeString): epoch เป็น UTC แต่ render ด้วย fixed
 * offset +7h แล้วอ่านผ่าน getUTC* — ห้ามขึ้นกับ process TZ
 *
 * Timestamps จริงจาก production D1 (sao-db --remote, read-only 2026-10-31):
 *   APP-2026-5019  submitted_at = 1792780340 = 24 ต.ค. 2569 01:32:20 ไทย
 *   APP-2026-5020  submitted_at = 1792782115 = 24 ต.ค. 2569 02:01:55 ไทย
 *   APP-2026-5011  submitted_at = 1792001410 = 15 ต.ค. 2569 01:10:10 ไทย
 *
 * fail-before-fix: รันก่อนแก้ด้วย TZ=UTC จะได้ "23 ตุลาคม 2569" (ผิด = FAIL)
 *   ภายใต้ TZ=Asia/Bangkok โค้ดเก่าให้ค่าถูกโดยบังเอิญ (masking เหมือน suite เดิม)
 *
 * รัน (ต้องผ่านภายใต้ TZ ใดก็ได้):
 *   TZ=UTC node --import tsx src/lib/document-composer/__tests__/pdf-thai-date-format.test.ts
 *   TZ=Asia/Bangkok node --import tsx src/lib/document-composer/__tests__/pdf-thai-date-format.test.ts
 */

import {
  formatThaiDate,
  formatThaiTime,
  resolveDocumentTokens,
  applyDocumentTokens,
} from "../document-tokens";

// (repo มี custom Process type — อ่าน env ผ่าน any เหมือน test ไฟล์อื่น)
function currentTZ(): string {
  return ((process as any).env?.TZ as string) ?? "system default";
}

function assertStrictEqual(actual: unknown, expected: unknown, msg = ""): void {
  if (actual !== expected) {
    throw new Error(
      `${msg}\n      actual   : ${JSON.stringify(actual)}\n      expected : ${JSON.stringify(expected)}`
    );
  }
}

// ── ข้อมูลจริงจาก production (query 2026-10-31) ──
const PROD_ROWS = [
  { no: "APP-2026-5019", submittedAt: 1792780340, date: "24 ตุลาคม 2569", time: "01:32" },
  { no: "APP-2026-5020", submittedAt: 1792782115, date: "24 ตุลาคม 2569", time: "02:01" },
  { no: "APP-2026-5011", submittedAt: 1792001410, date: "15 ตุลาคม 2569", time: "01:10" },
];

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name}`);
    console.log(`      ${(err as Error).message.split("\n").join("\n      ")}`);
  }
}

function makeCtx(submittedAt: number): any {
  return {
    application: { applicationNo: "APP-TEST", status: "SUBMITTED", submittedAt, formData: {} },
    round: { title: "รอบทดสอบ", roundCode: "R1", positionLevel: "-" },
    templateVersion: {},
    sections: [],
    fields: [],
    attachments: [],
  };
}

function main(): void {
  console.log(`\n(process TZ ขณะรัน = ${currentTZ()})`);

  console.log("\n[1] ข้อมูลจริงจาก production — วัน/เวลาต้องเป็น Asia/Bangkok เสมอ");
  for (const row of PROD_ROWS) {
    test(`${row.no}: formatThaiDate(${row.submittedAt}) = "${row.date}"`, () => {
      assertStrictEqual(formatThaiDate(row.submittedAt), row.date);
    });
    test(`${row.no}: formatThaiTime(${row.submittedAt}) = "${row.time}"`, () => {
      assertStrictEqual(formatThaiTime(row.submittedAt), row.time);
    });
  }

  console.log("\n[2] Token path — {APPLICATION_DATE} resolve จาก submittedAt จริง");
  for (const row of PROD_ROWS) {
    test(`${row.no}: {APPLICATION_DATE} = "${row.date}"`, () => {
      const tokens = resolveDocumentTokens(makeCtx(row.submittedAt));
      assertStrictEqual(tokens.APPLICATION_DATE.text, row.date);
    });
  }
  test("applyDocumentTokens ฝังวันที่ไทยลงข้อความ", () => {
    const tokens = resolveDocumentTokens(makeCtx(PROD_ROWS[0].submittedAt));
    assertStrictEqual(
      applyDocumentTokens("วันที่สมัคร: {APPLICATION_DATE}", tokens),
      `วันที่สมัคร: ${PROD_ROWS[0].date}`
    );
  });

  console.log("\n[3] Boundary รอยต่อวัน — ช่วงที่ UTC กลับเป็นวันก่อนหน้า");
  test("ไทย 01 พ.ย. 00:00:00 (= 31 ต.ค. 17:00 UTC) = 1 พฤศจิกายน 2569", () => {
    const sec = Math.floor(Date.parse("2026-11-01T00:00:00+07:00") / 1000);
    assertStrictEqual(formatThaiDate(sec), "1 พฤศจิกายน 2569");
  });
  test("ไทย 01 พ.ย. 06:59:59 (= 31 ต.ค. 23:59:59 UTC) = 1 พฤศจิกายน 2569", () => {
    const sec = Math.floor(Date.parse("2026-11-01T06:59:59+07:00") / 1000);
    assertStrictEqual(formatThaiDate(sec), "1 พฤศจิกายน 2569");
  });
  test("ไทย 01 พ.ย. 06:59:59 → formatThaiTime = 06:59", () => {
    const sec = Math.floor(Date.parse("2026-11-01T06:59:59+07:00") / 1000);
    assertStrictEqual(formatThaiTime(sec), "06:59");
  });
  test("ไทย 01 พ.ย. 07:00:00 (= 01 พ.ย. 00:00 UTC) = 1 พฤศจิกายน 2569", () => {
    const sec = Math.floor(Date.parse("2026-11-01T07:00:00+07:00") / 1000);
    assertStrictEqual(formatThaiDate(sec), "1 พฤศจิกายน 2569");
  });

  console.log("\n[4] {PRINT_DATE} — เวลาพิมพ์ช่วงเช้ามืดไทย");
  test("พิมพ์ 24 พ.ย. 05:00 ไทย = 24 พฤศจิกายน 2569", () => {
    const printAt = Math.floor(Date.parse("2026-11-24T05:00:00+07:00") / 1000);
    const tokens = resolveDocumentTokens(makeCtx(PROD_ROWS[0].submittedAt), undefined, printAt);
    assertStrictEqual(tokens.PRINT_DATE.text, "24 พฤศจิกายน 2569");
  });

  // ============================================================================
  // End
  // ============================================================================
  if (failed > 0) {
    console.log(`\n✗ ${failed} failed:`);
    failures.forEach((f) => console.log(`   - ${f}`));
    process.exit(1);
  }
  console.log(`\n✓ All ${passed} tests passed.\n`);
  process.exit(0);
}

main();
