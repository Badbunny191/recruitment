'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface VersionField {
  fieldId: string;
  sectionId: string | null; // Sprint 4
  labelTh: string;
  isRequired: boolean;
}

interface TemplateSection {
  id: string;
  name: string;
  displayOrder: number;
  isActive?: boolean; // Sprint 4: optional in case backend doesn't return
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
  const [sections, setSections] = React.useState<TemplateSection[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open && versionId) {
      fetchData();
    }
  }, [open, versionId]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch fields and sections in parallel (Sprint 4)
      const [fieldsRes, sectionsRes] = await Promise.all([
        fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/admin/template-fields/${versionId}`,
          { headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` } }
        ).then(r => r.json()),
        fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/admin/template-sections/${versionId}`,
          { headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` } }
        ).then(r => r.json()).catch(() => ({ data: [] })),
      ]);

      if (fieldsRes.error) {
        setError(fieldsRes.error);
      } else {
        setFields(fieldsRes.data || []);
        setSections((sectionsRes.data || []).filter((s: TemplateSection) => s.isActive !== false));
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

  // Sprint 4: Group fields by section
  const ungroupedFields = fields.filter(f => !f.sectionId);
  const fieldsBySectionId = (sectionId: string) => fields.filter(f => f.sectionId === sectionId);

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
              <div className="space-y-6">
                {/* Sprint 4: Render sections in order, then ungrouped */}
                {sections.map((section) => {
                  const sectionFields = fieldsBySectionId(section.id);
                  if (sectionFields.length === 0) return null;
                  return (
                    <div key={section.id} className="border rounded-lg p-4 bg-slate-50">
                      <h4 className="font-semibold text-base mb-3 pb-2 border-b flex items-center gap-2">
                        <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                        {section.name}
                        <Badge variant="outline" className="text-xs ml-2">{sectionFields.length} ฟิลด์</Badge>
                      </h4>
                      <ol className="space-y-2 list-decimal list-inside">
                        {sectionFields.map((field) => (
                          <li key={field.fieldId} className="flex items-center gap-2 text-sm">
                            <span className="flex-1">{field.labelTh}</span>
                            {field.isRequired && (
                              <Badge className="bg-red-100 text-red-700 text-xs">ต้องตอบ</Badge>
                            )}
                          </li>
                        ))}
                      </ol>
                    </div>
                  );
                })}

                {/* Ungrouped fields */}
                {ungroupedFields.length > 0 && (
                  <div className="border rounded-lg p-4 bg-slate-50">
                    <h4 className="font-semibold text-base mb-3 pb-2 border-b">ไม่มี Section</h4>
                    <ol className="space-y-2 list-decimal list-inside">
                      {ungroupedFields.map((field) => (
                        <li key={field.fieldId} className="flex items-center gap-2 text-sm">
                          <span className="flex-1">{field.labelTh}</span>
                          {field.isRequired && (
                            <Badge className="bg-red-100 text-red-700 text-xs">ต้องตอบ</Badge>
                          )}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            )}

            <div className="text-sm text-slate-500 mt-4">
              รวม {fields.length} ฟิลด์ ใน {sections.length} Section
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
