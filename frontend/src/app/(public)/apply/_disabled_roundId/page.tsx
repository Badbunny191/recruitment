'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FileUpload } from '@/components/FileUpload';

interface SchemaField {
  fieldId: string;
  type: 'TEXT' | 'TEXTAREA' | 'DROPDOWN' | 'RADIO' | 'FILE';
  label: string;
  overrideLabel: string | null;
  options: string[] | null;
  overrideOptions: string[] | null;
  isRequired: boolean;
}

function FormInner() {
  const params = useParams();
  const router = useRouter();
  const [schema, setSchema] = useState<SchemaField[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { register, handleSubmit, control } = useForm();

  useEffect(() => {
    if (!params.roundId) return;
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/public/rounds/${params.roundId}/schema`)
      .then(res => res.json())
      .then(res => {
        setSchema(res.data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [params.roundId]);

  const onSubmit = async (data: any) => {
    setIsSubmitting(true);
    
    const coreData = {
      roundId: params.roundId,
      email: data.email,
      fullname: data.fullname,
      nationalId: data.nationalId,
    };

    const formData: Record<string, any> = {};
    const attachments: { fieldId: string; fileUrl: string }[] = [];

    schema.forEach(field => {
      if (field.type === 'FILE') {
        if (data[field.fieldId]) attachments.push({ fieldId: field.fieldId, fileUrl: data[field.fieldId] });
      } else {
        formData[field.fieldId] = data[field.fieldId];
      }
    });

    try {
      const res = await fetch(process.env.NEXT_PUBLIC_API_URL + '/public/applications/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...coreData, formData, attachments }),
      });
      const result = await res.json();
      
      if (result.success) {
        router.push(`/apply/success?appNo=${result.data.applicationNo}`);
      } else {
        alert('เกิดข้อผิดพลาด กรุณาตรวจสอบข้อมูล');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) return <div className="p-8 text-center">กำลังโหลดแบบฟอร์ม...</div>;

  return (
    <div className="max-w-3xl mx-auto p-8">
      <Card>
        <CardHeader className="bg-slate-50 border-b">
          <CardTitle className="text-xl">ใบสมัครคัดเลือกบุคลากร</CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
            <div className="space-y-4">
              <h3 className="font-semibold text-lg border-b pb-2">ข้อมูลส่วนบุคคล</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>ชื่อ - นามสกุล <span className="text-red-500">*</span></Label>
                  <Input {...register('fullname', { required: true })} placeholder="เช่น นายสมชาย ใจดี" />
                </div>
                <div className="space-y-2">
                  <Label>เลขประจำตัวประชาชน <span className="text-red-500">*</span></Label>
                  <Input {...register('nationalId', { required: true, minLength: 13, maxLength: 13 })} placeholder="13 หลัก" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>อีเมล <span className="text-red-500">*</span></Label>
                  <Input type="email" {...register('email', { required: true })} placeholder="email@example.com" />
                </div>
              </div>
            </div>

            {schema.length > 0 && (
              <div className="space-y-6">
                <h3 className="font-semibold text-lg border-b pb-2">ข้อมูลประกอบการพิจารณา</h3>
                {schema.map((field) => {
                  const label = field.overrideLabel || field.label;
                  const options = field.overrideOptions || field.options || [];
                  return (
                    <div key={field.fieldId} className="space-y-2">
                      <Label>{label} {field.isRequired && <span className="text-red-500">*</span>}</Label>
                      {field.type === 'TEXT' && <Input {...register(field.fieldId, { required: field.isRequired })} />}
                      {field.type === 'TEXTAREA' && <Textarea rows={4} {...register(field.fieldId, { required: field.isRequired })} />}
                      {field.type === 'DROPDOWN' && (
                        <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...register(field.fieldId, { required: field.isRequired })}>
                          <option value="">-- กรุณาเลือก --</option>
                          {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      )}
                      {field.type === 'FILE' && (
                        <Controller
                          name={field.fieldId}
                          control={control}
                          rules={{ required: field.isRequired }}
                          render={({ field: { onChange } }) => (
                            <FileUpload onUploadSuccess={onChange} accept="application/pdf" />
                          )}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="space-y-4 bg-blue-50 p-4 rounded-md">
              <div className="flex items-start space-x-2">
                <Checkbox id="consent1" required />
                <label htmlFor="consent1" className="text-sm font-medium leading-none">ข้าพเจ้าได้ตรวจสอบความถูกต้องครบถ้วนของข้อมูลในใบสมัครแล้ว</label>
              </div>
              <div className="flex items-start space-x-2">
                <Checkbox id="consent2" required />
                <label htmlFor="consent2" className="text-sm font-medium leading-none">ข้าพเจ้าขอรับรองว่าข้อมูลที่ได้แจ้งไว้ในใบสมัครนี้ถูกต้องครบถ้วนทุกประการ</label>
              </div>
            </div>

            <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 h-12 text-lg" disabled={isSubmitting}>
              {isSubmitting ? 'กำลังส่งข้อมูล...' : 'ยืนยันการส่งใบสมัคร'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ApplicationFormPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center">กำลังโหลดแบบฟอร์ม...</div>}>
      <FormInner />
    </Suspense>
  );
}