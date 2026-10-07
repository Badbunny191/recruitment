'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useForm, useFieldArray } from 'react-hook-form';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';

export default function TemplateBuilderClient() {
  const params = useParams();
  const [masterFields, setMasterFields] = useState<any[]>([]);
  const { register, control, handleSubmit } = useForm({ defaultValues: { fields: [] as any[] } });
  const { fields, append, remove } = useFieldArray({ control, name: 'fields' });

  useEffect(() => {
    fetch(process.env.NEXT_PUBLIC_API_URL + '/admin/fields', { 
      headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` }
    }).then(res => res.json()).then(res => setMasterFields(res.data || []));
  }, []);

  const onSubmit = async (data: any) => {
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/templates/${params.id}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
      body: JSON.stringify({ templateId: params.id, fields: data.fields })
    });
    alert('บันทึก Version ใหม่สำเร็จ!');
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Template Builder</h1>
        <Button onClick={handleSubmit(onSubmit)}>Publish New Version</Button>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <Card className="col-span-1 h-[75vh] overflow-auto">
          <CardHeader><CardTitle>คลังคำถาม</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {masterFields.map((mf) => (
              <div key={mf.id} className="flex justify-between items-center p-3 border rounded bg-white hover:bg-slate-50">
                <span className="text-sm font-medium">{mf.labelTh}</span>
                <Button variant="ghost" size="sm" onClick={() => append({ fieldId: mf.id, displayOrder: fields.length + 1, isRequired: true, overrideLabelTh: '' })}>
                  เพิ่ม
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="col-span-2 h-[75vh] overflow-auto">
          <CardHeader><CardTitle>ฟิลด์ที่เลือกใช้งาน</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {fields.map((field, index) => (
              <div key={field.id} className="flex items-center gap-4 p-4 border rounded bg-slate-50">
                <span className="font-bold text-lg">{index + 1}</span>
                <div className="flex-1 space-y-2">
                  <Input {...register(`fields.${index}.overrideLabelTh`)} placeholder="ตั้งคำถามใหม่เฉพาะเทมเพลตนี้ (Optional)" />
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox {...register(`fields.${index}.isRequired`)} id={`req-${index}`} defaultChecked />
                  <label htmlFor={`req-${index}`} className="text-sm font-medium leading-none">บังคับตอบ</label>
                </div>
                <Button variant="destructive" size="sm" onClick={() => remove(index)}>ลบ</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
