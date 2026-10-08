import { NextRequest, NextResponse } from 'next/server';
import { getTask, updateTaskRequirements } from '@/lib/db';
import { deriveRules, type StoredRequirements } from '@/lib/requirements';

export const dynamic = 'force-dynamic';

/** PATCH：保存「要求引导」确认后的验收标准（检查项 + 规则开关，检查器实际读取 rules） */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getTask(Number(id))) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  const body = await req.json().catch(() => null);
  const r = body?.requirements as StoredRequirements | undefined;
  if (!r || typeof r.text !== 'string' || !Array.isArray(r.items)) {
    return NextResponse.json({ error: '参数不合法' }, { status: 400 });
  }
  const VALID_RULE_KEYS = ['verbatim', 'eventNear', 'emptyCritical'] as const;
  const items = r.items
    .filter((x) => x && typeof x.label === 'string')
    .slice(0, 50)
    .map((x) => {
      const rk = VALID_RULE_KEYS.find((k) => k === x.ruleKey);
      return {
        id: String(x.id),
        label: String(x.label).slice(0, 200),
        confirmed: !!x.confirmed,
        mapped: String(x.mapped ?? ''),
        ...(rk ? { ruleKey: rk } : {}),
      };
    });
  // 规则开关由服务端从确认项派生，不信任客户端提交值
  const stored: StoredRequirements = {
    text: String(r.text).slice(0, 2000),
    items,
    confirmedAt: new Date().toLocaleString('zh-CN'),
    rules: deriveRules(items),
  };
  updateTaskRequirements(Number(id), JSON.stringify(stored));
  return NextResponse.json({ ok: true, rules: stored.rules });
}
