import { NextRequest, NextResponse } from 'next/server';
import { getTask, insertSample } from '@/lib/db';
import { FIELDS } from '@/lib/kernel/checker';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const taskId = Number(id);
  if (!getTask(taskId)) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body?.input || !body?.category) return NextResponse.json({ error: '缺少 category/input' }, { status: 400 });

  const reference: Record<string, string> = {};
  for (const f of FIELDS) reference[f] = String(body.reference?.[f] ?? '');
  const critical: string[] = Array.isArray(body.critical) ? body.critical.filter((f: string) => FIELDS.includes(f)) : [];

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
