// Server component - มี generateStaticParams สำหรับ static export
import TemplateBuilderClient from './TemplateBuilderClient';

interface Template {
  id: string;
}

// Generate empty static params - admin pages require authentication
export async function generateStaticParams() {
  return [];
}

export default function TemplateBuilderPage() {
  return <TemplateBuilderClient />;
}