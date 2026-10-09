'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import React from 'react';

interface VersionOption {
  versionId: string;
  versionNumber: number;
  isCurrentVersion: boolean;
  isRecommended: boolean;
  fieldChanges: {
    added: number;
    removed: number;
  };
}

interface CloneOptions {
  originalRound: {
    id: string;
    title: string;
    status: string;
    currentVersionId: string;
    currentVersionNumber: number;
  };
  template: {
    id: string;
    name: string;
  } | null;
  applicationCount: number;
  needsProtection: boolean;
  versionOptions: VersionOption[];
}

interface CloneRoundModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roundId: string;
  onCloneSuccess?: () => void;
}

export function CloneRoundModal({
  open,
  onOpenChange,
  roundId,
  onCloneSuccess,
}: CloneRoundModalProps) {
  const [options, setOptions] = React.useState<CloneOptions | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = React.useState<string>('');
  const [newTitle, setNewTitle] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [cloneError, setCloneError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open && roundId) {
      fetchCloneOptions();
    }
  }, [open, roundId]);

  const fetchCloneOptions = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/rounds/${roundId}/clone-options`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('adminToken')}`,
          },
        }
      );
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setOptions(data.data);
        // Auto-select recommended version
        const recommended = data.data.versionOptions.find(
          (v: VersionOption) => v.isRecommended
        );
        if (recommended) {
          setSelectedVersionId(recommended.versionId);
        } else if (data.data.versionOptions.length > 0) {
          setSelectedVersionId(
            data.data.versionOptions[0].versionId
          );
        }
        // Auto-generate title
        setNewTitle(`${data.data.originalRound.title} (Copy)`);
      }
    } catch (err) {
      setError('เกิดข้อผิดพลาดในการโหลดข้อมูล');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedVersionId) {
      setCloneError('กรุณาเลือก Template Version');
      return;
    }

    setSubmitting(true);
    setCloneError(null);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/rounds/${roundId}/clone`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('adminToken')}`,
          },
          body: JSON.stringify({
            templateVersionId: selectedVersionId,
            title: newTitle,
          }),
        }
      );
      const data = await res.json();
      if (data.error) {
        setCloneError(data.error);
      } else {
        onOpenChange(false);
        onCloneSuccess?.();
      }
    } catch (err) {
      setCloneError('เกิดข้อผิดพลาดในการ Clone');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const selectedOption = options?.versionOptions.find(
    (v) => v.versionId === selectedVersionId
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Clone Round</DialogTitle>
          <DialogDescription>
            สร้างรอบใหม่โดยใช้ Template Version ที่เลือก
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-4 text-red-800">
            {error}
          </div>
        )}

        {options && !loading && (
          <div className="space-y-4">
            {/* Protection Warning for ACTIVE rounds with applications */}
            {options.needsProtection && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">🔒</span>
                  <div>
                    <h4 className="font-medium text-amber-800">
                      รอบนี้มีผู้สมัครแล้ว
                    </h4>
                    <p className="text-sm text-amber-700 mt-1">
                      มีผู้สมัครแล้ว {options.applicationCount} คน ไม่สามารถเปลี่ยน
                      Template Version ได้
                    </p>
                    <p className="text-sm text-amber-700">
                      Clone Round ใหม่เพื่อใช้ Template Version ที่ต้องการ
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Current Round Info */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <div className="text-sm text-slate-600">รอบเดิม</div>
              <div className="font-medium">{options.originalRound.title}</div>
              <div className="text-sm text-slate-500 mt-1">
                Template: {options.template?.name || '?'} v
                {options.originalRound.currentVersionNumber}
              </div>
              <div className="text-sm text-slate-500">
                สถานะ: {options.originalRound.status}
              </div>
              {options.applicationCount > 0 && (
                <div className="text-sm text-amber-600 mt-2">
                  ⚠️ มีผู้สมัคร {options.applicationCount} คน (ไม่คัดลอก)
                </div>
              )}
            </div>

            {/* New Round Title */}
            <div className="space-y-2">
              <Label htmlFor="newTitle">ชื่อรอบใหม่</Label>
              <Input
                id="newTitle"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="เช่น รอบใหม่ 2024"
              />
            </div>

            {/* Version Selection */}
            <div className="space-y-2">
              <Label>Template Version</Label>
              <div className="space-y-2">
                {options.versionOptions.map((option) => (
                  <label
                    key={option.versionId}
                    className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                      selectedVersionId === option.versionId
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="version"
                      value={option.versionId}
                      checked={selectedVersionId === option.versionId}
                      onChange={() => setSelectedVersionId(option.versionId)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          v{option.versionNumber}
                        </span>
                        {option.isCurrentVersion && (
                          <Badge className="bg-slate-100 text-slate-700 text-xs">
                            ปัจจุบัน
                          </Badge>
                        )}
                        {option.isRecommended && (
                          <Badge className="bg-green-100 text-green-700 text-xs">
                            แนะนำ
                          </Badge>
                        )}
                      </div>
                      {option.fieldChanges.added > 0 ||
                      option.fieldChanges.removed > 0 ? (
                        <div className="flex gap-2 mt-1 text-xs">
                          {option.fieldChanges.added > 0 && (
                            <span className="text-green-600">
                              ✅ เพิ่ม {option.fieldChanges.added} Field
                            </span>
                          )}
                          {option.fieldChanges.removed > 0 && (
                            <span className="text-red-600">
                              ❌ ลบ {option.fieldChanges.removed} Field
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="text-xs text-slate-500 mt-1">
                          ไม่มีการเปลี่ยนแปลง Field
                        </div>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Difference Summary */}
            {selectedOption && !selectedOption.isCurrentVersion && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="text-sm text-blue-800">
                  <div className="font-medium mb-1">
                    สรุปความแตกต่าง
                  </div>
                  <div className="flex gap-4">
                    {selectedOption.fieldChanges.added > 0 && (
                      <span className="text-green-600">
                        ✅ เพิ่ม {selectedOption.fieldChanges.added} Field
                      </span>
                    )}
                    {selectedOption.fieldChanges.removed > 0 && (
                      <span className="text-red-600">
                        ❌ ลบ {selectedOption.fieldChanges.removed} Field
                      </span>
                    )}
                    {selectedOption.fieldChanges.added === 0 &&
                      selectedOption.fieldChanges.removed === 0 && (
                        <span className="text-slate-600">
                          ไม่มีการเปลี่ยนแปลง
                        </span>
                      )}
                  </div>
                </div>
              </div>
            )}

            {/* Clone Error */}
            {cloneError && (
              <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">
                {cloneError}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            ยกเลิก
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || loading}>
            {submitting ? 'กำลัง Clone...' : 'Clone Round'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
