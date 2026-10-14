'use client';

import { useState, useId, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';

export interface UploadedFileMeta {
  name: string;
  url: string;
  contentType?: string;
}

interface FileUploadProps {
  onUploadSuccess: (fileUrl: string | string[]) => void;
  /**
   * Optional callback that receives the full list of uploaded files
   * (with name + url + contentType) on every change. PR #2 needs this
   * so the review page can show "filename.pdf" instead of just the URL.
   *
   * If omitted, the component still works exactly as before.
   */
  onFilesChange?: (files: UploadedFileMeta[]) => void;
  /**
   * Optional initial file list used to rehydrate the component from a
   * previously-saved draft. Two consumption rules:
   *
   *   1. Used as the seed for `useState` on first mount, so a fully
   *      synchronous restore (e.g. when the parent already has the
   *      rehydrated `attachmentMeta` on first render) works.
   *   2. Watched by an effect: if the prop transitions from
   *      `undefined` → `UploadedFileMeta[]` *after* mount (the typical
   *      "schema loaded → restoration effect ran" timeline), the
   *      component adopts the new value.
   *
   * The "adopt" path is **one-shot**: after a successful upload or
   * remove, we stop watching the prop to avoid a feedback loop with
   * `onFilesChange`.
   */
  defaultFiles?: UploadedFileMeta[];
  accept?: string;
  maxFiles?: number;
  maxSizeMB?: number;
  multiple?: boolean;
}

export function FileUpload({
  onUploadSuccess,
  onFilesChange,
  defaultFiles,
  accept = 'application/pdf',
  maxFiles = 1,
  maxSizeMB = 10,
  multiple = false
}: FileUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  // Seed from `defaultFiles` if provided at first render. The effect
  // below handles the case where `defaultFiles` arrives after mount.
  const [files, setFiles] = useState<UploadedFileMeta[]>(defaultFiles ?? []);
  const [error, setError] = useState<string | null>(null);

  const inputId = useId();

  // Once the user has touched the component (upload or remove), we stop
  // reacting to `defaultFiles` changes so a re-render of the parent
  // with a fresh array reference doesn't clobber the user's choice.
  const userTouchedRef = useRef(false);

  // Consume a `defaultFiles` change that happens after mount. This is
  // the "schema loaded → restoration effect ran → setAttachmentMeta
  // updated the prop" sequence.
  useEffect(() => {
    if (userTouchedRef.current) return;
    if (!defaultFiles) return;
    // Skip if it's the same content we already have (avoids the initial
    // double-set when the parent re-renders for unrelated reasons).
    if (
      defaultFiles.length === files.length &&
      defaultFiles.every((f, i) => f.url === files[i]?.url && f.name === files[i]?.name)
    ) {
      return;
    }
    setFiles(defaultFiles);
  }, [defaultFiles, files]);

  /**
   * Replace the local `files` state and notify both upward callbacks.
   * Centralised so remove + upload + initial-mount restore all go
   * through the same path and the parent always sees a consistent view.
   */
  const updateFiles = (next: UploadedFileMeta[]) => {
    userTouchedRef.current = true;
    setFiles(next);
    if (onFilesChange) onFilesChange(next);
    if (maxFiles === 1) {
      onUploadSuccess(next[0]?.url || '');
    } else {
      onUploadSuccess(next.map((f) => f.url));
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    // Check max files
    if (files.length + fileList.length > maxFiles) {
      setError(`อนุญาตให้อัปโหลดได้สูงสุด ${maxFiles} ไฟล์`);
      return;
    }

    setError(null);
    setIsUploading(true);

    const newFiles: UploadedFileMeta[] = [];

    try {
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];

        // Validate file type
        if (accept !== '*') {
          const acceptTypes = accept.split(',').map(t => t.trim());
          const fileExtension = file.name.split('.').pop()?.toLowerCase();
          const isValidType = acceptTypes.some(type => {
            if (type.startsWith('.')) {
              return type.slice(1).toLowerCase() === fileExtension;
            }
            if (type.includes('*')) {
              const baseType = type.split('/')[0];
              return file.type.startsWith(baseType);
            }
            return file.type === type || fileExtension === type.toLowerCase();
          });

          if (!isValidType) {
            throw new Error(`ไฟล์ "${file.name}" ไม่ใช่ประเภทที่อนุญาต (${accept})`);
          }
        }

        // Validate file size
        const maxBytes = maxSizeMB * 1024 * 1024;
        if (file.size > maxBytes) {
          throw new Error(`ไฟล์ "${file.name}" มีขนาดใหญ่เกิน ${maxSizeMB}MB`);
        }

        // Upload file
        const formData = new FormData();
        formData.append('file', file);

        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787/api/v1';
        const res = await fetch(`${apiUrl}/public/uploads/direct`, {
          method: 'POST',
          body: formData,
        });

        const responseData = await res.json();

        if (!responseData.success) {
          throw new Error(responseData.error || 'ไม่สามารถอัปโหลดไฟล์ได้');
        }

        newFiles.push({
          name: file.name,
          url: responseData.data.fileUrl,
          contentType: file.type || responseData.data.contentType,
        });
      }

      const allFiles = [...files, ...newFiles];
      updateFiles(allFiles);

    } catch (err) {
      console.error('Upload error:', err);
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการอัปโหลดไฟล์');
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemove = (index: number) => {
    const newFiles = files.filter((_, i) => i !== index);
    updateFiles(newFiles);
  };

  // Format accept string for display
  const formatAcceptLabel = () => {
    if (accept === 'application/pdf') return 'PDF';
    if (accept.includes('image')) return 'รูปภาพ (JPG, PNG)';
    if (accept.includes('word') || accept.includes('document')) return 'เอกสาร (PDF, DOC, DOCX)';
    return accept;
  };

  return (
    <div className="space-y-3">
      {/* Upload Area */}
      <div className={`border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center transition-colors ${
        error ? 'border-red-300 bg-red-50' : 'border-slate-300 bg-slate-50 hover:border-slate-400'
      }`}>
        {isUploading ? (
          <div className="text-center">
            <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-2"></div>
            <span className="text-blue-600">กำลังอัปโหลด...</span>
          </div>
        ) : files.length > 0 && maxFiles === 1 ? (
          <div className="text-center w-full">
            <div className="flex items-center justify-center gap-2 text-green-600 font-medium mb-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>{files[0].name}</span>
            </div>
            <Button 
              type="button" 
              variant="ghost" 
              size="sm" 
              onClick={() => handleRemove(0)} 
              className="text-red-500 hover:text-red-700 hover:bg-red-50"
            >
              ลบไฟล์
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-4">
              <svg className="w-12 h-12 text-slate-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <span className="text-sm text-slate-500 mb-4">
              รองรับ {formatAcceptLabel()} (ไม่เกิน {maxSizeMB}MB)
              {maxFiles > 1 && ` • สูงสุด ${maxFiles} ไฟล์`}
            </span>
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => document.getElementById(inputId)?.click()}
            >
              {maxFiles > 1 ? 'เลือกไฟล์' : 'เลือกไฟล์'}
            </Button>
          </>
        )}
        <input
          id={inputId}
          type="file"
          accept={accept}
          multiple={maxFiles > 1}
          className="hidden"
          onChange={handleFileChange}
          disabled={isUploading}
        />
      </div>

      {/* Multiple Files List */}
      {files.length > 0 && maxFiles > 1 && (
        <div className="space-y-2">
          {files.map((file, index) => (
            <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border">
              <div className="flex items-center gap-2 min-w-0">
                <svg className="w-5 h-5 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="text-sm truncate">{file.name}</span>
              </div>
              <Button 
                type="button" 
                variant="ghost" 
                size="sm" 
                onClick={() => handleRemove(index)} 
                className="text-red-500 hover:text-red-700 hover:bg-red-50 flex-shrink-0"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </Button>
            </div>
          ))}
          <p className="text-xs text-gray-500">{files.length} / {maxFiles} ไฟล์</p>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-2 text-red-600 text-sm">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
