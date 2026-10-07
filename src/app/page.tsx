import Link from 'next/link';
import { listTasks, listVersions, sampleCount, runCount } from '@/lib/db';
import { ensureSeeded } from '@/lib/seed';

export const dynamic = 'force-dynamic';

const SCENE_DESC: Record<string, string> = {
  'notice-extract': '故事线演示：新版提示词要求「输出更完整」——好心改版如何埋雷、又如何被逐条钉出。',
  'notice-extract-blind': '盲测：候选版是一次常见的「精简提示词省 token」改版，结果未预埋——跑出来是什么就是什么。',
};

const STORY = [
  {
    t: '① 改版',
    d: '新版提示词要求「输出更完整好用」，试了几条看着都不错，token 还更省——准备上线。',
  },
  {
    t: '② 盲区',
    d: '但平均观感会掩盖新增失败：没被试到的输入里，模型开始给「另行通知」编 18:00、给没写的地点编「待定」。',
  },
  {
    t: '③ 抓雷',
    d: '同一测试集跑两版：新增失败逐条钉出——违反哪条要求、哪个字段错、原文证据在哪。',
  },
  {
    t: '④ 验收',
    d: '修复 → 复跑 → 新增失败清零 → 放心上线。检查项与测试集随产品一起长大，下次改版继续守。',
  },
];

export default function Home() {
  ensureSeeded();
  const tasks = listTasks();
  return (
    <div>
      <div className="hero">
        <h1>改了提示词、换了模型 —— 哪些变好了？哪些被改坏了？</h1>
        <p className="hero-q">你上次改完提示词，怎么知道没改坏别的？</p>
        <p className="hero-d">
          自己试两三条，看着都挺流畅——但没试到的那部分呢？AI 功能没有回归测试：改版引入的新错误会被「平均变好了」掩盖。
          ChangeCheck 把你的业务要求变成可重复运行的验收测试，用证据回答：这次改版值不值得上线。
        </p>
        <p className="hero-tag">AI 功能的验收层 —— CI 之于代码，ChangeCheck 之于 AI 行为</p>
      </div>

      <h2 style={{ marginBottom: 6 }}>一次改版的故事</h2>
      <p className="page-desc" style={{ marginTop: 0 }}>
        下面是 M0 验证实验用真实 API 复现过的完整事件（数据见任务一）：
      </p>
      <div className="story">
        {STORY.map((s) => (
          <div className="step" key={s.t}>
            <div className="step-t">{s.t}</div>
            <div className="step-d">{s.d}</div>
          </div>
        ))}
      </div>

      <h2>任务</h2>
      <p className="page-desc">每个任务 = 一个 AI 功能场景（字段 schema + 测试集 + 版本配置 + 运行历史）。首次打开已自动播种两个演示任务。</p>
      {tasks.map((t) => {
        const schema = JSON.parse(t.schema_json) as { fields: string[] };
        const versions = listVersions(t.id);
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
            <div style={{ marginTop: 6 }}>{SCENE_DESC[t.scene] ?? ''}</div>
            <div className="muted" style={{ marginTop: 4 }}>
              字段：{schema.fields.join(' / ')} ｜ 测试集 {sampleCount(t.id)} 条 ｜ 版本 {versions.length} 个 ｜ 运行 {runCount(t.id)} 次
            </div>
          </div>
        );
      })}
    </div>
  );
}
