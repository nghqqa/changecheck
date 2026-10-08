import { NextRequest, NextResponse } from 'next/server';
import { getTask, getVersion, insertRun } from '@/lib/db';
import { buildSnapshot, enqueueRun } from '@/lib/runs';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const taskId = Number(body?.taskId);
  const baseId = Number(body?.baselineVersionId);
  const candId = Number(body?.candidateVersionId);
  const mode = body?.mode === 'mock' ? 'mock' : 'real';
  const reps = Math.min(5, Math.max(1, Number(body?.reps) || 1));

  if (!getTask(taskId)) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  if (baseId === candId) return NextResponse.json({ error: '基线与候选不能是同一版本' }, { status: 400 });
  if (!getVersion(baseId) || !getVersion(candId)) return NextResponse.json({ error: '版本不存在' }, { status: 404 });
  if (mode === 'real' && !process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json({ error: '缺少 DEEPSEEK_API_KEY，请改用 mock 模式或配置环境变量' }, { status: 400 });
  }

  // 点击运行即固化快照（版本配置/测试集/检查规则），之后编辑不影响本次运行的可复现性
  const snap = buildSnapshot(taskId, baseId, candId);
  if ('error' in snap) return NextResponse.json({ error: snap.error }, { status: 400 });

  const runId = insertRun({ task_id: taskId, baseline_version_id: baseId, candidate_version_id: candId, mode, reps, snapshot_json: JSON.stringify(snap) });
  const { queuedAhead } = enqueueRun(runId);
  return NextResponse.json({ id: runId, queuedAhead });
}
