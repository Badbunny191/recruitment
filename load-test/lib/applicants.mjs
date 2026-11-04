/**
 * ตัวสร้างข้อมูลผู้สมัครจำลอง (ภาษาไทย) — ไม่ซ้ำกัน
 * ---------------------------------------------------------------------------
 * - ลำดับ seq กำหนดทุกอย่าง deterministically → รันซ้ำได้ผลเหมือนเดิม
 * - email     = TEST-000001@test.local   (ระบุตัวตนชัดเจน ค้นหา/ลบง่าย)
 * - เบอร์โทร/เลขบัตร สร้างจาก seq ไม่ซ้ำแน่นอน
 * - ชื่อ-นามสกุล สุ่มจาก pool ด้วยสูตรที่ไม่ซ้ำในช่วง 0..9999
 */

const FIRST_NAMES_M = [
  'สมชาย', 'ประเสริฐ', 'วิชัย', 'อนุชา', 'ธนากร', 'กิตติ', 'ปิยะพงษ์', 'ศักดา',
  'ณัฐพงษ์', 'ธีรภัทร', 'อาทิตย์', 'ชัยวัฒน์', 'สุรเชษฐ์', 'ภูวเดช', 'จิรายุ', 'ณัฐวุฒิ',
  'ธนกฤต', 'พีระพงษ์', 'ศิวกร', 'อดิศร', 'บวรศักดิ์', 'ก้องภพ', 'ต่อพงษ์', 'นนทกร',
  'ปราโมทย์', 'วรวิทย์', 'สิริชัย', 'อรรถพล', 'เอกชัย', 'โชติกานต์', 'ไพโรจน์', 'กฤตธเดช',
];
const FIRST_NAMES_F = [
  'สมหญิง', 'ปิยะรัตน์', 'วรรณิดา', 'อรุณี', 'ธัญญ์รภัสร์', 'กมลชนก', 'ปิ่นป้าน', 'ศิริพรรณ',
  'ณัฐริกา', 'ธิดารัตน์', 'อาทิตยา', 'ชัญญา', 'สุพิชญา', 'ภัทรวดี', 'จิดาภา', 'ณัชชา',
  'ธนัชชา', 'พิมพ์ชนก', 'ศิรประภา', 'อัญชิสา', 'บุษราคัม', 'กชกร', 'ตรีชญา', 'นภัสกร',
  'ปาณิสรา', 'วริศรา', 'สิริกัญญา', 'อรพรรณ', 'เอมอร', 'โสภิดา', 'ไอริณ', 'กัญญาณัฐ',
];
const LAST_NAMES = [
  'ใจดี', 'รักไทย', 'สุขสันต์', 'มั่นคง', 'เจริญสุข', 'วงศ์สถาพร', 'อินทรแสง', 'พงษ์เจริญ',
  'ธารทอง', 'ศรีสุวรรณ', 'แก้วมณี', 'บุญประเสริฐ', 'จันทร์เพ็ญ', 'ทองคำดี', 'นิลรัตน์', 'พรหมมา',
  'รัตนวงศ์', 'ลาภเลิศ', 'สายบัว', 'หอมกลิ่น', 'เกษมสุข', 'คำแหง', 'โพธิ์ทอง', 'เพ็ชรรัตน์',
  'อาสาสมุทร', 'กล้าหาญ', 'ปัญญาดี', 'วัฒนชัย', 'สุวรรณกิจ', 'ทองอยู่ดี', 'มีสุข', 'ภูผาธรรม',
  'ดวงแจ่ม', 'เนตรนคร', 'อ่อนน้อม', 'เข้มแข็ง', 'ผดุงพงษ์', 'เลิศประเสริฐ', 'จรัสแสง', 'อุทัยธานี',
];
const PROVINCES = [
  'กรุงเทพมหานคร', 'เชียงใหม่', 'ขอนแก่น', 'นครราชสีมา', 'สงขลา', 'ภูเก็ต',
  'นนทบุรี', 'สมุทรปราการ', 'ชลบุรี', 'อุดรธานี', 'อุบลราชธานี', 'สุราษฎร์ธานี',
];
const EDUCATION_LEVELS = ['มัธยมศึกษา', 'ปวช.', 'ปวส.', 'ปริญญาตรี', 'ปริญญาโท', 'ปริญญาเอก'];
const GENDERS = ['ชาย', 'หญิง'];

const pad = (n, w = 6) => String(n).padStart(w, '0');

/** runStamp: ตัวตนของแต่ละรัน (yyyymmddHHMMSS) — ทำให้ email/บัตร/เบอร์ไม่ซ้ำกับรันก่อน */
export function makeRunStamp(d = new Date()) {
  const p = (n, w) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1, 2)}${p(d.getDate(), 2)}${p(d.getHours(), 2)}${p(d.getMinutes(), 2)}${p(d.getSeconds(), 2)}`;
}

export function applicantNo(seq) {
  return `TEST-${pad(seq)}`;
}

/**
 * สร้างผู้สมัคร 1 คนจาก seq (1-based)
 * @param runStamp yyyymmddHHMMSS ของรัน — identity ทั้งหมดฝัง stamp นี้
 *   → email = TEST-<stamp>-<seq>@test.local (ไม่ซ้ำกับทุก run/seed เดิมในรอบเดียวกัน)
 *   → บัตร 13 หลัก = 1 + stamp(7) + seq(4) + เลขตรวจ, เบอร์ 10 หลัก = 08 + stamp(4 ท้าย) + seq(4)
 */
export function makeApplicant(seq, runStamp = makeRunStamp()) {
  const idx = seq - 1;
  const runNum = parseInt(runStamp.slice(-7), 10) || 1;
  const isFemale = idx % 2 === 1;
  const firstPool = isFemale ? FIRST_NAMES_F : FIRST_NAMES_M;
  const firstName = firstPool[Math.floor(idx / 2) % firstPool.length];
  const lastName = LAST_NAMES[(idx * 7) % LAST_NAMES.length];
  const province = PROVINCES[idx % PROVINCES.length];

  return {
    seq,
    runStamp,
    applicationNo: applicantNo(seq), // ป้ายภายใน harness (เลขจริงมาจาก backend)
    email: `TEST-${runStamp}-${pad(seq)}@test.local`,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    gender: isFemale ? 'หญิง' : 'ชาย',
    // 13 หลัก: ไม่ซ้ำข้ามรัน (stamp) และไม่ซ้ำในรัน (seq 4 หลัก)
    nationalId: `1${pad(runNum, 7)}${pad(seq, 4)}${(idx % 9) + 1}`,
    // 10 หลัก: 08 + 4 ท้ายของ stamp + 4 หลัก seq (รองรับถึง 9,999 คน/รัน)
    phone: `08${runStamp.slice(-4)}${pad(seq, 4)}`,
    address: `${(idx % 989) + 1}/${(idx % 89) + 1} หมู่ ${(idx % 9) + 1} ถนนทดสอบ ตำบลใจดี อำเภอเมือง จังหวัด${province} 10${pad(idx % 100, 3)}`,
    education: EDUCATION_LEVELS[idx % EDUCATION_LEVELS.length],
    experience:
      `ทำงานตำแหน่งเจ้าหน้าที่ธุรการ อบต.ใจดี 3 ปี (ผู้สมัครทดสอบ ${runStamp}-${pad(seq)})\n` +
      `งานที่ถนัด: จัดทำเอกสาร ประสานงานภายใน และงานบริการประชาชน`,
    experienceYears: (idx % 10) + 1,
  };
}

/** สร้างผู้สมัครช่วง seq [from..to] (รวมปลาย) — ทุกคนในรันเดียวกันใช้ runStamp เดียวกัน */
export function generateApplicants(from = 1, to = 250, runStamp = makeRunStamp()) {
  const out = [];
  for (let seq = from; seq <= to; seq++) out.push(makeApplicant(seq, runStamp));
  return out;
}

/** formData ที่จะยัดลง SQL (key = fieldId ของ template) — ใช้โดย seed.mjs */
export function buildFormData(applicant, templateFields) {
  const fd = {};
  for (const f of templateFields) {
    switch (f.fieldId) {
      case 'field-fullname': fd[f.fieldId] = applicant.fullName; break;
      case 'field-national-id': fd[f.fieldId] = applicant.nationalId; break;
      case 'field-email': fd[f.fieldId] = applicant.email; break;
      case 'field-phone': fd[f.fieldId] = applicant.phone; break;
      case 'field-address': fd[f.fieldId] = applicant.address; break;
      case 'field-education': fd[f.fieldId] = applicant.education; break;
      case 'field-gender': fd[f.fieldId] = applicant.gender; break;
      case 'field-experience': fd[f.fieldId] = applicant.experience; break;
      default:
        // ฟิลด์อื่น ๆ ใส่ค่าทั่วไปที่ผ่าน required (FILE ไม่ใส่ใน formData)
        if (f.fieldType === 'TEXT') fd[f.fieldId] = `TEST-${pad(applicant.seq)}`;
        else if (f.fieldType === 'TEXTAREA') fd[f.fieldId] = `ข้อมูลทดสอบ ${applicant.applicationNo}`;
        else if (f.fieldType === 'NUMBER') fd[f.fieldId] = String(applicant.experienceYears);
        else if (f.fieldType === 'DROPDOWN' || f.fieldType === 'RADIO') fd[f.fieldId] = (f.options && f.options[0]) || 'อื่นๆ';
        else if (f.fieldType === 'CHECKBOX') fd[f.fieldId] = f.options?.[0] || 'ยืนยัน';
        else if (f.fieldType === 'DATE') fd[f.fieldId] = '2026-01-15';
    }
  }
  return fd;
}
