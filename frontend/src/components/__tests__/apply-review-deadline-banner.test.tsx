// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * Review page — Deadline banner เหนือปุ่ม "ยืนยันส่งใบสมัคร"
 * =====================================================================
 * จุดสำคัญที่สุดของ decision 2026-11-11: ผู้ใช้กำลังจะกดส่งใบสมัคร
 * ต้องรู้ก่อนว่าเวลาเหลือเท่าไร — รันหน้า review จริงบน happy-dom
 * (draft จาก sessionStorage + fetch stubs):
 *
 *   R1: เหลือ ~45 นาที → banner info "เหลือเวลารับสมัครอีก 45 นาที"
 *       + "ระบบจะปิดรับสมัครอัตโนมัติ" และอยู่ **เหนือปุ่ม** "ยืนยันส่งใบสมัคร"
 *   R2: เหลือ ~10 นาที → warning "เหลือเวลารับสมัครอีก 10 นาที"
 *       + "กรุณาตรวจสอบข้อมูลให้เรียบร้อย ก่อนกดยืนยันส่งใบสมัคร"
 *   R3: เหลือ ~4 นาที  → ตัวเลข "04:00" (MM:SS) ใหญ่ (text-3xl)
 *   R4: ทุกเคส → ห้ามมี "เวลาระบบ" บนหน้า (ตัดสินใจด้วย countdown ล้วน)
 *
 *   A1-A3: หน้า /apply (ฟอร์มจริง) เหลือ 45/10/4 นาที → banner แสดงถูกสถานะ
 *
 * Run: npx tsx --tsconfig tsconfig.test.json src/components/__tests__/apply-review-deadline-banner.test.tsx
 */
import { Window } from 'happy-dom';

const win = new Window({ url: 'http://localhost:3000/apply/review?id=round-rb' });
const globalAny = globalThis as any;
globalAny.window = win;
globalAny.document = win.document;
try { globalAny.navigator = win.navigator; } catch {}
globalAny.HTMLElement = win.HTMLElement;
globalAny.Event = win.Event;
globalAny.CustomEvent = win.CustomEvent;
globalAny.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalAny.cancelAnimationFrame = clearTimeout;
globalAny.IS_REACT_ACT_ENVIRONMENT = true;
win.alert = () => {};
win.confirm = () => true;

import Module from 'node:module';
const require = Module.createRequire(import.meta?.url ?? __filename);
const origResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === 'next/navigation') return require.resolve('./__mocks__/next-navigation.ts');
  if (request === 'next/link') return require.resolve('./__mocks__/next-link.tsx');
  return origResolve.call(this, request, ...args);
};

import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const MINUTE = 60 * 1000;
const ROUND = 'round-test'; // ต้องตรงกับ useSearchParams mock (hardcoded id=round-test)

const SCHEMA_RESPONSE = {
  data: {
    sections: [],
    fields: [
      { fieldId: 'field-name', type: 'TEXT', label: 'ชื่อ', isRequired: false },
    ],
  },
};

/** ติดตั้ง fetch stub ที่รอบมีเวลาปิด = now + remainingMs (อิง serverTime จริง) */
function installFetch(remainingMs: number) {
  globalAny.fetch = async (url: string) => {
    const u = String(url);
    const body = async (obj: any) => ({ ok: true, status: 200, json: async () => obj });
    if (u.includes(`/rounds/${ROUND}/schema`)) return body(SCHEMA_RESPONSE);
    if (u.includes(`/rounds/${ROUND}/detail`)) {
      return body({
        success: true,
        data: {
          id: ROUND,
          title: 'รอบทดสอบ banner',
          positionLevel: 'ปฏิบัติการ',
          status: 'ACTIVE',
          openDate: new Date(Date.now() - 60 * MINUTE).toISOString(),
          closeDate: new Date(Date.now() + remainingMs).toISOString(),
        },
        serverTime: Date.now(),
      });
    }
    if (u.includes('/master-data/organizations')) return body({ data: [] });
    if (u.includes('/public/config')) return body({ data: { turnstile: { enabled: false, siteKey: '' } } });
    return body({ data: [] });
  };
}

const assert = (c: any, m: string) => { if (!c) throw new Error(m); };
const assertFalse = (c: any, m: string) => { if (c) throw new Error(m); };

let container: HTMLElement | null = null;
let root: any = null;
function mount(el: React.ReactElement) {
  container = win.document.createElement('div');
  win.document.body.appendChild(container);
  root = createRoot(container as any);
  act(() => { root.render(el); });
}
async function unmount() {
  await act(async () => { root?.unmount(); });
  container?.remove();
  container = null; root = null;
}
const flush = (ms = 40) => new Promise((r) => setTimeout(r, ms));

/** หา index ของ element ในลำดับ DOM ของ container */
function domIndex(el: Element): number {
  const all = Array.from(container!.querySelectorAll('*'));
  return all.indexOf(el);
}

let passed = 0, failed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ok ${name}`);
  } catch (e: any) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`  FAIL ${name}: ${e?.message ?? e}`);
  }
}

void (async () => {
  const applyDraft = await import('../../lib/applyDraft');
  const { saveApplyDraft, __resetApplyDraftsForTests } = applyDraft;
  const ReviewPage = (await import('../../app/(public)/apply/review/page')).default;

  const renderReviewWithRemaining = async (remainingMs: number) => {
    __resetApplyDraftsForTests();
    (win.sessionStorage as any).clear?.();
    installFetch(remainingMs);
    saveApplyDraft({
      roundId: ROUND,
      formData: { 'field-name': 'ผู้สมัครสังเคราะห์' },
      attachments: [],
      submissionToken: 'tok-rb',
    });
    mount(<ReviewPage />);
    // รอจนพ้น loading state (draft → schema → detail คือ chain ของ state 3 ชั้น)
    // — ครอบด้วย act ให้ state update จาก fetch ถูก flush จริง
    await act(async () => {
      for (let i = 0; i < 25; i++) {
        await flush(100);
        const t = container?.textContent || '';
        if (!t.includes('กำลังโหลดข้อมูลที่ตรวจสอบ')) break;
      }
    });
    return {
      text: () => (container?.textContent || ''),
      bannerEl: () =>
        Array.from(container!.querySelectorAll('[role="status"],[role="alert"]')).find(
          (el: any) => (el.textContent || '').includes('เหลือเวลารับสมัครอีก'),
        ) as Element | undefined,
      submitBtn: () =>
        Array.from(container!.querySelectorAll('button')).find(
          (b: any) => (b.textContent || '').trim() === 'ยืนยันส่งใบสมัคร',
        ) as HTMLButtonElement | undefined,
      unmount,
    };
  };

  await test('R1: เหลือ ~45 นาที → banner info แสดง และอยู่เหนือปุ่ม "ยืนยันส่งใบสมัคร"', async () => {
    const view = await renderReviewWithRemaining(45 * MINUTE);
    try {
      const t = view.text();
      assert(/เหลือเวลารับสมัครอีก \d+ นาที/.test(t), `missing info banner: ${t.slice(0, 300)}`);
      assert(t.includes('ระบบจะปิดรับสมัครอัตโนมัติ'), 'missing auto-close line');
      const bannerEl = view.bannerEl();
      const btn = view.submitBtn();
      assert(bannerEl, 'banner element must exist');
      assert(btn, 'submit button must exist');
      assert(domIndex(bannerEl!) < domIndex(btn!), 'banner must appear BEFORE the submit button');
    } finally {
      await view.unmount();
    }
  });

  await test('R2: เหลือ ~10 นาที → banner warning ข้อความของหน้า review', async () => {
    const view = await renderReviewWithRemaining(10 * MINUTE);
    try {
      const t = view.text();
      assert(/เหลือเวลารับสมัครอีก \d+ นาที/.test(t), `missing warning banner: ${t.slice(0, 300)}`);
      assert(t.includes('กรุณาตรวจสอบข้อมูลให้เรียบร้อย'), 'missing review action line');
      assert(t.includes('ก่อนกดยืนยันส่งใบสมัคร'), 'missing "ก่อนกดยืนยันส่งใบสมัคร"');
      assertFalse(t.includes('ก่อนเวลา'), 'review warning must NOT mention close time');
    } finally {
      await view.unmount();
    }
  });

  await test('R3: เหลือ ~4 นาที → ตัวเลข "04:00" (MM:SS) ใหญ่ text-3xl', async () => {
    const view = await renderReviewWithRemaining(4 * MINUTE);
    try {
      const t = view.text();
      assert(t.includes('เหลือเวลารับสมัครอีก'), 'missing final banner label');
      assert(/\d{2}:\d{2}/.test(t), `missing MM:SS countdown: ${t.slice(0, 300)}`);
      const html = container!.innerHTML;
      assert(html.includes('text-3xl'), 'review final number must be larger (text-3xl)');
    } finally {
      await view.unmount();
    }
  });

  await test('R4: ทุกเคส → ห้ามมี "เวลาระบบ" บนหน้า review', async () => {
    for (const remaining of [45 * MINUTE, 10 * MINUTE, 4 * MINUTE]) {
      const view = await renderReviewWithRemaining(remaining);
      try {
        assertFalse(/เวลาระบบ \d/.test(view.text()), `clock must NOT appear at remaining=${remaining / MINUTE} min`);
      } finally {
        await view.unmount();
      }
    }
  });

  await test('A1: apply เหลือ ~45 นาที → banner info บนฟอร์ม + ไม่มีเวลาระบบ', async () => {
    __resetApplyDraftsForTests();
    (win.sessionStorage as any).clear?.();
    installFetch(45 * MINUTE);
    saveApplyDraft({ roundId: ROUND, formData: {}, attachments: [], submissionToken: 'tok-rb' });
    const ApplyPage = (await import('../../app/(public)/apply/page')).default;
    mount(<ApplyPage />);
    await act(async () => {
      for (let i = 0; i < 25; i++) {
        await flush(100);
        if (/เหลือเวลารับสมัครอีก/.test(container?.textContent || '')) break;
        if ((container?.textContent || '').includes('ใบสมัครคัดเลือกบุคลากร')) break;
      }
    });
    try {
      const t = container?.textContent || '';
      assert(/เหลือเวลารับสมัครอีก \d+ นาที/.test(t), `missing info banner on apply: ${t.slice(0, 300)}`);
      assert(t.includes('ระบบจะปิดรับสมัครอัตโนมัติ'), 'missing auto-close line');
      assertFalse(/เวลาระบบ \d/.test(t), 'apply page must NOT show system clock');
    } finally {
      await unmount();
    }
  });

  await test('A2: apply เหลือ ~10 นาที → banner warning "ตรวจสอบข้อมูลให้ครบถ้วน"', async () => {
    __resetApplyDraftsForTests();
    (win.sessionStorage as any).clear?.();
    installFetch(10 * MINUTE);
    saveApplyDraft({ roundId: ROUND, formData: {}, attachments: [], submissionToken: 'tok-rb' });
    const ApplyPage = (await import('../../app/(public)/apply/page')).default;
    mount(<ApplyPage />);
    await act(async () => {
      for (let i = 0; i < 25; i++) {
        await flush(100);
        if (/เหลือเวลารับสมัครอีก/.test(container?.textContent || '')) break;
      }
    });
    try {
      const t = container?.textContent || '';
      assert(/เหลือเวลารับสมัครอีก \d+ นาที/.test(t), `missing warning banner: ${t.slice(0, 300)}`);
      assert(t.includes('กรุณาตรวจสอบข้อมูลให้ครบถ้วน'), 'missing apply action line');
      assert(t.includes('ก่อนเวลา'), 'apply warning must mention close time');
      assertFalse(/เวลาระบบ \d/.test(t), 'apply page must NOT show system clock');
    } finally {
      await unmount();
    }
  });

  await test('A3: apply เหลือ ~4 นาที → ตัวเลข MM:SS (text-2xl) + ไม่มีเวลาระบบ', async () => {
    __resetApplyDraftsForTests();
    (win.sessionStorage as any).clear?.();
    installFetch(4 * MINUTE);
    saveApplyDraft({ roundId: ROUND, formData: {}, attachments: [], submissionToken: 'tok-rb' });
    const ApplyPage = (await import('../../app/(public)/apply/page')).default;
    mount(<ApplyPage />);
    await act(async () => {
      for (let i = 0; i < 25; i++) {
        await flush(100);
        if (/เหลือเวลารับสมัครอีก/.test(container?.textContent || '')) break;
      }
    });
    try {
      const t = container?.textContent || '';
      assert(/\d{2}:\d{2}/.test(t), `missing MM:SS countdown: ${t.slice(0, 300)}`);
      assert(container!.innerHTML.includes('text-2xl'), 'apply final number must be large (text-2xl)');
      assertFalse(/เวลาระบบ \d/.test(t), 'apply page must NOT show system clock');
    } finally {
      await unmount();
    }
  });

  // ========== SUMMARY ==========

  console.log('\n=== Summary ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  if (failed > 0) {
    (globalThis as any).process.exit(1);
  }

})();
