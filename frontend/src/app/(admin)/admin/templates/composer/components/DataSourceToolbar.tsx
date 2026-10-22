'use client';

/**
 * DataSourceToolbar
 * --------------------------------
 * Document Composer V1 — Preview Data Source Selector
 *
 * Requirement A: Preview Data Source Selection
 * Toolbar อยู่บริเวณ Toolbar ของหน้า Composer ไม่ใช่ใน Editor ของแต่ละ Block
 *
 * Modes:
 * 1. ข้อมูลตัวอย่าง (default)
 *    - ใช้ Preview Context จำลอง
 *    - มี Badge ชัดเจนว่า "ข้อมูลตัวอย่าง"
 *    - ห้ามทำให้ผู้ใช้เข้าใจว่าเป็นข้อมูลผู้สมัครจริง
 *
 * 2. ข้อมูลผู้สมัครจริง
 *    - เลือกรอบรับสมัครก่อน
 *    - ค้นหาด้วย: เลขที่ใบสมัคร / ชื่อ / อีเมล
 *    - แสดงเลขที่ใบสมัคร + ชื่อผู้สมัครที่กำลัง Preview
 *    - มีปุ่มล้างการเลือกและกลับไปใช้ข้อมูลตัวอย่าง
 */

import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '@/lib/useAdminAuth';

// =============================================================================
// Types
// =============================================================================

export interface Round {
  id: string;
  title: string;
  positionLevel: string;
  templateVersionId: string;
  status: string;
  roundCode?: string | null;
}

export interface ApplicationSummary {
  id: string;
  applicationNo: string;
  fullname: string;
  email: string;
  status: string;
  submittedAt: number | null;
}

export interface SelectedApplication {
  id: string;
  applicationNo: string;
  fullname: string;
  email: string;
}

export type DataSourceMode = 'sample' | 'real';

export interface DataSourceState {
  mode: DataSourceMode;
  selectedRound: Round | null;
  selectedApplication: SelectedApplication | null;
  applicationId: string | null; // passed to preview API
}

// =============================================================================
// Props
// =============================================================================

export interface DataSourceToolbarProps {
  /** Current state */
  value: DataSourceState;
  /** Callback when state changes */
  onChange: (state: DataSourceState) => void;
  /** Template version ID to filter rounds */
  templateVersionId: string;
  /** Whether to disable interactions (e.g., while saving) */
  disabled?: boolean;
}

// =============================================================================
// Main Component
// =============================================================================

export function DataSourceToolbar({
  value,
  onChange,
  templateVersionId,
  disabled = false,
}: DataSourceToolbarProps) {
  const [rounds, setRounds] = useState<Round[]>([]);
  const [roundsLoading, setRoundsLoading] = useState(false);

  // Load rounds when switching to real mode
  useEffect(() => {
    if (value.mode !== 'real') return;

    let cancelled = false;
    setRoundsLoading(true);

    const baseUrl = process.env.NEXT_PUBLIC_API_URL || '';
    adminFetch(`${baseUrl}/admin/rounds?view=active`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (cancelled) return;
        // Filter to rounds that use this template version
        const filtered = (data?.data ?? []).filter(
          (r: Round) => r.templateVersionId === templateVersionId && r.status === 'ACTIVE'
        );
        setRounds(filtered);
        setRoundsLoading(false);

        // Auto-select first round if none selected
        if (filtered.length > 0 && !value.selectedRound) {
          onChange({ ...value, selectedRound: filtered[0] });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRounds([]);
          setRoundsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [value.mode, templateVersionId]);

  const handleModeChange = useCallback(
    (mode: DataSourceMode) => {
      if (mode === 'sample') {
        // Switch to sample mode — clear selection
        onChange({
          mode: 'sample',
          selectedRound: null,
          selectedApplication: null,
          applicationId: null,
        });
      } else {
        // Switch to real mode — keep round if already selected
        onChange({
          ...value,
          mode: 'real',
          selectedApplication: null,
          applicationId: null,
        });
      }
    },
    [value, onChange]
  );

  const handleRoundChange = useCallback(
    (roundId: string) => {
      const round = rounds.find((r) => r.id === roundId) ?? null;
      onChange({
        ...value,
        selectedRound: round,
        selectedApplication: null,
        applicationId: null,
      });
    },
    [value, rounds, onChange]
  );

  const handleApplicationSelect = useCallback(
    (app: ApplicationSummary) => {
      onChange({
        ...value,
        selectedApplication: {
          id: app.id,
          applicationNo: app.applicationNo,
          fullname: app.fullname,
          email: app.email,
        },
        applicationId: app.id,
      });
    },
    [value, onChange]
  );

  const handleClearApplication = useCallback(() => {
    onChange({
      ...value,
      selectedApplication: null,
      applicationId: null,
    });
  }, [value, onChange]);

  return (
    <div className="flex flex-col gap-2">
      {/* Mode Toggle */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-600 font-medium shrink-0">
          ข้อมูลที่ใช้แสดงตัวอย่าง
        </span>
        <ModeToggle
          mode={value.mode}
          onChange={handleModeChange}
          disabled={disabled}
        />
      </div>

      {/* Real Application Selector */}
      {value.mode === 'real' && (
        <ApplicationSelector
          rounds={rounds}
          roundsLoading={roundsLoading}
          selectedRound={value.selectedRound}
          selectedApplication={value.selectedApplication}
          onRoundChange={handleRoundChange}
          onApplicationSelect={handleApplicationSelect}
          onClearApplication={handleClearApplication}
          disabled={disabled}
        />
      )}

      {/* Sample Mode Badge */}
      {value.mode === 'sample' && (
        <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-100 rounded text-[11px] text-slate-500">
          <span className="text-slate-400">●</span>
          <span>ข้อมูลตัวอย่าง</span>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Mode Toggle
// =============================================================================

function ModeToggle({
  mode,
  onChange,
  disabled,
}: {
  mode: DataSourceMode;
  onChange: (mode: DataSourceMode) => void;
  disabled: boolean;
}) {
  return (
    <div className="inline-flex rounded-md border border-slate-300 bg-slate-50 p-0.5">
      <button
        type="button"
        onClick={() => onChange('sample')}
        disabled={disabled}
        className={`text-xs px-2.5 py-1 rounded transition-colors ${
          mode === 'sample'
            ? 'bg-white text-slate-900 shadow-sm font-medium'
            : 'text-slate-500 hover:text-slate-700'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        ข้อมูลตัวอย่าง
      </button>
      <button
        type="button"
        onClick={() => onChange('real')}
        disabled={disabled}
        className={`text-xs px-2.5 py-1 rounded transition-colors ${
          mode === 'real'
            ? 'bg-white text-slate-900 shadow-sm font-medium'
            : 'text-slate-500 hover:text-slate-700'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        ผู้สมัครจริง
      </button>
    </div>
  );
}

// =============================================================================
// Application Selector
// =============================================================================

interface ApplicationSelectorProps {
  rounds: Round[];
  roundsLoading: boolean;
  selectedRound: Round | null;
  selectedApplication: SelectedApplication | null;
  onRoundChange: (roundId: string) => void;
  onApplicationSelect: (app: ApplicationSummary) => void;
  onClearApplication: () => void;
  disabled: boolean;
}

function ApplicationSelector({
  rounds,
  roundsLoading,
  selectedRound,
  selectedApplication,
  onRoundChange,
  onApplicationSelect,
  onClearApplication,
  disabled,
}: ApplicationSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [applications, setApplications] = useState<ApplicationSummary[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  // Load applications when round changes or search changes
  useEffect(() => {
    if (!selectedRound) {
      setApplications([]);
      return;
    }

    let cancelled = false;
    setAppsLoading(true);

    const baseUrl = process.env.NEXT_PUBLIC_API_URL || '';
    const url = `${baseUrl}/admin/rounds/${selectedRound.id}/applications` +
      (searchQuery ? `?search=${encodeURIComponent(searchQuery)}` : '');

    adminFetch(url)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (cancelled) return;
        setApplications(data?.data ?? []);
        setAppsLoading(false);
        setShowPicker(true);
      })
      .catch(() => {
        if (!cancelled) {
          setApplications([]);
          setAppsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedRound, searchQuery]);

  // Hide picker when no round selected
  useEffect(() => {
    if (!selectedRound) {
      setShowPicker(false);
    }
  }, [selectedRound]);

  return (
    <div className="flex flex-col gap-2 pl-4 border-l-2 border-slate-200">
      {/* Round Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2 w-full min-w-0">
        <label className="text-xs text-slate-600 font-medium shrink-0">รอบรับสมัคร:</label>
        {roundsLoading ? (
          <span className="text-xs text-slate-400">กำลังโหลด...</span>
        ) : rounds.length === 0 ? (
          <span className="text-xs text-amber-600">ไม่พบรอบที่ใช้งานได้</span>
        ) : (
          <select
            value={selectedRound?.id ?? ''}
            onChange={(e) => onRoundChange(e.target.value)}
            disabled={disabled}
            title={
              selectedRound
                ? `${selectedRound.title}${selectedRound.roundCode ? ` (${selectedRound.roundCode})` : ''}`
                : 'เลือกรอบรับสมัคร'
            }
            className="text-xs border border-slate-300 rounded px-2.5 py-1.5 w-full flex-1 min-w-0 bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-sm disabled:opacity-50"
          >
            <option value="">-- เลือกรอบรับสมัคร --</option>
            {rounds.map((r) => {
              const fullTitle = `${r.title}${r.roundCode ? ` (${r.roundCode})` : ''}`;
              return (
                <option key={r.id} value={r.id} title={fullTitle}>
                  {fullTitle}
                </option>
              );
            })}
          </select>
        )}
      </div>

      {/* Selected Application Display */}
      {selectedApplication && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 px-2 py-1 bg-blue-50 border border-blue-200 rounded text-[11px]">
            <span className="text-blue-600 font-medium">{selectedApplication.applicationNo}</span>
            <span className="text-slate-600">{selectedApplication.fullname}</span>
          </div>
          <button
            type="button"
            onClick={onClearApplication}
            disabled={disabled}
            className="text-[10px] text-slate-500 hover:text-slate-700 underline disabled:opacity-50"
          >
            เปลี่ยนผู้สมัคร
          </button>
          <button
            type="button"
            onClick={() => onClearApplication()}
            disabled={disabled}
            className="text-[10px] text-amber-600 hover:text-amber-700 underline disabled:opacity-50"
          >
            ยกเลิก
          </button>
        </div>
      )}

      {/* Application Picker */}
      {showPicker && selectedRound && !selectedApplication && (
        <ApplicationPicker
          applications={applications}
          loading={appsLoading}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSelect={onApplicationSelect}
          disabled={disabled}
        />
      )}

      {/* Empty state */}
      {selectedRound && !selectedApplication && applications.length === 0 && !appsLoading && (
        <p className="text-[11px] text-slate-400">ไม่พบผู้สมัครในรอบนี้</p>
      )}
    </div>
  );
}

// =============================================================================
// Application Picker
// =============================================================================

interface ApplicationPickerProps {
  applications: ApplicationSummary[];
  loading: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSelect: (app: ApplicationSummary) => void;
  disabled: boolean;
}

function ApplicationPicker({
  applications,
  loading,
  searchQuery,
  onSearchChange,
  onSelect,
  disabled,
}: ApplicationPickerProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <label className="text-xs text-slate-600 shrink-0">ค้นหา:</label>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="เลขที่ใบสมัคร ชื่อ หรืออีเมล"
          disabled={disabled}
          className="text-xs border border-slate-300 rounded px-2.5 py-1.5 w-full flex-1 min-w-0 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-sm disabled:opacity-50"
        />
      </div>

      {loading && (
        <div className="flex items-center gap-1 text-[11px] text-slate-400">
          <Spinner />
          <span>กำลังค้นหา...</span>
        </div>
      )}

      {!loading && applications.length > 0 && (
        <div className="max-h-40 overflow-y-auto border border-slate-200 rounded">
          {applications.map((app) => (
            <button
              key={app.id}
              type="button"
              onClick={() => onSelect(app)}
              disabled={disabled}
              className="w-full text-left px-2 py-1.5 text-[11px] hover:bg-blue-50 border-b border-slate-100 last:border-b-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="font-medium text-slate-700">{app.applicationNo}</span>
              <span className="text-slate-500 ml-2">{app.fullname}</span>
              <span className="text-slate-400 ml-1">({app.email})</span>
            </button>
          ))}
        </div>
      )}

      {!loading && applications.length === 0 && searchQuery.length > 0 && (
        <p className="text-[11px] text-slate-400">ไม่พบผู้สมัครที่ตรงกับการค้นหา</p>
      )}
    </div>
  );
}

// =============================================================================
// Spinner
// =============================================================================

function Spinner() {
  return (
    <svg
      className="animate-spin h-3.5 w-3.5 shrink-0"
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
