'use client';

import { useState, useEffect } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function ApplicationsPage() {
  const [apps, setApps] = useState<any[]>([]);

  useEffect(() => {
    fetch(process.env.NEXT_PUBLIC_API_URL + '/admin/applications', {
      headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` }
    }).then(res => res.json()).then(res => setApps(res.data || []));
  }, []);

  const handleExport = (roundId: string) => {
    window.open(`${process.env.NEXT_PUBLIC_API_URL}/admin/export/rounds/${roundId}?token=${localStorage.getItem('adminToken')}`, '_blank');
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">ใบสมัคร (Applications)</h1>
        {apps.length > 0 && (
          <Button variant="outline" onClick={() => handleExport(apps[0]?.roundId)}>Export Excel (รอบล่าสุด)</Button>
        )}
      </div>
      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>App No.</TableHead>
              <TableHead>ชื่อ-นามสกุล</TableHead>
              <TableHead>เลขบัตรประชาชน</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {apps.map((app) => (
              <TableRow key={app.id}>
                <TableCell className="font-medium">{app.applicationNo}</TableCell>
                <TableCell>{app.fullname}</TableCell>
                <TableCell>{app.nationalId}</TableCell>
                <TableCell><Badge>{app.status}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}