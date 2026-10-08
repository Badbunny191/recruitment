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

  const formatDate = (timestamp: number | string | null | undefined) => {
    if (!timestamp) return '-';
    let date: Date;
    if (typeof timestamp === 'number') {
      const ms = timestamp < 1e12 ? timestamp * 1000 : timestamp;
      date = new Date(ms);
    } else {
      date = new Date(timestamp);
    }
    if (isNaN(date.getTime())) return 'วันที่ไม่ถูกต้อง';
    return date.toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
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
    <div className="p-8 space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Button variant="outline" size="sm" onClick={() => router.back()} className="mb-2">
            ← กลับ
          </Button>
          <h1 className="text-2xl font-bold">ใบสมัคร {app.applicationNo}</h1>
          <p className="text-gray-500">สมัครเมื่อ: {formatDate(app.submittedAt)}</p>
        </div>
        <div className="flex items-center gap-4">
          <StatusBadge status={app.status as any} />
          <Button onClick={openStatusModal}>เปลี่ยนสถานะ</Button>
        </div>
      </div>

      {/* Reviewer Info - Latest Status */}
      {app.verifiedBy && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">สถานะล่าสุด</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500">สถานะ</p>
                <StatusBadge status={app.status as any} />
              </div>
              <div>
                <p className="text-sm text-gray-500">ผู้ตรวจ</p>
                <p className="font-medium">{app.verifiedByEmail || app.verifiedBy}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">วันที่</p>
                <p className="font-medium">{formatDate(app.verifiedAt)}</p>
              </div>
              {app.statusReason && (
                <div>
                  <p className="text-sm text-gray-500">เหตุผล</p>
                  <p className="font-medium text-red-600">{app.statusReason}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

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

      {/* Form Data */}
      <Card>
        <CardHeader>
          <CardTitle>ข้อมูลที่กรอก</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(() => {
            const parsedFormData = parseFormData(app.formData);
            const entries = Object.entries(parsedFormData).filter(
              ([key]) => !key.includes('fileUrl') && !key.includes('file')
            );

            if (entries.length === 0) {
              return <p className="text-gray-500">ไม่มีข้อมูลที่กรอก</p>;
            }

            return entries.map(([key, value]) => (
              <div key={key}>
                <p className="text-gray-500 text-sm">{getFieldLabel(key)}</p>
                <p className="font-medium whitespace-pre-wrap">
                  {typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}
                </p>
              </div>
            ));
          })()}
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

      {/* Status History */}
      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>ประวัติการตรวจสอบ</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {history.map((item, index) => (
                <div key={item.id} className="flex items-start gap-4 pb-4 border-b last:border-0">
                  <div className="w-2 h-2 rounded-full bg-blue-500 mt-2" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {STATUS_LABELS[item.action] || item.action}
                      </span>
                      {item.payload?.status && (
                        <span className="text-sm text-gray-500">
                          → {STATUS_LABELS[item.payload.status] || item.payload.status}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600">
                      โดย: {item.adminEmail || item.adminId}
                    </p>
                    <p className="text-sm text-gray-500">
                      {formatDate(item.createdAt)}
                    </p>
                    {item.payload?.reason && (
                      <p className="text-sm text-red-600 mt-1">
                        เหตุผล: {item.payload.reason}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status Update Modal */}
      {showStatusModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
            <h2 className="text-xl font-bold mb-4">เปลี่ยนสถานะใบสมัคร</h2>
            <p className="text-gray-600 mb-4">
              {app.applicationNo} - {app.fullname}
            </p>
            
            <div className="space-y-4">
              <div>
                <Label>สถานะใหม่</Label>
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
                  <Label>เหตุผลการปฏิเสธ *</Label>
                  <Textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="ระบุเหตุผล..."
                    className="w-full mt-1"
                    rows={3}
                  />
                </div>
              )}
            </div>
            
            <div className="flex gap-2 mt-6 justify-end">
              <Button 
                variant="outline" 
                onClick={() => setShowStatusModal(false)}
                disabled={updating}
              >
                ยกเลิก
              </Button>
              <Button 
                onClick={handleStatusUpdate}
                disabled={updating}
              >
                {updating ? 'กำลังบันทึก...' : 'บันทึก'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
