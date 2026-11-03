import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ระบบรับสมัครคัดเลือกบุคลากร',
  description: 'หน้าแรก - ระบบรับสมัครงานออนไลน์',
};

/**
 * Public Layout — header/footer กลางของทุกหน้าสาธารณะ
 * =====================================================
 * Branding อ้าง brand token กลาง (globals.css :root + tailwind.config `brand`) เท่านั้น
 *   - header: พื้นขาว + ตรา สตง. (TH) เต็มสี 46px + ชื่อหน่วยงานสี crimson
 *   - แถบทองใต้ header / เหนือ footer = brand-accent (ตกแต่งเท่านั้น ไม่ใช่กับข้อความ)
 *   - footer: พื้น brand-hover (crimson เข้ม) — ขาวบนพื้นนี้ contrast ~10.5:1
 */
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-sao-th.png"
            alt="ตราสำนักงานการตรวจเงินแผ่นดิน"
            width={72}
            height={72}
            className="h-[72px] w-[72px] shrink-0"
          />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold leading-tight text-brand md:text-2xl">
              สำนักงานการตรวจเงินแผ่นดิน (สตง.)
            </h1>
            <p className="text-sm text-slate-500">ระบบรับสมัครคัดเลือกบุคลากร</p>
          </div>
        </div>
        {/* แถบทอง — เส้นตกแต่งประจำแบรนด์ (aria-hidden เพราะไม่มีความหมายเชิงข้อมูล) */}
        <div aria-hidden="true" className="h-[5px] w-full bg-brand-accent" />
      </header>
      <main className="py-8">{children}</main>
      <footer className="bg-brand-hover text-white">
        <div aria-hidden="true" className="h-1 w-full bg-brand-accent" />
        <div className="mx-auto max-w-5xl px-4 py-4 text-center text-sm">
          <p className="font-medium">สำนักบริหารทรัพยากรบุคคล สำนักงานการตรวจเงินแผ่นดิน</p>
        </div>
      </footer>
    </div>
  );
}
