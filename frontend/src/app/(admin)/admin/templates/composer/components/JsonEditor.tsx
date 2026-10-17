'use client';

/**
 * JsonEditor
 * --------------------------------
 * Document Composer V1 — Advanced JSON Editor
 *
 * ซ่อนเป็น Advanced Mode (collapse)
 * - แสดง textarea (raw JSON)
 * - parse issues จาก parent
 * - ผู้ใช้แก้ JSON โดยตรง → ส่ง text ไป parent → parent parse → sync กลับ descriptor
 */

import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import type { ValidationIssue } from '@/lib/api/template-descriptor';

export interface JsonEditorProps {
  text: string;
  onTextChange: (next: string) => void;
  isValid: boolean;
  parseIssues: ValidationIssue[];
  charCount: number;
  /** sync จาก Block UI (object) → text */
  onFormatFromObject: () => void;
}

export function JsonEditor({
  text,
  onTextChange,
  isValid,
  parseIssues,
  charCount,
  onFormatFromObject,
}: JsonEditorProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-slate-200 rounded-lg bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm">{'</>'}</span>
          <span className="text-sm font-medium text-slate-700">
            Advanced JSON Editor
          </span>
          {!isValid && (
            <span className="text-[11px] text-red-600 font-medium">
              ✗ {parseIssues.length} error(s)
            </span>
          )}
          {isValid && (
            <span className="text-[11px] text-emerald-600 font-medium">✓</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500">
            {charCount.toLocaleString()} chars
          </span>
          <span className="text-slate-400 text-xs">
            {open ? '▲' : '▼'}
          </span>
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-200 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-slate-500">
              แก้ JSON ตรงๆ — การเปลี่ยนแปลงจะ sync กลับไป Block UI เมื่อ parse สำเร็จ
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={onFormatFromObject}
              className="h-7 text-xs"
              title="Format จาก Block UI ปัจจุบัน"
            >
              🔄 Format จาก Block
            </Button>
          </div>

          <Textarea
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            placeholder='{ "version": 1, "blocks": [...] }'
            className="font-mono text-xs min-h-[300px] resize-y"
            spellCheck={false}
          />

          {parseIssues.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded p-2 text-[11px] space-y-1">
              <p className="font-semibold text-red-800">Validation Errors:</p>
              <ul className="space-y-0.5">
                {parseIssues.map((iss, idx) => (
                  <li key={idx} className="text-red-700">
                    <code className="font-mono">{iss.path || '(root)'}</code>:{' '}
                    {iss.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}