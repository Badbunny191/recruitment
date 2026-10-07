'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';

export default function TemplatesPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<any[]>([]);

  useEffect(() => {
    fetch(process.env.NEXT_PUBLIC_API_URL + '/admin/templates', {
      headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` }
    }).then(res => res.json()).then(res => setTemplates(res.data || []));
  }, []);

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-2xl font-bold">Form Templates (แม่แบบฟอร์ม)</h1>
      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Template Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map((tpl) => (
              <TableRow key={tpl.id}>
                <TableCell className="font-medium">{tpl.name}</TableCell>
                <TableCell>{tpl.description}</TableCell>
                <TableCell className="text-right">
                  <Button variant="secondary" size="sm" onClick={() => router.push(`/admin/templates/${tpl.id}/builder`)}>
                    เปิด Builder
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}