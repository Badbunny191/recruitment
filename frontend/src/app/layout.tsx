import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ระบบรับสมัครคัดเลือกบุคลากร - สำนักงานการตรวจเงินแผ่นดิน',
  description: 'ระบบรับสมัครงานออนไลน์สำหรับสำนักงานการตรวจเงินแผ่นดิน (สตง.)',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <body className="min-h-screen bg-slate-50">{children}</body>
    </html>
  );
}
