'use client';

/**
 * ComposerWorkspace
 * -----------------------------------------------------------------
 * Document Composer — โครงสร้างพื้นที่ทำงานแบบ Responsive (ก้อนที่ 2)
 *
 * โครงสร้าง:
 *   Desktop / Laptop:
 *     [Actions] [ Visual Composer | Divider | Live Preview ]
 *
 *   Mobile (< 1024px):
 *     [แท็บ: แก้ไขเอกสาร | ดูตัวอย่าง]
 *
 * ⚠️ Scroll:
 *   - แต่ละคอลัมน์เลื่อนแยกกัน (overflow-y-auto + min-h-0)
 *   - หัวของแต่ละคอลัมน์อยู่นิ่ง (ไม่เลื่อนตาม)
 *   - ไม่ hard-code viewport offset แบบเปราะ → วัดความสูงที่เหลือจริง
 *
 * ⚠️ การสลับแท็บ **ไม่** ล้าง descriptor / selection / data source / preview
 *    (เนื้อหาทั้งสองแท็บ render พร้อมกัน — แค่ซ่อนด้วย CSS)
 */

import type { ReactNode, MutableRefObject } from 'react';
import { cn } from '@/lib/utils';
import { ActionsSidebar } from './ActionsSidebar';
import { WorkspaceDivider } from './WorkspaceDivider';
import type { WorkspaceLayoutMode, WorkspaceTab } from '../lib/workspace-layout';

export interface ComposerWorkspaceProps {
  /** โหมด layout ปัจจุบัน */
  layoutMode: WorkspaceLayoutMode;
  /** แท็บที่ active (โหมด mobile) */
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;

  /** แถบ Actions */
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onResetLayout: () => void;

  /** Actions callbacks (เดิมจาก ComposerClient) */
  onGenerate: () => void;
  onLoad: () => void;
  onSave: () => void;
  onFullscreenPreview: () => void;
  loading: {
    generate: boolean;
    load: boolean;
    save: boolean;
    preview: boolean;
  };
  canSave: boolean;
  canPreview: boolean;

  /** เนื้อหา Visual Composer (คอลัมน์กลาง) */
  composerContent: ReactNode;
  /** เนื้อหา Live Preview (คอลัมน์ขวา) */
  previewContent: ReactNode;

  /** สัดส่วนของ Visual Composer (0..1) */
  splitRatio: number;
  /** กำลังลาก divider */
  isDragging: boolean;
  /** handler ของ divider */
  dividerProps: {
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
    onDoubleClick: () => void;
  };

  /**
   * ref ของพื้นที่ที่ใช้วัดความกว้าง (เฉพาะส่วน composer + preview)
   * → ใช้คำนวณสัดส่วนตอนลาก divider และ clamp ขนาด
   */
  containerRef: MutableRefObject<HTMLDivElement | null>;
  /**
   * ref ของ element ระดับบนสุดของ workspace
   * → ใช้วัดความสูงที่เหลือจาก viewport (ไม่ hard-code offset)
   */
  heightRef?: MutableRefObject<HTMLDivElement | null>;
  /** ความสูงพื้นที่ทำงานที่เหลือจาก viewport (px) */
  workspaceHeight?: number;
}

export function ComposerWorkspace(props: ComposerWorkspaceProps) {
  const {
    layoutMode,
    activeTab,
    onTabChange,
    sidebarCollapsed,
    onToggleSidebar,
    onResetLayout,
    onGenerate,
    onLoad,
    onSave,
    onFullscreenPreview,
    loading,
    canSave,
    canPreview,
    composerContent,
    previewContent,
    splitRatio,
    isDragging,
    dividerProps,
    containerRef,
    heightRef,
    workspaceHeight,
  } = props;

  const isMobile = layoutMode === 'mobile';

  /**
   * ความสูงพื้นที่ทำงาน (วัดจริงจาก viewport)
   * - Desktop/Laptop: ใช้ความสูงที่เหลือจริง → แต่ละคอลัมน์เลื่อนแยกกัน
   * - Mobile: ก็กำหนดความสูงที่เหลือเช่นกัน → พื้นที่ Preview ในแท็บ
   *   "ดูตัวอย่าง" เต็มความสูงที่ได้รับ (ไม่สูงตามเนื้อหาเอกสาร)
   */
  const heightStyle =
    workspaceHeight != null ? { height: `${workspaceHeight}px` } : undefined;

  return (
    <div
      ref={heightRef}
      className="flex flex-col min-h-0 flex-1 h-full"
      data-testid="composer-workspace"
      data-layout-mode={layoutMode}
      style={isMobile ? heightStyle : undefined}
    >
      {/* ===== โหมดจอแคบ: แท็บ ===== */}
      {isMobile && (
        <>
          <div
            role="tablist"
            aria-label="สลับระหว่างการแก้ไขเอกสารและตัวอย่าง"
            className="flex items-center gap-1 p-1 mb-2 bg-white rounded-lg border shadow-sm shrink-0"
          >
            <TabButton
              active={activeTab === 'composer'}
              onClick={() => onTabChange('composer')}
              label="แก้ไขเอกสาร"
              testId="workspace-tab-composer"
            />
            <TabButton
              active={activeTab === 'preview'}
              onClick={() => onTabChange('preview')}
              label="ดูตัวอย่าง"
              testId="workspace-tab-preview"
            />
          </div>

          {/* Actions เปลี่ยนเป็น Toolbar แนวนอนบนหน้าจอแคบ */}
          <ActionsSidebar
            variant="toolbar"
            collapsed={false}
            onToggleCollapsed={onToggleSidebar}
            onResetLayout={onResetLayout}
            onGenerate={onGenerate}
            onLoad={onLoad}
            onSave={onSave}
            onFullscreenPreview={onFullscreenPreview}
            loading={loading}
            canSave={canSave}
            canPreview={canPreview}
          />
        </>
      )}

      {/* ===== โหมดจอกว้าง: 3 คอลัมน์ + Divider ===== */}
      {!isMobile && (
        <div className="flex items-stretch min-h-0 flex-1 h-full" style={heightStyle}>
          {/* LEFT: Actions */}
          <div className="flex shrink-0 min-h-0 pr-2">
            <ActionsSidebar
              collapsed={sidebarCollapsed}
              onToggleCollapsed={onToggleSidebar}
              onResetLayout={onResetLayout}
              onGenerate={onGenerate}
              onLoad={onLoad}
              onSave={onSave}
              onFullscreenPreview={onFullscreenPreview}
              loading={loading}
              canSave={canSave}
              canPreview={canPreview}
            />
          </div>

          {/* ===== พื้นที่ composer + preview (ใช้วัดสัดส่วน) ===== */}
          <div
            ref={containerRef}
            className="flex items-stretch min-w-0 min-h-0 flex-1 h-full"
          >
            {/* MIDDLE: Visual Composer */}
            <div
              className="min-w-0 min-h-0 flex flex-col pr-1 h-full"
              style={{ width: `${splitRatio * 100}%` }}
            >
              {composerContent}
            </div>

            {/* Divider */}
            <WorkspaceDivider
              ratio={splitRatio}
              isDragging={isDragging}
              onPointerDown={dividerProps.onPointerDown}
              onKeyDown={dividerProps.onKeyDown}
              onDoubleClick={dividerProps.onDoubleClick}
            />

            {/* RIGHT: Live Preview */}
            <div
              className="min-w-0 min-h-0 flex flex-col pl-1 h-full"
              style={{ width: `${(1 - splitRatio) * 100}%` }}
            >
              {previewContent}
            </div>
          </div>
        </div>
      )}

      {/* ===== โหมดจอแคบ: เนื้อหาแท็บ ===== */}
      {isMobile && (
        <div className="flex flex-col min-h-0 flex-1">
          {/*
            ⚠️ ใช้ class เพียงอย่างเดียวในการซ่อน/แสดง
               (ไม่ใช้ attribute `hidden` ควบกัน `flex` เพราะ class จะ override
                display:none ของ attribute → ทั้งสองแท็บจะเห็นพร้อมกัน)
          */}
          <div
            role="tabpanel"
            aria-label="แก้ไขเอกสาร"
            data-testid="workspace-panel-composer"
            data-active={activeTab === 'composer' ? 'true' : 'false'}
            className={cn(
              'flex-col min-h-0',
              activeTab === 'composer' ? 'flex flex-1' : 'hidden'
            )}
          >
            {composerContent}
          </div>
          <div
            role="tabpanel"
            aria-label="ดูตัวอย่าง"
            data-testid="workspace-panel-preview"
            data-active={activeTab === 'preview' ? 'true' : 'false'}
            className={cn(
              'flex-col min-h-0',
              activeTab === 'preview' ? 'flex flex-1' : 'hidden'
            )}
          >
            {previewContent}
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
        active
          ? 'bg-blue-600 text-white shadow-sm'
          : 'text-slate-600 hover:bg-slate-100'
      )}
    >
      {label}
    </button>
  );
}
