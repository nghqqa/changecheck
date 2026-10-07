import { NextRequest, NextResponse } from 'next/server';
import { getTask, listSamples, listVersions } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** 测试资产导出：任务 + 测试集 + 版本配置（JSON 下载，可迁移/进 Git） */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = getTask(Number(id));
  if (!task) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  const payload = {
    exportedAt: new Date().toISOString(),
    task: { name: task.name, scene: task.scene, schema: JSON.parse(task.schema_json), requirements: task.requirements_json ? JSON.parse(task.requirements_json) : null },
    samples: listSamples(task.id).map((s) => ({
      category: s.category,
      input: s.input,
      reference: JSON.parse(s.reference_json),
      checks: JSON.parse(s.checks_json),
      note: s.note,
      origin: s.origin,
      enabled: !!s.enabled,
    })),
    versions: listVersions(task.id).map((v) => ({
      name: v.name,
      model: v.model,
      system_prompt: v.system_prompt,
      user_template: v.user_template,
      temperature: v.temperature,
      max_tokens: v.max_tokens,
    })),
  };
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="changecheck-task-${id}.json"`,
    },
  });
}
