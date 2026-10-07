'use client';

import { useState, useEffect } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

export default function FieldMasterPage() {
  const [fields, setFields] = useState<any[]>([]);

  useEffect(() => {
    fetch(process.env.NEXT_PUBLIC_API_URL + '/admin/fields', {
      headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` }
    }).then(res => res.json()).then(res => setFields(res.data || []));
  }, []);

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-2xl font-bold">Field Master (คลังคำถาม)</h1>
      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label (TH)</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>PDF Mapping Key</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((field) => (
              <TableRow key={field.id}>
                <TableCell className="font-medium">{field.labelTh}</TableCell>
                <TableCell><Badge variant="outline">{field.fieldType}</Badge></TableCell>
                <TableCell>{field.pdfMappingKey || '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}