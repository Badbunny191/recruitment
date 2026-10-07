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
      alert(`อนุญาตเฉพาะไฟล์ ${accept} เท่านั้น`);
      return;
    }

    setIsUploading(true);
    try {
      // 1. ขอ Presigned URL จาก Backend
      const res = await fetch(process.env.NEXT_PUBLIC_API_URL + '/public/uploads/presigned-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type, fileSize: file.size }),
      });
      
      const responseData = await res.json();
      if (!responseData.success) throw new Error("ไม่สามารถขอสิทธิ์อัปโหลดได้");

      const { uploadUrl, uploadFields, fileKey } = responseData.data;

      // 2. เตรียมข้อมูลสำหรับยิงตรงเข้า R2
      const formData = new FormData();
      Object.entries(uploadFields).forEach(([key, value]) => {
        formData.append(key, value as string);
      });
      formData.append('file', file);

      // 3. อัปโหลดไฟล์
      const uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        body: formData,
      });

      if (!uploadRes.ok) throw new Error('อัปโหลดไฟล์ล้มเหลว');

      setFileName(file.name);
      onUploadSuccess(fileKey); 

    } catch (error) {
      alert('เกิดข้อผิดพลาดในการอัปโหลดไฟล์ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center bg-slate-50">
      {isUploading ? (
        <span className="text-blue-600">กำลังอัปโหลด...</span>
      ) : fileName ? (
        <div className="text-green-600 font-medium">
          {fileName} 
          <Button type="button" variant="ghost" size="sm" onClick={() => setFileName(null)} className="text-red-500 ml-2">
            เปลี่ยนไฟล์
          </Button>
        </div>
      ) : (
        <>
          <span className="text-sm text-slate-500 mb-4">รองรับเฉพาะไฟล์ PDF</span>
          <Button type="button" variant="outline" onClick={() => document.getElementById('file-upload')?.click()}>
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
        disabled={isUploading || fileName !== null}
      />
    </div>
  );
}