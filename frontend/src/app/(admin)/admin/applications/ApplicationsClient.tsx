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

const STATUS_COLORS: Record<string, string> = {
  SUBMITTED: 'bg-blue-500',
  UNDER_REVIEW: 'bg-yellow-500',
  QUALIFIED: 'bg-green-500',
  REJECTED: 'bg-red-500',
  CANCELED: 'bg-gray-500',
  ARCHIVED: 'bg-purple-500',
};

const BULK_STATUS_OPTIONS = ['UNDER_REVIEW', 'QUALIFIED', 'REJECTED', 'ARCHIVED'];

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
  
  // Show archived filter
  const [showArchived, setShowArchived] = useState(false);
  
  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // Status update modal (single)
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [newStatus, setNewStatus] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [updating, setUpdating] = useState(false);

  // Bulk status modal
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkReason, setBulkReason] = useState('');
  const [bulkUpdating, setBulkUpdating] = useState(false);

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
    setSelectedIds(new Set()); // Reset selection
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
      
      let appsList = appsData.data || [];
      
      // Filter archived if needed
      if (!showArchived) {
        appsList = appsList.filter((app: Application) => app.status !== 'ARCHIVED');
      }
      
      setApps(appsList);
      setSummary(summaryData.data || { total: 0, byStatus: {} });
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedRoundId, search, showArchived, API_URL]);

  // Fetch on mount and when dependencies change
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Selection handlers
  const toggleSelectAll = () => {
    if (selectedIds.size === apps.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(apps.map(app => app.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

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
        fetchData();
      } else {
        alert(data.error || data.details || 'เกิดข้อผิดพลาด');
      }
    } catch (error) {
      console.error('Status update error:', error);
      alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
      setUpdating(false);
    }
  };

  // Bulk status update
  const handleBulkStatusUpdate = async () => {
    if (!bulkStatus || selectedIds.size === 0) return;
    
    if (bulkStatus === 'REJECTED' && !bulkReason.trim()) {
      alert('กรุณาระบุเหตุผลการปฏิเสธ');
      return;
    }
    
    setBulkUpdating(true);
    try {
      const res = await fetch(`${API_URL}/admin/applications/bulk-status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('adminToken')}`
        },
        body: JSON.stringify({
          ids: Array.from(selectedIds),
          status: bulkStatus,
          reason: bulkStatus === 'REJECTED' ? bulkReason : undefined
        })
      });
      
      const data = await res.json();
      
      if (res.ok && data.success) {
        setShowBulkModal(false);
        setBulkStatus('');
        setBulkReason('');
        fetchData();
        alert(`อัปเดตสถานะสำเร็จ ${data.updated} รายการ`);
      } else {
        alert(data.error || 'เกิดข้อผิดพลาด');
      }
    } catch (error) {
      console.error('Bulk status update error:', error);
      alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
      setBulkUpdating(false);
    }
  };

  const openBulkModal = () => {
    setBulkStatus('');
    setBulkReason('');
    setShowBulkModal(true);
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return 'ไม่ระบุ';
    
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
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const activeSummary = showArchived ? summary : {
    ...summary,
    byStatus: {
      ...summary.byStatus,
      ARCHIVED: 0
    }
  };

  return (
    <div className="p-4 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
        <h1 className="text-2xl font-bold">ใบสมัคร (Applications)</h1>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300"
            />
            <span>แสดงรายการที่เก็บเข้าคลัง</span>
          </label>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="w-full md:w-64">
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
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <Input
              type="text"
              placeholder="ค้นหาชื่อ, อีเมล, เลขใบสมัคร..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10"
            />
          </div>
        </div>
      </div>

      {/* Summary Cards - Color coded */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
        <Card 
          className="cursor-pointer hover:shadow-lg transition-all hover:scale-105 bg-gray-50"
          onClick={() => setSearch('')}
        >
          <CardContent className="p-3 md:p-4 text-center">
            <p className="text-2xl md:text-3xl font-bold text-gray-800">{activeSummary.total}</p>
            <p className="text-xs md:text-sm text-gray-500">ทั้งหมด</p>
          </CardContent>
        </Card>
        {Object.entries(STATUS_LABELS).map(([key, label]) => {
          const count = activeSummary.byStatus[key] || 0;
          const colorClass = STATUS_COLORS[key] || 'bg-gray-500';
          return (
            <Card 
              key={key}
              className={`cursor-pointer hover:shadow-lg transition-all hover:scale-105 ${count > 0 ? 'bg-white' : 'bg-gray-50 opacity-60'}`}
              onClick={() => setSearch('')}
            >
              <CardContent className="p-3 md:p-4 text-center">
                <div className={`w-8 h-8 md:w-10 md:h-10 mx-auto rounded-full ${colorClass} flex items-center justify-center mb-2`}>
                  <span className="text-white text-sm md:text-base font-bold">{count}</span>
                </div>
                <p className="text-xs md:text-sm text-gray-600">{label}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="bg-blue-500 text-white rounded-full px-3 py-1 text-sm font-medium">
              {selectedIds.size}
            </span>
            <span className="text-gray-700">เลือกแล้ว</span>
            <button 
              onClick={() => setSelectedIds(new Set())}
              className="text-sm text-gray-500 hover:text-gray-700 underline"
            >
              ยกเลิก
            </button>
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={openBulkModal}
            >
              เปลี่ยนสถานะ
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => {
                if (confirm(`เก็บเข้าคลัง ${selectedIds.size} รายการ?`)) {
                  setBulkStatus('ARCHIVED');
                  setBulkReason('');
                  setShowBulkModal(true);
                }
              }}
            >
              เก็บเข้าคลัง
            </Button>
          </div>
        </div>
      )}

      {/* Applications Table */}
      <div className="border rounded-lg bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50 sticky top-0">
              <TableRow>
                <TableHead className="w-12">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === apps.length && apps.length > 0}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-gray-300 cursor-pointer"
                  />
                </TableHead>
                <TableHead className="min-w-[120px]">เลขใบสมัคร</TableHead>
                <TableHead className="min-w-[150px]">ชื่อ-นามสกุล</TableHead>
                <TableHead className="min-w-[180px]">อีเมล</TableHead>
                <TableHead className="min-w-[100px]">สถานะ</TableHead>
                <TableHead className="min-w-[140px]">วันที่สมัคร</TableHead>
                <TableHead className="text-right min-w-[180px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-gray-500">
                    <div className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>กำลังโหลด...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : apps.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-gray-500">
                    ไม่พบใบสมัคร
                  </TableCell>
                </TableRow>
              ) : (
                apps.map((app, index) => (
                  <TableRow 
                    key={app.id} 
                    className={`cursor-pointer hover:bg-blue-50 transition-colors ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(app.id)}
                        onChange={() => toggleSelect(app.id)}
                        className="w-4 h-4 rounded border-gray-300 cursor-pointer"
                      />
                    </TableCell>
                    <TableCell 
                      className="font-medium text-blue-600"
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
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
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
      </div>

      {/* Single Status Update Modal */}
      {showStatusModal && selectedApp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
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

      {/* Bulk Status Update Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">เปลี่ยนสถานะ ({selectedIds.size} รายการ)</h2>
            
            <div className="space-y-4">
              <div>
                <Label>สถานะใหม่</Label>
                <Select
                  value={bulkStatus}
                  onChange={(e) => setBulkStatus(e.target.value)}
                  className="w-full mt-1"
                >
                  <option value="">-- เลือกสถานะ --</option>
                  {BULK_STATUS_OPTIONS.map(status => (
                    <option key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </option>
                  ))}
                </Select>
              </div>
              
              {bulkStatus === 'REJECTED' && (
                <div>
                  <Label>เหตุผลการปฏิเสธ *</Label>
                  <Textarea
                    value={bulkReason}
                    onChange={(e) => setBulkReason(e.target.value)}
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
                onClick={() => setShowBulkModal(false)}
                disabled={bulkUpdating}
              >
                ยกเลิก
              </Button>
              <Button 
                onClick={handleBulkStatusUpdate}
                disabled={bulkUpdating || !bulkStatus}
              >
                {bulkUpdating ? 'กำลังบันทึก...' : 'บันทึก'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
