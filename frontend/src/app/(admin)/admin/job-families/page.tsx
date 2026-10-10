'use client';

import { MasterListPage } from '@/components/MasterListPage';

export default function JobFamiliesPage() {
  return (
    <MasterListPage
      config={{
        title: 'Job Family (สายงาน)',
        addButtonLabel: 'เพิ่ม Job Family ใหม่',
        apiPath: '/admin/job-families',
        entityNameTh: 'Job Family',
        entityNameThForDelete: 'Job Family',
        emptyText: 'ไม่พบข้อมูล Job Family',
        allowDelete: true,
      }}
    />
  );
}
