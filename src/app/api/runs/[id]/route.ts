import { NextRequest, NextResponse } from 'next/server';
import { getRun } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(Number(id));
  if (!run) return NextResponse.json({ error: '运行不存在' }, { status: 404 });
  return NextResponse.json({
    id: run.id,
    status: run.status,
    error: run.error,
    mode: run.mode,
    reps: run.reps,
    report: run.status === 'done' && run.stats_json ? JSON.parse(run.stats_json) : null,
  });
}
