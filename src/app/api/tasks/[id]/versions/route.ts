import { NextRequest, NextResponse } from 'next/server';
import { getTask, insertVersion } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const taskId = Number(id);
  if (!getTask(taskId)) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body?.name || !body?.system_prompt) return NextResponse.json({ error: '缺少 name/system_prompt' }, { status: 400 });
  const vid = insertVersion(taskId, {
    name: String(body.name),
    model: String(body.model || process.env.DEEPSEEK_MODEL || 'deepseek-flash'),
    system_prompt: String(body.system_prompt),
    user_template: body.user_template,
    temperature: Number(body.temperature ?? 0),
    max_tokens: Number(body.max_tokens ?? 2000),
  });
  return NextResponse.json({ id: vid });
}
