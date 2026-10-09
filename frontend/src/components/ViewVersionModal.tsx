'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface VersionField {
  fieldId: string;
  labelTh: string;
  isRequired: boolean;
}

interface ViewVersionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versionId: string;
  versionNumber: number;
  status: string;
  templateName: string;
}

export function ViewVersionModal({
  open,
  onOpenChange,
  versionId,
  versionNumber,
  status,
  templateName,
}: ViewVersionModalProps) {
  const [fields, setFields] = React.useState<VersionField[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open && versionId) {
      fetchFields();
    }
  }, [open, versionId]);

  const fetchFields = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/template-fields/${versionId}`,
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
        setFields(data.data || []);
      }
    } catch {
      setError('เกิดข้อผิดพลาดในการโหลดข้อมูล');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (s: string) => {
    switch (s) {
      case 'PUBLISHED':
        return <Badge className="bg-green-600">Published</Badge>;
      case 'DRAFT':
        return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">Draft</Badge>;
      case 'ARCHIVED':
        return <Badge className="bg-gray-100 text-gray-600 border-gray-300">Archived</Badge>;
      default:
        return <Badge>{s}</Badge>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>
            ดู Version {versionNumber}
          </DialogTitle>
          <DialogDescription>
            {templateName} — {getStatusBadge(status)}
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

        {!loading && !error && (
          <>
            <div className="mb-4">
              <div className="flex items-center gap-4 text-sm text-slate-600">
                <span>Template: <strong>{templateName}</strong></span>
                <span>Version: <strong>v{versionNumber}</strong></span>
                <span>สถานะ: {getStatusBadge(status)}</span>
              </div>
            </div>

            {fields.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                ไม่มีฟิลด์ใน version นี้
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>คำถาม</TableHead>
                    <TableHead className="w-24 text-center">บังคับ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fields.map((field, idx) => (
                    <TableRow key={field.fieldId}>
                      <TableCell className="font-medium">{idx + 1}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span>{field.labelTh}</span>
                          {field.isRequired && (
                            <Badge className="bg-red-100 text-red-700 text-xs">ต้องตอบ</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {field.isRequired ? '✓' : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <div className="text-sm text-slate-500 mt-4">
              รวม {fields.length} ฟิลด์
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            ปิด
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import React from 'react';
