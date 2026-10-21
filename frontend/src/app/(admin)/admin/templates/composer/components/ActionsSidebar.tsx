'use client';

/**
 * ActionsSidebar
 * -----------------------------------------------------------------
 * Document Composer — แถบคำสั่งด้านซ้าย (ก้อนที่ 2)
 *
 * พฤติกรรมเดิมที่ต้องคงไว้ **ทุกประการ**:
 *   - Generate / Load / Save ทำงานเหมือนเดิม (เรียก callback เดิม)
 *   - Loading / Saving state ยังมองเห็นได้
 *   - Fullscreen Preview เรียก callback เดิม
 *
 * สิ่งที่เพิ่ม:
 *   - โหมดย่อ/ขยาย (เรียก callback เดิมของ ComposerClient ไม่เปลี่ยน)
 *   - Collapsed → แสดงเฉพาะไอคอน + tooltip + aria-label ครบ
 *   - ปุ่มย่อ/ขยาย มี aria-expanded และ focus ring
 *   - `variant="toolbar"` → ใช้เป็นแถบเครื่องมือแนวนอนบนหน้าจอแคบ
 */

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ActionsSidebarProps {
  /** true = ย่อ (แสดงเฉพาะไอคอน) */
  collapsed: boolean;
  /** สลับย่อ/ขยาย */
  onToggleCollapsed: () => void;
  /** รีเซ็ตพื้นที่ทำงานทั้งหมด */
  onResetLayout: () => void;

  onGenerate: () => void;
  onLoad: () => void;
  onSave: () => void;
  onFullscreenPreview: () => void;

  /** loading flags (จาก hook เดิม) */
  loading: {
    generate: boolean;
    load: boolean;
    save: boolean;
    preview: boolean;
  };
  /** ปิด Save ได้ไหม (เช่น JSON ไม่ถูกต้อง / version mismatch) */
  canSave: boolean;
  /** ปิด Preview ได้ไหม */
  canPreview: boolean;
  /**
   * 'sidebar' = แถบด้านซ้าย (default)
   * 'toolbar' = แถบเครื่องมือแนวนอน (ใช้บนหน้าจอแคบ)
   */
  variant?: 'sidebar' | 'toolbar';
}

interface ActionButtonSpec {
  key: string;
  icon: string;
  label: string;
  description: string;
  onClick: () => void;
  disabled: boolean;
  loading: boolean;
  /** spinner แทนไอคอน */
  busy: boolean;
  variant?: 'default' | 'outline' | 'ghost';
  className?: string;
}

/**
 * สร้างรายการปุ่มคำสั่ง — single source of truth ของ Actions
 * (ใช้ร่วมกันทั้งแบบ sidebar และ toolbar)
 */
export function buildActionSpecs(props: {
  onGenerate: () => void;
  onLoad: () => void;
  onSave: () => void;
  onFullscreenPreview: () => void;
  loading: ActionsSidebarProps['loading'];
  canSave: boolean;
  canPreview: boolean;
}): ActionButtonSpec[] {
  const { onGenerate, onLoad, onSave, onFullscreenPreview, loading, canSave, canPreview } =
    props;

  return [
    {
      key: 'generate',
      icon: '✨',
      label: 'Generate',
      description: 'สร้าง default descriptor จาก template structure',
      onClick: onGenerate,
      disabled: loading.generate || loading.load || loading.save,
      loading: loading.generate,
      busy: loading.generate,
    },
    {
      key: 'load',
      icon: '📥',
      label: 'Load',
      description: 'โหลด descriptor ที่บันทึกไว้',
      onClick: onLoad,
      disabled: loading.load || loading.save,
      loading: loading.load,
      busy: loading.load,
      variant: 'outline',
    },
    {
      key: 'save',
      icon: '💾',
      label: 'Save',
      description: 'บันทึก descriptor เข้า template version',
      onClick: onSave,
      disabled: loading.save || !canSave,
      loading: loading.save,
      busy: loading.save,
      className: 'bg-blue-600 hover:bg-blue-700',
    },
    {
      key: 'preview',
      icon: '👁',
      label: 'Preview (Fullscreen)',
      description: 'เปิด Fullscreen A4 · รองรับ Form/Document toggle',
      onClick: onFullscreenPreview,
      disabled: loading.preview || !canPreview,
      loading: loading.preview,
      busy: loading.preview,
      variant: 'outline',
    },
  ];
}

export function ActionsSidebar({
  collapsed,
  onToggleCollapsed,
  onResetLayout,
  onGenerate,
  onLoad,
  onSave,
  onFullscreenPreview,
  loading,
  canSave,
  canPreview,
  variant = 'sidebar',
}: ActionsSidebarProps) {
  const actions = buildActionSpecs({
    onGenerate,
    onLoad,
    onSave,
    onFullscreenPreview,
    loading,
    canSave,
    canPreview,
  });

  /**
   * Fullscreen Preview แยกออกจากปุ่มหลัก
   * → ไม่เก็บเป็นปุ่มใหญ่ใน Actions (ปุ่มหลักอยู่ที่หัว Live Preview)
   */
  const previewAction = actions.find((a) => a.key === 'preview')!;
  const primaryActions = actions.filter((a) => a.key !== 'preview');

  // ── โหมดแถบเครื่องมือ (หน้าจอแคบ) ────────────────────────────────────
  if (variant === 'toolbar') {
    return (
      <div
        data-testid="actions-toolbar"
        className="flex items-center gap-1.5 flex-wrap p-2 bg-white rounded-lg border shadow-sm mb-2 shrink-0"
      >
        {actions.map((action) => (
          <ToolbarActionButton key={action.key} action={action} />
        ))}
        <Button
          variant="ghost"
          size="sm"
          onClick={onResetLayout}
          className="text-slate-600"
          title="รีเซ็ตพื้นที่ทำงาน (สัดส่วนคอลัมน์ + ขนาดแถบ Actions)"
          aria-label="รีเซ็ตพื้นที่ทำงาน"
        >
          <span aria-hidden="true">↺</span>
          <span>รีเซ็ต</span>
        </Button>
      </div>
    );
  }

  return (
    <div
      data-testid="actions-sidebar"
      data-collapsed={collapsed ? 'true' : 'false'}
      className={cn(
        'flex flex-col h-full bg-white rounded-lg border shadow-sm overflow-hidden',
        collapsed ? 'w-14 shrink-0' : 'w-[240px] shrink-0'
      )}
    >
      {/* ===== Header + ปุ่มย่อ/ขยาย ===== */}
      <div
        className={cn(
          'flex items-center border-b border-slate-200 shrink-0',
          collapsed ? 'justify-center px-1 py-2' : 'justify-between px-3 py-2'
        )}
      >
        {!collapsed && (
          <div className="flex items-center gap-2 min-w-0">
            <span aria-hidden="true">⚡</span>
            <span className="text-sm font-semibold text-slate-800 truncate">
              Actions
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'ขยายแถบ Actions' : 'ย่อแถบ Actions'}
          title={collapsed ? 'ขยายแถบ Actions' : 'ย่อแถบ Actions'}
          data-testid="actions-sidebar-toggle"
          className={cn(
            'inline-flex items-center justify-center h-7 w-7 rounded-md shrink-0',
            'text-slate-600 hover:text-slate-900 hover:bg-slate-100',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1'
          )}
        >
          <span aria-hidden="true" className="text-sm leading-none">
            {collapsed ? '»' : '«'}
          </span>
        </button>
      </div>

      {/* ===== ปุ่มคำสั่ง ===== */}
      <div
        className={cn(
          'flex-1 min-h-0 overflow-y-auto',
          collapsed ? 'flex flex-col items-center gap-1 p-1.5' : 'p-2 space-y-1.5'
        )}
      >
        {primaryActions.map((action) => {
          if (collapsed) {
            return <IconActionButton key={action.key} action={action} />;
          }
          return <ExpandedActionButton key={action.key} action={action} />;
        })}

        {/* รีเซ็ตพื้นที่ทำงาน */}
        {collapsed ? (
          <IconActionButton
            action={{
              key: 'reset',
              icon: '↺',
              label: 'รีเซ็ตพื้นที่ทำงาน',
              description: 'คืนค่าสัดส่วนและขนาดแถบ Actions เป็นค่าเริ่มต้น',
              onClick: onResetLayout,
              disabled: false,
              loading: false,
              busy: false,
              variant: 'ghost',
            }}
          />
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={onResetLayout}
            className="w-full justify-start text-slate-600"
            title="รีเซ็ตพื้นที่ทำงาน (สัดส่วนคอลัมน์ + ขนาดแถบ Actions)"
            aria-label="รีเซ็ตพื้นที่ทำงาน"
          >
            <span className="shrink-0" aria-hidden="true">
              ↺
            </span>
            <span>รีเซ็ตพื้นที่ทำงาน</span>
          </Button>
        )}

        {/*
          Fullscreen Preview
          ⚠️ ไม่เก็บเป็นปุ่มใหญ่ใน Actions — ปุ่มหลักอยู่ที่หัว Live Preview
             (ปุ่ม ⛶ Fullscreen) และที่นี่เป็นทางลัดแบบเล็ก
        */}
        <div className="pt-2 mt-1 border-t border-slate-200">
          {collapsed ? (
            <IconActionButton action={previewAction} />
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={previewAction.onClick}
              disabled={previewAction.disabled}
              title={previewAction.description}
              aria-label={previewAction.label}
              className="w-full justify-start text-slate-600 h-7 text-[11px]"
            >
              {previewAction.busy ? (
                <Spinner />
              ) : (
                <span className="shrink-0" aria-hidden="true">
                  ⛶
                </span>
              )}
              <span className="truncate">Fullscreen Preview</span>
            </Button>
          )}
        </div>
      </div>

      {/* ===== คำอธิบาย (เฉพาะตอนขยาย) ===== */}
      {!collapsed && (
        <div className="px-3 py-2 border-t border-slate-200 shrink-0">
          <p className="text-[10px] text-slate-500 leading-relaxed">
            <strong>Generate:</strong> สร้าง default descriptor จาก template
            structure
            <br />
            <strong>Load:</strong> โหลด descriptor ที่บันทึกไว้
            <br />
            <strong>Save:</strong> บันทึก descriptor เข้า template version
            <br />
            <strong>Preview:</strong> เปิด Fullscreen A4 · รองรับ Form/Document
            toggle
          </p>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

function ExpandedActionButton({ action }: { action: ActionButtonSpec }) {
  const { icon, label, description, onClick, disabled, busy, variant, className } =
    action;
  return (
    <Button
      variant={variant ?? 'default'}
      size="sm"
      onClick={onClick}
      disabled={disabled}
      title={description}
      aria-label={label}
      className={cn('w-full justify-start', className)}
    >
      {busy ? (
        <Spinner />
      ) : (
        <span className="shrink-0" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="truncate">{busy ? `${label}...` : label}</span>
    </Button>
  );
}

/**
 * ปุ่มแบบแถบเครื่องมือ (หน้าจอแคบ) — แนวนอน แต่ยังมี tooltip + aria-label ครบ
 */
function ToolbarActionButton({ action }: { action: ActionButtonSpec }) {
  const { icon, label, description, onClick, disabled, busy, variant, className } =
    action;
  return (
    <Tooltip label={label} description={description}>
      <Button
        variant={variant ?? 'default'}
        size="sm"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        title={description}
        className={cn('h-8 text-xs', className)}
      >
        {busy ? (
          <Spinner />
        ) : (
          <span className="shrink-0" aria-hidden="true">
            {icon}
          </span>
        )}
        <span className="truncate">{busy ? `${label}...` : label}</span>
      </Button>
    </Tooltip>
  );
}

function IconActionButton({ action }: { action: ActionButtonSpec }) {
  const { icon, label, description, onClick, disabled, busy, variant } = action;
  return (
    <Tooltip label={label} description={description}>
      <Button
        variant={variant ?? 'ghost'}
        size="sm"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        title={description}
        className="h-8 w-8 p-0 shrink-0"
      >
        {busy ? (
          <Spinner />
        ) : (
          <span aria-hidden="true" className="text-sm leading-none">
            {icon}
          </span>
        )}
      </Button>
    </Tooltip>
  );
}

/**
 * Tooltip แบบ CSS (ไม่ต้องเพิ่ม package)
 * - แสดงเมื่อ hover / focus
 * - ใช้ group-hover และ group-focus-within
 */
function Tooltip({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <span className="relative inline-flex group">
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-full top-1/2 z-50 -translate-y-1/2 ml-2',
          'hidden group-hover:flex group-focus-within:flex',
          'whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] text-white shadow-lg'
        )}
      >
        <span className="font-medium">{label}</span>
        <span className="opacity-75"> — {description}</span>
      </span>
    </span>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}
