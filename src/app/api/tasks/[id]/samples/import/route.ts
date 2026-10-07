import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { getTask, listSamples, insertSample } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const taskId = Number(id);
  if (!getTask(taskId)) return NextResponse.json({ error: '任务不存在' }, { status: 404 });

  const p = path.join(process.cwd(), 'm0', 'samples.json');
  if (!fs.existsSync(p)) return NextResponse.json({ error: '种子数据不存在（m0/samples.json）' }, { status: 500 });
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  const existing = new Set(listSamples(taskId).map((s) => s.input.trim()));
  let added = 0;
  for (const s of data.samples as Array<{ category: string; input: string; reference: Record<string, string>; critical: string[]; note?: string }>) {
    if (existing.has(s.input.trim())) continue;
    insertSample(taskId, { category: s.category, input: s.input, reference: s.reference, critical: s.critical, note: s.note ?? '', origin: 'seed' });
    added++;
  }
  return NextResponse.json({ added, skipped: (data.samples as unknown[]).length - added });
}
