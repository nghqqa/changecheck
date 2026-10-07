import { NextRequest, NextResponse } from 'next/server';
import { renderMarkdown } from '@/lib/kernel/report';
import { recomputeReport } from '@/lib/runs';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = recomputeReport(Number(id));
  if (!r) return NextResponse.json({ error: '报告尚未生成（运行未完成或不存在）' }, { status: 404 });
  const md = renderMarkdown(r.taskName, r.data);
  return new NextResponse(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="changecheck-report-${id}.md"`,
    },
  });
}
