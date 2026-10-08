'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface FileUploadProps {
  onUploadSuccess: (fileUrl: string) => void;
  accept?: string;
}

export function FileUpload({ onUploadSuccess, accept = 'application/pdf' }: FileUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== accept) {
      alert(`อนุญาตเฉพาะไฟล์ PDF เท่านั้น`);
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert(`ไฟล์มีขนาดใหญ่เกิน 10MB`);
      return;
    }

    setIsUploading(true);
    try {
      // สร้าง FormData และ append ไฟล์
      const formData = new FormData();
      formData.append('file', file);

      // Upload ไฟล์ไปที่ /direct endpoint
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787/api/v1';
      const res = await fetch(`${apiUrl}/public/uploads/direct`, {
        method: 'POST',
        body: formData,
      });
      
      const responseData = await res.json();
      
      if (!responseData.success) {
        throw new Error(responseData.error || 'ไม่สามารถอัปโหลดไฟล์ได้');
      }

      const { fileKey, fileUrl } = responseData.data;
      
      setFileName(file.name);
      // ส่ง fileUrl ไปให้ parent component (เหมือนเดิม)
      onUploadSuccess(fileUrl);

    } catch (error) {
      console.error('Upload error:', error);
      alert(error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการอัปโหลดไฟล์ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemove = () => {
    setFileName(null);
  };

  return (
    <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 flex flex-col items-center justify-center bg-slate-50 hover:border-slate-400 transition-colors">
      {isUploading ? (
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-2"></div>
          <span className="text-blue-600">กำลังอัปโหลด...</span>
        </div>
      ) : fileName ? (
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 text-green-600 font-medium mb-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>{fileName}</span>
          </div>
          <Button 
            type="button" 
            variant="ghost" 
            size="sm" 
            onClick={handleRemove} 
            className="text-red-500 hover:text-red-700 hover:bg-red-50"
          >
            เปลี่ยนไฟล์
          </Button>
        </div>
      ) : (
        <>
          <div className="mb-4">
            <svg className="w-12 h-12 text-slate-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <span className="text-sm text-slate-500 mb-4">รองรับเฉพาะไฟล์ PDF (ไม่เกิน 10MB)</span>
          <Button 
            type="button" 
            variant="outline" 
            onClick={() => document.getElementById('file-upload')?.click()}
          >
            เลือกไฟล์
          </Button>
        </>
      )}
      <input
        id="file-upload"
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleFileChange}
        disabled={isUploading}
      />
    </div>
  );
}
