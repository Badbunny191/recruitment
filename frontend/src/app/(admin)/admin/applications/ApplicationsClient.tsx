'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface Round {
  id: string;
  title: string;
  status: string;
}

interface Application {
  id: string;
  applicationNo: string;
  fullname: string;
  email: string;
  nationalId: string;
  status: string;
  submittedAt: number;
}

interface Summary {
  total: number;
  byStatus: Record<string, number>;
}

const STATUS_LABELS: Record<string, string> = {
  SUBMITTED: 'รอตรวจ',
  UNDER_REVIEW: 'กำลังตรวจ',
  QUALIFIED: 'ผ่าน',
  REJECTED: 'ไม่ผ่าน',
  CANCELED: 'ยกเลิก',
  ARCHIVED: 'เก็บเข้าคลัง',
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

export default function ApplicationsClient() {
  const router = useRouter();
  
  // State
  const [rounds, setRounds] = useState<Round[]>([]);
  const [selectedRoundId, setSelectedRoundId] = useState<string>('');
  const [apps, setApps] = useState<Application[]>([]);
  const [summary, setSummary] = useState<Summary>({ total: 0, byStatus: {} });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  
  // Status update modal
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [newStatus, setNewStatus] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [updating, setUpdating] = useState(false);

  // Fetch rounds
  useEffect(() => {
    fetch(`${API_URL}/admin/rounds`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` }
    })
      .then(res => res.json())
      .then(res => {
        const roundList = res.data || [];
        setRounds(roundList);
        // Select first active round or first round
        const activeRound = roundList.find((r: Round) => r.status === 'ACTIVE') || roundList[0];
        if (activeRound) {
          setSelectedRoundId(activeRound.id);
        }
      });
  }, []);

  // Fetch applications and summary
  const fetchData = useCallback(async () => {
    if (!selectedRoundId) return;
    
    setLoading(true);
    const token = localStorage.getItem('adminToken');
    
    try {
      // Fetch applications with filters
      const params = new URLSearchParams();
      params.append('roundId', selectedRoundId);
      if (search) params.append('search', search);
      
      const [appsRes, summaryRes] = await Promise.all([
        fetch(`${API_URL}/admin/applications?${params}`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(`${API_URL}/admin/applications/summary?roundId=${selectedRoundId}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);
      
      const appsData = await appsRes.json();
      const summaryData = await summaryRes.json();
      
      setApps(appsData.data || []);
      setSummary(summaryData.data || { total: 0, byStatus: {} });
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedRoundId, search, API_URL]);

  // Fetch on mount and when dependencies change
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Open status modal
  const openStatusModal = (app: Application, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedApp(app);
    setNewStatus(app.status === 'SUBMITTED' ? 'UNDER_REVIEW' : app.status);
    setRejectReason('');
    setShowStatusModal(true);
  };

  // Handle status update
  const handleStatusUpdate = async () => {
    if (!selectedApp || !newStatus) return;
    
    if (newStatus === 'REJECTED' && !rejectReason.trim()) {
      alert('กรุณาระบุเหตุผลการปฏิเสธ');
      return;
    }
    
    setUpdating(true);
    try {
      const res = await fetch(`${API_URL}/admin/applications/${selectedApp.id}/status`, {
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
      
      const data = await res.json();
      
      if (res.ok && data.success) {
        setShowStatusModal(false);
        fetchData(); // Refresh data
      } else {
        // แสดง error message ที่ backend ส่งมา
        alert(data.error || data.details || 'เกิดข้อผิดพลาด');
      }
    } catch (error) {
      console.error('Status update error:', error);
      alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
      setUpdating(false);
    }
  };

  const formatDate = (timestamp: any) => {
    // Handle null/undefined/empty
    if (!timestamp) return 'ไม่ระบุ';
    
    let date: Date;
    
    // Handle Date object (from Drizzle with mode: 'timestamp')
    if (timestamp instanceof Date) {
      date = timestamp;
    } 
    // Handle number (seconds or milliseconds)
    else if (typeof timestamp === 'number') {
      // If timestamp >= 1e12, it's milliseconds; otherwise seconds
      date = new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp);
    }
    // Handle string
    else if (typeof timestamp === 'string') {
      date = new Date(timestamp);
    }
    else {
      return 'ไม่ถูกต้อง';
    }
    
    if (isNaN(date.getTime())) return 'ไม่ถูกต้อง';
    
    return date.toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">ใบสมัคร (Applications)</h1>
      </div>

      {/* Filters */}
      <div className="flex gap-4 flex-wrap">
        <div className="w-64">
          <Label className="text-sm text-gray-600 mb-1 block">รอบรับสมัคร</Label>
          <Select
            value={selectedRoundId}
            onChange={(e) => setSelectedRoundId(e.target.value)}
            className="w-full"
          >
            {rounds.map((round) => (
              <option key={round.id} value={round.id}>
                {round.title} {round.status === 'ACTIVE' ? '(เปิดรับ)' : ''}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex-1 max-w-md">
          <Label className="text-sm text-gray-600 mb-1 block">ค้นหา</Label>
          <Input
            type="text"
            placeholder="ค้นหาชื่อ, อีเมล, เลขใบสมัคร..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full"
          />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <Card 
          className="cursor-pointer hover:shadow-md transition-shadow" 
          onClick={() => setSearch('')}
        >
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{summary.total}</p>
            <p className="text-sm text-gray-500">ทั้งหมด</p>
          </CardContent>
        </Card>
        {Object.entries(STATUS_LABELS).map(([key, label]) => (
          <Card 
            key={key}
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => setSearch('')}
          >
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold">{summary.byStatus[key] || 0}</p>
              <p className="text-sm text-gray-500">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Applications Table */}
      <div className="border rounded-md bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>เลขใบสมัคร</TableHead>
              <TableHead>ชื่อ-นามสกุล</TableHead>
              <TableHead>อีเมล</TableHead>
              <TableHead>สถานะ</TableHead>
              <TableHead>วันที่สมัคร</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                  กำลังโหลด...
                </TableCell>
              </TableRow>
            ) : apps.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                  ไม่พบใบสมัคร
                </TableCell>
              </TableRow>
            ) : (
              apps.map((app) => (
                <TableRow key={app.id} className="cursor-pointer hover:bg-gray-50">
                  <TableCell 
                    className="font-medium"
                    onClick={() => router.push(`/admin/application-detail?id=${app.id}`)}
                  >
                    {app.applicationNo}
                  </TableCell>
                  <TableCell onClick={() => router.push(`/admin/application-detail?id=${app.id}`)}>
                    {app.fullname}
                  </TableCell>
                  <TableCell onClick={() => router.push(`/admin/application-detail?id=${app.id}`)}>
                    {app.email}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={app.status as any} />
                  </TableCell>
                  <TableCell onClick={() => router.push(`/admin/application-detail?id=${app.id}`)}>
                    {formatDate(app.submittedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-2 justify-end">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={(e) => openStatusModal(app, e)}
                      >
                        เปลี่ยนสถานะ
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => router.push(`/admin/application-detail?id=${app.id}`)}
                      >
                        ดูรายละเอียด
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Status Update Modal */}
      {showStatusModal && selectedApp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
            <h2 className="text-xl font-bold mb-4">เปลี่ยนสถานะใบสมัคร</h2>
            <p className="text-gray-600 mb-4">
              {selectedApp.applicationNo} - {selectedApp.fullname}
            </p>
            
            <div className="space-y-4">
              <div>
                <Label>สถานะใหม่</Label>
                <Select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                  className="w-full mt-1"
                >
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
