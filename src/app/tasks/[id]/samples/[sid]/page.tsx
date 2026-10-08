import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSample, getTask } from '@/lib/db';
import SampleForm from '@/components/SampleForm';

export const dynamic = 'force-dynamic';

export default async function SampleEditPage({ params }: { params: Promise<{ id: string; sid: string }> }) {
  const { id, sid } = await params;
  const task = getTask(Number(id));
  const sample = getSample(Number(sid));
  if (!task || !sample) notFound();
  const schema = JSON.parse(task.schema_json) as { fields: string[] };

  return (
    <div style={{ maxWidth: 860 }}>
      <h1>编辑样例 #{sample.id}</h1>
      <p className="page-desc">
        <Link href={`/tasks/${task.id}`}>← 返回任务</Link> ｜ 人工确认检查项：参考答案决定「必须提取/必须留空」，勾选决定零容忍字段。
      </p>
      <div className="card">
        <SampleForm
          taskId={task.id}
          fields={schema.fields}
          sample={{
            id: sample.id,
            category: sample.category,
            input: sample.input,
            reference: JSON.parse(sample.reference_json),
            critical: (JSON.parse(sample.checks_json) as { critical: string[] }).critical,
            note: sample.note,
          }}
        />
      </div>
    </div>
  );
}
