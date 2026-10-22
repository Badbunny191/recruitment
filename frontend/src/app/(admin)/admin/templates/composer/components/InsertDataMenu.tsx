'use client';

/**
 * InsertDataMenu
 * ------------------------------------------------------------------
 * เมนู "แทรกข้อมูล" สำหรับ Heading/Text Editor
 *
 * 2 กลุ่ม (Requirement A):
 *   1. กลุ่มข้อมูลระบบ   → {APPLICATION_NO}, {ROUND_NAME}, …
 *   2. กลุ่มข้อมูลผู้สมัคร → {FIELD:<fieldId>} ของ Template Version ปัจจุบัน
 *
 * ── แทรก ณ cursor position ────────────────────────────────────────────────
 * เมนูนี้**ไม่**ต่อท้ายข้อความ แต่แทรกที่ตำแหน่งเคอร์เซอร์จริงใน textarea:
 *   - ครั้งแรก: ใช้ `selectionStart` ปัจจุบัน
 *   - หลังแทรก: คืน focus + วางเคอร์เซอร์หลัง token ที่แทรก
 *
 * ── รองรับข้อความหลายบรรทัด + ข้อความผสม token ────────────────────────────
 * ไม่แตะ newline เดิม — token ที่แทรกเป็นข้อความชิ้นเดียวในบรรทัดที่เคอร์เซอร์อยู่
 * (ถ้าต้องการขึ้นบรรทัดใหม่ ให้กด Enter ใน textarea ก่อน)
 *
 * ── Unknown token ──────────────────────────────────────────────────────────
 * ถ้าผู้ใช้พิมพ์ `{FOO}` เอง renderer จะคงไว้เป็นข้อความ (ไม่ลบทิ้ง)
 * → เอกสารไม่ล้ม (Requirement K.6)
 *
 * ── Positioning (UAT fix) ────────────────────────────────────────────────────
 * เดิมเมนูเป็น `position: absolute; left: 0` อยู่ใน wrapper ของปุ่ม
 * → เมนูกว้าง 340px ล้นขอบ Visual Composer → ถูก parent `overflow` ตัด
 *
 * แก้โดย:
 *   - ย้ายเมนูไปอยู่ใน **Portal** (document.body) + `position: fixed`
 *     → ไม่ถูกตัดโดย parent overflow และไม่ทำให้ body มี horizontal scrollbar
 *   - คำนวณตำแหน่งแบบ **right-aligned** (ชิดขอบขวาของปุ่ม) + clamp เข้า viewport
 *     → ใช้ได้ทั้ง Desktop, Sidebar expanded/collapsed และหน้าจอแคบ
 *   - ปิดเมนูเมื่อกดภายนอก / กด Escape (เหมือนเดิม)
 *
 * ⚠️ ไม่แต้พฤติกรรมการแทรก token (insertAtCursor) — เหมือนเดิมทุกประการ
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  INSERTABLE_TOKENS,
  INSERTABLE_TOKEN_LABELS,
  type InsertableToken,
} from '@/lib/api/template-descriptor';
import type { TemplateFieldLibraryItem } from '../hooks/useTemplateFields';
import { MENU_ANCHOR_GAP, computeMenuPosition } from '../lib/menu-position';

/**
 * useLayoutEffect ที่ปลอดภัยกับ SSR
 *
 * Next.js render ฝั่ง server → useLayoutEffect เตือน (ไม่มีผลกับผลลัพธ์)
 * ใช้ useEffect ตอน server / useLayoutEffect ตอน client
 */
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// =============================================================================
// Props
// =============================================================================

export interface InsertDataMenuProps {
  /** textarea ที่จะแทรก token — ใช้อ่าน/เขียน selection */
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  /** ข้อความปัจจุบัน (controlled) */
  value: string;
  /** callback เรียกเมื่อข้อความเปลี่ยน */
  onChange: (next: string) => void;
  /** Application Fields ของ Template Version ปัจจุบัน */
  fields: TemplateFieldLibraryItem[];
  fieldsLoading?: boolean;
  disabled?: boolean;
}

// =============================================================================
// Token builders (mirror backend document-tokens.ts)
// =============================================================================

/** สร้าง system token — `{APPLICATION_NO}` */
export function buildSystemToken(token: InsertableToken): string {
  return `{${token}}`;
}

/**
 * สร้าง Application Field token — `{FIELD:<fieldId>}`
 *
 * ใช้ `field_master.id` (stable mapping key) เท่านั้น
 * ห้ามผูกด้วย label ไทย เพราะ label เปลี่ยนได้ (Requirement A.6 / C.4)
 */
export function buildFieldToken(fieldId: string): string {
  return `{FIELD:${fieldId}}`;
}

// =============================================================================
// Pure helper: แทรกข้อความ ณ cursor position
// =============================================================================

export interface InsertAtCursorResult {
  text: string;
  /** ตำแหน่งเคอร์เซอร์ใหม่ (หลัง token ที่แทรก) */
  caret: number;
}

/**
 * แทรก `snippet` ณ `cursor` ภายใน `text`
 *
 * Pure function — แยกจาก React เพื่อให้ test ได้โดยไม่ต้อง render DOM
 *
 * @param text - ข้อความปัจจุบัน (อาจมีหลายบรรทัด)
 * @param cursor - ตำแหน่งที่จะแทรก (selectionStart)
 * @param snippet - ข้อความที่จะแทรก (เช่น `{ROUND_NAME}`)
 */
export function insertAtCursor(
  text: string,
  cursor: number,
  snippet: string
): InsertAtCursorResult {
  // ป้องกัน cursor เพี้ยน (เช่น null, NaN, เกินความยาว)
  const safeCursor =
    Number.isFinite(cursor) && cursor >= 0
      ? Math.min(Math.floor(cursor), text.length)
      : text.length;

  const before = text.slice(0, safeCursor);
  const after = text.slice(safeCursor);
  const next = before + snippet + after;

  return {
    text: next,
    caret: before.length + snippet.length,
  };
}

// =============================================================================
// Component
// =============================================================================

export function InsertDataMenu({
  textareaRef,
  value,
  onChange,
  fields,
  fieldsLoading,
  disabled,
}: InsertDataMenuProps) {
  const [open, setOpen] = useState(false);
  const [fieldSearch, setFieldSearch] = useState('');
  const [showAllFields, setShowAllFields] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  /** ปุ่มที่ใช้เป็น anchor ของเมนู */
  const buttonRef = useRef<HTMLButtonElement>(null);
  /** ตัวเมนู (อยู่ใน Portal) */
  const menuRef = useRef<HTMLDivElement>(null);
  /** ตำแหน่งแบบ fixed (คำนวณจากพื้นที่จริงของ viewport) */
  const [menuPos, setMenuPos] = useState<{
    top: number;
    left: number;
    ready: boolean;
  }>({ top: 0, left: 0, ready: false });

  /** ความกว้างเมนู (px) — ต้องตรงกับ class w-[340px] */
  const MENU_WIDTH = 340;
  /** ความสูงโดยประมาณ (px) — ใช้ตัดสินว่าจะพลิกขึ้นด้านบนไหม */
  const MENU_ESTIMATED_HEIGHT = 420;

  // ── คำนวณตำแหน่งเมนู (right-aligned + clamp เข้า viewport) ──────────────
  // ใช้ useLayoutEffect เพื่อไม่ให้เมนู "กระพริบ" ในตำแหน่งผิดก่อนคำนวณ
  const reposition = useCallback(() => {
    const anchor = buttonRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const pos = computeMenuPosition(
      rect,
      MENU_WIDTH,
      MENU_ESTIMATED_HEIGHT,
      { width: window.innerWidth, height: window.innerHeight },
      MENU_ANCHOR_GAP
    );
    setMenuPos({ top: pos.top, left: pos.left, ready: true });
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (!open) {
      setMenuPos({ top: 0, left: 0, ready: false });
      return;
    }
    reposition();

    // คำนวณใหม่เมื่อเลื่อนหน้า / เปลี่ยนขนาดหน้าจอ / เปลี่ยน layout
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, reposition]);

  // ปิดเมนูเมื่อคลิกนอกพื้นที่ (ทั้งปุ่ม และตัวเมนูที่อยู่ใน Portal)
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      const inButton = wrapperRef.current?.contains(target);
      const inMenu = menuRef.current?.contains(target);
      if (!inButton && !inMenu) {
        setOpen(false);
        setFieldSearch('');
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // ปิดเมนูเมื่อกด Esc
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setFieldSearch('');
        textareaRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, textareaRef]);

  /**
   * แทรก snippet ณ cursor position จริงใน textarea
   *
   * ถ้าหา selection ไม่ได้ (เช่น textarea ยังไม่ mount) → fallback แทรกท้าย
   */
  const handleInsert = useCallback(
    (snippet: string) => {
      const el = textareaRef.current;
      const cursor = el?.selectionStart ?? value.length;
      const result = insertAtCursor(value, cursor, snippet);
      onChange(result.text);

      // คืน focus + วางเคอร์เซอร์หลัง token ที่แทรก
      requestAnimationFrame(() => {
        const target = textareaRef.current;
        if (!target) return;
        target.focus();
        target.setSelectionRange(result.caret, result.caret);
      });
    },
    [onChange, textareaRef, value]
  );

  const filteredFields = fields.filter((f) => {
    const q = fieldSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      f.labelTh.toLowerCase().includes(q) ||
      f.fieldId.toLowerCase().includes(q) ||
      (f.fieldType || '').toLowerCase().includes(q)
    );
  });

  const visibleFields = showAllFields ? filteredFields : filteredFields.slice(0, 8);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className={`h-8 px-2.5 text-xs rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          open
            ? 'bg-blue-600 text-white border-blue-600'
            : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
        }`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="แทรกข้อมูลระบบหรือข้อมูลผู้สมัคร ณ ตำแหน่งเคอร์เซอร์"
      >
        <span className="mr-1">➕</span>
        แทรกข้อมูล
      </button>

      {!open || !menuPos.ready || typeof document === 'undefined'
        ? null
        : createPortal(
            <div
              ref={menuRef}
              role="menu"
              data-testid="insert-data-menu"
              style={{
                position: 'fixed',
                top: menuPos.top,
                left: menuPos.left,
                width: MENU_WIDTH,
                zIndex: 9999,
              }}
              className="rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden"
            >
              {/* ── กลุ่มข้อมูลระบบ ─────────────────────────────────── */}
              <div className="px-3 py-2 border-b border-slate-100">
                <p className="text-[10px] font-semibold uppercase text-slate-500 mb-1.5">
                  กลุ่มข้อมูลระบบ
                </p>
                <div className="space-y-0.5">
                  {INSERTABLE_TOKENS.map((token) => (
                    <button
                      key={token}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        handleInsert(buildSystemToken(token));
                        setOpen(false);
                      }}
                      className="w-full text-left px-2 py-1.5 rounded hover:bg-blue-50 flex items-center justify-between gap-2"
                    >
                      <span className="text-xs text-slate-800">
                        {INSERTABLE_TOKEN_LABELS[token]}
                      </span>
                      <code className="text-[10px] font-mono text-blue-700 shrink-0">
                        {`{${token}}`}
                      </code>
                    </button>
                  ))}
                </div>
              </div>

              {/* ── กลุ่มข้อมูลผู้สมัคร ──────────────────────────────── */}
              <div className="px-3 py-2">
                <p className="text-[10px] font-semibold uppercase text-slate-500 mb-1.5">
                  กลุ่มข้อมูลผู้สมัคร (Template Version นี้)
                </p>

                <input
                  type="text"
                  value={fieldSearch}
                  onChange={(e) => setFieldSearch(e.target.value)}
                  placeholder="ค้นหาฟิลด์..."
                  className="w-full h-7 mb-1.5 rounded border border-slate-300 px-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />

                {fieldsLoading ? (
                  <p className="text-[11px] text-slate-400 py-2 text-center">
                    กำลังโหลดฟิลด์...
                  </p>
                ) : fields.length === 0 ? (
                  <p className="text-[11px] text-slate-400 py-2 text-center">
                    Template Version นี้ยังไม่มีฟิลด์
                  </p>
                ) : visibleFields.length === 0 ? (
                  <p className="text-[11px] text-slate-400 py-2 text-center">
                    ไม่พบฟิลด์ที่ตรงกับคำค้น
                  </p>
                ) : (
                  <>
                    <div className="max-h-[220px] overflow-auto space-y-0.5">
                      {visibleFields.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            handleInsert(buildFieldToken(f.fieldId));
                            setOpen(false);
                          }}
                          className="w-full text-left px-2 py-1.5 rounded hover:bg-emerald-50 flex items-center justify-between gap-2"
                        >
                          <span className="text-xs text-slate-800 truncate">
                            {f.labelTh}
                          </span>
                          <code className="text-[10px] font-mono text-emerald-700 shrink-0 max-w-[130px] truncate">
                            {`{FIELD:${f.fieldId}}`}
                          </code>
                        </button>
                      ))}
                    </div>

                    {filteredFields.length > 8 && (
                      <button
                        type="button"
                        onClick={() => setShowAllFields((v) => !v)}
                        className="w-full mt-1 text-[11px] text-blue-700 hover:underline py-1"
                      >
                        {showAllFields
                          ? 'ย่อ / แสดงกลุ่มแรก'
                          : `ดูทั้งหมด (${filteredFields.length})`}
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* ── คำอธิบาย ───────────────────────────────────────── */}
              <div className="px-3 py-2 bg-slate-50 border-t border-slate-100">
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  แทรก ณ ตำแหน่งเคอร์เซอร์ในช่องข้อความ · รองรับหลายบรรทัด
                  <br />
                  token ที่ยังไม่มีข้อมูลจะแสดงเป็น{' '}
                  <code className="font-mono">{'{TOKEN_NAME}'}</code> สีเทาใน Preview
                  และ PDF
                </p>
              </div>
            </div>,
            document.body
          )}
    </div>
  );
}

export default InsertDataMenu;