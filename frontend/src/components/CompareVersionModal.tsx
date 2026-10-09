'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface VersionComparison {
  fromVersion: {
    id: string;
    versionNumber: number;
  };
  toVersion: {
    id: string;
    versionNumber: number;
  };
  added: string[];
  removed: string[];
  modified: string[];
  summary: {
    added: number;
    removed: number;
    modified: number;
  };
}

interface CompareVersionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fromVersionId: string;
  toVersionId: string;
  onClone?: (versionId: string) => void;
  isLoading?: boolean;
}

export function CompareVersionModal({
  open,
  onOpenChange,
  fromVersionId,
  toVersionId,
  onClone,
  isLoading = false,
}: CompareVersionModalProps) {
  const [comparison, setComparison] = React.useState<VersionComparison | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open && fromVersionId && toVersionId) {
      fetchComparison();
    }
  }, [open, fromVersionId, toVersionId]);

  const fetchComparison = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/template-versions/${fromVersionId}/compare/${toVersionId}`,
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
        setComparison(data.data);
      }
    } catch (err) {
      setError('เกิดข้อผิดพลาดในการโหลดข้อมูล');
    } finally {
      setLoading(false);
    }
  };

  const handleClone = () => {
    if (onClone && comparison) {
      onClone(comparison.toVersion.id);
    }
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>เปรียบเทียบ Version</DialogTitle>
          <DialogDescription>
            {comparison ? (
              <>v{comparison.fromVersion.versionNumber} → v{comparison.toVersion.versionNumber}</>
            ) : (
              'กำลังโหลด...'
            )}
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

        {comparison && !loading && (
          <div className="space-y-4">
            {/* Summary Badges */}
            <div className="flex gap-2 flex-wrap">
              {comparison.summary.added > 0 && (
                <Badge className="bg-green-100 text-green-800 border-green-300">
                  +{comparison.summary.added} เพิ่ม
                </Badge>
              )}
              {comparison.summary.removed > 0 && (
                <Badge className="bg-red-100 text-red-800 border-red-300">
                  -{comparison.summary.removed} ลบ
                </Badge>
              )}
              {comparison.summary.modified > 0 && (
                <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">
                  ~{comparison.summary.modified} แก้ไข
                </Badge>
              )}
              {comparison.summary.added === 0 && comparison.summary.removed === 0 && comparison.summary.modified === 0 && (
                <Badge className="bg-gray-100 text-gray-800 border-gray-300">
                  ไม่มีการเปลี่ยนแปลง
                </Badge>
              )}
            </div>

            {/* Added Fields */}
            {comparison.added.length > 0 && (
              <div className="border rounded-lg p-4 bg-green-50">
                <h4 className="font-medium text-green-800 mb-2 flex items-center gap-2">
                  <span className="text-green-600">➕</span> เพิ่ม
                </h4>
                <ul className="space-y-1">
                  {comparison.added.map((field, idx) => (
                    <li key={idx} className="flex items-center gap-2 text-sm text-green-700">
                      <span className="text-green-500">✅</span> {field}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Removed Fields */}
            {comparison.removed.length > 0 && (
              <div className="border rounded-lg p-4 bg-red-50">
                <h4 className="font-medium text-red-800 mb-2 flex items-center gap-2">
                  <span className="text-red-600">🗑️</span> ลบ
                </h4>
                <ul className="space-y-1">
                  {comparison.removed.map((field, idx) => (
                    <li key={idx} className="flex items-center gap-2 text-sm text-red-700">
                      <span className="text-red-500">❌</span> {field}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Modified Fields */}
            {comparison.modified.length > 0 && (
              <div className="border rounded-lg p-4 bg-yellow-50">
                <h4 className="font-medium text-yellow-800 mb-2 flex items-center gap-2">
                  <span className="text-yellow-600">📝</span> แก้ไข
                </h4>
                <ul className="space-y-1">
                  {comparison.modified.map((field, idx) => (
                    <li key={idx} className="flex items-center gap-2 text-sm text-yellow-700">
                      <span className="text-yellow-500">📝</span> {field}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            ปิด
          </Button>
          {comparison && onClone && (
            <Button onClick={handleClone} disabled={isLoading}>
              {isLoading ? 'กำลัง Clone...' : `Clone ใช้ v${comparison.toVersion.versionNumber}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import React from 'react';
