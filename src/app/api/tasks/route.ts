import { NextRequest, NextResponse } from 'next/server';
import { insertTask, listTasks } from '@/lib/db';

export const dynamic = 'force-dynamic';

const NAME_RE = /^[\w\u4e00-\u9fa5-]{1,24}$/;

/** POST：创建自定义任务（名称 + 字段 schema）。字段即验收的对象，第一个字段约定为主体名称 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? '').trim();
  const rawFields = Array.isArray(body?.fields) ? body.fields : [];

  if (!name || name.length > 60) return NextResponse.json({ error: '任务名称必填且不超过 60 字' }, { status: 400 });
  if (rawFields.length < 1 || rawFields.length > 12) return NextResponse.json({ error: '字段数量需在 1–12 之间' }, { status: 400 });

  const fields: string[] = [];
  const desc: Record<string, string> = {};
  for (const f of rawFields) {
    const fname = String(f?.name ?? '').trim();
    if (!NAME_RE.test(fname)) {
      return NextResponse.json({ error: `字段名「${fname.slice(0, 20)}」不合法：仅限中文、字母、数字、下划线、连字符，≤24 字符` }, { status: 400 });
    }
    if (fields.includes(fname)) return NextResponse.json({ error: `字段名重复：${fname}` }, { status: 400 });
    fields.push(fname);
    const d = String(f?.desc ?? '').trim();
    if (d) desc[fname] = d.slice(0, 120);
  }

  // 同名任务去重提示（不阻断）
  if (listTasks().some((t) => t.name === name)) {
    return NextResponse.json({ error: `已有同名任务「${name}」，请换一个名字` }, { status: 400 });
  }

  const id = insertTask(name, 'custom', JSON.stringify({ fields, desc }));
  return NextResponse.json({ id });
}
