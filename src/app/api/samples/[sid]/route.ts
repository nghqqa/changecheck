import { NextRequest, NextResponse } from 'next/server';
import { getSample, updateSample, deleteSample } from '@/lib/db';
import { FIELDS } from '@/lib/kernel/checker';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params;
  if (!getSample(Number(sid))) return NextResponse.json({ error: '样例不存在' }, { status: 404 });
  const body = await req.json().catch(() => ({}));

  const patch: Parameters<typeof updateSample>[1] = {};
  if (body.category !== undefined) patch.category = body.category;
  if (body.input !== undefined) patch.input = String(body.input).trim();
  if (body.note !== undefined) patch.note = body.note;
  if (body.enabled !== undefined) patch.enabled = !!body.enabled;
  if (body.reference !== undefined) {
    const reference: Record<string, string> = {};
    for (const f of FIELDS) reference[f] = String(body.reference?.[f] ?? '');
    patch.reference = reference;
  }
  if (body.critical !== undefined) patch.critical = Array.isArray(body.critical) ? body.critical.filter((f: string) => FIELDS.includes(f)) : [];
  updateSample(Number(sid), patch);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params;
  deleteSample(Number(sid));
  return NextResponse.json({ ok: true });
}
