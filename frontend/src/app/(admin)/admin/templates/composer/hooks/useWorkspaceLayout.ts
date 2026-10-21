'use client';

/**
 * useWorkspaceLayout
 * -----------------------------------------------------------------
 * Document Composer — state ของพื้นที่ทำงาน (ก้อนที่ 2)
 *
 * ขอบเขต:
 *   - splitRatio (สัดส่วน Visual Composer / Live Preview)
 *   - sidebarCollapsed (แถบ Actions ย่อ/ขยาย)
 *   - activeTab (โหมดแท็บสำหรับหน้าจอแคบ)
 *
 * ⚠️ Layout state นี้ **แยกจาก DocumentDescriptor เด็ดขัด**
 *    → ไม่มีการเขียนค่าใด ๆ ลง descriptor / backend
 *
 * SSR:
 *   - ค่าเริ่มต้นเป็น default เสมอ (ไม่อ่าน localStorage ตอน render)
 *   - อ่าน localStorage ใน useEffect หลัง mount → ไม่เกิด hydration mismatch
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import {
  DEFAULT_SPLIT_RATIO,
  DIVIDER_WIDTH,
  WORKSPACE_STORAGE_KEYS,
  clampSplitRatio,
  parseStoredSidebarCollapsed,
  parseStoredSplitRatio,
  readWorkspacePreference,
  resetWorkspaceLayout,
  resizeRatioByKey,
  resolveSplitBounds,
  resolveWorkspaceLayoutMode,
  serializeSidebarCollapsed,
  serializeSplitRatio,
  splitRatioFromClientX,
  writeWorkspacePreference,
  type ResizeKey,
  type WorkspaceLayoutMode,
  type WorkspaceTab,
} from '../lib/workspace-layout';

export interface UseWorkspaceLayoutResult {
  /** สัดส่วนความกว้างของ Visual Composer (0..1) */
  splitRatio: number;
  /** แถบ Actions ย่ออยู่หรือไม่ */
  sidebarCollapsed: boolean;
  /** โหมด layout ตามความกว้างหน้าต่าง */
  layoutMode: WorkspaceLayoutMode;
  /** แท็บที่ active (โหมด mobile) */
  activeTab: WorkspaceTab;
  /** กำลังลาก divider อยู่หรือไม่ */
  isDragging: boolean;

  /** สลับแท็บ (ไม่ล้าง selection / descriptor / preview) */
  setActiveTab: (tab: WorkspaceTab) => void;
  /** สลับสถานะย่อ/ขยายของ Actions */
  toggleSidebar: () => void;
  /** ตั้งสถานะย่อ/ขยายโดยตรง */
  setSidebarCollapsed: (collapsed: boolean) => void;
  /** รีเซ็ตพื้นที่ทำงานทั้งหมด */
  resetLayout: () => void;

  /** ขอเริ่มลาก divider */
  startDrag: (event: ReactPointerEvent<HTMLElement>) => void;
  /** ป้ายกับเมาส์/คีย์บอร์ดของ divider */
  dividerProps: {
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onDoubleClick: () => void;
  };

  /** ref ของ container ที่ใช้วัดความกว้างพื้นที่ทำงาน */
  containerRef: MutableRefObject<HTMLDivElement | null>;
}

export function useWorkspaceLayout(): UseWorkspaceLayoutResult {
  const [splitRatio, setSplitRatio] = useState<number>(DEFAULT_SPLIT_RATIO);
  const [sidebarCollapsed, setSidebarCollapsedState] = useState<boolean>(false);
  const [layoutMode, setLayoutMode] = useState<WorkspaceLayoutMode>('desktop');
  const [activeTab, setActiveTabState] = useState<WorkspaceTab>('composer');
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  /** ความกว้างจริงของพื้นที่ทำงาน (px) */
  const containerWidthRef = useRef<number>(0);
  /** กันเขียนค่าเดิมซ้ำ (ลด localStorage traffic) */
  const hydratedRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Hydrate จาก localStorage (หลัง mount เท่านั้น → ไม่เกิด hydration mismatch)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    const storedRatio = readWorkspacePreference(
      WORKSPACE_STORAGE_KEYS.splitRatio
    );
    const storedCollapsed = readWorkspacePreference(
      WORKSPACE_STORAGE_KEYS.sidebarCollapsed
    );

    setSplitRatio(parseStoredSplitRatio(storedRatio));
    setSidebarCollapsedState(parseStoredSidebarCollapsed(storedCollapsed));
  }, []);

  // ---------------------------------------------------------------------------
  // ตรวจความกว้างพื้นที่ทำงาน + โหมด layout
  // ---------------------------------------------------------------------------
  // ตรวจโหมด layout ตามความกว้างหน้าต่าง (ทำงานทุกโหมด)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const measureMode = () => {
      setLayoutMode(resolveWorkspaceLayoutMode(window.innerWidth));
    };
    measureMode();
    window.addEventListener('resize', measureMode);
    return () => window.removeEventListener('resize', measureMode);
  }, []);

  // ---------------------------------------------------------------------------
  // วัดความกว้างพื้นที่ทำงาน → clamp สัดส่วนให้อยู่ในช่วงที่ใช้ได้
  // (ทำใหม่เมื่อสลับโหมด เพราะ container ถูก mount/unmount)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const measure = () => {
      const el = containerRef.current;
      if (!el) return;
      const width = el.clientWidth || el.getBoundingClientRect().width;
      if (width <= 0) return;
      containerWidthRef.current = width;
      // clamp ค่าเดิมให้อยู่ในช่วงที่ใช้ได้เมื่อหน้าต่างเปลี่ยนขนาด
      setSplitRatio((prev) => clampSplitRatio(prev, width));
    };

    measure();
    window.addEventListener('resize', measure);
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      const observer = new ResizeObserver(() => measure());
      observer.observe(containerRef.current);
      return () => {
        observer.disconnect();
        window.removeEventListener('resize', measure);
      };
    }
    return () => window.removeEventListener('resize', measure);
  }, [layoutMode]);

  // ---------------------------------------------------------------------------
  // บันทึกค่าลง localStorage (UI preference เท่านั้น)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!hydratedRef.current) return;
    writeWorkspacePreference(
      WORKSPACE_STORAGE_KEYS.splitRatio,
      serializeSplitRatio(splitRatio)
    );
  }, [splitRatio]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    writeWorkspacePreference(
      WORKSPACE_STORAGE_KEYS.sidebarCollapsed,
      serializeSidebarCollapsed(sidebarCollapsed)
    );
  }, [sidebarCollapsed]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  const setActiveTab = useCallback((tab: WorkspaceTab) => {
    setActiveTabState(tab);
  }, []);

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    setSidebarCollapsedState(collapsed);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsedState((prev) => !prev);
  }, []);

  const resetLayout = useCallback(() => {
    const next = resetWorkspaceLayout();
    setSplitRatio(next.splitRatio);
    setSidebarCollapsedState(next.sidebarCollapsed);
  }, []);

  // ---------------------------------------------------------------------------
  // Drag divider (Pointer Events — รองรับทั้ง Mouse และ Trackpad)
  // ---------------------------------------------------------------------------
  const dragCleanupRef = useRef<(() => void) | null>(null);

  const stopDrag = useCallback(() => {
    if (dragCleanupRef.current) {
      dragCleanupRef.current();
      dragCleanupRef.current = null;
    }
    setIsDragging(false);
  }, []);

  const startDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      // ปุ่มซ้ายเท่านั้น
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      event.preventDefault();

      // ให้ focus ติดที่ divider (เพื่อให้ใช้คีย์บอร์ดต่อได้ทันที)
      try {
        (event.currentTarget as HTMLElement | null)?.focus?.();
      } catch {
        // ไม่เป็นไร — focus เป็น enhancement เท่านั้น
      }

      const container = containerRef.current;
      const rect = container?.getBoundingClientRect();
      if (!container || !rect) return;

      setIsDragging(true);

      // ป้องกันการเลือกข้อความระหว่างลาก
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = 'none';

      // พื้นที่ที่ใช้แบ่งจริง = ความกว้าง container ลบด้วยความกว้าง divider
      const usableWidth = Math.max(1, rect.width - DIVIDER_WIDTH);

      const handleMove = (moveEvent: PointerEvent) => {
        const ratio = splitRatioFromClientX(moveEvent.clientX, {
          left: rect.left,
          width: usableWidth,
        });
        setSplitRatio(clampSplitRatio(ratio, usableWidth));
      };

      const handleUp = () => {
        stopDrag();
      };

      const handleCancel = () => {
        stopDrag();
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
      window.addEventListener('pointercancel', handleCancel);

      dragCleanupRef.current = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        window.removeEventListener('pointercancel', handleCancel);
        document.body.style.userSelect = previousUserSelect;
      };
    },
    [stopDrag]
  );

  // cleanup ทุก listener เมื่อ unmount
  useEffect(() => {
    return () => {
      if (dragCleanupRef.current) {
        dragCleanupRef.current();
        dragCleanupRef.current = null;
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Keyboard resize
  // ---------------------------------------------------------------------------
  const handleDividerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const key = event.key as ResizeKey;
      if (
        key !== 'ArrowLeft' &&
        key !== 'ArrowRight' &&
        key !== 'Home' &&
        key !== 'End'
      ) {
        return;
      }
      event.preventDefault();
      const width = containerWidthRef.current;
      setSplitRatio((prev) =>
        resizeRatioByKey(prev, key, { containerWidth: width })
      );
    },
    []
  );

  const handleDividerDoubleClick = useCallback(() => {
    // Double click → คืนค่า Default
    setSplitRatio(defaultRatio());
  }, []);

  const dividerProps = useMemo(
    () => ({
      onKeyDown: handleDividerKeyDown,
      onPointerDown: startDrag,
      onDoubleClick: handleDividerDoubleClick,
    }),
    [handleDividerKeyDown, handleDividerDoubleClick, startDrag]
  );

  return {
    splitRatio,
    sidebarCollapsed,
    layoutMode,
    activeTab,
    isDragging,
    setActiveTab,
    toggleSidebar,
    setSidebarCollapsed,
    resetLayout,
    startDrag,
    dividerProps,
    containerRef,
  };
}

function defaultRatio(): number {
  return DEFAULT_SPLIT_RATIO;
}
