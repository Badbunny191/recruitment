# Fix: Public Round Staleness + Countdown + Audit Trail

**Branch:** `fix/public-round-staleness-and-audit`
**Commit:** `2ca8d6ef` — `fix(public-rounds): refresh stale round status and improve audit trail`
**Base:** `main` @ `924f090c`
**Date:** 2026-11-10

**Out of scope (unchanged):** closeDate semantics, 16:30 vs 16:31 boundary, grace period, round visibility business rule. Time Semantics and Option 1/2/3 not touched.

---

## 1. Root Cause Summary

### TASK 1 — Public round badge staleness

**Symptom:** open the public page, leave the tab open, and the badge keeps saying "กำลังเปิดรับสมัคร" indefinitely, even after the round closed and the backend already rejects submissions.

**Root cause:** `frontend/src/app/(public)/page.tsx` fetched `/public/rounds/active` exactly once, in a `useEffect` with `[]` deps. There was no `visibilitychange` listener, no `focus` listener, no polling, no deadline timer. The only thing that moved was `useTick()` (a 30s `setInterval` that re-rendered), and re-rendering stale data does not make it fresh. `groups.open` and every `round.status` stayed at whatever the first response said, for the entire lifetime of the tab.

A second, compounding defect: the page rendered `open` straight from the payload and `PhaseBadge` straight from the server's phase string. So even the countdown could disagree with the badge on the same card.

**Why the obvious fixes are wrong:**

| Approach | Problem |
|---|---|
| Polling every N seconds | Burns quota and battery forever, including on background tabs nobody is looking at. Fixes staleness by making every user pay for it continuously. |
| `focus` refetch only | Misses the user who is *already looking* at the page when the round closes. No focus event fires. |
| `visibilitychange` only | Same gap, plus misses focus-within-tab cases. |
| Near-deadline refresh only | Requires knowing the deadline up front, and misses the case where an admin edits `closeDate` while the page is open. |

**Chosen:** all three signals, each doing the job it is actually good at, with the network call gated so it only happens when it must.

1. `visibilitychange` → user came back to the tab
2. `focus` → window regained focus
3. a single `setTimeout` armed at the *next deadline* → the user who is staring at the page sees the badge flip by itself

No polling. The timer is re-armed from the payload, so it always points at the next real state change, not at a fixed interval.

### TASK 2 — Countdown UX

**Root cause:** `formatCountdown()` in `frontend/src/lib/public-rounds.ts` collapsed everything under one minute into the literal `'น้อยกว่า 1 นาที'`, and returned that same string for `ms <= 0` as well. So 59 seconds remaining, 3 seconds remaining, and "closed 20 minutes ago" all rendered identically. The single most decision-relevant window in the whole product had zero information in it, and the closed state was actively misleading.

### TASK 3 — Audit trail

Two independent defects.

**3a. `POST /admin/rounds` wrote nothing useful.** The route is registered at path `/rounds` with no `:id` param. `auditMiddleware` resolves the entity as `c.get('auditEntityId') || c.req.param('id') || 'BULK/NEW'`, so it fell through to the sentinel `'BULK/NEW'`. The handler never called `setAuditPayload`, so `payload` was `NULL`. Result: the log recorded *that* someone created something, with no round id, no title, no code, and no dates. The audit-log UI could not resolve a name for the entity either.

**3b. `PATCH /admin/rounds/:id` recorded dates, not times.** The change-tracking call pre-formatted both sides with `toLocaleDateString('th-TH')`, which yields a date with no time component. Moving a close date from 16:29 to 16:31 on the same day produced `oldValue === newValue`, `computeChanges` skipped the field, and the audit entry contained no diff at all. The most consequential edit an operator can make to a round was invisible in the log.

**A third bug surfaced during the fix** (see §5): once real `Date` objects reached `computeChanges`, its `oldVal === newVal` guard compared object identity rather than instants, so two `Date`s for the same moment were treated as different. That would have produced a phantom diff on every PATCH that resent an unchanged date.

---

## 2. Files Modified

| File | Change |
|---|---|
| `backend/src/lib/change-tracking.ts` | Added `formatAuditDateTime()` (Bangkok fixed-offset, Buddhist year, HH:mm), `DATETIME_FIELDS` + `formatValue` routing for `openDate`/`closeDate`, `buildRoundCreatePayload()`, and a `Date`-aware equality guard in `computeChanges`. |
| `backend/src/routes/admin.routes.ts` | `POST /rounds`: sets `auditEntityId` to the new round id and calls `setAuditPayload(buildRoundCreatePayload(...))`. `PATCH /rounds/:id`: passes raw `Date` objects into `computeChanges` instead of `toLocaleDateString('th-TH')` strings. |
| `frontend/src/lib/public-rounds.ts` | Rewrote `formatCountdown` (seconds under 5 min, `'ปิดรับสมัครแล้ว'` when closed, `''` for non-finite). Added `closed` to `Countdown`, `CLOSED_COUNTDOWN_TEXT`, `shouldRefetchOnEvent`, `planDeadlineTimer`, `deadlinesToMarkHandled`, `collectDeadlines`, `effectivePhase`, `planRefresh`, and the timing constants. |
| `frontend/src/app/(public)/page.tsx` | Refetch on `visibilitychange` + `focus`, deadline `setTimeout`, `handledDeadlines` loop guard, silent refresh, 1s tick under 5 minutes, `openLive` filtering, closed-state copy, `UpcomingRoundCard` phase correction. |
| `backend/src/lib/__tests__/audit-round-datetime.test.ts` | **New.** 14 tests: formatter contract, 16:29→16:31 diff, false-diff guards, CREATE payload shape. |
| `backend/src/routes/__tests__/round-audit-trail.test.ts` | **New.** 7 tests: real Hono routes on in-memory D1 — entity id, payload contents, datetime diff, no false diffs. |
| `frontend/src/lib/__tests__/public-rounds.test.ts` | Extended: countdown seconds/closed cases, `planRefresh`, `planDeadlineTimer` (incl. anti-loop), `collectDeadlines`, `effectivePhase`. |
| `frontend/src/app/__tests__/public-home-staleness.test.tsx` | **New.** 9 tests: real page component on happy-dom — refetch on return, badge flip, stale-snapshot honesty, seconds display, no polling, throttle, silent-failure resilience. |
| `backend/package.json`, `frontend/package.json` | Registered the new suites in `npm test`. |

---

## 3. Git Diff

### 3a. `backend/src/routes/admin.routes.ts`

```diff
-import { handleApplicationStatusChange, buildAuditPayload } from '../lib/change-tracking';
+import { handleApplicationStatusChange, buildAuditPayload, buildRoundCreatePayload } from '../lib/change-tracking';
```

`POST /rounds` — after the insert:

```diff
   await db.insert(recruitmentRounds).values({
     ...
     roundCode,
   });
+
+  // ── Audit trail ของ CREATE (2026-11-10) ─────────────────────────────────
+  // เดิม: path '/rounds' ไม่มี :id → auditMiddleware ตั้ง entityId = 'BULK/NEW'
+  //       และ route ไม่ได้ setAuditPayload → payload = NULL
+  //       ⇒ audit log บอกได้แค่ว่า "มีคนสร้างอะไรบางอย่าง" ไม่มีชื่อรอบ/รหัส/
+  //         ช่วงเวลา → ตอบคำถามย้อนหลังไม่ได้ และ resolve ชื่อ entity ไม่ได้
+  // ตอนนี้: ชี้ entityId ไปที่รอบที่เพิ่งสร้าง + เก็บ snapshot ที่ระบุตัวรอบได้
+  c.set('auditEntityId', id);
+  setAuditPayload(c, buildRoundCreatePayload({
+    id,
+    title: data.title,
+    roundCode,
+    positionLevel: data.positionLevel,
+    openDate: data.openDate,
+    closeDate: data.closeDate,
+    status: data.status,
+  }));
+
   return c.json({ success: true, id }, 201);
```

`PATCH /rounds/:id` — the change-tracking call:

```diff
-      openDate: round.openDate ? new Date(round.openDate as any).toLocaleDateString('th-TH') : null,
-      closeDate: round.closeDate ? new Date(round.closeDate as any).toLocaleDateString('th-TH') : null,
+      // ⚠️ ส่ง Date ดิบเข้าไป — formatValue จะจัดรูปเป็น "6 พ.ย. 2569 16:29"
+      // (เดิมเรียก toLocaleDateString('th-TH') ที่นี่ → เหลือแค่วันที่ ทำให้
+      //  การเลื่อนปิดรับสมัคร 16:29 → 16:31 วันเดียวกันไม่มี diff ใน audit)
+      openDate: round.openDate,
+      closeDate: round.closeDate,
```

```diff
-      openDate: data.openDate == null ? data.openDate : new Date(data.openDate * 1000).toLocaleDateString('th-TH'),
-      closeDate: data.closeDate == null ? data.closeDate : new Date(data.closeDate * 1000).toLocaleDateString('th-TH'),
+      openDate: data.openDate == null ? data.openDate : new Date(data.openDate * 1000),
+      closeDate: data.closeDate == null ? data.closeDate : new Date(data.closeDate * 1000),
```

### 3b. `backend/src/lib/change-tracking.ts`

New formatter (Workers-safe: fixed +7h offset, `getUTC*` getters, never `toLocaleDateString`):

```ts
const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', ..., 'ธ.ค.'];
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

export function formatAuditDateTime(value: unknown): string | null {
  const ms = toEpochMs(value as any);
  if (ms === null) return null;
  const d = new Date(ms + BANGKOK_OFFSET_MS);
  const day = d.getUTCDate();
  const month = THAI_MONTHS_SHORT[d.getUTCMonth()];
  const year = d.getUTCFullYear() + 543;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${year} ${hh}:${mm}`;
}

const DATETIME_FIELDS = new Set(['openDate', 'closeDate']);
```

Date-aware equality in `computeChanges` (the third bug):

```diff
     // Skip if values are the same (also covers false===false, 0===0, ''==='')
     if (oldVal === newVal) continue;
+
+    // ⚠️ Date objects: `===` เทียบ reference ไม่ใช่ instant → Date สองตัวที่
+    //    เป็นเวลาเดียวกันจะไม่เท่ากัน (ได้ false diff ทุกครั้งที่ PATCH ส่งวันที่เดิม)
+    //    เทียบด้วย getTime() แทน — และถ้าเท่ากันจริงให้ข้าม
+    if (oldVal instanceof Date && newVal instanceof Date) {
+      if (oldVal.getTime() === newVal.getTime()) continue;
+    }
```

CREATE payload builder:

```ts
export function buildRoundCreatePayload(round: RoundCreateSnapshot): Record<string, any> {
  return {
    roundId: round.id,
    title: round.title,
    roundCode: round.roundCode,
    positionLevel: round.positionLevel,
    openDate: formatValue('openDate', round.openDate),
    closeDate: formatValue('closeDate', round.closeDate),
    status: round.status,
  };
}
```

### 3c. `frontend/src/lib/public-rounds.ts` — countdown

```diff
 export const formatCountdown = (ms: number): string => {
-  if (!Number.isFinite(ms) || ms <= 0) return 'น้อยกว่า 1 นาที';
+  if (!Number.isFinite(ms)) return '';
+  if (ms <= 0) return CLOSED_COUNTDOWN_TEXT;
   const totalSec = Math.floor(ms / 1000);
   const days = Math.floor(totalSec / 86400);
   const hours = Math.floor((totalSec % 86400) / 3600);
   const minutes = Math.floor((totalSec % 3600) / 60);
+  const seconds = totalSec % 60;
   if (days > 0) return `${days} วัน ${hours} ชั่วโมง`;
   if (hours > 0) return `${hours} ชั่วโมง ${minutes} นาที`;
-  if (minutes > 0) return `${minutes} นาที`;
-  return 'น้อยกว่า 1 นาที';
+
+  // 5 นาทีสุดท้าย — ต้องเห็นวินาทีที่ขยับจริง
+  if (ms < SECONDS_DISPLAY_THRESHOLD_MS) {
+    if (minutes > 0) return `${minutes} นาที ${seconds} วินาที`;
+    return seconds > 0 ? `${seconds} วินาที` : '1 วินาที';
+  }
+
+  return `${minutes} นาที`;
 };
```

### 3d. `frontend/src/app/(public)/page.tsx` — refresh

```diff
-  const tick = useTick();
-
-  useEffect(() => {
-    const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
-    const requestedAt = Date.now();
-    fetch(`${apiUrl}/public/rounds/active`)
-      .then((res) => res.json())
-      .then((json) => {
-        setPayload(parseRoundsResponse(json, requestedAt));
-        setLoading(false);
-      })
-      .catch(() => { setFailed(true); setLoading(false); });
-  }, []);
+  const loadRounds = useCallback((opts: { silent?: boolean } = {}) => { ... }, []);
+
+  useEffect(() => { loadRounds(); }, [loadRounds]);
+
+  useEffect(() => {
+    const refreshIfDue = () => {
+      if (shouldRefetchOnEvent(Date.now(), lastFetchAtRef.current)) {
+        loadRounds({ silent: true });
+      }
+    };
+    const onVisibility = () => {
+      if (document.visibilityState === 'visible') refreshIfDue();
+    };
+    document.addEventListener('visibilitychange', onVisibility);
+    window.addEventListener('focus', refreshIfDue);
+    return () => { ... };
+  }, [loadRounds]);
+
+  useEffect(() => {
+    const { delayMs } = planDeadlineTimer(
+      Date.now(), collectDeadlines(payload), handledDeadlinesRef.current,
+    );
+    if (delayMs === null) return;
+    const id = setTimeout(() => loadRounds({ silent: true }), delayMs);
+    return () => clearTimeout(id);
+  }, [payload, loadRounds]);
```

And the render no longer trusts a stale `groups.open`:

```diff
-        ) : open.length === 0 ? (
+        ) : openLive.length === 0 ? (
           ...
+              {justClosed > 0
+                ? 'ปิดรับสมัครแล้ว'
+                : 'ขณะนี้ยังไม่มีรอบที่เปิดรับสมัคร'}
```

```ts
const openLive = open.filter((r) => effectivePhase('OPEN', r, nowMs) === 'OPEN');
const justClosed = open.length - openLive.length;
```

---

## 4. Test Result

### New backend suites

```
node --import tsx src/lib/__tests__/audit-round-datetime.test.ts
  PASSED: 14/14

node --import tsx src/routes/__tests__/round-audit-trail.test.ts
  === Round audit trail: 7 passed, 0 failed ===
```

Key assertions:

- `RA1` — `POST /rounds` produces an audit row whose `entity_id` is the real round id, not `'BULK/NEW'`
- `RA2` — payload contains `roundId`, `title`, `roundCode`, `positionLevel`, `openDate: "1 ธ.ค. 2569 09:00"`, `closeDate: "20 ธ.ค. 2569 16:30"`, `status`
- `RA3` — `entity_id` joins to a real `recruitment_rounds` row (so the audit UI can resolve the name)
- `RA4` — `PATCH` closeDate 16:29 → 16:31 same day yields exactly one change: `"30 พ.ย. 2569 16:29"` → `"30 พ.ย. 2569 16:31"`, and the summary contains both times
- `RA5` — resending an unchanged date yields zero changes
- `RA6` — omitting dates yields no date diffs
- `RA7` — title + closeDate together yields both diffs

### New frontend suites

```
node --import tsx src/lib/__tests__/public-rounds.test.ts
  Passed: 61
  Failed: 0

npx tsx --tsconfig tsconfig.test.json src/app/__tests__/public-home-staleness.test.tsx
  === Public home: 9 passed, 0 failed ===
```

Key assertions:

- `S1` — returning to the tab after close triggers a **second** fetch (previously: one fetch for the life of the page)
- `S2` — after refetch reports closed, the badge reads "ปิดรับสมัครแล้ว" and no "กำลังเปิดรับสมัคร 1 รอบ" remains
- `S3` — with a stale snapshot past `closeDate`, the page does **not** claim "กำลังเปิดรับสมัคร 1 รอบ"
- `S4` — 4m52s remaining renders `N นาที N วินาที`, and "น้อยกว่า 1 นาที" is gone
- `S5` — closed renders "ปิดรับสมัครแล้ว"
- `S6` — `focus` alone triggers refetch
- `S7` — `focus` + `visibilitychange` inside 15s produce one fetch, not two
- `S8` — a failed background refresh keeps the existing data and does not flip to the error state
- `S9` — no polling: no events, distant deadline, no extra fetch

Countdown unit cases: `4 นาที 52 วินาที`, `1 นาที 15 วินาที`, `23 วินาที`, `59 วินาที`, `1 วินาที`, `5 นาที`, `4 นาที 59 วินาที`, `ปิดรับสมัครแล้ว` at 0 and negative, `''` for NaN/Infinity.

### Full suites

```
frontend: npm test  → exit 0   (all suites, including the new one)
backend:  npm test  → exit 0   (all suites, including both new ones)
frontend: npx tsc --noEmit → exit 0
backend:  npx tsc --noEmit → exit 0
```

Existing suites that touch this code, all still green: `change-tracking.test.ts` (21/21), `round-clone-numbering.test.ts` (17/17), `audit-log-display.test.ts` (42/42), `round-lifecycle.test.ts`, `round-form-payload.test.ts` (9/9).

### Two bugs the tests caught during development

Worth recording, because both would have shipped:

1. **Infinite refetch loop.** With a passed deadline still present in `groups.open`, `planDeadlineTimer` returned `delayMs: 0`, the fetch re-armed the same zero-delay timer, and the page hammered the API with no bound. Caught by `S1`/`S2` (fetch counts of 2 and 5 instead of 1). Fixed with `handledDeadlinesRef` + `deadlinesToMarkHandled`: one deadline triggers exactly one refetch, then the display layer (`effectivePhase`) handles the rest. Locked by `R10`–`R12`.

2. **Phantom date diffs.** `computeChanges` compared `Date` objects with `===`, which is reference equality. Two `Date`s for the same instant are never equal, so every PATCH resending an unchanged date would have logged a fake change. Caught by `B3`. Fixed with a `getTime()` comparison, locked by `B3`/`RA5`.

---

## 5. Deployment Notes

**No migration.** No schema change, no new column, no data backfill. `audit_logs.payload` already accepts JSON.

**No API contract change.** Request and response shapes for `/public/rounds/active`, `POST /admin/rounds`, and `PATCH /admin/rounds/:id` are unchanged. The only difference is what gets written into `audit_logs`.

**Deploy order:** backend first, then frontend. The frontend does not depend on the new backend behavior (it degrades to the old single-fetch behavior against an old backend), but the audit fix only takes effect once the backend is live.

**Historical audit rows are not backfilled.** Rows written before this deploy keep `entity_id = 'BULK/NEW'` and `payload = NULL`. They are not wrong, just uninformative. If you want them repaired, that is a separate backfill script against `recruitment_rounds` by `created_at` proximity — deliberately not included here, because guessing which round a `BULK/NEW` row refers to is exactly the kind of inference that should not be automated silently.

**Audit payload format changed for round dates.** `openDate`/`closeDate` in `changes[]` now read `"6 พ.ย. 2569 16:29"` instead of `"6/11/2569"`. The audit-log UI renders these as opaque strings (`getTableChangeSummary` interpolates `oldValue → newValue`), so no frontend change is required and old rows still render. Anything external that parses these strings would need to know.

**Behavior change worth flagging to operators:** a round whose `closeDate` has passed no longer appears under "กำลังเปิดรับสมัคร" even in the seconds before the refetch lands. It moves to the closed state and the section shows "ปิดรับสมัครแล้ว". This is the intended fix, but it is a visible change on the public page at the moment of closing.

**Refresh cost.** No polling was added. Network calls happen on: first load, tab return, window focus (throttled to one per 15s), and one timer firing per deadline. A user who leaves the page open for eight hours with no deadline in range generates exactly one request.

**Rollback.** Single revert of `2ca8d6ef`. No data written by this change needs undoing; new audit rows are additive.

**Verification after deploy:**

1. Create a round in admin → audit log shows the round's title and code, and the entity name resolves (no `BULK/NEW`).
2. Edit a round's close date from one minute to another within the same hour → audit detail shows both times.
3. Open the public page, note a round closing within a few minutes, and leave the tab alone → badge flips without interaction.
4. Switch away and back after a round closes → the round is gone from the open section without a manual reload.
