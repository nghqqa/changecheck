import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getRun, getTask, getVersion } from '@/lib/db';
import { getRunReport } from '@/lib/runs';
import type { ReportData, SampleReport } from '@/lib/kernel/report';
import RunPoller from '@/components/RunPoller';

export const dynamic = 'force-dynamic';

const catLabel: Record<string, string> = { normal: '正常', missing: '缺失', ambiguous: '歧义', adversarial: '对抗' };
const fmtCost = (c: number | null) => (c == null ? '未知' : `¥${c.toFixed(4)}`);

function CaseDetails({ s }: { s: SampleReport }) {
  return (
    <details className={`case ${s.criticalViolation ? 'critical' : ''}`}>
      <summary>
        {s.criticalViolation ? <span className="badge critical">🔴 违反关键要求</span> : <span className="badge gray">⚠️ 失败</span>}
        <span className={`badge ${s.category}`}>{catLabel[s.category] ?? s.category}</span>
        <span className="mono">#{s.sampleId}</span>
        <span className="muted" style={{ flex: 1, minWidth: 200 }}>
          {s.note}
        </span>
      </summary>
      <div className="body">
        <div className="io">
          <b>通知原文</b>：{s.input}
        </div>
        <div className="io mono">
          <b>参考答案</b>：{JSON.stringify(s.reference)}
        </div>
        <div className="io mono">
          <b>基线输出</b>：{s.baselineOutput}
        </div>
        <div className="io mono" style={{ background: 'var(--red-soft)' }}>
          <b>候选输出</b>：{s.candidateOutput}
        </div>
        {s.fails.length > 0 && (
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th style={{ width: 100 }}>字段</th>
                <th style={{ width: 170 }}>违反规则</th>
                <th>期望</th>
                <th>实际</th>
                <th style={{ width: 50 }}>关键</th>
              </tr>
            </thead>
            <tbody>
              {s.fails.map((f, i) => (
                <tr key={i}>
                  <td className="mono">{f.field}</td>
                  <td>{f.rule}</td>
                  <td className="mono">{f.expected}</td>
                  <td className="mono">{f.actual}</td>
                  <td>{f.critical ? '🔴' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {s.error && <p style={{ color: 'var(--red)' }}>错误：{s.error}</p>}
      </div>
    </details>
  );
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(Number(id));
  if (!run) notFound();
  const task = getTask(run.task_id);
  const base = getVersion(run.baseline_version_id);
  const cand = getVersion(run.candidate_version_id);
  const report: ReportData | null = run.stats_json ? JSON.parse(run.stats_json) : null;

  return (
    <div>
      <h1>
        运行 #{run.id} 报告{task ? ` · ${task.name}` : ''}
      </h1>
      <p className="page-desc">
        <Link href={`/tasks/${run.task_id}`}>← 返回任务</Link> ｜ 基线：{base?.name ?? '?'} → 候选：{cand?.name ?? '?'} ｜{' '}
        {run.mode === 'mock' ? 'mock 演示' : '真实 API'} × {run.reps} 次 ｜ {run.created_at}
        {report ? (
          <>
            {' '}
            ｜ <a href={`/api/runs/${run.id}/report`}>导出 Markdown 报告</a>
          </>
        ) : null}
      </p>

      {run.status !== 'done' && run.status !== 'error' && <RunPoller runId={run.id} />}
      {run.status === 'error' && <div className="banner reject">运行失败：{run.error}</div>}

      {report && (
        <>
          <div className={`banner ${report.verdictLevel}`}>{report.verdict}</div>

          <table>
            <thead>
              <tr>
                <th>版本</th>
                <th className="num">通过</th>
                <th className="num">关键要求违反</th>
                <th className="num">调用失败</th>
                <th className="num">费用(估)</th>
                <th className="num">平均耗时</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{report.baseline.label}（基线）</td>
                <td className="num">
                  {report.baseline.passCount}/{report.total}
                </td>
                <td className="num">{report.baseline.criticalCount}</td>
                <td className="num">{report.baseline.callErrors}</td>
                <td className="num">{fmtCost(report.baseline.cost)}</td>
                <td className="num">{report.baseline.avgLat != null ? `${report.baseline.avgLat} ms` : '未知'}</td>
              </tr>
              <tr style={{ background: 'var(--brand-soft)' }}>
                <td>
                  <b>{report.candidate.label}（候选）</b>
                </td>
                <td className="num">
                  <b>{report.candidate.passCount}/{report.total}</b>
                </td>
                <td className="num" style={{ color: report.candidate.criticalCount > 0 ? 'var(--red)' : undefined }}>
                  {report.candidate.criticalCount}
                </td>
                <td className="num">{report.candidate.callErrors}</td>
                <td className="num">{fmtCost(report.candidate.cost)}</td>
                <td className="num">{report.candidate.avgLat != null ? `${report.candidate.avgLat} ms` : '未知'}</td>
              </tr>
            </tbody>
          </table>

          <p className="page-desc" style={{ marginTop: 10 }}>
            <b>改版差异</b>：新增失败 <b style={{ color: 'var(--red)' }}>{report.diff.newFailures}</b>（关键 {report.diff.newFailCritical}）｜ 新增通过 {report.diff.newPasses} ｜ 皆失败 {report.diff.bothFail} ｜ 皆通过 {report.diff.bothPass}
          </p>

          <table>
            <thead>
              <tr>
                <th>类别</th>
                <th className="num">条数</th>
                <th className="num">基线通过</th>
                <th className="num">候选通过</th>
                <th className="num">新增失败</th>
              </tr>
            </thead>
            <tbody>
              {report.byCategory.map((c) => (
                <tr key={c.category}>
                  <td>{c.label}</td>
                  <td className="num">{c.total}</td>
                  <td className="num">{c.baselinePass}</td>
                  <td className="num">{c.candidatePass}</td>
                  <td className="num" style={{ color: c.newFailures > 0 ? 'var(--red)' : undefined }}>
                    {c.newFailures}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>一、新增失败（最优先 · {report.newFailureList.length} 条）</h2>
          <p className="page-desc">基线通过、候选失败 = 本次改版引入的退步。点开看字段级证据。</p>
          {report.newFailureList.length === 0 && <p className="page-desc">（无）</p>}
          {report.newFailureList.map((s) => (
            <CaseDetails key={String(s.sampleId)} s={s} />
          ))}

          <h2>二、新增通过（{report.newPassList.length} 条）</h2>
          {report.newPassList.length === 0 ? (
            <p className="page-desc">（无）</p>
          ) : (
            <p className="page-desc">
              {report.newPassList.map((s) => (
                <span key={String(s.sampleId)} className="badge ok" style={{ marginRight: 8 }}>
                  #{s.sampleId} {catLabel[s.category]} ✓
                </span>
              ))}
            </p>
          )}

          <h2>三、两版皆失败（{report.bothFailList.length} 条）—— 疑似检查器误报或双版皆坏，需人工复核</h2>
          {report.bothFailList.map((s) => (
            <CaseDetails key={String(s.sampleId)} s={s} />
          ))}

          <h2>四、近似通过复核清单（{report.nearList.length} 条）</h2>
          {report.nearList.length === 0 ? (
            <p className="page-desc">（无）</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: 80 }}>样例</th>
                  <th style={{ width: 100 }}>字段</th>
                  <th>期望</th>
                  <th>实际（判为通过）</th>
                </tr>
              </thead>
              <tbody>
                {report.nearList.map((n, i) => (
                  <tr key={i}>
                    <td className="mono">#{n.sampleId}</td>
                    <td className="mono">{n.field}</td>
                    <td className="mono">{n.expected}</td>
                    <td className="mono">{n.actual}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className="muted" style={{ marginTop: 24, fontSize: 12 }}>
            计价：{report.meta.pricingText}。结论保留「需人工确认」状态；本报告由 ChangeCheck 内核自动生成，逐条证据存于 run_items，可随时重算。
          </p>
        </>
      )}
    </div>
  );
}
