'use client';

import { useState, useEffect } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    fetch(process.env.NEXT_PUBLIC_API_URL + '/admin/audit-logs', {
      headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` }
    }).then(res => res.json()).then(res => setLogs(res.data || []));
  }, []);

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-2xl font-bold">System Audit Logs (ประวัติการทำงาน)</h1>
      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>เวลา</TableHead>
              <TableHead>Admin ID</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map((log) => (
              <TableRow key={log.id}>
                <TableCell>{new Date(log.createdAt * 1000).toLocaleString('th-TH')}</TableCell>
                <TableCell className="font-mono text-xs">{log.adminId}</TableCell>
                <TableCell>
                   <Badge variant={log.action === 'DELETE' ? 'destructive' : 'outline'}>{log.action}</Badge>
                </TableCell>
                <TableCell>{log.entityType} ({log.entityId})</TableCell>
                <TableCell className="font-mono text-xs">{log.ipAddress}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}