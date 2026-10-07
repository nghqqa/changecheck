import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTask, listSamples, listVersions, listRuns, getVersion } from '@/lib/db';
import { ensureSeeded } from '@/lib/seed';
import type { StoredRequirements } from '@/lib/requirements';
import ImportSeedButton from '@/components/ImportSeedButton';
import SampleForm from '@/components/SampleForm';
import SampleRowActions from '@/components/SampleRowActions';
import VersionCard from '@/components/VersionCard';
import RequirementsWizard, { RequirementsView } from '@/components/RequirementsWizard';

export const dynamic = 'force-dynamic';

const catLabel: Record<string, string> = { normal: '正常', missing: '缺失', ambiguous: '歧义', adversarial: '对抗' };
const verdictChip: Record<string, { cls: string; text: string }> = {
  reject: { cls: 'critical', text: '🔴 有新增失败' },
  review: { cls: 'missing', text: '⚠️ 需复核' },
  adopt: { cls: 'ok', text: '✓ 建议采用' },
  same: { cls: 'gray', text: '无差异' },
};

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  ensureSeeded();
  const { id } = await params;
  const task = getTask(Number(id));
  if (!task) notFound();
  const samples = listSamples(task.id);
  const versions = listVersions(task.id);
  const runs = listRuns(task.id);
  const requirements: StoredRequirements | null = task.requirements_json ? JSON.parse(task.requirements_json) : null;

  return (
    <div>
      <h1>{task.name}</h1>
      <p className="page-desc">
        <Link href="/">← 任务列表</Link> ｜ 流程：① 确认验收标准 → ② 准备测试集 → ③ 配置版本 → ④ 运行看报告 ｜{' '}
        <a href={`/api/tasks/${task.id}/export`}>导出测试资产 (JSON)</a>
      </p>

      <h2 className="mt0">① 验收标准（要求引导）</h2>
      <p className="page-desc" style={{ marginTop: 0 }}>
        把自然语言业务要求变成可确认的检查项——确认后成为本任务的验收依据，出现在每份报告里。
      </p>
      {requirements ? <RequirementsView r={requirements} /> : <RequirementsWizard taskId={task.id} initial={null} />}
      {requirements && (
        <details className="card">
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>重新引导 / 修改要求</summary>
          <div style={{ paddingTop: 8 }}>
            <RequirementsWizard key="re" taskId={task.id} initial={requirements} />
          </div>
        </details>
      )}

      <h2>② 测试集（{samples.length} 条，启用 {samples.filter((s) => s.enabled).length} 条）</h2>
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
            <th style={{ width: 210 }}>参考答案</th>
            <th style={{ width: 150 }}>关键要求</th>
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
                  {s.origin === 'real-error' && (
                    <>
                      {' '}
                      <span className="badge critical">线上错误</span>
                    </>
                  )}
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
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>＋ 新增样例</summary>
        <div style={{ paddingTop: 8 }}>
          <SampleForm taskId={task.id} />
        </div>
      </details>
      <details className="card">
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>＋ 从线上坏输出入库（真实错误 → 回归用例，零运维积累）</summary>
        <div style={{ paddingTop: 8 }}>
          <p className="page-desc" style={{ margin: '0 0 4px' }}>
            线上发现一条错误输出？把输入和「本应正确的答案」填进来，它从此成为回归测试的一部分，每次改版自动复检。
          </p>
          <SampleForm taskId={task.id} defaultOrigin="real-error" />
        </div>
      </details>

      <h2>③ 版本配置（{versions.length} 个）</h2>
      <p className="page-desc">对比时任选两个：一个作基线（现状），一个作候选（改版）。改提示词就在这里改。</p>
      <div className="grid-2">
        {versions.map((v) => (
          <VersionCard
            key={v.id}
            v={{ id: v.id, name: v.name, model: v.model, system_prompt: v.system_prompt, user_template: v.user_template, temperature: v.temperature, max_tokens: v.max_tokens }}
          />
        ))}
      </div>

      <h2>④ 运行历史（{runs.length} 次）</h2>
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
              <th style={{ width: 130 }}>结论</th>
              <th style={{ width: 150 }}>时间</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const stats = r.stats_json ? JSON.parse(r.stats_json) as { verdictLevel?: string } : null;
              const chip = stats?.verdictLevel ? verdictChip[stats.verdictLevel] : null;
              return (
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
                    {r.status === 'done' ? (
                      chip ? <span className={`badge ${chip.cls}`}>{chip.text}</span> : '—'
                    ) : (
                      <>
                        <span className={`status-dot ${r.status}`} />
                        {r.status === 'error' ? '出错' : r.status}
                      </>
                    )}
                  </td>
                  <td className="muted">{r.created_at}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="toolbar" style={{ marginTop: 18 }}>
        <Link className="btn primary" href={`/tasks/${task.id}/runs/new`}>
          发起对比运行 →
        </Link>
      </div>
    </div>
  );
}
