import {
  formatThaiClock,
  formatThaiCloseTime,
  toEpochMs,
} from '@/lib/public-rounds';

/**
 * บล็อกหลักฐานเวลาใน error state — แสดงเมื่อถูกปฏิเสธเพราะปิดรับสมัครแล้ว
 * ======================================================================
 * ใช้ร่วมกัน 2 จุด: การ์ด error ของ /apply (เปิดหน้าตอนรอบปิดแล้ว) และ
 * กล่อง error ของ /apply/review (submit โดน 403 ALREADY_CLOSED)
 *
 * หลักการเขียน (กันสร้างจุดโต้แย้งใหม่):
 *   - "เวลาของระบบขณะได้รับคำขอ" ต้องเป็นเวลาที่ server วัดเอง ณ ขณะรับ
 *     request ที่โดนปฏิเสธ (serverTime จาก response เดียวกัน) — ไม่ใช่เวลา
 *     เครื่องผู้ใช้ และไม่ใช่ค่าประมาณจาก offset ที่เดินต่อบนเครื่อง
 *   - requestServerTime ไม่รู้ (response เก่า/field หาย) → ซ่อนเฉพาะ
 *     บรรทัดนาฬิกา แต่ยังแสดงกำหนดปิด + ข้อความนโยบาย
 *   - ข้อความนโยบายอธิบายกติกาโดยไม่ผูกกับตัวเลขที่แสดง
 */
export function DeadlineServerTimeEvidence({
  closeValue,
  requestServerTime,
  closeLabel = 'กำหนดปิดรับสมัคร',
  policyText = 'ระบบพิจารณาการรับสมัครตามเวลาของระบบ ไม่ใช่เวลาที่แสดงบนอุปกรณ์ของผู้สมัคร',
}: {
  closeValue: string | number | Date | null | undefined;
  /** epoch ms ที่ server วัดเอง ณ ขณะรับคำขอที่โดนปฏิเสธ — undefined = ไม่แสดงบรรทัดนี้ */
  requestServerTime?: number;
  closeLabel?: string;
  policyText?: string;
}) {
  const closeMs = toEpochMs(closeValue);
  const serverTimeKnown =
    typeof requestServerTime === 'number' && Number.isFinite(requestServerTime);
  return (
    <div className="rounded-md bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-700">
      <ul className="space-y-1">
        {closeMs !== null && (
          <li>
            <span className="font-medium">{closeLabel}</span>{' '}
            {formatThaiCloseTime(closeMs, serverTimeKnown ? requestServerTime : null)}
          </li>
        )}
        {serverTimeKnown && (
          <li>
            <span className="font-medium">เวลาของระบบขณะได้รับคำขอ</span>{' '}
            <span className="tabular-nums">{formatThaiClock(requestServerTime, { seconds: true })}</span>
          </li>
        )}
        <li className="text-slate-600">{policyText}</li>
      </ul>
    </div>
  );
}
