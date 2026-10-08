import ApplicationDetailClient from './ApplicationDetailClient';
import { Suspense } from 'react';

export default function ApplicationDetailPage() {
  return (
    <Suspense fallback={<div className="p-8">กำลังโหลด...</div>}>
      <ApplicationDetailClient />
    </Suspense>
  );
}
