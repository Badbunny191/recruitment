'use client';

import { useState, useEffect } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

export default function RoundsPage() {
  const [rounds, setRounds] = useState<any[]>([]);

  useEffect(() => {
    fetch(process.env.NEXT_PUBLIC_API_URL + '/admin/rounds', {
      headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` }
    }).then(res => res.json()).then(res => setRounds(res.data || []));
  }, []);

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-2xl font-bold">รอบการรับสมัคร (Recruitment Rounds)</h1>
      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Position Level</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rounds.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.title}</TableCell>
                <TableCell>{r.positionLevel}</TableCell>
                <TableCell><Badge variant={r.status === 'ACTIVE' ? 'default' : 'secondary'}>{r.status}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}