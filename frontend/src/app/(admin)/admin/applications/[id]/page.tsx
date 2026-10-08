'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ApplicationAttachment {
  id: string;
  fieldId: string;
  fileUrl: string;
  uploadedAt: number;
}

interface FormField {
  fieldId: string;
  type: string;
  label: string;
  overrideLabel?: string;
  isRequired: boolean;
}

interface Application {
  id: string;
  applicationNo: string;
  fullname: string;
  email: string;
  nationalId: string;
  status: string;
  formData: Record<string, any>;
  submittedAt: number;
  attachments: ApplicationAttachment[];
  schema: FormField[];
}

export default function ApplicationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [app, setApp] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = params.id as string;
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/applications/${id}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` }
    })
      .then(res => res.json())
      .then(res => {
        if (res.data) {
          setApp(res.data);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [params.id]);

  const getFileKey = (fileUrl: string) => {
    // fileUrl format: /api/v1/public/uploads/files/uploads/documents/2026/...
    // Extract the actual R2 key after /files/
    const match = fileUrl.match(/\/files\/(.+)$/);
    return match ? match[1] : fileUrl;
  };

  const handleViewFile = (fileUrl: string) => {
    const key = getFileKey(fileUrl);
    const url = `${process.env.NEXT_PUBLIC_API_URL}/public/uploads/files/${encodeURIComponent(key)}`;
    window.open(url, '_blank');
  };

  const handleDownloadFile = (fileUrl: string, filename: string) => {
    const key = getFileKey(fileUrl);
    const url = `${process.env.NEXT_PUBLIC_API_URL}/public/uploads/files/${encodeURIComponent(key)}`;
    // Create download link
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download.pdf';
    a.click();
  };

  const getFieldLabel = (fieldId: string): string => {
    if (!app?.schema) return fieldId;
    const field = app.schema.find(f => f.fieldId === fieldId);
    return field?.overrideLabel || field?.label || fieldId;
  };

  if (loading) {
    return <div className="p-8">กำลังโหลด...</div>;
  }

  if (!app) {
    return (
      <div className="p-8">
        <p className="text-red-500">ไม่พบใบสมัคร</p>
        <Button variant="outline" onClick={() => router.back()} className="mt-4">กลับ</Button>
      </div>
    );
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Separate attachments from form data
  const attachmentFields = app.schema?.filter(f => f.type === 'FILE') || [];
  const regularFields = Object.entries(app.formData || {}).filter(([key]) => !key.startsWith('field-'));

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Button variant="outline" size="sm" onClick={() => router.back())} className="mb-2">
            ← กลับ
          </Button>
          <h1 className="text-2xl font-bold">ใบสมัคร {app.applicationNo}</h1>
          <p className="text-gray-500">สมัครเมื่อ: {formatDate(app.submittedAt)}</p>
        </div>
        <Badge className="text-lg px-4 py-2">{app.status}</Badge>
      </div>

      {/* Personal Info */}
      <Card>
        <CardHeader>
          <CardTitle>ข้อมูลส่วนตัว</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-gray-500 text-sm">ชื่อ-นามสกุล</p>
            <p className="font-medium">{app.fullname}</p>
          </div>
          <div>
            <p className="text-gray-500 text-sm">อีเมล</p>
            <p className="font-medium">{app.email}</p>
          </div>
          <div>
            <p className="text-gray-500 text-sm">เลขบัตรประชาชน</p>
            <p className="font-medium">{app.nationalId}</p>
          </div>
        </CardContent>
      </Card>

      {/* Dynamic Form Data */}
      <Card>
        <CardHeader>
          <CardTitle>ข้อมูลที่กรอก</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {Object.entries(app.formData || {}).map(([key, value]) => {
            // Skip file fields (they're shown in attachments section)
            if (key.includes('fileUrl') || key.includes('file')) return null;
            
            return (
              <div key={key}>
                <p className="text-gray-500 text-sm">{getFieldLabel(key)}</p>
                <p className="font-medium whitespace-pre-wrap">
                  {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                </p>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Attachments */}
      <Card>
        <CardHeader>
          <CardTitle>เอกสารแนบ</CardTitle>
        </CardHeader>
        <CardContent>
          {app.attachments && app.attachments.length > 0 ? (
            <div className="space-y-4">
              {app.attachments.map((att) => {
                const fieldInfo = app.schema?.find(f => f.fieldId === att.fieldId);
                const fieldLabel = fieldInfo?.overrideLabel || fieldInfo?.label || att.fieldId;
                
                return (
                  <div key={att.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <p className="font-medium">{fieldLabel}</p>
                      <p className="text-sm text-gray-500">{att.fileUrl.split('/').pop()}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => handleViewFile(att.fileUrl)}>
                        ดูไฟล์
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => handleDownloadFile(att.fileUrl, fieldLabel)}>
                        ดาวน์โหลด
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-gray-500">ไม่มีเอกสารแนบ</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
