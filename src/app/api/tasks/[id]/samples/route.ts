import { NextRequest, NextResponse } from 'next/server';
import { getTask, insertSample } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** 字段列表来自任务 schema（自定义任务字段任意），解析失败回退内置五字段 */
function fieldsOf(task: { schema_json: string } | undefined): string[] {
  try {
    const f = task ? (JSON.parse(task.schema_json) as { fields?: string[] }).fields : undefined;
    return Array.isArray(f) && f.length ? f : ['event', 'date', 'time', 'location', 'deadline'];
  } catch {
    return ['event', 'date', 'time', 'location', 'deadline'];
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const taskId = Number(id);
  const task = getTask(taskId);
  if (!task) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body?.input || !body?.category) return NextResponse.json({ error: '缺少 category/input' }, { status: 400 });

  const fields = fieldsOf(task);
  const reference: Record<string, string> = {};
  for (const f of fields) reference[f] = String(body.reference?.[f] ?? '');
  const critical: string[] = Array.isArray(body.critical) ? body.critical.filter((f: string) => fields.includes(f)) : [];

  const sid = insertSample(taskId, {
    category: body.category,
    input: String(body.input).trim(),
    reference,
    critical,
    note: body.note ?? '',
    origin: body.origin === 'real-error' ? 'real-error' : 'manual',
  });
  return NextResponse.json({ id: sid });
}
