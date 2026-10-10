'use client';

import { MasterListPage } from '@/components/MasterListPage';

export default function PositionLevelsPage() {
  return (
    <MasterListPage
      config={{
        title: 'Position Level (ระดับตำแหน่ง)',
        addButtonLabel: 'เพิ่ม Position Level ใหม่',
        apiPath: '/admin/position-levels',
        entityNameTh: 'Position Level',
        entityNameThForDelete: 'Position Level',
        emptyText: 'ไม่พบข้อมูล Position Level',
        allowDelete: true,
      }}
    />
  );
}
