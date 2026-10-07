import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTask, listSamples, listVersions, listRuns } from '@/lib/db';
import { ensureSeeded } from '@/lib/seed';
import { getVersion } from '@/lib/db';
import ImportSeedButton from '@/components/ImportSeedButton';
import SampleForm from '@/components/SampleForm';
import SampleRowActions from '@/components/SampleRowActions';
import VersionCard from '@/components/VersionCard';

export const dynamic = 'force-dynamic';

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  ensureSeeded();
  const { id } = await params;
  const task = getTask(Number(id));
  if (!task) notFound();
  const samples = listSamples(task.id);
  const versions = listVersions(task.id);
  const runs = listRuns(task.id);
  const catLabel: Record<string, string> = { normal: '正常', missing: '缺失', ambiguous: '歧义', adversarial: '对抗' };

  return (
    <div>
      <h1>{task.name}</h1>
      <p className="page-desc">
        <Link href="/">← 任务列表</Link> ｜ 四步流程：描述任务 → <b>准备测试（本页）</b> → 配置两版本（本页） → 运行看报告
      </p>

      <h2 className="mt0">① 测试集（{samples.length} 条，启用 {samples.filter((s) => s.enabled).length} 条）</h2>
      <div className="toolbar">
        <ImportSeedButton taskId={task.id} />
        <span className="muted">种子集 = M0 验证实验的 36 条样例（可复现）</span>
      </div>
      <table>
        <thead>
          <tr>
            <th style={{ width: 60 }}>ID</th>
            <th style={{ width: 70 }}>类别</th>
            <th>通知原文</th>
            <th style={{ width: 220 }}>参考答案</th>
            <th style={{ width: 160 }}>关键要求</th>
            <th style={{ width: 170 }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {samples.map((s) => {
            const ref = JSON.parse(s.reference_json) as Record<string, string>;
            const checks = JSON.parse(s.checks_json) as { critical: string[] };
            return (
              <tr key={s.id} style={{ opacity: s.enabled ? 1 : 0.45 }}>
                <td className="mono">#{s.id}</td>
                <td>
                  <span className={`badge ${s.category}`}>{catLabel[s.category] ?? s.category}</span>
                </td>
                <td>{s.input}</td>
                <td className="mono" style={{ fontSize: 12 }}>
                  {Object.entries(ref)
                    .map(([k, v]) => `${k}:${v === '' ? '∅' : v}`)
                    .join(' ')}
                </td>
                <td>{checks.critical.length ? <span className="badge critical">{checks.critical.join('/')}</span> : <span className="muted">—</span>}</td>
                <td>
                  <SampleRowActions sampleId={s.id} taskId={task.id} enabled={!!s.enabled} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <details className="card" style={{ marginTop: 14 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>＋ 新增样例（导入真实通知 / 真实错误 → 回归用例）</summary>
        <div style={{ paddingTop: 8 }}>
          <SampleForm taskId={task.id} />
        </div>
      </details>

      <h2>② 版本配置（{versions.length} 个）</h2>
      <p className="page-desc">对比时任选两个：一个作基线（现状），一个作候选（改版）。改提示词就在这里改。</p>
      <div className="grid-2">
        {versions.map((v) => (
          <VersionCard
            key={v.id}
            v={{ id: v.id, name: v.name, model: v.model, system_prompt: v.system_prompt, user_template: v.user_template, temperature: v.temperature, max_tokens: v.max_tokens }}
          />
        ))}
      </div>

      <h2>③ 运行历史（{runs.length} 次）</h2>
      {runs.length === 0 ? (
        <p className="page-desc">还没有运行记录。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ width: 60 }}>ID</th>
              <th>基线 → 候选</th>
              <th style={{ width: 80 }}>模式</th>
              <th className="num" style={{ width: 60 }}>重复</th>
              <th style={{ width: 90 }}>状态</th>
              <th style={{ width: 150 }}>时间</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="mono">
                  <Link href={`/runs/${r.id}`}>#{r.id}</Link>
                </td>
                <td>
                  {getVersion(r.baseline_version_id)?.name ?? '?'} → {getVersion(r.candidate_version_id)?.name ?? '?'}
                </td>
                <td>{r.mode === 'mock' ? <span className="badge gray">mock</span> : '真实'}</td>
                <td className="num">{r.reps}</td>
                <td>
                  <span className={`status-dot ${r.status}`} />
                  {r.status === 'done' ? '完成' : r.status === 'error' ? '出错' : r.status}
                </td>
                <td className="muted">{r.created_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="toolbar" style={{ marginTop: 18 }}>
        <Link className="btn primary" href={`/tasks/${task.id}/runs/new`}>
          ④ 发起对比运行 →
        </Link>
      </div>
    </div>
  );
}
