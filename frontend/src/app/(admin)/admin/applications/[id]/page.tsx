import ApplicationDetailClient from './ApplicationDetailClient';
import { Suspense } from 'react';

// Use searchParams for dynamic ID (compatible with Cloudflare Pages static export)
// URL format: /admin/applications?id=UUID

export default function ApplicationDetailPage() {
  return (
    <Suspense fallback={<div className="p-8">กำลังโหลด...</div>}>
      <ApplicationDetailClient />
    </Suspense>
  );
}
