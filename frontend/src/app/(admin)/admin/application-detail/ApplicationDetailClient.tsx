'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

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

interface StatusHistoryItem {
  id: string;
  action: string;
  adminId: string;
  adminEmail: string;
  payload: {
    status?: string;
    reason?: string;
  } | null;
  createdAt: number | null;
}

interface Application {
  id: string;
  applicationNo: string;
  roundId: string;
  fullname: string;
  email: string;
  nationalId: string;
  status: string;
  statusReason: string | null;
  verifiedBy: string | null;
  verifiedByEmail: string | null;
  verifiedAt: number | null;
  formData: Record<string, any>;
  submittedAt: number;
  attachments: ApplicationAttachment[];
  schema: FormField[];
}

const STATUS_LABELS: Record<string, string> = {
  SUBMITTED: 'รอตรวจ',
  UNDER_REVIEW: 'กำลังตรวจ',
  QUALIFIED: 'ผ่าน',
  REJECTED: 'ไม่ผ่าน',
  CANCELED: 'ยกเลิก',
  ARCHIVED: 'เก็บเข้าคลัง',
  CREATE: 'สร้างใบสมัคร',
  UPDATE: 'แก้ไขสถานะ',
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

export default function ApplicationDetailClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [app, setApp] = useState<Application | null>(null);
  const [history, setHistory] = useState<StatusHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Status update state
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const id = searchParams.get('id');
    if (!id) {
      setLoading(false);
      return;
    }

    const token = localStorage.getItem('adminToken');
    
    Promise.all([
      fetch(`${API_URL}/admin/applications/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      }),
      fetch(`${API_URL}/admin/applications/${id}/history`, {
        headers: { Authorization: `Bearer ${token}` }
      })
    ])
      .then(([appRes, historyRes]) => Promise.all([appRes.json(), historyRes.json()]))
      .then(([appData, historyData]) => {
        if (appData.data) {
          setApp(appData.data);
          setNewStatus(appData.data.status);
        }
        if (historyData.data) {
          setHistory(historyData.data);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [searchParams]);

  const getFileKey = (fileUrl: string) => {
    const match = fileUrl.match(/\/files\/(.+)$/);
    return match ? match[1] : fileUrl;
  };

  const handleViewFile = (fileUrl: string) => {
    const key = getFileKey(fileUrl);
    const url = `${API_URL}/public/uploads/files/${encodeURIComponent(key)}`;
    window.open(url, '_blank');
  };

  const handleDownloadFile = (fileUrl: string, filename: string) => {
    const key = getFileKey(fileUrl);
    const url = `${API_URL}/public/uploads/files/${encodeURIComponent(key)}`;
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

  const openStatusModal = () => {
    if (!app) return;
    setNewStatus(app.status);
    setRejectReason(app.statusReason || '');
    setShowStatusModal(true);
  };

  const handleStatusUpdate = async () => {
    if (!app) return;
    
    if (newStatus === 'REJECTED' && !rejectReason.trim()) {
      alert('กรุณาระบุเหตุผลการปฏิเสธ');
      return;
    }
    
    setUpdating(true);
    try {
      const res = await fetch(`${API_URL}/admin/applications/${app.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('adminToken')}`
        },
        body: JSON.stringify({
          status: newStatus,
          reason: newStatus === 'REJECTED' ? rejectReason : undefined
        })
      });
      
      if (res.ok) {
        const result = await res.json();
        setShowStatusModal(false);
        
        // Refresh data
        const token = localStorage.getItem('adminToken');
        const [appRes, historyRes] = await Promise.all([
          fetch(`${API_URL}/admin/applications/${app.id}`, {
            headers: { Authorization: `Bearer ${token}` }
          }),
          fetch(`${API_URL}/admin/applications/${app.id}/history`, {
            headers: { Authorization: `Bearer ${token}` }
          })
        ]);
        
        const [appData, historyData] = await Promise.all([appRes.json(), historyRes.json()]);
        if (appData.data) setApp(appData.data);
        if (historyData.data) setHistory(historyData.data);
        
        setNewStatus(appData.data?.status || newStatus);
      } else {
        const error = await res.json();
        alert(error.error || 'เกิดข้อผิดพลาด');
      }
    } catch (error) {
      alert('เกิดข้อผิดพลาดในการอัปเดตสถานะ');
    } finally {
      setUpdating(false);
    }
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return '-';
    
    let date: Date;
    
    if (timestamp instanceof Date) {
      date = timestamp;
    } else if (typeof timestamp === 'number') {
      date = new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp);
    } else if (typeof timestamp === 'string') {
      date = new Date(timestamp);
    } else {
      return 'ไม่ถูกต้อง';
    }
    
    if (isNaN(date.getTime())) return 'ไม่ถูกต้อง';
    
    return date.toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-blue-500 mx-auto mb-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-500">กำลังโหลด...</p>
        </div>
      </div>
    );
  }

  if (!app) {
    return (
      <div className="p-8">
        <p className="text-red-500">ไม่พบใบสมัคร</p>
        <Button variant="outline" onClick={() => router.back()} className="mt-4">กลับ</Button>
      </div>
    );
  }

  // MASTER_DATA values are stored as { id, name }.
  // Legacy applications stored a plain string — handle both.
  const formatFormDataValue = (value: unknown): string => {
    if (value === null || value === undefined || value === '') return '-';
    if (typeof value === 'boolean') return value ? 'ตกลง' : 'ไม่ตกลง';
    if (typeof value === 'object') {
      const rec = value as Record<string, unknown>;
      if (typeof rec.name === 'string' && rec.name) return rec.name;
      return JSON.stringify(value);
    }
    return String(value);
  };

  const parseFormData = (raw: any): Record<string, any> => {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    if (typeof raw !== 'string') return {};
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
      if (typeof parsed === 'string') {
        const second = JSON.parse(parsed);
        if (second && typeof second === 'object') return second;
      }
    } catch {}
    return {};
  };

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-2 -ml-2">
            ← กลับ
          </Button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">ใบสมัคร</h1>
            <span className="text-xl text-gray-600">{app.applicationNo}</span>
          </div>
          <p className="text-gray-500 mt-1">สมัครเมื่อ: {formatDate(app.submittedAt)}</p>
        </div>
        <div className="flex flex-col items-end gap-3">
          <div className="px-4 py-2 bg-gray-100 rounded-lg">
            <StatusBadge status={app.status as any} className="text-base px-3 py-1" />
          </div>
          <Button onClick={openStatusModal} size="sm">
            เปลี่ยนสถานะ
          </Button>
        </div>
      </div>

      {/* Status Info Card */}
      {app.verifiedBy && (
        <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-100">
          <CardContent className="p-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div>
                <p className="text-sm text-gray-500 mb-1">สถานะปัจจุบัน</p>
                <StatusBadge status={app.status as any} className="text-sm" />
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">ผู้ดำเนินการ</p>
                <p className="font-medium">{app.verifiedByEmail || app.verifiedBy}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">วันที่ดำเนินการ</p>
                <p className="font-medium">{formatDate(app.verifiedAt)}</p>
              </div>
              {app.statusReason && (
                <div>
                  <p className="text-sm text-gray-500 mb-1">เหตุผล</p>
                  <p className="font-medium text-red-600">{app.statusReason}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Personal Info Card */}
      <Card>
        <CardHeader className="bg-gray-50 border-b">
          <CardTitle className="flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            ข้อมูลส่วนตัว
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-500 mb-1">ชื่อ-นามสกุล</p>
              <p className="font-semibold text-lg">{app.fullname}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-500 mb-1">อีเมล</p>
              <p className="font-medium">{app.email}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-500 mb-1">เลขบัตรประชาชน</p>
              <p className="font-medium">{app.nationalId}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Form Data Card */}
      <Card>
        <CardHeader className="bg-gray-50 border-b">
          <CardTitle className="flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            ข้อมูลที่กรอก
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          {(() => {
            const parsedFormData = parseFormData(app.formData);
            const entries = Object.entries(parsedFormData).filter(
              ([key]) => !key.includes('fileUrl') && !key.includes('file')
            );

            if (entries.length === 0) {
              return <p className="text-gray-500 text-center py-8">ไม่มีข้อมูลที่กรอก</p>;
            }

            return (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {entries.map(([key, value]) => (
                  <div key={key} className="bg-gray-50 rounded-lg p-4">
                    <p className="text-sm text-gray-500 mb-1">{getFieldLabel(key)}</p>
                    <p className="font-medium whitespace-pre-wrap">
                      {formatFormDataValue(value)}
                    </p>
                  </div>
                ))}
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Attachments Card */}
      <Card>
        <CardHeader className="bg-gray-50 border-b">
          <CardTitle className="flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
            เอกสารแนบ
            {app.attachments && app.attachments.length > 0 && (
              <span className="ml-2 bg-blue-100 text-blue-800 text-xs font-medium px-2 py-0.5 rounded-full">
                {app.attachments.length} ไฟล์
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          {app.attachments && app.attachments.length > 0 ? (
            <div className="space-y-3">
              {app.attachments.map((att) => {
                const fieldInfo = app.schema?.find(f => f.fieldId === att.fieldId);
                const fieldLabel = fieldInfo?.overrideLabel || fieldInfo?.label || att.fieldId;
                const filename = att.fileUrl.split('/').pop() || 'ไฟล์';
                
                return (
                  <div key={att.id} className="flex flex-col md:flex-row md:items-center justify-between p-4 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50/50 transition-colors">
                    <div className="flex items-start gap-3 mb-3 md:mb-0">
                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-medium">{fieldLabel}</p>
                        <p className="text-sm text-gray-500">{filename}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 ml-0 md:ml-auto">
                      <Button variant="outline" size="sm" onClick={() => handleViewFile(att.fileUrl)}>
                        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                        ดูไฟล์
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => handleDownloadFile(att.fileUrl, fieldLabel)}>
                        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        ดาวน์โหลด
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p>ไม่มีเอกสารแนบ</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Status History Card */}
      <Card>
        <CardHeader className="bg-gray-50 border-b">
          <CardTitle className="flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            ประวัติการดำเนินการ
            {history.length > 0 && (
              <span className="ml-2 bg-gray-200 text-gray-700 text-xs font-medium px-2 py-0.5 rounded-full">
                {history.length} รายการ
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          {history.length > 0 ? (
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200"></div>
              
              <div className="space-y-6">
                {history.map((item, index) => (
                  <div key={item.id} className="relative flex items-start gap-4 pl-2">
                    {/* Timeline dot */}
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 z-10 ${
                      index === 0 ? 'bg-blue-500' : 'bg-gray-300'
                    }`}>
                      {index === 0 ? (
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <span className="text-white text-xs font-bold">{index + 1}</span>
                      )}
                    </div>
                    
                    <div className="flex-1 bg-gray-50 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium">
                          {STATUS_LABELS[item.action] || item.action}
                        </span>
                        {item.payload?.status && (
                          <>
                            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                            </svg>
                            <span className="text-sm text-blue-600">
                              {STATUS_LABELS[item.payload.status] || item.payload.status}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                        <span className="flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                          {item.adminEmail || item.adminId}
                        </span>
                        <span className="flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {formatDate(item.createdAt)}
                        </span>
                      </div>
                      {item.payload?.reason && (
                        <div className="mt-2 p-2 bg-red-50 border border-red-100 rounded text-sm text-red-700">
                          <span className="font-medium">เหตุผล:</span> {item.payload.reason}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p>ยังไม่มีประวัติการดำเนินการ</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Status Update Modal */}
      {showStatusModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">เปลี่ยนสถานะใบสมัคร</h2>
              <button 
                onClick={() => setShowStatusModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="text-gray-600 mb-4">
              <span className="font-medium">{app.applicationNo}</span> - {app.fullname}
            </p>
            
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-medium text-gray-700">สถานะใหม่</Label>
                <Select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                  className="w-full mt-1"
                >
                  <option value="SUBMITTED">รอตรวจ</option>
                  <option value="UNDER_REVIEW">กำลังตรวจ</option>
                  <option value="QUALIFIED">ผ่าน</option>
                  <option value="REJECTED">ไม่ผ่าน</option>
                  <option value="CANCELED">ยกเลิก</option>
                  <option value="ARCHIVED">เก็บเข้าคลัง</option>
                </Select>
              </div>
              
              {newStatus === 'REJECTED' && (
                <div>
                  <Label className="text-sm font-medium text-gray-700">เหตุผลการปฏิเสธ *</Label>
                  <Textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="ระบุเหตุผลที่ปฏิเสธ..."
                    className="w-full mt-1"
                    rows={3}
                  />
                </div>
              )}
            </div>
            
            <div className="flex gap-3 mt-6">
              <Button 
                variant="outline" 
                onClick={() => setShowStatusModal(false)}
                disabled={updating}
                className="flex-1"
              >
                ยกเลิก
              </Button>
              <Button 
                onClick={handleStatusUpdate}
                disabled={updating}
                className="flex-1"
              >
                {updating ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    กำลังบันทึก
                  </span>
                ) : 'บันทึก'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
