import { NextRequest, NextResponse } from 'next/server';
import { getSample, getTask, updateSample, deleteSample } from '@/lib/db';

export const dynamic = 'force-dynamic';

function fieldsOf(task: { schema_json: string } | undefined): string[] {
  try {
    const f = task ? (JSON.parse(task.schema_json) as { fields?: string[] }).fields : undefined;
    return Array.isArray(f) && f.length ? f : ['event', 'date', 'time', 'location', 'deadline'];
  } catch {
    return ['event', 'date', 'time', 'location', 'deadline'];
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params;
  const sample = getSample(Number(sid));
  if (!sample) return NextResponse.json({ error: '样例不存在' }, { status: 404 });
  const fields = fieldsOf(getTask(sample.task_id));
  const body = await req.json().catch(() => ({}));

  const patch: Parameters<typeof updateSample>[1] = {};
  if (body.category !== undefined) patch.category = body.category;
  if (body.input !== undefined) patch.input = String(body.input).trim();
  if (body.note !== undefined) patch.note = body.note;
  if (body.enabled !== undefined) patch.enabled = !!body.enabled;
  if (body.reference !== undefined) {
    const reference: Record<string, string> = {};
    for (const f of fields) reference[f] = String(body.reference?.[f] ?? '');
    patch.reference = reference;
  }
  if (body.critical !== undefined) patch.critical = Array.isArray(body.critical) ? body.critical.filter((f: string) => fields.includes(f)) : [];
  updateSample(Number(sid), patch);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params;
  deleteSample(Number(sid));
  return NextResponse.json({ ok: true });
}
