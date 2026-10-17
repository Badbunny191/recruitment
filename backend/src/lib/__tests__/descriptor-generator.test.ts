/**
 * Unit Tests: Descriptor Generator
 *
 * รัน: node --import tsx src/lib/__tests__/descriptor-generator.test.ts
 *
 * ทดสอบ generateDescriptorFromTemplate() — pure function ที่สร้าง
 * DocumentDescriptor จาก sections + fields
 *
 * ครอบคลุม:
 *   1. Basic generation (logo + sections + fields)
 *   2. Sort order (sections + fields ตาม displayOrder)
 *   3. Field → FieldBlock (default)
 *   4. Field → TableBlock (MASTER_DATA heuristic)
 *   5. Field → TableBlock (tableFieldIds override)
 *   6. Unsectioned fields (sectionId === null) → ไม่มี heading
 *   7. Empty input → empty blocks
 *   8. label resolution (overrideLabelTh → labelTh)
 *   9. Block id uniqueness (ไม่ซ้ำ)
 *  10. Output passes descriptor validation
 *  11. Version = 1
 *  12. Error: invalid input shape
 */

import {
  generateDescriptorFromTemplate,
  type GeneratorInput,
  type GeneratorSectionInput,
  type GeneratorFieldInput,
} from "../document-composer/descriptor-generator";
import { validateDescriptor } from "../document-composer/descriptor-validator";

// =============================================================================
// Test framework
// =============================================================================

declare const process: { exit(code?: number): never };

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((e: any) => {
      failed++;
      failures.push(`${name}: ${e.message}`);
      console.log(`  ✗ ${name}: ${e.message}`);
    });
}

function assertEqual<T>(actual: T, expected: T, msg = "") {
  if (actual !== expected) {
    throw new Error(
      `${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function assertTrue(condition: boolean, msg = "") {
  if (!condition) throw new Error(msg || "Expected true");
}

function assertFalse(condition: boolean, msg = "") {
  if (condition) throw new Error(msg || "Expected false");
}

// =============================================================================
// Fixtures
// =============================================================================

function makeSection(
  id: string,
  name: string,
  displayOrder: number
): GeneratorSectionInput {
  return { id, name, displayOrder, isActive: true };
}

function makeField(
  id: string,
  fieldId: string,
  sectionId: string | null,
  displayOrder: number,
  type: GeneratorFieldInput["type"],
  labelTh: string,
  overrideLabelTh: string | null = null
): GeneratorFieldInput {
  return {
    id,
    fieldId,
    sectionId,
    displayOrder,
    type,
    labelTh,
    overrideLabelTh,
  };
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log("\n=== Descriptor Generator — Unit Tests ===\n");

  // ── 1. Basic generation ───────────────────────────────────────────
  console.log("[1] Basic generation");
  await test("generates logo block as the first block", () => {
    const input: GeneratorInput = {
      sections: [makeSection("s1", "ข้อมูลส่วนตัว", 1)],
      fields: [makeField("f1", "fm-name", "s1", 1, "TEXT", "ชื่อ")],
    };
    const result = generateDescriptorFromTemplate(input);
    assertTrue(result.ok);
    if (!result.ok) return;
    assertEqual(result.descriptor.blocks[0].type, "logo");
    assertEqual(result.descriptor.version, 1);
  });

  await test("generates heading block per section with name", () => {
    const input: GeneratorInput = {
      sections: [
        makeSection("s1", "ข้อมูลส่วนตัว", 1),
        makeSection("s2", "ประวัติการศึกษา", 2),
      ],
      fields: [],
    };
    const result = generateDescriptorFromTemplate(input);
    assertTrue(result.ok);
    if (!result.ok) return;
    const headings = result.descriptor.blocks.filter(
      (b) => b.type === "heading"
    );
    assertEqual(headings.length, 2);
  });

  // ── 2. Sort order ─────────────────────────────────────────────────
  console.log("\n[2] Sort order");
  await test("sections are sorted by displayOrder (asc)", () => {
    const input: GeneratorInput = {
      sections: [
        makeSection("s2", "B Section", 2),
        makeSection("s1", "A Section", 1),
        makeSection("s3", "C Section", 3),
      ],
      fields: [],
    };
    const result = generateDescriptorFromTemplate(input);
    assertTrue(result.ok);
    if (!result.ok) return;
    const headings = result.descriptor.blocks.filter(
      (b) => b.type === "heading"
    );
    assertEqual(
      (headings[0] as any).text,
      "A Section"
    );
    assertEqual(
      (headings[1] as any).text,
      "B Section"
    );
    assertEqual(
      (headings[2] as any).text,
      "C Section"
    );
  });

  await test("fields within a section are sorted by displayOrder (asc)", () => {
    const input: GeneratorInput = {
      sections: [makeSection("s1", "Info", 1)],
      fields: [
        makeField("f3", "fm-c", "s1", 3, "TEXT", "C"),
        makeField("f1", "fm-a", "s1", 1, "TEXT", "A"),
        makeField("f2", "fm-b", "s1", 2, "TEXT", "B"),
      ],
    };
    const result = generateDescriptorFromTemplate(input);
    assertTrue(result.ok);
    if (!result.ok) return;
    const fields = result.descriptor.blocks.filter(
      (b) => b.type === "field"
    );
    assertEqual(fields.length, 3);
    assertEqual((fields[0] as any).fieldId, "fm-a");
    assertEqual((fields[1] as any).fieldId, "fm-b");
    assertEqual((fields[2] as any).fieldId, "fm-c");
  });

  // ── 3. Field → FieldBlock (default) ───────────────────────────────
  console.log("\n[3] Field → FieldBlock");
  await test("TEXT field becomes FieldBlock", () => {
    const input: GeneratorInput = {
      sections: [makeSection("s1", "Info", 1)],
      fields: [makeField("f1", "fm-name", "s1", 1, "TEXT", "ชื่อ")],
    };
    const result = generateDescriptorFromTemplate(input);
    assertTrue(result.ok);
    if (!result.ok) return;
    const field = result.descriptor.blocks.find((b) => b.type === "field");
    assertTrue(field !== undefined);
    if (!field || field.type !== "field") return;
    assertEqual(field.fieldId, "fm-name");
    assertEqual(field.label, "ชื่อ");
  });

  await test("TEXTAREA, NUMBER, DATE become FieldBlock", () => {
    const input: GeneratorInput = {
      sections: [makeSection("s1", "Info", 1)],
      fields: [
        makeField("f1", "fm-ta", "s1", 1, "TEXTAREA", "ประสบการณ์"),
        makeField("f2", "fm-num", "s1", 2, "NUMBER", "GPA"),
        makeField("f3", "fm-date", "s1", 3, "DATE", "วันเกิด"),
      ],
    };
    const result = generateDescriptorFromTemplate(input);
    assertTrue(result.ok);
    if (!result.ok) return;
    const fields = result.descriptor.blocks.filter((b) => b.type === "field");
    assertEqual(fields.length, 3);
  });

  // ── 4. Field → TableBlock (MASTER_DATA heuristic) ─────────────────
  console.log("\n[4] Field → TableBlock (MASTER_DATA heuristic)");
  await test("MASTER_DATA field becomes TableBlock by default", () => {
    const input: GeneratorInput = {
      sections: [makeSection("s1", "Org", 1)],
      fields: [
        makeField("f1", "fm-org", "s1", 1, "MASTER_DATA", "หน่วยงาน"),
      ],
    };
    const result = generateDescriptorFromTemplate(input);
    assertTrue(result.ok);
    if (!result.ok) return;
    const table = result.descriptor.blocks.find((b) => b.type === "table");
    assertTrue(table !== undefined);
    if (!table || table.type !== "table") return;
    assertEqual(table.fieldId, "fm-org");
  });

  // ── 5. Field → TableBlock (tableFieldIds override) ────────────────
  console.log("\n[5] Field → TableBlock (tableFieldIds override)");
  await test("field in tableFieldIds becomes TableBlock", () => {
    const input: GeneratorInput = {
      sections: [makeSection("s1", "Info", 1)],
      fields: [
        makeField("f1", "fm-multi", "s1", 1, "TEXT", "รายการ"),
      ],
      tableFieldIds: ["f1"],
    };
    const result = generateDescriptorFromTemplate(input);
    assertTrue(result.ok);
    if (!result.ok) return;
    const table = result.descriptor.blocks.find((b) => b.type === "table");
    assertTrue(table !== undefined);
    if (!table || table.type !== "table") return;
    assertEqual(table.fieldId, "fm-multi");
  });

  await test("tableFieldIds is per template_field id, not field_master id", () => {
    const input: GeneratorInput = {
      sections: [makeSection("s1", "Info", 1)],
      fields: [
        makeField("f1", "fm-a", "s1", 1, "TEXT", "A"),
        makeField("f2", "fm-b", "s1", 2, "TEXT", "B"),
      ],
      tableFieldIds: ["f1"], // template_field.id
    };
    const result = generateDescriptorFromTemplate(input);
    assertTrue(result.ok);
    if (!result.ok) return;
    const tables = result.descriptor.blocks.filter((b) => b.type === "table");
    const fields = result.descriptor.blocks.filter((b) => b.type === "field");
    assertEqual(tables.length, 1);
    assertEqual(fields.length, 1);
    if (tables[0]?.type === "table") {
      assertEqual(tables[0].fieldId, "fm-a"); // field_master.id
    }
  });

  // ── 6. Unsectioned fields ─────────────────────────────────────────
  console.log("\n[6] Unsectioned fields");
  await test("unsectioned fields (sectionId === null) get no heading", () => {
    const input: GeneratorInput = {
      sections: [makeSection("s1", "Section A", 1)],
      fields: [
        makeField("f1", "fm-x", null, 1, "TEXT", "X"), // unsectioned
        makeField("f2", "fm-y", "s1", 1, "TEXT", "Y"), // in section
      ],
    };
    const result = generateDescriptorFromTemplate(input);
    assertTrue(result.ok);
    if (!result.ok) return;
    const headings = result.descriptor.blocks.filter(
      (b) => b.type === "heading"
    );
    assertEqual(headings.length, 1);
    assertEqual((headings[0] as any).text, "Section A");
  });

  await test("unsectioned fields are appended after sections", () => {
    const input: GeneratorInput = {
      sections: [makeSection("s1", "Section A", 1)],
      fields: [
        makeField("f1", "fm-y", "s1", 1, "TEXT", "Y"), // in section
        makeField("f2", "fm-x", null, 1, "TEXT", "X"), // unsectioned
      ],
    };
    const result = generateDescriptorFromTemplate(input);
    assertTrue(result.ok);
    if (!result.ok) return;
    const last = result.descriptor.blocks[result.descriptor.blocks.length - 1];
    assertEqual(last.type, "field");
    if (last.type === "field") {
      assertEqual(last.fieldId, "fm-x");
    }
  });

  // ── 7. Empty input ────────────────────────────────────────────────
  console.log("\n[7] Empty input");
  await test("empty sections + fields still returns logo block", () => {
    const result = generateDescriptorFromTemplate({
      sections: [],
      fields: [],
    });
    assertTrue(result.ok);
    if (!result.ok) return;
    assertEqual(result.descriptor.blocks.length, 1);
    assertEqual(result.descriptor.blocks[0].type, "logo");
  });

  // ── 8. Label resolution ───────────────────────────────────────────
  console.log("\n[8] Label resolution");
  await test("uses overrideLabelTh when present", () => {
    const input: GeneratorInput = {
      sections: [makeSection("s1", "Info", 1)],
      fields: [
        makeField("f1", "fm-x", "s1", 1, "TEXT", "Original Label", "Override Label"),
      ],
    };
    const result = generateDescriptorFromTemplate(input);
    assertTrue(result.ok);
    if (!result.ok) return;
    const field = result.descriptor.blocks.find((b) => b.type === "field");
    if (field?.type === "field") {
      assertEqual(field.label, "Override Label");
    }
  });

  await test("falls back to labelTh when no override", () => {
    const input: GeneratorInput = {
      sections: [makeSection("s1", "Info", 1)],
      fields: [
        makeField("f1", "fm-x", "s1", 1, "TEXT", "Master Label", null),
      ],
    };
    const result = generateDescriptorFromTemplate(input);
    assertTrue(result.ok);
    if (!result.ok) return;
    const field = result.descriptor.blocks.find((b) => b.type === "field");
    if (field?.type === "field") {
      assertEqual(field.label, "Master Label");
    }
  });

  // ── 9. Block id uniqueness ────────────────────────────────────────
  console.log("\n[9] Block id uniqueness");
  await test("all block ids are unique", () => {
    const input: GeneratorInput = {
      sections: [
        makeSection("s1", "A", 1),
        makeSection("s2", "B", 2),
        makeSection("s3", "C", 3),
      ],
      fields: [
        makeField("f1", "fm-1", "s1", 1, "TEXT", "1"),
        makeField("f2", "fm-2", "s2", 1, "TEXT", "2"),
        makeField("f3", "fm-3", "s3", 1, "TEXT", "3"),
      ],
    };
    const result = generateDescriptorFromTemplate(input);
    assertTrue(result.ok);
    if (!result.ok) return;
    const ids = result.descriptor.blocks.map((b) => b.id);
    const uniqueIds = new Set(ids);
    assertEqual(uniqueIds.size, ids.length);
  });

  // ── 10. Output passes descriptor validation ───────────────────────
  console.log("\n[10] Output passes descriptor validation");
  await test("generated descriptor passes validateDescriptor()", () => {
    const input: GeneratorInput = {
      sections: [
        makeSection("s1", "Info", 1),
        makeSection("s2", "Education", 2),
      ],
      fields: [
        makeField("f1", "fm-name", "s1", 1, "TEXT", "ชื่อ"),
        makeField("f2", "fm-age", "s1", 2, "NUMBER", "อายุ"),
        makeField("f3", "fm-school", "s2", 1, "TEXT", "โรงเรียน"),
        makeField("f4", "fm-gpa", "s2", 2, "NUMBER", "GPA"),
        makeField("f5", "fm-org", "s2", 3, "MASTER_DATA", "หน่วยงาน"),
      ],
    };
    const result = generateDescriptorFromTemplate(input);
    assertTrue(result.ok);
    if (!result.ok) return;
    const validation = validateDescriptor(result.descriptor);
    assertTrue(validation.ok);
  });

  // ── 11. Version = 1 ───────────────────────────────────────────────
  console.log("\n[11] Version");
  await test("descriptor version is always 1", () => {
    const result = generateDescriptorFromTemplate({
      sections: [],
      fields: [],
    });
    assertTrue(result.ok);
    if (!result.ok) return;
    assertEqual(result.descriptor.version, 1);
  });

  // ── 12. Error: invalid input ──────────────────────────────────────
  console.log("\n[12] Error: invalid input");
  await test("non-array sections returns ok: false", () => {
    const result = generateDescriptorFromTemplate({
      sections: null as any,
      fields: [],
    });
    assertFalse(result.ok);
    if (!result.ok) {
      assertTrue(result.issues.length > 0);
    }
  });

  await test("non-array fields returns ok: false", () => {
    const result = generateDescriptorFromTemplate({
      sections: [],
      fields: undefined as any,
    });
    assertFalse(result.ok);
  });

  // ── 13. Meta info ─────────────────────────────────────────────────
  console.log("\n[13] Meta info");
  await test("meta includes correct counts", () => {
    const input: GeneratorInput = {
      sections: [
        makeSection("s1", "A", 1),
        makeSection("s2", "B", 2),
      ],
      fields: [
        makeField("f1", "fm-1", "s1", 1, "TEXT", "1"),
        makeField("f2", "fm-2", "s1", 2, "TEXT", "2"),
        makeField("f3", "fm-3", "s2", 1, "MASTER_DATA", "3"),
        makeField("f4", "fm-4", null, 1, "TEXT", "4"),
      ],
    };
    const result = generateDescriptorFromTemplate(input);
    assertTrue(result.ok);
    if (!result.ok) return;
    assertEqual(result.meta.logoBlockId, result.descriptor.blocks[0].id);
    assertEqual(result.meta.headingCount, 2);
    assertEqual(result.meta.fieldBlockCount, 3);
    assertEqual(result.meta.tableBlockCount, 1);
    // 1 logo + 2 headings + 3 fields + 1 table = 7
    assertEqual(result.meta.totalBlocks, 7);
  });

  // ── 14. Section with empty name → no heading ──────────────────────
  console.log("\n[14] Section with empty name");
  await test("section with empty name does not generate heading", () => {
    const input: GeneratorInput = {
      sections: [
        makeSection("s1", "", 1), // empty name
        makeSection("s2", "Real Section", 2),
      ],
      fields: [],
    };
    const result = generateDescriptorFromTemplate(input);
    assertTrue(result.ok);
    if (!result.ok) return;
    const headings = result.descriptor.blocks.filter(
      (b) => b.type === "heading"
    );
    assertEqual(headings.length, 1);
    assertEqual((headings[0] as any).text, "Real Section");
  });

  // ── 15. Heading style defaults ────────────────────────────────────
  console.log("\n[15] Heading style defaults");
  await test("heading uses size=medium + bold=true + align=left", () => {
    const input: GeneratorInput = {
      sections: [makeSection("s1", "Info", 1)],
      fields: [],
    };
    const result = generateDescriptorFromTemplate(input);
    assertTrue(result.ok);
    if (!result.ok) return;
    const heading = result.descriptor.blocks.find((b) => b.type === "heading");
    if (heading?.type === "heading") {
      assertEqual(heading.size, "medium");
      assertEqual(heading.bold, true);
      assertEqual(heading.align, "left");
      assertTrue(heading.marginTop !== undefined && heading.marginTop > 0);
    }
  });

  // ── Summary ───────────────────────────────────────────────────────
  console.log("\n=== Summary ===");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Test runner crashed:", e);
  process.exit(1);
});
