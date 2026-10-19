// UX Review Report — Document Composer
// Standalone artifact. Open in Cursor Canvas (▶ Open Canvas).

import React, { useState } from "react";

const T = {
  bg: "#f8fafc",
  panel: "#ffffff",
  border: "#e2e8f0",
  text: "#0f172a",
  textMuted: "#475569",
  textSubtle: "#64748b",
  blue: "#2563eb",
  blueSubtle: "#dbeafe",
  green: "#15803d",
  greenSubtle: "#dcfce7",
  red: "#b91c1c",
  redSubtle: "#fee2e2",
  amber: "#b45309",
  amberSubtle: "#fef3c7",
  slate100: "#f1f5f9",
  slate200: "#e2e8f0",
  slate300: "#cbd5e1",
  slate400: "#94a3b8",
  slate500: "#64748b",
  slate600: "#475569",
  slate700: "#334155",
  slate800: "#1e293b",
  slate900: "#0f172a",
};

const Code: React.FC<{ children: React.ReactNode; tone?: "danger" | "good" | "neutral" }> = ({
  children,
  tone = "neutral",
}) => {
  const bg =
    tone === "danger" ? T.redSubtle : tone === "good" ? T.greenSubtle : T.slate100;
  const fg = tone === "danger" ? T.red : tone === "good" ? T.green : T.slate800;
  return (
    <code
      style={{
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 11,
        background: bg,
        color: fg,
        padding: "1px 5px",
        borderRadius: 4,
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
      }}
    >
      {children}
    </code>
  );
};

const Section: React.FC<{
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}> = ({ title, subtitle, children }) => (
  <section
    style={{
      background: T.panel,
      border: `1px solid ${T.border}`,
      borderRadius: 12,
      padding: 24,
      marginBottom: 20,
    }}
  >
    <h2
      style={{
        margin: 0,
        fontSize: 18,
        fontWeight: 700,
        color: T.text,
      }}
    >
      {title}
    </h2>
    {subtitle && (
      <p style={{ margin: "4px 0 16px", color: T.textMuted, fontSize: 13 }}>
        {subtitle}
      </p>
    )}
    {children}
  </section>
);

const Pill: React.FC<{ tone: "ok" | "warn" | "bad"; children: React.ReactNode }> = ({
  tone,
  children,
}) => {
  const bg = tone === "ok" ? T.greenSubtle : tone === "warn" ? T.amberSubtle : T.redSubtle;
  const fg = tone === "ok" ? T.green : tone === "warn" ? T.amber : T.red;
  return (
    <span
      style={{
        display: "inline-block",
        background: bg,
        color: fg,
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 999,
        letterSpacing: 0.2,
      }}
    >
      {children}
    </span>
  );
};

// ---------------------------------------------------------------------------
// MOCKUP — Block Item (UX before/after)
// ---------------------------------------------------------------------------
const MockBlockItem: React.FC<{ before: boolean }> = ({ before }) => {
  const buttons = before
    ? ["▲", "▼", "✏️", "🗑"]
    : ["↑", "↓", "แก้ไข", "ลบ"];
  const showFieldId = before;
  return (
    <div
      style={{
        background: T.panel,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        padding: 12,
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 24,
            height: 24,
            background: T.blueSubtle,
            color: T.blue,
            borderRadius: 4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          F
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: T.text,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            ชื่อ-นามสกุล
          </div>
          <div style={{ fontSize: 10, color: T.textSubtle }}>
            {showFieldId ? (
              <>
                <Code>a3b7d2e1</Code>
                <span style={{ marginLeft: 4 }}>(text)</span>
              </>
            ) : (
              <span>(text)</span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {buttons.map((b, i) => {
            const danger = b === "🗑" || b === "ลบ";
            const primary = b === "แก้ไข";
            return (
              <button
                key={i}
                style={{
                  border: `1px solid ${primary ? T.blue : T.border}`,
                  background: primary ? T.blue : T.panel,
                  color: danger ? T.red : primary ? "#fff" : T.text,
                  fontSize: 11,
                  padding: before ? "4px 6px" : "4px 8px",
                  borderRadius: 4,
                  cursor: "pointer",
                  minWidth: 28,
                }}
              >
                {b}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// MOCKUP — Page title (UX before/after)
// ---------------------------------------------------------------------------
const MockPageTitle: React.FC<{ before: boolean }> = ({ before }) => (
  <div
    style={{
      padding: 12,
      background: T.panel,
      border: `1px solid ${T.border}`,
      borderRadius: 8,
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
    }}
  >
    {before ? (
      <>
        <div
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: T.text,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span>🧩</span>
          <span>Document Composer: ใบสมัครทั่วไป</span>
        </div>
        <div style={{ fontSize: 11, color: T.textSubtle, marginTop: 2 }}>
          v3 • แก้ไขล่าสุด: วันนี้
        </div>
      </>
    ) : (
      <>
        <div
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: T.text,
          }}
        >
          จัดหน้าเอกสาร: ใบสมัครทั่วไป
        </div>
        <div style={{ fontSize: 11, color: T.textSubtle, marginTop: 2 }}>
          จัดลำดับ Heading, Field, Table และ Logo ของเอกสาร — ไม่ต้องเขียน JSON
        </div>
        <div style={{ fontSize: 11, color: T.textSubtle, marginTop: 2 }}>
          v3 • แก้ไขล่าสุด: วันนี้
        </div>
      </>
    )}
  </div>
);

// ---------------------------------------------------------------------------
// MOCKUP — Save Indicator
// ---------------------------------------------------------------------------
const MockSaveIndicator: React.FC<{ state: "saving" | "saved" | "unsaved" | "idle" }> = ({
  state,
}) => {
  const map = {
    saving: { color: T.blue, bg: T.blueSubtle, text: "กำลังบันทึก..." },
    saved: { color: T.green, bg: T.greenSubtle, text: "✓ บันทึกแล้ว เมื่อสักครู่" },
    unsaved: { color: T.red, bg: T.redSubtle, text: "● มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก" },
    idle: { color: T.textMuted, bg: T.slate100, text: "ยังไม่เคยบันทึก" },
  } as const;
  const m = map[state];
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        background: m.bg,
        color: m.color,
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 500,
      }}
    >
      {m.text}
    </div>
  );
};

// ---------------------------------------------------------------------------
// MOCKUP — Alignment preview (visual demonstration)
// ---------------------------------------------------------------------------
const MockAlignPreview: React.FC<{ align: "left" | "center" | "right" }> = ({ align }) => {
  const justify = align === "left" ? "flex-start" : align === "center" ? "center" : "flex-end";
  return (
    <div
      style={{
        background: T.panel,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        padding: 12,
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        minHeight: 180,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: T.textSubtle,
          textTransform: "uppercase",
          letterSpacing: 1,
          marginBottom: 8,
        }}
      >
        Preview (align = {align})
      </div>
      {/* Heading */}
      <div
        style={{
          display: "flex",
          justifyContent: justify,
          marginBottom: 8,
        }}
      >
        <h2
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: T.text,
            margin: 0,
          }}
        >
          ข้อมูลผู้สมัคร
        </h2>
      </div>
      {/* Field */}
      <div
        style={{
          textAlign: align as any,
          marginBottom: 8,
        }}
      >
        <div style={{ fontSize: 12, color: T.textMuted, fontWeight: 500 }}>
          ชื่อ-นามสกุล
        </div>
        <div style={{ fontSize: 14, color: T.text }}>นายสมชาย ใจดี</div>
      </div>
      {/* Table */}
      <div
        style={{
          textAlign: align as any,
        }}
      >
        <div
          style={{
            display: "inline-table",
            border: `1px solid ${T.border}`,
            fontSize: 12,
            background: T.slate100,
            padding: 4,
            color: T.text,
          }}
        >
          [table 1 row × 2 cols]
        </div>
      </div>
      {/* Logo */}
      <div
        style={{
          textAlign: align as any,
          marginTop: 8,
        }}
      >
        <div
          style={{
            display: "inline-block",
            width: 36,
            height: 18,
            background: T.slate300,
            borderRadius: 2,
          }}
        />
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// MOCKUP — FieldPicker (UX before/after)
// ---------------------------------------------------------------------------
const MockFieldPicker: React.FC<{ before: boolean }> = ({ before }) => (
  <div
    style={{
      background: T.panel,
      border: `1px solid ${T.border}`,
      borderRadius: 8,
      padding: 8,
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
      fontSize: 13,
    }}
  >
    <div style={{ fontSize: 10, color: T.textSubtle, marginBottom: 4 }}>
      เพิ่ม Field เข้า Block
    </div>
    {[1, 2, 3].map((i) => (
      <div
        key={i}
        style={{
          padding: "6px 8px",
          borderRadius: 4,
          border: `1px solid ${T.border}`,
          marginBottom: 4,
        }}
      >
        <div style={{ fontSize: 13, color: T.text, fontWeight: 500 }}>
          ชื่อ-นามสกุล
        </div>
        <div style={{ fontSize: 11, color: T.textSubtle, marginTop: 2 }}>
          {before && (
            <>
              <Code>a3b7d2e1</Code>
              <span style={{ marginRight: 6 }}>…</span>
            </>
          )}
          <span>text</span>
        </div>
      </div>
    ))}
  </div>
);

// ===========================================================================
// MAIN COMPONENT
// ===========================================================================
export default function ComposerUXReport() {
  const [alignTab, setAlignTab] = useState<"left" | "center" | "right">("left");

  return (
    <div
      style={{
        minHeight: "100vh",
        background: T.bg,
        color: T.text,
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        padding: "32px 24px",
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {/* HEADER */}
        <header style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <Pill tone="ok">P1 UX Cleanup — Shipped</Pill>
            <span style={{ fontSize: 12, color: T.textMuted }}>
              {new Date().toISOString().slice(0, 10)}
            </span>
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 28,
              fontWeight: 800,
              color: T.text,
              letterSpacing: -0.5,
            }}
          >
            Document Composer — UX Review Report
          </h1>
          <p style={{ margin: "4px 0 0", color: T.textMuted, fontSize: 14 }}>
            เน้นเปลี่ยนเครื่องมือจาก "Developer / JSON tool" → "Document Layout tool"
            — มี 2 root-cause fix (save indicator + alignment rendering)
          </p>
        </header>

        {/* 1. CHANGED FILES */}
        <Section
          title="1. Changed Files"
          subtitle="5 ไฟล์ — 1 backend + 4 frontend · 185 insertions / 107 deletions"
        >
          <table
            style={{
              width: "100%",
              fontSize: 13,
              borderCollapse: "collapse",
            }}
          >
            <thead>
              <tr style={{ background: T.slate100 }}>
                <th
                  style={{
                    textAlign: "left",
                    padding: 8,
                    fontWeight: 600,
                    borderBottom: `1px solid ${T.border}`,
                  }}
                >
                  File
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: 8,
                    fontWeight: 600,
                    borderBottom: `1px solid ${T.border}`,
                  }}
                >
                  Purpose
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: 8,
                    fontWeight: 600,
                    borderBottom: `1px solid ${T.border}`,
                  }}
                >
                  Why
                </th>
              </tr>
            </thead>
            <tbody style={{ fontSize: 12 }}>
              {[
                {
                  f: "backend/src/lib/document-composer/preview-renderer.ts",
                  p: "Alignment + duplicate-attr fix",
                  w: "หา root cause: helper เดิมแยก class/style ออกจากกัน → browser ignore attribute ที่ 2 (alignment ไม่แสดง)",
                },
                {
                  f: "frontend/.../ComposerClient.tsx",
                  p: "useSaveStatus (transition) + page title/subtitle",
                  w: "Save indicator ค้าง เพราะ schemaVersion เป็น const=1 + เปลี่ยน page title เป็นภาษาไทย",
                },
                {
                  f: "frontend/.../components/BlockItem.tsx",
                  p: "Hide fieldId, Edit UX cleanup",
                  w: "ซ่อน technical ID, เปลี่ยน ▲▼✏️🗑 → ↑↓แก้ไข/ซ่อนรายละเอียด ลบ",
                },
                {
                  f: "frontend/.../components/FieldPicker.tsx",
                  p: "Hide UUID",
                  w: "ลบ `<code>{f.fieldId.slice(0, 8)}…</code>` ออก",
                },
                {
                  f: "frontend/.../components/PreviewPanel.tsx",
                  p: "CSS สำหรับ Heading/Field/Table alignment",
                  w: "เพิ่ม rule `.dc-heading.dc-align--*`, `.dc-field.dc-align--*`, `.dc-table-wrap.dc-align--*` ใน srcDoc",
                },
              ].map((r, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${T.border}` }}>
                  <td
                    style={{
                      padding: 8,
                      fontFamily: "ui-monospace, monospace",
                      fontSize: 11,
                      color: T.text,
                    }}
                  >
                    {r.f}
                  </td>
                  <td style={{ padding: 8, color: T.textMuted }}>{r.p}</td>
                  <td style={{ padding: 8, color: T.textMuted }}>{r.w}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        {/* 2. SCREENSHOTS BEFORE/AFTER */}
        <Section
          title="2. Before / After — Visual Mockups"
          subtitle="Text mockups เพราะไม่มีสิทธิ์ screenshot แอปจริง — แต่ style, copy, layout ตรงกับ production code"
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <div
                style={{
                  fontSize: 11,
                  color: T.textMuted,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                ❌ Before
              </div>
              <MockPageTitle before />
              <div style={{ height: 12 }} />
              <MockBlockItem before />
              <div style={{ height: 12 }} />
              <MockFieldPicker before />
            </div>
            <div>
              <div
                style={{
                  fontSize: 11,
                  color: T.textMuted,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                ✅ After
              </div>
              <MockPageTitle after={false as any} />
              <div style={{ height: 12 }} />
              <MockBlockItem before={false} />
              <div style={{ height: 12 }} />
              <MockFieldPicker before={false} />
            </div>
          </div>

          <div style={{ marginTop: 20 }}>
            <div
              style={{
                fontSize: 11,
                color: T.textMuted,
                fontWeight: 600,
                textTransform: "uppercase",
                marginBottom: 6,
              }}
            >
              Save Indicator — state machine
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <MockSaveIndicator state="idle" />
              <MockSaveIndicator state="saving" />
              <MockSaveIndicator state="saved" />
              <MockSaveIndicator state="unsaved" />
            </div>
          </div>

          <div style={{ marginTop: 20 }}>
            <div
              style={{
                fontSize: 11,
                color: T.textMuted,
                fontWeight: 600,
                textTransform: "uppercase",
                marginBottom: 6,
              }}
            >
              Alignment — left / center / right (live preview)
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              {(["left", "center", "right"] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => setAlignTab(a)}
                  style={{
                    padding: "4px 12px",
                    borderRadius: 4,
                    border: `1px solid ${alignTab === a ? T.blue : T.border}`,
                    background: alignTab === a ? T.blue : T.panel,
                    color: alignTab === a ? "#fff" : T.text,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {a}
                </button>
              ))}
            </div>
            <MockAlignPreview align={alignTab} />
            <p
              style={{
                marginTop: 8,
                fontSize: 12,
                color: T.textMuted,
              }}
            >
              ทดสอบกับ renderer แล้วทั้ง 3 ค่า — HTML ออกมาถูก, CSS rule ใน srcDoc รองรับ,
              duplicate-attribute bug หายแล้ว
            </p>
          </div>
        </Section>

        {/* 3. TEST RESULTS */}
        <Section
          title="3. Test Results"
          subtitle="รัน typecheck, build และเขียน simulation 4 scenarios"
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              { name: "frontend typecheck", result: "✅ PASS", note: "0 errors" },
              { name: "frontend build", result: "✅ PASS", note: "/admin/templates/composer → 14.5 kB" },
              { name: "backend typecheck", result: "✅ PASS", note: "0 errors" },
              { name: "save-state simulation", result: "✅ 4/4", note: "A,B,C,D scenarios" },
              { name: "alignment HTML probe", result: "✅ 3/3", note: "left, center, right" },
              {
                name: "duplicate-attr check",
                result: "✅ 0 dup",
                note: "elements with double class/style = 0",
              },
            ].map((t) => (
              <div
                key={t.name}
                style={{
                  border: `1px solid ${T.border}`,
                  borderRadius: 6,
                  padding: 10,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</div>
                  <div style={{ fontSize: 11, color: T.textSubtle }}>{t.note}</div>
                </div>
                <Pill tone="ok">{t.result}</Pill>
              </div>
            ))}
          </div>

          <h3 style={{ fontSize: 14, margin: "20px 0 8px", color: T.text }}>
            Save Indicator Simulation
          </h3>
          <p style={{ fontSize: 12, color: T.textMuted, marginBottom: 8 }}>
            4 scenarios — ทุกตัวไม่มี timeout / setTimeout / 200ms recovery
          </p>
          <table
            style={{
              width: "100%",
              fontSize: 12,
              borderCollapse: "collapse",
            }}
          >
            <thead>
              <tr style={{ background: T.slate100 }}>
                <th style={{ textAlign: "left", padding: 6 }}>Scenario</th>
                <th style={{ textAlign: "left", padding: 6 }}>Input</th>
                <th style={{ textAlign: "left", padding: 6 }}>Expected</th>
                <th style={{ textAlign: "left", padding: 6 }}>Result</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["A", "Save #1 success", "saved", "✅ saved"],
                ["B", "Save #2 success (เคยเป็น bug)", "saved", "✅ saved"],
                ["C", "Save fail (lastError set)", "unsaved", "✅ unsaved"],
                ["D", "First save after default source", "saved", "✅ saved"],
              ].map((row, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${T.border}` }}>
                  {row.map((c, j) => (
                    <td key={j} style={{ padding: 6, color: T.text }}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          <h3 style={{ fontSize: 14, margin: "20px 0 8px", color: T.text }}>
            Alignment HTML Probe (excerpt)
          </h3>
          <pre
            style={{
              background: T.slate900,
              color: T.slate100,
              padding: 12,
              borderRadius: 6,
              fontSize: 11,
              fontFamily: "ui-monospace, monospace",
              overflow: "auto",
              lineHeight: 1.5,
            }}
          >{`# align=center
<h2 class="dc-heading dc-heading--large dc-heading--bold
    dc-block dc-align--center" style="font-size: 16pt">...</h2>
<section class="dc-field dc-block dc-align--center">
  <div class="dc-field__label">ชื่อ-นามสกุล</div>
  <div class="dc-field__value">นายสมชาย ใจดี</div>
</section>
<section class="dc-table-wrap dc-block dc-align--center">
  <table class="dc-table">...</table>
</section>
<section class="dc-block dc-logo dc-align--center">
  <img src="" alt="SAO Logo" />
</section>

# elements with double class: 0  (was 1 before)
# elements with double style: 0  (was 1 before)`}</pre>
        </Section>

        {/* 4. GIT DIFF SUMMARY */}
        <Section title="4. Git Diff Summary">
          <pre
            style={{
              background: T.slate100,
              padding: 12,
              borderRadius: 6,
              fontSize: 11,
              fontFamily: "ui-monospace, monospace",
              overflow: "auto",
              lineHeight: 1.6,
              margin: 0,
            }}
          >{`$ git diff --stat HEAD
 backend/src/lib/document-composer/preview-renderer.ts   | 112 +++++++++--------
 frontend/src/app/(admin)/admin/templates/composer/ComposerClient.tsx | 99 +++++++++-----
 frontend/src/app/(admin)/admin/templates/composer/components/BlockItem.tsx | 33 +++---
 frontend/src/app/(admin)/admin/templates/composer/components/FieldPicker.tsx | 3 -
 frontend/src/app/(admin)/admin/templates/composer/components/PreviewPanel.tsx | 45 ++++++++
 5 files changed, 185 insertions(+), 107 deletions(-)`}</pre>
        </Section>

        {/* ROOT CAUSE NOTES */}
        <Section
          title="Root Cause Notes"
          subtitle="ทั้ง 2 fix เป็น state/HTML transition-based ไม่ใช่ workaround"
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div
              style={{
                border: `1px solid ${T.border}`,
                borderRadius: 6,
                padding: 12,
              }}
            >
              <h4
                style={{
                  margin: 0,
                  fontSize: 13,
                  fontWeight: 700,
                  color: T.text,
                }}
              >
                Save Indicator (A)
              </h4>
              <p
                style={{
                  fontSize: 12,
                  color: T.textMuted,
                  margin: "6px 0",
                  lineHeight: 1.5,
                }}
              >
                <strong>Root cause:</strong>{" "}
                <Code>CURRENT_DESCRIPTOR_SCHEMA_VERSION = 1</Code> เป็น const → ใช้
                <Code> schemaVersion </Code> เปรียบเทียบไม่ได้หลัง save #2
              </p>
              <p
                style={{
                  fontSize: 12,
                  color: T.textMuted,
                  margin: "6px 0",
                  lineHeight: 1.5,
                }}
              >
                <strong>Fix:</strong> ใช้ <Code>edge detection</Code> ของ
                <Code> loading.save (true→false) </Code> + <Code>lastError</Code>
                เป็นเงื่อนไข ไม่ต้อง bump schemaVersion, ไม่มี timeout
              </p>
            </div>
            <div
              style={{
                border: `1px solid ${T.border}`,
                borderRadius: 6,
                padding: 12,
              }}
            >
              <h4
                style={{
                  margin: 0,
                  fontSize: 13,
                  fontWeight: 700,
                  color: T.text,
                }}
              >
                Alignment (A)
              </h4>
              <p
                style={{
                  fontSize: 12,
                  color: T.textMuted,
                  margin: "6px 0",
                  lineHeight: 1.5,
                }}
              >
                <strong>Root cause:</strong> helper เดิม <Code>buildBlockStyleAttrs</Code>{" "}
                ส่ง string แยก (e.g. <Code>class="…" style="…"</Code>) แล้ว caller
                เอาไปต่อท้าย element ที่มี class/style อยู่แล้ว → browser ignore
                attribute ที่ 2
              </p>
              <p
                style={{
                  fontSize: 12,
                  color: T.textMuted,
                  margin: "6px 0",
                  lineHeight: 1.5,
                }}
              >
                <strong>Fix:</strong> inline align class + margin style เข้า
                attribute เดียวกันของแต่ละ element, ลบ helper ที่ไม่ใช้แล้ว
              </p>
            </div>
          </div>
        </Section>

        <footer
          style={{
            textAlign: "center",
            color: T.textSubtle,
            fontSize: 11,
            marginTop: 32,
          }}
        >
          Cursor Agent · {new Date().toISOString().slice(0, 10)}
        </footer>
      </div>
    </div>
  );
}
