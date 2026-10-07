import { NextRequest, NextResponse } from 'next/server';
import { getVersion, updateVersion } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ vid: string }> }) {
  const { vid } = await params;
  if (!getVersion(Number(vid))) return NextResponse.json({ error: '版本不存在' }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  updateVersion(Number(vid), {
    ...(body.name !== undefined ? { name: String(body.name) } : {}),
    ...(body.model !== undefined ? { model: String(body.model) } : {}),
    ...(body.system_prompt !== undefined ? { system_prompt: String(body.system_prompt) } : {}),
    ...(body.user_template !== undefined ? { user_template: String(body.user_template) } : {}),
    ...(body.temperature !== undefined ? { temperature: Number(body.temperature) } : {}),
    ...(body.max_tokens !== undefined ? { max_tokens: Number(body.max_tokens) } : {}),
  });
  return NextResponse.json({ ok: true });
}
