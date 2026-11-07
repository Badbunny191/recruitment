import type { MetadataRoute } from 'next';

// PWA icon set (เตรียมไว้ล่วงหน้า — ยังไม่ตั้ง start_url/display จึงยังไม่เสนอ install)
// icon-192/512: ตราชั่งบนพื้นแดงเต็มเหลี่ยม + วงแหวนทอง
// icon-512-maskable: ตัวตราอยู่ใน safe zone 80% ที่ Android mask ไม่ทับ
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ระบบรับสมัครคัดเลือกบุคลากร - สำนักงานการตรวจเงินแผ่นดิน',
    short_name: 'รับสมัคร สตง.',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
