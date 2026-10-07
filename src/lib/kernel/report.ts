// 内核·回归报告：结构化数据 ReportData（UI 渲染用）+ Markdown 渲染（导出用）。
// 组织原则：新增失败最优先，关键要求标红，结论保留「需人工确认」状态。
import type { ExecRecord, KernelSample, VersionConfig } from './executor';
import { checkRecord, type CheckResult } from './checker';

export interface SampleReport {
  sampleId: string | number;
  category: string;
  note: string;
  input: string;
  reference: Record<string, string>;
  baselineOutput: string; // JSON 字符串或原文截断
  candidateOutput: string;
  criticalViolation: boolean;
  fails: { field: string; rule: string; expected: string | null; actual: string | null; critical: boolean }[];
  error: string | null;
}

export interface VersionStats {
  label: string;
  passCount: number;
  criticalCount: number;
  callErrors: number;
  cost: number | null;
  tokens: number;
  avgLat: number | null;
}

export interface ReportData {
  verdict: string;
  verdictLevel: 'reject' | 'review' | 'adopt' | 'same';
  total: number;
  baseline: VersionStats;
  candidate: VersionStats;
  diff: { newFailures: number; newFailCritical: number; newPasses: number; bothFail: number; bothPass: number };
  byCategory: { category: string; label: string; total: number; baselinePass: number; candidatePass: number; newFailures: number }[];
  newFailureList: SampleReport[];
  newPassList: { sampleId: string | number; category: string; note: string }[];
  bothFailList: SampleReport[];
  nearList: { sampleId: string | number; field: string; expected: string; actual: string }[];
  meta: { mode: string; model: string; reps: number; timeText: string; pricingText: string; requirements?: { text: string; items: { id: string; label: string; confirmed: boolean }[] } };
}

interface Agg {
  pass: boolean;
  criticalViolation: boolean;
  checks: { record: ExecRecord; check: CheckResult }[];
  worst?: { record: ExecRecord; check: CheckResult };
}

function aggregate(records: ExecRecord[], sample: KernelSample): Agg {
  const checks = records.map((r) => ({ record: r, check: checkRecord(sample, r) }));
  const passCount = checks.filter((c) => c.check.pass).length;
  const worst =
    checks.find((c) => !c.check.pass && c.check.criticalViolation) ||
    checks.find((c) => !c.check.pass) ||
    checks.find((c) => c.check.fieldResults.some((f) => f.status === 'near')) ||
    checks[0];
  return {
    pass: passCount * 2 > checks.length,
    criticalViolation: checks.some((c) => c.check.criticalViolation),
    checks,
    worst,
  };
}

function versionStats(records: ExecRecord[], aggById: Map<string, Agg>, samples: KernelSample[], label: string): VersionStats {
  const passCount = samples.filter((s) => aggById.get(String(s.id))?.pass).length;
  const criticalCount = samples.filter((s) => aggById.get(String(s.id))?.criticalViolation).length;
  const known = records.every((r) => r.costCNY != null);
  const tokens = records.reduce((a, r) => a + (r.usage ? r.usage.promptTokens + r.usage.completionTokens : 0), 0);
  const lat = records.filter((r) => r.latencyMs != null).map((r) => r.latencyMs as number);
  return {
    label,
    passCount,
    criticalCount,
    callErrors: records.filter((r) => r.error).length,
    cost: known ? records.reduce((a, r) => a + (r.costCNY || 0), 0) : null,
    tokens,
    avgLat: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null,
  };
}

function outText(rec?: ExecRecord): string {
  if (!rec) return '(无记录)';
  if (rec.parsed) return JSON.stringify(rec.parsed);
  return rec.error ? `调用失败: ${rec.error}` : rec.raw.slice(0, 120) || '(空输出)';
}

function toSampleReport(s: KernelSample, cand: Agg, base: Agg): SampleReport {
  const fails = (cand.worst?.check.fieldResults ?? []).filter((f) => f.status !== 'pass');
  return {
    sampleId: s.id,
    category: s.category,
    note: s.note ?? '',
    input: s.input,
    reference: s.reference,
    baselineOutput: outText(base.worst?.record),
    candidateOutput: outText(cand.worst?.record),
    criticalViolation: cand.criticalViolation,
    fails: fails.map((f) => ({ field: f.field, rule: f.rule, expected: f.expected, actual: f.actual, critical: f.critical })),
    error: cand.worst?.check.error ?? null,
  };
}

const CAT_LABEL: Record<string, string> = { normal: '正常', missing: '缺失', ambiguous: '歧义', adversarial: '对抗' };

export function buildReportData(params: {
  taskName: string;
  samples: KernelSample[];
  baselineRecords: ExecRecord[];
  candidateRecords: ExecRecord[];
  baselineVersion: VersionConfig;
  candidateVersion: VersionConfig;
  meta: ReportData['meta'];
}): ReportData {
  const { samples, baselineRecords, candidateRecords } = params;
  const baseAgg = new Map<string, Agg>();
  const candAgg = new Map<string, Agg>();
  for (const s of samples) {
    baseAgg.set(String(s.id), aggregate(baselineRecords.filter((r) => String(r.sampleId) === String(s.id)), s));
    candAgg.set(String(s.id), aggregate(candidateRecords.filter((r) => String(r.sampleId) === String(s.id)), s));
  }
  const P = (s: KernelSample) => baseAgg.get(String(s.id))?.pass;
  const C = (s: KernelSample) => candAgg.get(String(s.id))?.pass;

  const newFailures = samples.filter((s) => P(s) && !C(s));
  const newPasses = samples.filter((s) => !P(s) && C(s));
  const bothFail = samples.filter((s) => !P(s) && !C(s));
  const bothPass = samples.filter((s) => P(s) && C(s));
  const newFailCritical = newFailures.filter((s) => candAgg.get(String(s.id))?.criticalViolation);

  const baseStats = versionStats(baselineRecords, baseAgg, samples, params.baselineVersion.name);
  const candStats = versionStats(candidateRecords, candAgg, samples, params.candidateVersion.name);

  // punchline：把"表面收益"与"新增失败"放进同一句话 —— 反差即意义
  const pctDelta = (b: number | null, c: number | null): string | null => {
    if (b == null || c == null || b <= 0) return null;
    const p = Math.round(((c - b) / b) * 100);
    if (p === 0) return null;
    return p > 0 ? `+${p}%` : `${p}%`;
  };
  const perfParts = [pctDelta(baseStats.cost, candStats.cost), pctDelta(baseStats.avgLat, candStats.avgLat)]
    .filter((x): x is string => x != null)
    .map((x, i) => `${i === 0 ? '费用' : '耗时'}${x}`);
  const perfText = perfParts.length ? `，${perfParts.join('、')}` : '';

  let verdict: string;
  let verdictLevel: ReportData['verdictLevel'];
  if (newFailCritical.length > 0) {
    verdict = `候选通过 ${candStats.passCount}/${samples.length}（基线 ${baseStats.passCount}/${samples.length}${perfText}）—— 但抓到 ${newFailures.length} 条新增失败，其中 ${newFailCritical.length} 条违反关键要求。表面收益掩盖不了退步：不建议直接采用，修复后复跑确认新增失败清零。`;
    verdictLevel = 'reject';
  } else if (newFailures.length > 0) {
    verdict = `候选通过 ${candStats.passCount}/${samples.length}（基线 ${baseStats.passCount}/${samples.length}${perfText}）—— 有 ${newFailures.length} 条新增失败（未违反关键要求），复核后可采用。`;
    verdictLevel = 'review';
  } else if (newPasses.length > 0) {
    verdict = `无新增失败，且修复 ${newPasses.length} 条${perfText ? `，${perfParts.join('、')}` : ''} —— 建议采用（最终由人工确认）。`;
    verdictLevel = 'adopt';
  } else {
    verdict = `两版结果无差异${perfText} —— 维持现状，改版收益未体现。`;
    verdictLevel = 'same';
  }

  const nearList = samples.flatMap((s) =>
    (candAgg.get(String(s.id))?.checks ?? []).flatMap((c) =>
      c.check.fieldResults.filter((f) => f.status === 'near').map((f) => ({ sampleId: s.id, field: f.field, expected: f.expected ?? '', actual: f.actual ?? '' }))
    )
  );

  return {
    verdict,
    verdictLevel,
    total: samples.length,
    baseline: baseStats,
    candidate: candStats,
    diff: { newFailures: newFailures.length, newFailCritical: newFailCritical.length, newPasses: newPasses.length, bothFail: bothFail.length, bothPass: bothPass.length },
    byCategory: [...new Set(samples.map((s) => s.category))].map((c) => {
      const cs = samples.filter((s) => s.category === c);
      return {
        category: c,
        label: CAT_LABEL[c] ?? c,
        total: cs.length,
        baselinePass: cs.filter((s) => P(s)).length,
        candidatePass: cs.filter((s) => C(s)).length,
        newFailures: newFailures.filter((s) => s.category === c).length,
      };
    }),
    newFailureList: newFailures.map((s) => toSampleReport(s, candAgg.get(String(s.id))!, baseAgg.get(String(s.id))!)),
    newPassList: newPasses.map((s) => ({ sampleId: s.id, category: s.category, note: s.note ?? '' })),
    bothFailList: bothFail.map((s) => toSampleReport(s, candAgg.get(String(s.id))!, baseAgg.get(String(s.id))!)),
    nearList,
    meta: params.meta,
  };
}

const esc = (s: unknown) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const fmtCost = (c: number | null) => (c == null ? '未知' : `¥${c.toFixed(4)}`);

export function renderMarkdown(taskName: string, d: ReportData): string {
  const L: string[] = [];
  L.push(`# ${taskName} · 改版对比报告`);
  L.push('');
  L.push(`- 模式：**${d.meta.mode === 'mock' ? 'mock 模拟（演示链路）' : '真实 API'}** ｜ 模型：${d.meta.model} ｜ 样例：${d.total} 条 ｜ 每条重复 ${d.meta.reps} 次`);
  L.push(`- 基线：${d.baseline.label} ｜ 候选：${d.candidate.label}`);
  L.push(`- 生成时间：${d.meta.timeText}`);
  if (d.meta.requirements?.items?.some((i) => i.confirmed)) {
    L.push('');
    L.push(`**验收依据**（用户确认的检查项，源自要求描述：「${d.meta.requirements.text}」）：`);
    for (const i of d.meta.requirements.items.filter((x) => x.confirmed)) L.push(`- ${i.id} ${i.label}`);
  }
  L.push('');
  L.push('## 结论');
  L.push('');
  L.push(d.verdict);
  L.push('');
  L.push('## 总体对比');
  L.push('');
  L.push('| 版本 | 通过 | 关键要求违反 | 调用失败 | 费用(估) | 平均耗时 |');
  L.push('|---|---|---|---|---|---|');
  L.push(`| ${d.baseline.label} | ${d.baseline.passCount}/${d.total} | ${d.baseline.criticalCount} | ${d.baseline.callErrors} | ${fmtCost(d.baseline.cost)} | ${d.baseline.avgLat != null ? d.baseline.avgLat + ' ms' : '未知'} |`);
  L.push(`| ${d.candidate.label} | ${d.candidate.passCount}/${d.total} | ${d.candidate.criticalCount} | ${d.candidate.callErrors} | ${fmtCost(d.candidate.cost)} | ${d.candidate.avgLat != null ? d.candidate.avgLat + ' ms' : '未知'} |`);
  L.push('');
  L.push(`**改版差异**：新增失败 ${d.diff.newFailures}（关键 ${d.diff.newFailCritical}）｜ 新增通过 ${d.diff.newPasses} ｜ 皆失败 ${d.diff.bothFail} ｜ 皆通过 ${d.diff.bothPass}`);
  L.push('');
  L.push('## 分类统计');
  L.push('');
  L.push('| 类别 | 条数 | 基线通过 | 候选通过 | 新增失败 |');
  L.push('|---|---|---|---|---|');
  for (const c of d.byCategory) L.push(`| ${c.label} | ${c.total} | ${c.baselinePass} | ${c.candidatePass} | ${c.newFailures} |`);
  L.push('');
  L.push(`## 一、新增失败（最优先 · ${d.newFailureList.length} 条）`);
  L.push('');
  for (const s of d.newFailureList) {
    L.push(`#### ${s.sampleId} · ${s.category} ｜ ${s.criticalViolation ? '🔴 **违反关键要求**' : '⚠️ 失败'}`);
    if (s.note) L.push(`> ${s.note}`);
    L.push('');
    L.push(`- **通知原文**：${s.input}`);
    L.push(`- **参考答案**：\`${JSON.stringify(s.reference)}\``);
    L.push(`- **基线输出**：\`${esc(s.baselineOutput)}\``);
    L.push(`- **候选输出**：\`${esc(s.candidateOutput)}\``);
    if (s.fails.length) {
      L.push('');
      L.push('| 字段 | 规则 | 期望 | 实际 | 关键 |');
      L.push('|---|---|---|---|---|');
      for (const f of s.fails) L.push(`| ${f.field} | ${esc(f.rule)} | ${esc(f.expected)} | ${esc(f.actual)} | ${f.critical ? '🔴' : ''} |`);
    }
    if (s.error) L.push(`- **错误**：${esc(s.error)}`);
    L.push('');
  }
  L.push(`## 二、新增通过（${d.newPassList.length} 条）`);
  L.push('');
  for (const s of d.newPassList) L.push(`- **${s.sampleId} · ${s.category}**：${s.note}`);
  L.push('');
  L.push(`## 三、两版皆失败（${d.bothFailList.length} 条）—— 疑似检查器误报或双版皆坏，需人工复核`);
  L.push('');
  for (const s of d.bothFailList) {
    L.push(`#### ${s.sampleId} · ${s.category}`);
    L.push(`- 原文：${s.input}`);
    L.push(`- 基线输出：\`${esc(s.baselineOutput)}\` ｜ 候选输出：\`${esc(s.candidateOutput)}\``);
    L.push('');
  }
  L.push(`## 四、近似通过复核清单（${d.nearList.length} 条）`);
  L.push('');
  for (const n of d.nearList) L.push(`- ${n.sampleId} · ${n.field}：期望 \`${esc(n.expected)}\`，实际 \`${esc(n.actual)}\``);
  L.push('');
  L.push('---');
  L.push('*本报告由 ChangeCheck 生成，结论保留「需人工确认」状态。*');
  return L.join('\n');
}
