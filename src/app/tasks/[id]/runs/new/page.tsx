import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTask, listVersions, listSamples } from '@/lib/db';
import NewRunForm from '@/components/NewRunForm';

export const dynamic = 'force-dynamic';

export default async function NewRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = getTask(Number(id));
  if (!task) notFound();
  const versions = listVersions(task.id);
  const enabled = listSamples(task.id).filter((s) => s.enabled).length;

  return (
    <div style={{ maxWidth: 860 }}>
      <h1>发起对比运行</h1>
      <p className="page-desc">
        <Link href={`/tasks/${task.id}`}>← 返回任务</Link> ｜ 将对 {enabled} 条启用样例 × 2 个版本 × 重复次数 逐条调用并检查。
      </p>
      {versions.length < 2 ? (
        <div className="banner review">版本不足 2 个，请先在任务页配置基线与候选版本。</div>
      ) : (
        <NewRunForm taskId={task.id} versions={versions.map((v) => ({ id: v.id, name: v.name }))} />
      )}
    </div>
  );
}
