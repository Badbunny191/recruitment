/**
 * Document Composer Page — Server Component (thin shell)
 * --------------------------------------------
 * Document Composer V1 — Admin UI Layer
 *
 * Route: /admin/templates/composer
 *
 * ใช้ query param ?versionId=... แทน dynamic route
 * (เพื่อให้ compatible กับ output: 'export' ของ Next.js Cloudflare Pages)
 */

import ComposerClient from './ComposerClient';

export default function ComposerPage() {
  return <ComposerClient />;
}