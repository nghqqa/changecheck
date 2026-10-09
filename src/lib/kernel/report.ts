// 内核·回归报告：结构化数据 ReportData（UI 渲染用）+ Markdown 渲染（导出用）。
// 组织原则：新增失败与新增关键违规最优先；结论保留「需人工确认」状态。
// 判定口径（v0.5）：整条样例按多数决定通过，但【新增关键违规】独立参与采用判断——
// 候选出现基线没有的关键违规（无论该样例多数决是否通过）即拒绝采用；
// 基线普通失败→候选关键失败同样视为关键层面的退步。
import type { ExecRecord, KernelSample, VersionConfig } from './executor';
import { checkRecord, DEFAULT_CHECK_OPTIONS, type CheckOptions, type CheckResult } from './checker';

export interface SampleReport {
  sampleId: string | number;
  category: string;
  note: string;
  input: string;
  reference: Record<string, string>;
  baselineOutput: string; // JSON 字符串或原文截断
  candidateOutput: string;
  criticalViolation: boolean;
  /** 退步类型标记：整条退步 / 新增关键违规 / 关键违规被多数决掩盖 / 偶发坏输出（解析/调用异常） */
  flags: { newFail: boolean; newCritical: boolean; hiddenByMajority: boolean; newStructural: boolean };
  fails: { field: string; rule: string; expected: string | null; actual: string | null; critical: boolean }[];
  error: string | null;
}

export interface VersionStats {
  label: string;
  passCount: number;
  criticalCount: number;
  callErrors: number;
  cost: number | null;
  /** 费用可算程度：all=全部已知；partial=部分调用缺用量（合计仅含已知部分）；none=全部未知 */
  costKnown: 'all' | 'partial' | 'none';
  tokens: number;
  avgLat: number | null;
}

export interface ReportData {
  verdict: string;
  verdictLevel: 'reject' | 'review' | 'adopt' | 'same' | 'error';
  total: number;
  baseline: VersionStats;
  candidate: VersionStats;
  diff: {
    newFailures: number;
    newCriticalViolations: number;
    /** 新增关键违规中被多数决判通过的条数（最容易被忽视的退步） */
    hiddenCritical: number;
    /** 候选出现、基线没有的偶发坏输出样例数（解析失败/空输出/调用异常）——稳定性退步，至少需复核 */
    newStructural: number;
    newPasses: number;
    bothFail: number;
    bothPass: number;
  };
  byCategory: { category: string; label: string; total: number; baselinePass: number; candidatePass: number; newFailures: number }[];
  /** 新增退步 = 整条退步（基线过→候选败）∪ 新增关键违规（含升级与被掩盖的） */
  newFailureList: SampleReport[];
  newPassList: { sampleId: string | number; category: string; note: string }[];
  bothFailList: SampleReport[];
  nearList: { sampleId: string | number; field: string; expected: string; actual: string }[];
  /** 归一化标记：本报告生成于旧判定口径，读取时已补齐新字段 */
  _legacyNormalized?: boolean;
  meta: {
    mode: string;
    model: string;
    reps: number;
    timeText: string;
    pricingText: string;
    checkRules?: CheckOptions;
    requirements?: { text: string; items: { id: string; label: string; confirmed: boolean }[] };
  };
}

interface Agg {
  pass: boolean;
  criticalViolation: boolean;
  /** 出现过关键违规的字段集合（任意一次重复）——用于字段级新旧对比 */
  criticalFields: Set<string>;
  /** 结构性失败次数（调用异常/解析失败/空输出）——稳定性问题，与业务违规分开对比 */
  structuralFails: number;
  checks: { record: ExecRecord; check: CheckResult }[];
  worst?: { record: ExecRecord; check: CheckResult };
}

function aggregate(records: ExecRecord[], sample: KernelSample, opts: CheckOptions): Agg {
  const checks = records.map((r) => ({ record: r, check: checkRecord(sample, r, opts) }));
  const passCount = checks.filter((c) => c.check.pass).length;
  const criticalFields = new Set<string>();
  for (const c of checks) {
    for (const f of c.check.fieldResults) {
      if (f.status === 'fail' && f.critical) criticalFields.add(f.field);
    }
  }
  const structuralFails = checks.filter((c) => c.check.structural).length;
  const worst =
    checks.find((c) => !c.check.pass && c.check.criticalViolation) ||
    checks.find((c) => !c.check.pass && c.check.structural) ||
    checks.find((c) => !c.check.pass) ||
    checks.find((c) => c.check.fieldResults.some((f) => f.status === 'near')) ||
    checks[0];
  return {
    pass: passCount * 2 > checks.length,
    criticalViolation: checks.some((c) => c.check.criticalViolation),
    criticalFields,
    structuralFails,
    checks,
    worst,
  };
}

function versionStats(records: ExecRecord[], aggById: Map<string, Agg>, samples: KernelSample[], label: string): VersionStats {
  const passCount = samples.filter((s) => aggById.get(String(s.id))?.pass).length;
  const criticalCount = samples.filter((s) => aggById.get(String(s.id))?.criticalViolation).length;
  const costs = records.map((r) => r.costCNY).filter((c) => c != null) as number[];
  const knownCount = costs.length;
  const tokens = records.reduce((a, r) => a + (r.usage ? r.usage.promptTokens + r.usage.completionTokens : 0), 0);
  const lat = records.filter((r) => r.latencyMs != null).map((r) => r.latencyMs as number);
  return {
    label,
    passCount,
    criticalCount,
    callErrors: records.filter((r) => r.error).length,
    cost: costs.reduce((a, b) => a + b, 0),
    costKnown: knownCount === records.length ? 'all' : knownCount > 0 ? 'partial' : 'none',
    tokens,
    avgLat: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null,
  };
}

function outText(rec?: ExecRecord): string {
  if (!rec) return '(无记录)';
  if (rec.parsed) return JSON.stringify(rec.parsed);
  return rec.error ? `调用失败: ${rec.error}` : rec.raw.slice(0, 120) || '(空输出)';
}

function toSampleReport(s: KernelSample, cand: Agg, base: Agg, flags: SampleReport['flags']): SampleReport {
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
    flags,
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
  checkOpts?: CheckOptions;
  meta: ReportData['meta'];
}): ReportData {
  const { samples, baselineRecords, candidateRecords } = params;
  const opts = params.checkOpts ?? DEFAULT_CHECK_OPTIONS;
  const baseAgg = new Map<string, Agg>();
  const candAgg = new Map<string, Agg>();
  for (const s of samples) {
    baseAgg.set(String(s.id), aggregate(baselineRecords.filter((r) => String(r.sampleId) === String(s.id)), s, opts));
    candAgg.set(String(s.id), aggregate(candidateRecords.filter((r) => String(r.sampleId) === String(s.id)), s, opts));
  }
  const P = (s: KernelSample) => baseAgg.get(String(s.id))?.pass;
  const C = (s: KernelSample) => candAgg.get(String(s.id))?.pass;
  // 字段级关键违规集合：候选出现的、基线没有的关键违规字段（交换盲区：旧错日期→新错时间也能抓到）
  const BCf = (s: KernelSample) => baseAgg.get(String(s.id))?.criticalFields ?? new Set<string>();
  const CCf = (s: KernelSample) => candAgg.get(String(s.id))?.criticalFields ?? new Set<string>();
  const hasNewCriticalField = (s: KernelSample) => {
    const cf = CCf(s);
    if (cf.size === 0) return false;
    const bf = BCf(s);
    for (const f of cf) if (!bf.has(f)) return true;
    return false;
  };

  const newFailures = samples.filter((s) => P(s) && !C(s));
  // 新增关键违规（字段级）：无论整条多数决是否通过、无论是否同时修好了别的字段
  const newCriticalSamples = samples.filter(hasNewCriticalField);
  const hiddenCriticalSamples = newCriticalSamples.filter((s) => C(s));
  // 偶发坏输出（稳定性）：候选出现解析失败/空输出/调用异常而基线没有 —— 即使多数决整条通过也要复核
  const newStructuralSamples = samples.filter((s) => {
    const agg = candAgg.get(String(s.id));
    if (!agg || agg.structuralFails === 0) return false;
    return (baseAgg.get(String(s.id))?.structuralFails ?? 0) === 0;
  });
  const newPasses = samples.filter((s) => !P(s) && C(s));
  const bothFail = samples.filter((s) => !P(s) && !C(s));
  const bothPass = samples.filter((s) => P(s) && C(s));

  const baseStats = versionStats(baselineRecords, baseAgg, samples, params.baselineVersion.name);
  const candStats = versionStats(candidateRecords, candAgg, samples, params.candidateVersion.name);

  // punchline：把"表面收益"与"新增失败"放进同一句话 —— 反差即意义。
  // 费用/耗时各自独立标注，缺数据的一侧不产出文字（避免"仅耗时变化被写成费用变化"）。
  const pctDelta = (b: number | null, c: number | null): string | null => {
    if (b == null || c == null || b <= 0) return null;
    const p = Math.round(((c - b) / b) * 100);
    if (p === 0) return null;
    return p > 0 ? `+${p}%` : `${p}%`;
  };
  const perfParts: string[] = [];
  const costDelta = pctDelta(baseStats.costKnown !== 'none' ? baseStats.cost : null, candStats.costKnown !== 'none' ? candStats.cost : null);
  if (baseStats.costKnown === 'all' && candStats.costKnown === 'all' && costDelta) perfParts.push(`费用${costDelta}`);
  const latDelta = pctDelta(baseStats.avgLat, candStats.avgLat);
  if (latDelta) perfParts.push(`耗时${latDelta}`);
  const perfText = perfParts.length ? `，${perfParts.join('、')}` : '';

  // 可信度闸门：调用大面积失败（鉴权失效/网络/限流）时，"全部失败"在统计上与"无差异"无法区分，
  // 必须显式标记结果不可信，而不是放行一条误导性的"无差异/建议采用"结论。
  const totalCalls = baselineRecords.length + candidateRecords.length;
  const failedCalls = baselineRecords.filter((r) => r.error).length + candidateRecords.filter((r) => r.error).length;
  const unreliable = totalCalls > 0 && failedCalls / totalCalls >= 0.5;

  // 采用判断：新增关键违规一票否决（字段级，独立于整条多数决）；其余新增失败需复核
  let verdict: string;
  let verdictLevel: ReportData['verdictLevel'];
  if (unreliable) {
    verdict = `执行异常：${failedCalls}/${totalCalls} 次调用失败（鉴权失效、网络或限流），本次没有得到有效的评测结果，结论不可信——失败样例与"无差异"无法区分。请检查 DEEPSEEK_API_KEY / 网络 / 限流后重跑。`;
    verdictLevel = 'error';
  } else if (newCriticalSamples.length > 0) {
    const hiddenNote = hiddenCriticalSamples.length > 0 ? `，其中 ${hiddenCriticalSamples.length} 条因多数决整条仍判通过、极易被忽视` : '';
    const extra = newFailures.length > newCriticalSamples.filter((s) => P(s)).length ? `；另有 ${newFailures.length - newCriticalSamples.filter((s) => P(s)).length} 条普通新增失败` : '';
    verdict = `候选通过 ${candStats.passCount}/${samples.length}（基线 ${baseStats.passCount}/${samples.length}${perfText}）—— 但抓到 ${newCriticalSamples.length} 条新增关键违规${hiddenNote}${extra}。表面收益掩盖不了退步：不建议采用，修复后复跑确认新增失败清零。`;
    verdictLevel = 'reject';
  } else if (newStructuralSamples.length > 0 && newFailures.length === 0) {
    const reps = candidateRecords.filter((r) => r.parseError && !r.error).length;
    verdict = `候选通过 ${candStats.passCount}/${samples.length}（基线 ${baseStats.passCount}/${samples.length}${perfText}）—— 但有 ${newStructuralSamples.length} 条样例出现偶发坏输出（解析失败/空输出/调用异常，基线无此类问题${reps ? `，本轮共 ${reps} 次输出无法解析` : ''}），稳定性存疑：复核并建议复跑确认。`;
    verdictLevel = 'review';
  } else if (newFailures.length > 0) {
    const st = newStructuralSamples.length > 0 ? `；另有 ${newStructuralSamples.length} 条样例出现偶发坏输出（解析失败/调用异常），需一并复核` : '';
    verdict = `候选通过 ${candStats.passCount}/${samples.length}（基线 ${baseStats.passCount}/${samples.length}${perfText}）—— 有 ${newFailures.length} 条新增失败（未违反关键要求）${st}，复核后可采用。`;
    verdictLevel = 'review';
  } else if (newStructuralSamples.length > 0) {
    // 不可达（上方已覆盖 structural-only），防御性保留
    verdict = `有 ${newStructuralSamples.length} 条样例出现偶发坏输出，需复核复跑。`;
    verdictLevel = 'review';
  } else if (newPasses.length > 0) {
    verdict = `无新增失败与新增关键违规，且修复 ${newPasses.length} 条${perfText ? `，${perfParts.join('、')}` : ''} —— 建议采用（最终由人工确认）。`;
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

  // 退步清单 = 整条退步 ∪ 新增关键违规 ∪ 偶发坏输出（去重）；"两版皆失败"仅统计未构成退步升级的剩余样例
  const regressionSet = new Set<string>([...newFailures, ...newCriticalSamples, ...newStructuralSamples].map((s) => String(s.id)));
  const bothFailRemaining = bothFail.filter((s) => !regressionSet.has(String(s.id)));
  const regressions = samples.filter((s) => regressionSet.has(String(s.id)));
  const flagsOf = (s: KernelSample): SampleReport['flags'] => {
    const isStructural = newStructuralSamples.some((x) => String(x.id) === String(s.id));
    return {
      newFail: !!P(s) && !C(s),
      newCritical: hasNewCriticalField(s),
      hiddenByMajority: hasNewCriticalField(s) && !!C(s),
      newStructural: isStructural,
    };
  };

  return {
    verdict,
    verdictLevel,
    total: samples.length,
    baseline: baseStats,
    candidate: candStats,
    diff: {
      newFailures: newFailures.length,
      newCriticalViolations: newCriticalSamples.length,
      hiddenCritical: hiddenCriticalSamples.length,
      newStructural: newStructuralSamples.length,
      newPasses: newPasses.length,
      bothFail: bothFailRemaining.length,
      bothPass: bothPass.length,
    },
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
    newFailureList: regressions.map((s) => toSampleReport(s, candAgg.get(String(s.id))!, baseAgg.get(String(s.id))!, flagsOf(s))),
    newPassList: newPasses.map((s) => ({ sampleId: s.id, category: s.category, note: s.note ?? '' })),
    bothFailList: bothFailRemaining.map((s) => toSampleReport(s, candAgg.get(String(s.id))!, baseAgg.get(String(s.id))!, { newFail: false, newCritical: false, hiddenByMajority: false, newStructural: false })),
    nearList,
    meta: { ...params.meta, checkRules: opts },
  };
}

const esc = (s: unknown) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/**
 * 旧格式报告归一化：v0.5 之前的 stats_json 缺少新字段（字段级关键违规/偶发坏输出/费用可信度等），
 * 读取时统一补默认值——历史报告在新页面/导出里不出现 undefined，判定展示口径一致。
 */
export function normalizeReportData(raw: ReportData): ReportData {
  const d = raw as ReportData & { diff?: Record<string, unknown>; _legacyNormalized?: boolean };
  // 判定历史标记：生成于 v0.5 及以前（缺字段级关键违规/偶发坏输出/费用可信度等新字段）→ 页面与导出注明口径
  const legacy = (d.diff as { newCriticalViolations?: number } | undefined)?.newCriticalViolations === undefined || d.baseline?.costKnown === undefined;
  const diff = {
    newFailures: d.diff?.newFailures ?? 0,
    newCriticalViolations: d.diff?.newCriticalViolations ?? (d.diff as { newFailCritical?: number })?.newFailCritical ?? 0,
    hiddenCritical: d.diff?.hiddenCritical ?? 0,
    newStructural: d.diff?.newStructural ?? 0,
    newPasses: d.diff?.newPasses ?? 0,
    bothFail: d.diff?.bothFail ?? 0,
    bothPass: d.diff?.bothPass ?? 0,
  };
  const stat = (v: VersionStats): VersionStats => ({
    ...v,
    costKnown: v?.costKnown ?? (v?.cost != null ? 'all' : 'none'),
  });
  const flag = (f: SampleReport['flags'] | undefined, critical: boolean): SampleReport['flags'] =>
    f ?? { newFail: true, newCritical: critical, hiddenByMajority: false, newStructural: false };
  return {
    ...d,
    _legacyNormalized: legacy,
    diff,
    baseline: stat(d.baseline),
    candidate: stat(d.candidate),
    newFailureList: (d.newFailureList ?? []).map((s) => ({ ...s, flags: flag(s.flags, s.criticalViolation) })),
    bothFailList: (d.bothFailList ?? []).map((s) => ({ ...s, flags: s.flags ?? { newFail: false, newCritical: false, hiddenByMajority: false, newStructural: false } })),
    nearList: d.nearList ?? [],
    byCategory: d.byCategory ?? [],
    newPassList: d.newPassList ?? [],
    verdictLevel: d.verdictLevel ?? 'same',
    verdict: d.verdict ?? '',
  };
}
export function fmtCostFull(v: VersionStats): string {
  if (v.costKnown === 'none') return '未知';
  const text = `¥${(v.cost ?? 0).toFixed(4)}`;
  return v.costKnown === 'partial' ? `${text}（部分调用缺用量，仅计已知）` : text;
}

export function renderMarkdown(taskName: string, d: ReportData): string {
  const L: string[] = [];
  L.push(`# ${taskName} · 改版对比报告`);
  L.push('');
  L.push(`- 模式：**${d.meta.mode === 'mock' ? 'mock 模拟（演示链路）' : '真实 API'}** ｜ 模型：${d.meta.model} ｜ 样例：${d.total} 条 ｜ 每条重复 ${d.meta.reps} 次`);
  L.push(`- 基线：${d.baseline.label} ｜ 候选：${d.candidate.label}`);
  L.push(`- 生成时间：${d.meta.timeText}`);
  if ((d as ReportData & { _legacyNormalized?: boolean })._legacyNormalized) {
    L.push(`- ℹ️ 本报告生成于判定口径 v0.5 及以前，页面与导出的统计已按 v0.6 口径归一化显示（字段级关键违规对比、偶发坏输出、费用可信度）。`);
  }
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
  L.push(`| ${d.baseline.label} | ${d.baseline.passCount}/${d.total} | ${d.baseline.criticalCount} | ${d.baseline.callErrors} | ${fmtCostFull(d.baseline)} | ${d.baseline.avgLat != null ? d.baseline.avgLat + ' ms' : '未知'} |`);
  L.push(`| ${d.candidate.label} | ${d.candidate.passCount}/${d.total} | ${d.candidate.criticalCount} | ${d.candidate.callErrors} | ${fmtCostFull(d.candidate)} | ${d.candidate.avgLat != null ? d.candidate.avgLat + ' ms' : '未知'} |`);
  L.push('');
  L.push(`**改版差异**：新增失败 ${d.diff.newFailures} ｜ **新增关键违规 ${d.diff.newCriticalViolations}**（其中被多数决掩盖 ${d.diff.hiddenCritical}）｜ 偶发坏输出 ${d.diff.newStructural} ｜ 新增通过 ${d.diff.newPasses} ｜ 皆失败 ${d.diff.bothFail} ｜ 皆通过 ${d.diff.bothPass}`);
  L.push('');
  L.push('## 分类统计');
  L.push('');
  L.push('| 类别 | 条数 | 基线通过 | 候选通过 | 新增失败 |');
  L.push('|---|---|---|---|---|');
  for (const c of d.byCategory) L.push(`| ${c.label} | ${c.total} | ${c.baselinePass} | ${c.candidatePass} | ${c.newFailures} |`);
  L.push('');
  L.push(`## 一、新增退步（最优先 · ${d.newFailureList.length} 条 = 整条退步 ${d.diff.newFailures} + 新增关键违规 ${d.diff.newCriticalViolations} + 偶发坏输出 ${d.diff.newStructural}，去重）`);
  L.push('');
  for (const s of d.newFailureList) {
    const fl = s.flags ?? { newFail: true, newCritical: s.criticalViolation, hiddenByMajority: false, newStructural: false }; // 兼容旧版报告数据
    const flagText = fl.hiddenByMajority
      ? '🔴 **新增关键违规（整条因多数决判通过——最易被忽视）**'
      : fl.newCritical && fl.newFail
        ? '🔴 **违反关键要求**'
        : fl.newCritical
          ? '🔴 **普通失败升级为关键违规**'
          : fl.newStructural
            ? '⚠️ **偶发坏输出（解析失败/调用异常）——稳定性退步**'
            : '⚠️ 失败';
    L.push(`#### ${s.sampleId} · ${s.category} ｜ ${flagText}`);
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
