import Link from 'next/link';
import { listTasks, sampleCount, runCount } from '@/lib/db';
import { ensureSeeded } from '@/lib/seed';

export const dynamic = 'force-dynamic';

export default function Home() {
  ensureSeeded();
  const tasks = listTasks();
  return (
    <div>
      <h1>任务</h1>
      <p className="page-desc">
        每个任务 = 一个 AI 功能场景（字段 schema + 测试集 + 版本配置 + 运行历史）。首次打开已自动播种演示任务「中文通知信息提取」。
      </p>
      {tasks.map((t) => {
        const schema = JSON.parse(t.schema_json) as { fields: string[] };
        return (
          <div className="card" key={t.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <Link href={`/tasks/${t.id}`} style={{ fontSize: 16, fontWeight: 600 }}>
                  {t.name}
                </Link>
                <span className="badge gray" style={{ marginLeft: 10 }}>
                  {t.scene}
                </span>
              </div>
              <Link className="btn primary" href={`/tasks/${t.id}/runs/new`}>
                发起对比运行
              </Link>
            </div>
            <div className="muted" style={{ marginTop: 6 }}>
              字段：{schema.fields.join(' / ')} ｜ 测试集 {sampleCount(t.id)} 条 ｜ 运行 {runCount(t.id)} 次
            </div>
          </div>
        );
      })}
    </div>
  );
}
