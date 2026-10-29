# Applications Summary Decoupling — Implementation Review

**Branch:** `feature/applications-summary-decoupling`
**Review date:** 2026-10-29
**Status:** Implementation complete and verified. **Not committed, not pushed** — awaiting review.
**Verdict:** All 6 requirements met, all 6 required tests present and passing, no forbidden surface touched.

---

## 1. What was found on arrival

The working tree was already clean and the decoupling work was already present as commit
`b7e45a92 fix: decouple applications summary loading` on this branch. Nothing was re-implemented
and nothing was re-committed during this review. This document verifies that existing work against
the stated requirements.

Branch state at review time:

| Item | Value |
|---|---|
| Branch | `feature/applications-summary-decoupling` |
| HEAD | `55639408 fix: prevent false empty state during applications loading` |
| Decoupling commit | `b7e45a92 fix: decouple applications summary loading` |
| Working tree | clean (`git status --porcelain` empty) |
| Upstream | none — branch has never been pushed |
| Files in decoupling commit | 3 (`frontend/package.json`, `ApplicationsClient.tsx`, `applications-summary-decoupling.test.tsx`) |
| Backend files in commit | 0 |

---

## 2. Requirement-by-requirement verification

### R1 — fetch summary แยก effect

**Met.** `fetchSummary` is its own `useCallback`, and a dedicated effect drives it:

```ts
const fetchSummary = useCallback(async () => { ... }, [selectedRoundId, API_URL]);   // line 849–891

// ยิง summary ใหม่เมื่อ "รอบ" เปลี่ยนเท่านั้น
useEffect(() => {
  fetchSummary();
}, [fetchSummary]);                                                                  // line 894–896
```

The list fetch (`fetchData`, line 776) no longer contains any summary call. The previous
`Promise.all([list, summary])` is gone — `fetchData` now issues exactly one request, to
`/admin/applications?<params>`.

### R2 — dependency = selectedRoundId เท่านั้น

**Met.** `fetchSummary` deps are `[selectedRoundId, API_URL]`. `API_URL` is a module-level constant
(`const API_URL = process.env.NEXT_PUBLIC_API_URL || ''`, line 260), so it is stable across renders
and does not cause re-invocation. Effectively the only reactive dependency is `selectedRoundId`.

### R3 — page/pageSize/search/sort ห้าม trigger summary refetch

**Met.** None of `currentPage`, `pageSize`, `search`, `sortId`, `statusFilter` appears in
`fetchSummary`'s dependency list or its body. The summary request URL is
`${API_URL}/admin/applications/summary?roundId=${selectedRoundId}` — no list params are attached.

Verified two ways in the test suite: by counting real network calls after each interaction, and by
reading the source to assert the dependency array contains none of the forbidden identifiers.

### R4 — summaryLoading state แยกจาก table loading

**Met.** Two independent states:

```ts
const [summaryLoading, setSummaryLoading] = useState(true);   // line 384
const [loading, setLoading] = useState(true);                 // line 388
```

`loading` is set/cleared only inside `fetchData`. `summaryLoading` is set/cleared only inside
`fetchSummary`. Neither writes the other's state.

Two correctness details worth noting for review:

- When `selectedRoundId` is empty, `fetchSummary` early-returns **and** clears `summaryLoading`
  (line 854). Without this the KPI skeleton would hang forever on a page with no rounds.
- The `finally` block clears `summaryLoading` only when `!controller.signal.aborted` (line 889), so
  an aborted request cannot clear the skeleton belonging to a newer in-flight round.

### R5 — table render ได้แม้ summary ยังโหลด

**Met.** The table's render gate is:

```ts
{loading || roundsStatus === 'loading' ? <spinner> : <rows>}
```

`summaryLoading` does not appear in that condition. A pending summary cannot hold the table.

### R6 — KPI cards ใช้ skeleton/loading state ของตัวเอง

**Met.** `KpiCard` gained `loading` and `error` props and renders three distinct states:

- `loading` → `<span data-testid="kpi-skeleton" class="block h-8 w-16 rounded-md bg-slate-200 animate-pulse" />`
- `error` → `—` in `text-slate-300` (never a fake `0`)
- otherwise → the real value

The skeleton is sized `h-8` to match `text-3xl leading-none`, so the card does not jump when the
number arrives.

The loading flag passed to the cards is derived, not a new dependency:

```ts
const kpiLoading = summaryLoading || roundsStatus === 'loading';   // line 1153
```

The `roundsStatus` term exists because `selectedRoundId` is empty while rounds are still loading,
which makes `fetchSummary` early-return and clear `summaryLoading` — without the second term the
skeleton would blink off for one frame and come back. Being a derived value, it adds nothing to the
summary effect's dependency array.

The status filter pills follow the same rule: `count={kpiLoading || summaryError ? undefined : statusCounts[option.value]}`
(line 1456), so no misleading `0` badges while the numbers are unknown.

---

## 3. Forbidden-surface check

| Forbidden | Touched? | Evidence |
|---|---|---|
| API contract change | No | Same URL `/admin/applications/summary?roundId=<id>`, same `data.data` response shape, same `{ total, byStatus }` state |
| Backend | No | 0 backend files in `b7e45a92`; `git show --name-only` confirms |
| Migration | No | No migration files in the commit |
| Selector model | No | `applications-selection-state.ts` untouched; bulk-selection suite still green |
| Export | No | `handleExportExcel` / `handleExportSelected` untouched |
| Bulk | No | Bulk handler untouched apart from the added `fetchSummary()` refresh call |
| PDF | No | PDF bulk paths untouched |

---

## 4. Test results

### Required tests — all present, all passing

`npm run test:applications-summary-decoupling` → **13 passed, 0 failed**

| # | Test | Requirement |
|---|---|---|
| 1 | summary ไม่ refetch เมื่อ page เปลี่ยน | R3 |
| 2 | summary ไม่ refetch เมื่อ search เปลี่ยน (ผ่าน URL hydrate) | R3 |
| 3 | effect ของ summary ไม่มี search/sort/page/pageSize ใน dependency | R2, R3 |
| 4 | summary ไม่ refetch เมื่อ sort เปลี่ยน | R3 |
| 5 | summary ไม่ refetch เมื่อ pageSize เปลี่ยน | R3 |
| 6 | summary refetch เมื่อ round เปลี่ยน | R2 |
| 7 | table render ได้แม้ summary ยังโหลด | R5 |
| 8 | KPI แสดง skeleton ระหว่างรอ summary แล้วหายเมื่อข้อมูลมา | R6 |
| 9 | KPI แสดงตัวเลขจริงหลัง summary กลับมา (ไม่มี skeleton ค้าง) | R6 |
| 10 | KPI loading ไม่ปนกับ loading ของตาราง (แยกกันจริง) | R4 |
| 11 | summary 500 → KPI แสดง error และ table ยัง render/ใช้งานได้ | R6 (fail-soft) |
| 12 | กด "ลองอีกครั้ง" ที่ KPI error → ยิง summary ใหม่และหาย error เมื่อสำเร็จ | R6 (recovery) |
| 13 | ระหว่าง list ยังโหลด → footer ต้องไม่สรุป "ไม่พบรายการ" | regression guard |

The tests count real network calls from a URL-based `fetch` stub rather than inspecting component
state, so they are not coupled to state variable names and will catch a genuine regression.

### Regression suites

| Suite | Result |
|---|---|
| `test:applications-loading-gate` | 9 passed, 0 failed |
| `test:applications-bulk-selection` | 5 passed, 0 failed |
| Full `npm test` (frontend) | all suites green |
| `npx tsc --noEmit` | exit 0, no type errors |

The loading-gate suite independently re-asserts the same contract from the gate's perspective,
including "summary ค้างตลอดไป → ตารางต้องแสดงแถวได้" and "summary ยิงครั้งเดียวต่อรอบ".

---

## 5. Points for the reviewer to decide on

**5.1 Summary also refreshes after status mutations.** `fetchSummary()` is called explicitly at
line 988 (single status update) and line 1045 (bulk status update). This is deliberate: changing an
application's status changes the KPI numbers, and before the decoupling the summary came along with
the `Promise.all` so it stayed correct for free. This does not violate R2/R3 (no page/search/sort
involvement), but it does mean the summary effect is not the *only* caller. If the review wants the
effect to be the sole trigger, these two calls would need to be replaced by something else — I would
keep them, since removing them would leave the KPIs stale after a status change.

**5.2 `API_URL` in the dependency array.** Technically R2 says "selectedRoundId only". `API_URL` is a
module constant so it never triggers a re-run. Leaving it in is correct React practice (and required
by the lint rule); I would not strip it.

**5.3 Search-change test uses the URL-hydrate path.** In this project's happy-dom harness, React does
not dispatch `onChange` for `<input type="text">` (a probe confirmed `onInput` fires but `onChange`
does not; `<select>` change events work fine, so it is not a bubbling problem). Typing into the search
box therefore cannot be simulated faithfully. The test covers the real hydrate path (`?q=` in the URL
→ list fires with the search term, summary fires once) and additionally asserts the dependency array
by reading the source. That is the strongest available evidence in this harness; a browser-level test
would be the way to close the gap if the review wants it.

---

## 6. Delivery state

- **Not committed** by this review. The work exists as `b7e45a92` on the branch; the tree is clean.
- **Not pushed.** The branch has no upstream and has never been pushed.
- No files were modified during this review.

Awaiting review before any commit or push.
