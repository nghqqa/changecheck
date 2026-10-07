// 回归报告：以「新增失败优先」组织证据，给出采用建议。
'use strict';

const { checkRecord } = require('./checker');

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function fmtCost(cny) {
  if (cny == null) return '未知';
  return `¥${cny.toFixed(4)}`;
}

/** 聚合一个版本在某样例上的多次重复运行：过半通过才算通过；任一次关键违规即记关键违规 */
function aggregateSample(records, sample) {
  const checks = records.map((r) => ({ record: r, check: checkRecord(sample, r) }));
  const passCount = checks.filter((c) => c.check.pass).length;
  const pass = passCount * 2 > checks.length;
  const criticalViolation = checks.some((c) => c.check.criticalViolation);
  // 取最差一次（优先关键违规的失败）作为展示证据
  const worst =
    checks.find((c) => !c.check.pass && c.check.criticalViolation) ||
    checks.find((c) => !c.check.pass) ||
    checks.find((c) => c.check.fieldResults.some((f) => f.status === 'near')) ||
    checks[0];
  return { pass, criticalViolation, checks, worst };
}

function versionStats(records, aggById, samples) {
  const passCount = samples.filter((s) => aggById[s.id].pass).length;
  const criticalCount = samples.filter((s) => aggById[s.id].criticalViolation).length;
  const costKnown = records.every((r) => r.costCNY != null);
  const totalCost = records.reduce((a, r) => a + (r.costCNY || 0), 0);
  const tokens = records.reduce((a, r) => a + (r.usage ? r.usage.promptTokens + r.usage.completionTokens : 0), 0);
  const lat = records.filter((r) => r.latencyMs != null).map((r) => r.latencyMs);
  const avgLat = lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null;
  const callErrors = records.filter((r) => r.error).length;
  return { passCount, criticalCount, cost: costKnown ? totalCost : null, tokens, avgLat, callErrors };
}

function renderSampleDetail(sample, agg, versionLabel) {
  const lines = [];
  const flag = agg.criticalViolation ? '🔴 **违反关键要求**' : '⚠️ 失败';
  lines.push(`#### ${sample.id} · ${sample.category} ｜ ${flag}`);
  lines.push(`> ${sample.note}`);
  lines.push('');
  lines.push(`- **通知原文**：${sample.input}`);
  lines.push(`- **参考答案**：\`${JSON.stringify(sample.reference)}\``);
  if (agg.worst) {
    lines.push(`- **${versionLabel}输出**：\`${JSON.stringify(agg.worst.record.parsed ?? agg.worst.record.raw.slice(0, 120))}\``);
  }
  const fails = agg.worst ? agg.worst.check.fieldResults.filter((f) => f.status !== 'pass') : [];
  if (fails.length) {
    lines.push('');
    lines.push('| 字段 | 规则 | 期望 | 实际 | 关键 |');
    lines.push('|---|---|---|---|---|');
    for (const f of fails) {
      lines.push(`| ${f.field} | ${esc(f.rule)} | ${esc(f.expected)} | ${esc(f.actual)} | ${f.critical ? '🔴' : ''} |`);
    }
  }
  if (agg.worst && agg.worst.check.error) lines.push(`- **错误**：${esc(agg.worst.check.error)}`);
  return lines.join('\n');
}

function buildReport({ samples, recordsBy, versions, meta }) {
  const oldById = {};
  const newById = {};
  for (const s of samples) {
    oldById[s.id] = aggregateSample(recordsBy.old.filter((r) => r.sampleId === s.id), s);
    newById[s.id] = aggregateSample(recordsBy.new.filter((r) => r.sampleId === s.id), s);
  }
  const newFailures = samples.filter((s) => oldById[s.id].pass && !newById[s.id].pass);
  const newPasses = samples.filter((s) => !oldById[s.id].pass && newById[s.id].pass);
  const bothFail = samples.filter((s) => !oldById[s.id].pass && !newById[s.id].pass);
  const bothPass = samples.filter((s) => oldById[s.id].pass && newById[s.id].pass);
  const newFailCritical = newFailures.filter((s) => newById[s.id].criticalViolation);

  const oldStats = versionStats(recordsBy.old, oldById, samples);
  const newStats = versionStats(recordsBy.new, newById, samples);

  // 采用建议（报告保留「需人工确认」状态）
  let verdict;
  if (newFailCritical.length > 0) {
    verdict = `新版存在 **${newFailCritical.length} 条违反关键要求的新增失败** —— 不建议直接采用；修复后复跑本测试确认新增失败清零。`;
  } else if (newFailures.length > 0) {
    verdict = `新版有 ${newFailures.length} 条新增失败（未违反关键要求）—— 复核后可采用。`;
  } else if (newPasses.length > 0) {
    verdict = `无新增失败，且有 ${newPasses.length} 条修复 —— 建议采用（最终由人工确认）。`;
  } else {
    verdict = '两版结果无差异 —— 维持现状，改版收益未体现。';
  }

  const categories = ['normal', 'missing', 'ambiguous', 'adversarial'];
  const catName = { normal: '正常', missing: '缺失', ambiguous: '歧义', adversarial: '对抗' };

  const L = [];
  L.push(`# ChangeCheck M0 验证实验报告`);
  L.push('');
  L.push(`- 模式：**${meta.mode === 'mock' ? 'mock 模拟（验证链路，不代表真实模型行为）' : '真实 API'}** ｜ 模型：${meta.model} ｜ 样例：${samples.length} 条（${catNameList(samples)}）｜ 每条重复 ${meta.reps} 次`);
  L.push(`- 旧版：${versions.old.label} ｜ 新版：${versions.new.label}`);
  L.push(`- 生成时间：${meta.timeText}`);
  L.push('');
  L.push(`## 结论`);
  L.push('');
  L.push(verdict);
  L.push('');
  L.push(`## 总体对比`);
  L.push('');
  L.push('| 版本 | 通过 | 关键要求违反 | 调用失败 | 费用(估) | 平均耗时 |');
  L.push('|---|---|---|---|---|---|');
  L.push(`| 旧版 | ${oldStats.passCount}/${samples.length} | ${oldStats.criticalCount} | ${oldStats.callErrors} | ${fmtCost(oldStats.cost)} | ${oldStats.avgLat != null ? oldStats.avgLat + ' ms' : '未知'} |`);
  L.push(`| 新版 | ${newStats.passCount}/${samples.length} | ${newStats.criticalCount} | ${newStats.callErrors} | ${fmtCost(newStats.cost)} | ${newStats.avgLat != null ? newStats.avgLat + ' ms' : '未知'} |`);
  L.push('');
  L.push(`**改版差异**：新增失败 ${newFailures.length} 条（其中违反关键要求 ${newFailCritical.length} 条）｜ 新增通过 ${newPasses.length} 条 ｜ 两版皆失败 ${bothFail.length} 条 ｜ 两版皆通过 ${bothPass.length} 条`);
  L.push('');
  L.push(`## 分类统计`);
  L.push('');
  L.push('| 类别 | 条数 | 旧版通过 | 新版通过 | 新增失败 |');
  L.push('|---|---|---|---|---|');
  for (const c of categories) {
    const cs = samples.filter((s) => s.category === c);
    if (!cs.length) continue;
    L.push(`| ${catName[c]} | ${cs.length} | ${cs.filter((s) => oldById[s.id].pass).length} | ${cs.filter((s) => newById[s.id].pass).length} | ${newFailures.filter((s) => s.category === c).length} |`);
  }
  L.push('');
  L.push(`## 一、新增失败（最优先 · ${newFailures.length} 条）`);
  L.push('');
  L.push('> 旧版通过、新版失败的样例 = 本次改版引入的退步。');
  L.push('');
  if (!newFailures.length) L.push('（无）');
  for (const s of newFailures) L.push(renderSampleDetail(s, newById[s.id], '新版'), '');

  L.push(`## 二、新增通过（${newPasses.length} 条）`);
  L.push('');
  if (!newPasses.length) L.push('（无）');
  for (const s of newPasses) {
    L.push(`- **${s.id} · ${s.category}**：${s.note}（旧版未过 → 新版通过）`);
  }
  L.push('');
  L.push(`## 三、两版皆失败（${bothFail.length} 条）—— 疑似检查器误报或双版皆坏，需人工复核`);
  L.push('');
  if (!bothFail.length) L.push('（无）');
  for (const s of bothFail) L.push(renderSampleDetail(s, oldById[s.id], '旧版'), '');

  const nearList = samples.flatMap((s) =>
    newById[s.id].checks.flatMap((c) =>
      c.check.fieldResults.filter((f) => f.status === 'near').map((f) => `- ${s.id} · ${f.field}：期望 \`${esc(f.expected)}\`，实际 \`${esc(f.actual)}\`（判为通过，请复核）`)
    )
  );
  L.push(`## 四、近似通过复核清单（${nearList.length} 条）`);
  L.push('');
  if (!nearList.length) L.push('（无）');
  L.push(...nearList, '');

  L.push(`## 五、用量与费用`);
  L.push('');
  L.push(`| 版本 | token 用量 | 费用(估) | 计价 |`);
  L.push('|---|---|---|---|');
  L.push(`| 旧版 | ${oldStats.tokens} | ${fmtCost(oldStats.cost)} | ${meta.pricingText} |`);
  L.push(`| 新版 | ${newStats.tokens} | ${fmtCost(newStats.cost)} | ${meta.pricingText} |`);
  L.push('');
  L.push(`> 费用按返回 usage 与单价常量估算；缺用量记「未知」。单价可在 m0/run.js 头部调整。`);
  L.push('');
  L.push(`---`);
  L.push(`*本报告由 ChangeCheck M0 管线自动生成，结论保留「需人工确认」状态。*`);

  const summary = [
    `总体: 旧版 ${oldStats.passCount}/${samples.length} 通过、${oldStats.criticalCount} 关键违规 ｜ 新版 ${newStats.passCount}/${samples.length} 通过、${newStats.criticalCount} 关键违规`,
    `差异: 新增失败 ${newFailures.length}（关键 ${newFailCritical.length}）｜ 新增通过 ${newPasses.length} ｜ 皆失败 ${bothFail.length}`,
    `结论: ${verdict}`,
  ].join('\n');

  return { markdown: L.join('\n'), summary, newFailures: newFailures.length, newFailCritical: newFailCritical.length, newPasses: newPasses.length, bothFail: bothFail.length };
}

function catNameList(samples) {
  const m = { normal: '正常', missing: '缺失', ambiguous: '歧义', adversarial: '对抗' };
  const cnt = {};
  for (const s of samples) cnt[m[s.category]] = (cnt[m[s.category]] || 0) + 1;
  return Object.entries(cnt).map(([k, v]) => `${k}${v}`).join(' / ');
}

module.exports = { buildReport };
