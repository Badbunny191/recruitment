'use client';

/**
 * useTemplateFields Hook
 * --------------------------------
 * Document Composer V1 — Field Library Loader
 *
 * โหลดรายการ field ทั้งหมดที่ version นี้ใช้ จาก backend endpoint ที่มีอยู่แล้ว
 * (GET /admin/template-fields/:versionId)
 *
 * ใช้สำหรับ Field Picker — ผู้ใช้เลือก field จาก template version ปัจจุบันเท่านั้น
 */

import { useEffect, useState, useCallback } from 'react';
import { adminFetch } from '@/lib/useAdminAuth';

export interface TemplateFieldLibraryItem {
  /** template_fields.id (UUID) — เป็นค่า fieldId ที่ Block ใช้ */
  id: string;
  /** field_master.id (FK) */
  fieldId: string;
  sectionId: string | null;
  displayOrder: number;
  isRequired: boolean;
  /** ชื่อ field ที่แสดง (override ?? master) */
  labelTh: string;
  /** field type (TEXT, TEXTAREA, MASTER_DATA, DATE, ...) */
  fieldType?: string;
  rows?: number | null;
  minLength?: number | null;
  maxLength?: number | null;
}

export interface UseTemplateFieldsReturn {
  fields: TemplateFieldLibraryItem[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useTemplateFields(
  templateVersionId: string | null
): UseTemplateFieldsReturn {
  const [fields, setFields] = useState<TemplateFieldLibraryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!templateVersionId) {
      setFields([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${process.env.NEXT_PUBLIC_API_URL || ''}/admin/template-fields/${templateVersionId}`,
        { method: 'GET' }
      );
      if (!res.ok) {
        setError(`Failed to load fields (${res.status})`);
        setFields([]);
        return;
      }
      const body = await res.json();
      const list = (body.data || []) as TemplateFieldLibraryItem[];
      setFields(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setFields([]);
    } finally {
      setLoading(false);
    }
  }, [templateVersionId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { fields, loading, error, reload };
}