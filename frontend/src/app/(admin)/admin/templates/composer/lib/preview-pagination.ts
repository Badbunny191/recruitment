/**
 * ⚠️⚠️⚠️ DEPRECATED — ไม่อยู่ใน flow หลักแล้ว (2026-10-22) ⚠️⚠️⚠️
 * ------------------------------------------------------------------
 * Document Composer เปลี่ยนเป็น **Continuous Preview** แล้ว:
 *   - ตัด Browser Pagination ออกทั้งหมด
 *   - `PreviewFrame.tsx` **ไม่ import** ไฟล์นี้อีกต่อไป (ไม่มี script ฝังใน iframe)
 *   - ไม่มีการวัด DOM / ไม่มีการเดาจุดแบ่งหน้า / ไม่มีการ scale-zoom
 *   - เอกสารแสดงเป็นลำดับยาวเดียว (`.dc-page` โตตามเนื้อหา)
 *   - 🔑 การแบ่งหน้าจริงดูจาก **PDF Preview** (renderer ตัวเดียวกับ export)
 *
 * 🚫 ห้ามนำกลับมาใน flow หลัก
 *    - ถ้าต้องการแบ่งหน้า → ใช้ block `pageBreak` (PDF renderer ขึ้นหน้าใหม่ทันที)
 *    - ถ้าต้องการดูการแบ่งหน้าจริง → เปิดโหมด PDF Preview
 *
 * ⚠️ ไฟล์นี้ยังอยู่เพื่อให้เทสต์เดิม (composer-uat-round2.test.tsx) รันได้
 *    เพื่อทบทวนพฤติกรรมเก่าเทียบกับแนวทางใหม่
 * ------------------------------------------------------------------
 */

/**
 * Preview Pagination (HTML Preview เท่านั้น) — ❌ RETIRED
 * --------------------------------------------
 * Document Composer — แบ่งหน้ากระดาษ A4 สำหรับตัวอย่างเอกสาร (HTML Preview)
 *
 * ⚠️ ขอบเขต (เก็บไว้เป็น historical reference เท่านั้น)
 *   - ~~มีผลกับ HTML Preview~~ → **ถูกถอดออกจาก PreviewFrame แล้ว**
 *   - ไม่แตะ PDF Renderer / Legacy PDF route
 *   - ไม่แก้ Page Settings schema (ใช้ค่า margin ที่ backend resolve มาแล้ว)
 *
 * ── แนวทาง Pagination ───────────────────────────────────────────────────────
 * 1. **Automatic pagination เป็นค่าเริ่มต้น** — ไม่ต้องมี Page Break เพื่อแบ่งหน้า
 * 2. ในรอบนี้ยังไม่เพิ่ม Page Break Block แต่ **ออกแบบรองรับไว้แล้ว**
 *    (ดู "Explicit Page Break" ด้านล่าง)
 * 3. **อย่า hard-code การแบ่งหน้ากับประเภท Block ปัจจุบัน**
 *    → engine ทำงานกับ "หน่วย" (unit) ที่ adapter ตรวจจาก DOM แบบ declarative:
 *        - `table`         → หน่วยคือ "แถว"
 *        - `label + value` → หน่วยเดียว (กัน label หลุดไปคนละหน้า)
 *        - อื่น ๆ          → element ลูกแต่ละตัวเป็นหน่วย (บรรทัด)
 *    → เพิ่ม Page Break Block ทีหลัง = เพิ่ม block type ใน renderer
 *      + ปล่อย attribute `data-dc-break="page"` → **ไม่ต้องแตะ engine เลย**
 * 4. engine เป็น **pure function** (ไม่พึ่ง DOM) → เขียน test ได้โดยไม่ต้องมี browser
 *    และใช้ **source เดียวกัน** กับ script ที่ฝังลง iframe (ไม่มี logic ซ้ำ)
 *
 * ── กติกาแบ่งหน้า ───────────────────────────────────────────────────────────
 *   - Block ที่พอในหนึ่งหน้า → อยู่หน้านั้น (ห้ามถูกแยกออกจากกัน)
 *   - Block ที่ไม่พอในหน้าปัจจุบัน แต่พอในหน้าว่าง → **ย้ายทั้งก้อนไปหน้าถัดไป**
 *     (ห้ามตัดกลางบรรทัด / ห้ามแยก label ออกจาก value)
 *   - Block ที่ยาวเกินหนึ่งหน้าจริง → ค่อยแบ่งตามหน่วย (บรรทัด / แถว)
 *   - Table → แบ่งตามแถว + ทำ header ซ้ำทุกหน้า
 *   - ทุกหน้าใช้ margin ชุดเดียวกัน + ขนาด A4 เท่ากันทุกแผ่น
 *   - ป้าย "หน้า X / N" อยู่ **นอก** กรอบกระดาษ (ไม่ติดไปกับ PDF)
 *   - ไม่มี block หาย / ซ้ำ / ลำดับเปลี่ยน
 *
 * ⚠️ ไม่มี Automatic Header ในการแบ่งหน้านี้ (ห้ามนำกลับมา)
 */

export const PREVIEW_PAGE_WIDTH_PT = 595.28;
export const PREVIEW_PAGE_HEIGHT_PT = 841.89;

/** ช่องว่างระหว่างแผ่นกระดาษ (pt) */
export const PREVIEW_PAGE_GAP_PT = 20;

/** CSS px ต่อ 1 pt (96/72) */
export const PX_PER_PT = 96 / 72;

export interface PreviewPaginationConfig {
  pageWidthPt: number;
  pageHeightPt: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
}

// =============================================================================
// Pure pagination model
// =============================================================================

/** หน่วยเล็กที่ห้ามถูกตัด (บรรทัด / แถว / label+value) */
export interface PaginationUnit {
  /** id ของหน่วย (unique ทั้งเอกสาร) */
  id: string;
  /** ระยะจากขอบบนของพื้นที่หน่วย ถึงขอบล่างของหน่วยนั้น (px) */
  bottom: number;
}

/** ชิ้นส่วนหนึ่งก้อนของเอกสาร (block หนึ่งก้อน หรือส่วนต่อของ block ที่ถูกแบ่ง) */
export interface PaginationItem {
  /** id ของชิ้นส่วน (unique) */
  id: string;
  /** id ของ block ต้นทาง (ต่างจาก id เมื่อเป็นส่วนต่อ) */
  originId: string;
  /** true = ชิ้นส่วนนี้เป็น "ส่วนต่อ" ของ block ที่ถูกแบ่ง */
  continuation: boolean;
  /** ความสูงที่กินพื้นที่ในหน้า รวม margin บน/ล่าง (px) */
  height: number;
  /** margin บน (px) */
  marginTop: number;
  /** margin ล่าง (px) */
  marginBottom: number;
  /** ความสูงกล่องเนื้อหาของชิ้นส่วน (px) — รวม header ที่ทำซ้ำ */
  boxHeight: number;
  /** ความสูง header ที่ทำซ้ำเหนือหน่วย (เช่น thead ของตาราง) (px) */
  headerHeight: number;
  /** หน่วยที่แบ่งได้ (เรียงตามลำดับ) */
  units: PaginationUnit[];
  /** true = ต้องขึ้นหน้าใหม่ก่อน (Explicit Page Break) */
  explicitBreak: boolean;
}

/**
 * รายการที่วางลงหนึ่งหน้า
 *
 * `unitIds === null` → ใช้ element เดิมทั้งก้อน (ส่วนหัวของ block ที่ถูกแบ่ง)
 * `unitIds !== null` → ต้องสร้าง shell ใหม่แล้วย้ายหน่วยเหล่านี้เข้าไป
 */
export interface PaginationEntry {
  /** id ของ block ต้นทาง (ใช้หา DOM node) */
  itemId: string;
  /** หน่วยที่อยู่ใน entry นี้ (null = ใช้ element เดิมทั้งก้อน) */
  unitIds: string[] | null;
  /** true = entry นี้ต้องสร้าง shell ใหม่ (ส่วนต่อของ block ที่ถูกแบ่ง) */
  continuation: boolean;
}

/** หนึ่งหน้ากระดาษ */
export interface PaginationPage {
  entries: PaginationEntry[];
  /** true = มีเนื้อหาที่ยาวเกินหนึ่งหน้า (ยอมให้หน้าโตขึ้นแทนการตัดข้อความ) */
  overflow: boolean;
}

// =============================================================================
// Pure pagination engine
// =============================================================================

/**
 * Pure pagination engine
 * ---------------------
 * คำนวณว่า block ไหนอยู่หน้าไหน (และถ้าต้องแบ่ง block จะแบ่งที่หน่วยไหน)
 *
 * ⚠️ ฟังก์ชันนี้ถูกฝังลง iframe ตรง ๆ (ผ่าน `Function.prototype.toString()`)
 *    → ต้อง self-contained เท่านั้น (ห้ามอ้างอิงตัวแปรนอกฟังก์ชัน)
 *    → โค้ดด้านในเป็น plain JS (ไม่มี TypeScript syntax)
 *
 * @param items - รายการ block ทั้งเอกสาร (เรียงตามลำดับที่ต้องการแสดงผล)
 * @param contentHeight - ความสูงพื้นที่เนื้อหาของหนึ่งหน้า (px)
 * @returns รายการหน้า (ลำดับหน้า + รายการในแต่ละหน้า)
 */
export function computePagination(
  items: PaginationItem[],
  contentHeight: number
): PaginationPage[] {
  var EPS = 0.5;
  var pages: PaginationPage[] = [];
  var queue: PaginationItem[] = [];
  var i: number;

  for (i = 0; i < items.length; i += 1) {
    queue.push(items[i]);
  }

  var cur: PaginationPage = { entries: [], overflow: false };
  var used = 0;
  var seq = 0;
  var guard = 0;

  function newPage(): void {
    pages.push(cur);
    cur = { entries: [], overflow: false };
    used = 0;
  }

  /**
   * จำนวนหน่วยสูงสุดที่ยังพอลงพื้นที่ที่เหลือของหน้า
   * @param item - ชิ้นส่วนที่กำลังพิจารณา
   * @param avail - พื้นที่ที่เหลือในหน้า (px)
   */
  function fitCount(item: PaginationItem, avail: number): number {
    var count = 0;
    for (var k = 0; k < item.units.length; k += 1) {
      if (
        item.marginTop +
          item.headerHeight +
          item.units[k].bottom +
          item.marginBottom <=
        avail + EPS
      ) {
        count = k + 1;
      } else {
        break;
      }
    }
    return count;
  }

  /** สร้าง entry สำหรับ "ทั้งก้อน" */
  function wholeEntry(item: PaginationItem): PaginationEntry {
    if (item.continuation) {
      var ids: string[] = [];
      for (var w = 0; w < item.units.length; w += 1) {
        ids.push(item.units[w].id);
      }
      return { itemId: item.originId, unitIds: ids, continuation: true };
    }
    return { itemId: item.originId, unitIds: null, continuation: false };
  }

  while (queue.length > 0 && guard < 10000) {
    guard += 1;
    var item: PaginationItem = queue.shift() as PaginationItem;

    // ── Explicit page break (Page Break block ในอนาคต) ──────────────────────
    if (item.explicitBreak && cur.entries.length > 0) {
      newPage();
    }

    // ── 1) Block ที่พอในหนึ่งหน้า → วางทั้งก้อน (ห้ามแยก) ───────────────────
    if (item.height <= contentHeight + EPS) {
      if (used + item.height > contentHeight + EPS && cur.entries.length > 0) {
        newPage();
      }
      cur.entries.push(wholeEntry(item));
      used += item.height;
      continue;
    }

    // ── 2) ใหญ่เกินหนึ่งหน้าจริง + แบ่งไม่ได้ → ยอมให้ล้น (ไม่ตัดข้อความ) ────
    if (item.units.length < 2) {
      if (cur.entries.length > 0) {
        newPage();
      }
      cur.entries.push(wholeEntry(item));
      cur.overflow = true;
      used += item.height;
      continue;
    }

    // ── 3) แบ่งตามหน่วย (บรรทัด / แถว) ───────────────────────────────────────
    var avail = contentHeight - used;
    var head = fitCount(item, avail);

    // ไม่มีที่ในหน้าปัจจุบันเลย → ย้ายไปหน้าใหม่แล้วลองใหม่
    if (head === 0) {
      if (cur.entries.length > 0) {
        newPage();
      }
      avail = contentHeight;
      head = fitCount(item, avail);
      // หน่วยเดียวที่สูงเกินหน้า → ยังต้องยกไปไว้ (ห้ามทิ้งเนื้อหา)
      if (head === 0) {
        head = 1;
      }
    }

    if (head >= item.units.length) {
      cur.entries.push(wholeEntry(item));
      cur.overflow = true;
      used += item.height;
      continue;
    }

    var headUnits: PaginationUnit[] = item.units.slice(0, head);
    var tailUnits: PaginationUnit[] = item.units.slice(head);
    var headBottom = headUnits[headUnits.length - 1].bottom;
    var unitsTotal = item.boxHeight - item.headerHeight;
    var headFootprint =
      item.marginTop + item.headerHeight + headBottom + item.marginBottom;
    var tailFootprint =
      item.marginTop +
      item.headerHeight +
      (unitsTotal - headBottom) +
      item.marginBottom;

    // ── ส่วนหัว → อยู่หน้าปัจจุบัน ───────────────────────────────────────────
    //    ถ้าเป็น block เดิม → ใช้ element เดิม (ส่วนต่อจะถูก "ดึง" หน่วยออกไปตอน
    //    สร้าง shell → element เดิมเหลือแต่หน่วยของส่วนหัวโดยอัตโนมัติ)
    //    ถ้าเป็นส่วนต่อ → ต้องสร้าง shell ใหม่
    if (item.continuation) {
      var headIds: string[] = [];
      for (var h = 0; h < headUnits.length; h += 1) {
        headIds.push(headUnits[h].id);
      }
      cur.entries.push({
        itemId: item.originId,
        unitIds: headIds,
        continuation: true,
      });
    } else {
      cur.entries.push({
        itemId: item.originId,
        unitIds: null,
        continuation: false,
      });
    }
    used += headFootprint;

    // ── ส่วนต่อ → เข้าคิว (จะถูกวางในหน้าถัดไป) ───────────────────────────────
    seq += 1;
    var tailModel: PaginationItem = {
      id: item.id + '~' + seq,
      originId: item.originId,
      continuation: true,
      height: tailFootprint,
      marginTop: item.marginTop,
      marginBottom: item.marginBottom,
      boxHeight: item.headerHeight + (unitsTotal - headBottom),
      headerHeight: item.headerHeight,
      units: [],
      explicitBreak: false,
    };
    for (var u = 0; u < tailUnits.length; u += 1) {
      tailModel.units.push({
        id: tailUnits[u].id,
        bottom: tailUnits[u].bottom - headBottom,
      });
    }
    queue.unshift(tailModel);
  }

  if (cur.entries.length > 0) {
    pages.push(cur);
  }

  return pages;
}

/**
 * Source ของ pure engine (ใช้ทั้งใน iframe และในเทสต์ชุดเดียวกัน)
 *
 * ⚠️ เป็น string เดียวกับที่ฝังลง iframe → เทสต์ที่รันได้คือโค้ดที่ deploy จริง
 */
export const PAGINATION_ENGINE_SOURCE = computePagination.toString();

// =============================================================================
// Script สำหรับฝังลงใน srcdoc ของ PreviewFrame
// =============================================================================

/**
 * สร้างสคริปต์แบ่งหน้าที่ฝังลงใน srcdoc ของ PreviewFrame
 *
 * คืนค่าเป็น string ของ JS ที่ไม่มี `</script>` และไม่มี `${...}`
 * (ปลอดภัยเมื่อฝังใน <script> tag)
 */
export function buildPaginationScript(cfg: PreviewPaginationConfig): string {
  const configJson = JSON.stringify({
    pageWidth: cfg.pageWidthPt,
    pageHeight: cfg.pageHeightPt,
    marginTop: cfg.marginTop,
    marginRight: cfg.marginRight,
    marginBottom: cfg.marginBottom,
    marginLeft: cfg.marginLeft,
  });

  return `
window.__DC_PAGE_CONFIG__ = ${configJson};
(function () {
  "use strict";
  var CFG = window.__DC_PAGE_CONFIG__ || {};
  var PAGE_W = CFG.pageWidth || ${PREVIEW_PAGE_WIDTH_PT};
  var PAGE_H = CFG.pageHeight || ${PREVIEW_PAGE_HEIGHT_PT};
  var MT = CFG.marginTop || 0;
  var MR = CFG.marginRight || 0;
  var MB = CFG.marginBottom || 0;
  var ML = CFG.marginLeft || 0;
  var CONTENT_W = PAGE_W - ML - MR;
  var CONTENT_H = PAGE_H - MT - MB;
  var PX_PER_PT = ${PX_PER_PT};

  ${PAGINATION_ENGINE_SOURCE}

  var pagesRoot = document.getElementById("dc-pages");
  var source = document.getElementById("dc-source");
  var scaler = document.getElementById("dc-scaler");
  if (!pagesRoot || !source) { return; }

  /* snapshot HTML ต้นทาง (ไว้ restore ทุกครั้งที่ paginate) */
  var sourceHtml = source.innerHTML;

  /* ── DOM helpers ─────────────────────────────────────────────────────── */
  function childList(el) {
    var out = [];
    for (var i = 0; i < el.children.length; i++) { out.push(el.children[i]); }
    return out;
  }

  /* wrapper ที่เก็บ "บรรทัด" ของ field / systemdata แบบ inline */
  function findBodyWrapper(el) {
    var kids = childList(el);
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c.classList && (c.classList.contains("dc-field__body") || c.classList.contains("dc-systemdata__body"))) {
        return c;
      }
    }
    return null;
  }

  /*
   * Explicit page break (Page Break block ในอนาคต)
   * → ใช้ attribute เป็นสัญญา ไม่ hard-code กับประเภท block
   */
  function isExplicitBreak(el) {
    if (el.getAttribute && el.getAttribute("data-dc-break") === "page") { return true; }
    if (el.classList && el.classList.contains("dc-page-break")) { return true; }
    return false;
  }

  /*
   * label ของ field / systemdata → ต้องอยู่กับ value เดียวกันเสมอ
   * (ตรวจจาก convention ของ class ไม่ใช่จากประเภท block)
   */
  function isLabelEl(el) {
    if (!el.classList) { return false; }
    for (var i = 0; i < el.classList.length; i++) {
      var c = el.classList[i];
      if (c === "dc-field__label" || c === "dc-systemdata__label") { return true; }
    }
    return false;
  }

  /*
   * ── สร้าง "หน่วย" (units) ของ block แบบ declarative ─────────────────────
   *   - table          → หน่วยคือ "แถว" (ห้ามตัดข้อความครึ่งแถว)
   *   - label + value  → หน่วยเดียว (ห้ามแยก label ออกจาก value)
   *   - อื่น ๆ         → element ลูกแต่ละตัวเป็นหน่วย (บรรทัด)
   */
  function collectUnits(el) {
    var table = el.querySelector ? el.querySelector("table") : null;
    var tbody = table && table.tBodies && table.tBodies.length > 0 ? table.tBodies[0] : null;

    if (tbody && tbody.rows.length > 0) {
      var rowGroups = [];
      var rows = childList(tbody);
      for (var r = 0; r < rows.length; r += 1) { rowGroups.push([rows[r]]); }
      return {
        kind: "table",
        table: table,
        headerEl: table.tHead || null,
        container: null,
        groups: rowGroups,
      };
    }

    var container = findBodyWrapper(el) || el;
    var kids = childList(container);
    var groups = [];
    for (var i = 0; i < kids.length; i += 1) {
      if (isLabelEl(kids[i]) && kids.length > i + 1) {
        /* label + ค่า → หน่วยเดียว (กัน label หลุดไปอยู่คนละหน้า) */
        groups.push([kids[i], kids[i + 1]]);
        i += 1;
      } else {
        groups.push([kids[i]]);
      }
    }
    return {
      kind: "block",
      table: null,
      headerEl: null,
      container: container,
      groups: groups,
    };
  }

  /* ── รวบรวม block ทั้งเอกสารเป็น item (ยังไม่วัด) ────────────────────── */
  function collectItems() {
    var items = [];
    var kids = childList(source);
    for (var i = 0; i < kids.length; i += 1) {
      var el = kids[i];
      var units = collectUnits(el);
      items.push({
        id: "b" + i,
        originId: "b" + i,
        el: el,
        kind: units.kind,
        table: units.table,
        headerEl: units.headerEl,
        container: units.container,
        groups: units.groups,
        unitEls: {},
        units: [],
        headerHeight: 0,
        height: 0,
        marginTop: 0,
        marginBottom: 0,
        boxHeight: 0,
        explicitBreak: isExplicitBreak(el),
      });
    }
    return items;
  }

  /* ── วัดความสูงจริงในกรอบวัด (กว้างเท่าโซนเนื้อหาของหน้า) ─────────────── */
  function measureItems(items) {
    var box = document.createElement("div");
    box.className = "dc-measure";
    box.style.position = "absolute";
    box.style.left = "-99999px";
    box.style.top = "0";
    box.style.width = CONTENT_W + "pt";
    box.style.visibility = "hidden";
    box.style.display = "flow-root";
    document.body.appendChild(box);

    for (var i = 0; i < items.length; i += 1) { box.appendChild(items[i].el); }

    for (var j = 0; j < items.length; j += 1) {
      var it = items[j];
      var cs = window.getComputedStyle(it.el);
      var mt = parseFloat(cs.marginTop) || 0;
      var mb = parseFloat(cs.marginBottom) || 0;
      var rect = it.el.getBoundingClientRect();

      if (it.headerEl) {
        it.headerHeight = it.headerEl.getBoundingClientRect().height;
      }

      var unitsTop = rect.top + it.headerHeight;
      var units = [];
      for (var k = 0; k < it.groups.length; k += 1) {
        var group = it.groups[k];
        var maxBottom = -Infinity;
        for (var g = 0; g < group.length; g += 1) {
          var gr = group[g].getBoundingClientRect();
          if (gr.bottom > maxBottom) { maxBottom = gr.bottom; }
        }
        var uid = it.id + "-u" + k;
        for (var q = 0; q < group.length; q += 1) {
          it.unitEls[uid + "-" + q] = group[q];
        }
        units.push({ id: uid, bottom: maxBottom - unitsTop });
      }
      it.units = units;
      it.boxHeight = rect.height;
      it.marginTop = mt;
      it.marginBottom = mb;
      it.height = rect.height + mt + mb;
    }

    for (var m = 0; m < items.length; m += 1) {
      var el = items[m].el;
      if (el.parentNode) { el.parentNode.removeChild(el); }
    }
    if (box.parentNode) { box.parentNode.removeChild(box); }
  }

  function toModel(item) {
    return {
      id: item.id,
      originId: item.originId,
      continuation: false,
      height: item.height,
      marginTop: item.marginTop,
      marginBottom: item.marginBottom,
      boxHeight: item.boxHeight,
      headerHeight: item.headerHeight,
      units: item.units,
      explicitBreak: item.explicitBreak,
    };
  }

  /* ── สร้าง "ส่วนต่อ" ของ block ที่ถูกแบ่ง (ย้าย DOM node ไม่ clone เนื้อหา) ── */
  function buildContinuation(item, unitIds) {
    if (item.kind === "table") {
      var shell = item.el.cloneNode(false);
      var labelEl = item.el.querySelector(".dc-table-label");
      if (labelEl) { shell.appendChild(labelEl.cloneNode(true)); }
      var table = document.createElement("table");
      table.className = item.table.className;
      if (item.table.tHead) { table.appendChild(item.table.tHead.cloneNode(true)); }
      var tbody = document.createElement("tbody");
      for (var i = 0; i < unitIds.length; i += 1) {
        var row = item.unitEls[unitIds[i] + "-0"];
        if (row) { tbody.appendChild(row); }
      }
      table.appendChild(tbody);
      shell.appendChild(table);
      return shell;
    }

    var shell2 = item.el.cloneNode(false);
    var target = shell2;
    if (item.container && item.container !== item.el) {
      target = item.container.cloneNode(false);
      shell2.appendChild(target);
    }
    for (var j = 0; j < unitIds.length; j += 1) {
      var u = item.unitEls[unitIds[j] + "-0"];
      if (u) { target.appendChild(u); }
      /* หน่วยที่เป็น label + value → ต้องย้ายทั้งคู่ */
      var u2 = item.unitEls[unitIds[j] + "-1"];
      if (u2) { target.appendChild(u2); }
    }
    return shell2;
  }

  /* ── สร้างหน้ากระดาษ (แต่ละแผ่นแยกกัน + ป้ายหน้านอกกรอบกระดาษ) ─────── */
  function buildPages(plan, items) {
    pagesRoot.innerHTML = "";

    var byId = {};
    for (var b = 0; b < items.length; b += 1) { byId[items[b].id] = items[b]; }

    /*
     * เตรียม "ส่วนต่อ" ทั้งหมดก่อน
     * → การย้ายหน่วยออกจาก block เดิมทำให้ block เดิมเหลือแต่หน่วยของส่วนหัว
     *   (ไม่มีเนื้อหาหาย / ไม่มีเนื้อหาซ้ำ)
     */
    var shells = {};
    for (var p = 0; p < plan.length; p += 1) {
      var entries = plan[p].entries;
      for (var e = 0; e < entries.length; e += 1) {
        if (!entries[e].continuation || !entries[e].unitIds) { continue; }
        var src = byId[entries[e].itemId];
        if (src) { shells[p + ":" + e] = buildContinuation(src, entries[e].unitIds); }
      }
    }

    var total = plan.length;

    for (var i = 0; i < total; i += 1) {
      var sheet = document.createElement("div");
      sheet.className = "dc-page-sheet";

      /* ป้าย "หน้า X / N" — อยู่นอกกรอบกระดาษ (ไม่ติดไปกับ PDF) */
      var label = document.createElement("div");
      label.className = "dc-page__label";
      label.textContent = "หน้า " + (i + 1) + " / " + total;
      sheet.appendChild(label);

      var page = document.createElement("div");
      page.className = "dc-page dc-page--paged";
      page.style.width = PAGE_W + "pt";
      page.style.height = PAGE_H + "pt";
      page.style.minHeight = PAGE_H + "pt";
      page.style.padding = MT + "pt " + MR + "pt " + MB + "pt " + ML + "pt";

      var flow = document.createElement("div");
      flow.className = "dc-flow";
      page.appendChild(flow);
      sheet.appendChild(page);

      var pageEntries = plan[i].entries;
      for (var f = 0; f < pageEntries.length; f += 1) {
        if (pageEntries[f].continuation) {
          var shell = shells[i + ":" + f];
          if (shell) { flow.appendChild(shell); }
        } else {
          var orig = byId[pageEntries[f].itemId];
          if (orig) { flow.appendChild(orig.el); }
        }
      }

      if (plan[i].overflow) { page.classList.add("dc-page--overflow"); }

      pagesRoot.appendChild(sheet);
    }
  }

  /* ── ย่อ/ขยายให้พอดีกรอบ (ไม่ให้เกิด horizontal scrollbar ใน iframe) ───── */
  /*
   * ใช้ "zoom" (ไม่ใช่ transform) เพราะ zoom มีผลกับ layout ด้วย
   * → scrollWidth / scrollHeight สะท้อนขนาดจริงหลังย่อ → วัดความสูงได้ถูก
   * → ไม่มี horizontal scrollbar แม้ใน Compact ที่คอลัมน์แคบ
   * → แผ่นกระดาษยังเป็น A4 เต็ม (595.28pt) ในขนาดจริง แค่ถูกย่อให้พอดีกรอบ
   */
  function applyScale() {
    if (!scaler) { return; }
    /* วัดที่ zoom = 1 เสมอ (ไม่งั้นค่าเพี้ยน) */
    scaler.style.zoom = "";
    var vw = window.innerWidth || 0;
    var natural = scaler.scrollWidth || 0;
    var s = 1;
    if (vw > 0 && natural > vw) {
      s = (vw - 12) / natural;
    }
    if (!(s > 0) || s > 1) { s = 1; }
    scaler.style.zoom = s === 1 ? "" : String(s);
  }

  function report(pageCount) {
    var height = document.documentElement.scrollHeight;
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(
          { type: "dc-preview-pagination", pageCount: pageCount, contentHeight: height },
          "*"
        );
      }
    } catch (err) { /* ignore */ }
  }

  function run() {
    /* คืน HTML ต้นทางก่อนวัดใหม่ทุกครั้ง (ไม่มี block หาย/ซ้ำ) */
    source.innerHTML = sourceHtml;
    if (scaler) { scaler.style.zoom = ""; }

    var items = collectItems();
    measureItems(items);

    var models = [];
    for (var i = 0; i < items.length; i += 1) { models.push(toModel(items[i])); }

    var plan = computePagination(models, CONTENT_H * PX_PER_PT);
    if (plan.length === 0) { plan = [{ entries: [], overflow: false }]; }

    buildPages(plan, items);
    applyScale();

    /* re-render ใหม่ → scroll กลับด้านบนเสมอ */
    try { window.scrollTo(0, 0); } catch (err) { /* ignore */ }

    report(plan.length);
  }

  run();
  if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === "function") {
    document.fonts.ready.then(function () { run(); });
  }
  window.addEventListener("load", function () { run(); });
  window.addEventListener("resize", function () { applyScale(); });

  /*
   * ── Scroll reset ────────────────────────────────────────────────────────
   * parent ส่งมาเมื่อสลับโหมด Form ↔ Document/PDF หรือ re-render
   * → เลื่อนกลับด้านบน (ไม่ค้างกลางเอกสาร)
   */
  window.addEventListener("message", function (ev) {
    var data = ev && ev.data;
    if (data && typeof data === "object" && data.type === "dc-preview-scroll-top") {
      try { window.scrollTo(0, 0); } catch (err) { /* ignore */ }
      try {
        if (document.documentElement) { document.documentElement.scrollTop = 0; }
        if (document.body) { document.body.scrollTop = 0; }
      } catch (err2) { /* ignore */ }
    }
  });
})();
`;
}
