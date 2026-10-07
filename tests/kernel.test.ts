// 内核单元测试：检查器规则 / 执行器 JSON 提取 / 报告聚合与结论。
// 运行：npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRecord, normalize } from '../src/lib/kernel/checker';
import { extractJson } from '../src/lib/kernel/executor';
import { buildReportData, renderMarkdown } from '../src/lib/kernel/report';
import type { ExecRecord, KernelSample, VersionConfig } from '../src/lib/kernel/executor';

// ---- fixtures ----
const sample = (over: Partial<KernelSample> = {}): KernelSample => ({
  id: 'S1',
  category: 'missing',
  input: '请于10月12日提交实验报告，具体提交时间另行通知。',
  reference: { event: '实验报告提交', date: '10月12日', time: '', location: '', deadline: '' },
  critical: ['time', 'location', 'deadline'],
  ...over,
});

const rec = (over: Partial<ExecRecord> = {}): ExecRecord => ({
  versionId: 'old',
  sampleId: 'S1',
  rep: 1,
  raw: '',
  parsed: {},
  parseError: null,
  latencyMs: 100,
  usage: { promptTokens: 100, completionTokens: 50 },
  costCNY: 0.001,
  error: null,
  ...over,
});

// ---- checker：empty 规则（凭空补全 = 恒为关键违规） ----
test('该留空却补值 → fail 且 critical（凭空补全零容忍）', () => {
  const r = checkRecord(sample(), rec({ parsed: { event: '实验报告提交', date: '10月12日', time: '18:00', location: '', deadline: '' } }));
  assert.equal(r.pass, false);
  const f = r.fieldResults.find((x) => x.field === 'time')!;
  assert.equal(f.status, 'fail');
  assert.equal(f.rule, 'empty(必须留空)');
  assert.equal(f.critical, true, '即使字段不在 critical 列表也必须关键');
  assert.equal(r.criticalViolation, true);
});

test('参考答案为空且输出留空 → pass', () => {
  const r = checkRecord(sample(), rec({ parsed: { event: '实验报告提交', date: '10月12日', time: '', location: '', deadline: '' } }));
  assert.equal(r.pass, true);
  assert.equal(r.criticalViolation, false);
});

// ---- checker：required / exact ----
test('应提取却为空 → required fail', () => {
  const r = checkRecord(sample(), rec({ parsed: { event: '实验报告提交', date: '', time: '', location: '', deadline: '' } }));
  const f = r.fieldResults.find((x) => x.field === 'date')!;
  assert.equal(f.status, 'fail');
  assert.match(f.rule, /required/);
});

test('值不符 → exact fail（在 critical 列表则关键）', () => {
  const r = checkRecord(sample({ critical: ['date'] }), rec({ parsed: { event: '实验报告提交', date: '10月13日', time: '', location: '', deadline: '' } }));
  const f = r.fieldResults.find((x) => x.field === 'date')!;
  assert.equal(f.status, 'fail');
  assert.equal(f.critical, true);
});

// ---- checker：近似与数字保护 ----
test('日期数字保护：10月1日 不得近似匹配 10月17日', () => {
  const r = checkRecord(sample(), rec({ parsed: { event: '实验报告提交', date: '10月1日', time: '', location: '', deadline: '' } }));
  // 参考是 10月12日，输出 10月1日 是包含关系但数字不同 → 必须 fail 而非 near
  const f = r.fieldResults.find((x) => x.field === 'date')!;
  assert.equal(f.status, 'fail');
});

test('非日期字段近似：上午10:00 vs 10:00 → near（计通过）', () => {
  const s = sample({ reference: { event: '例会', date: '10月8日', time: '上午10:00', location: '会议室', deadline: '' } });
  const r = checkRecord(s, rec({ parsed: { event: '例会', date: '10月8日', time: '10:00', location: '会议室', deadline: '' } }));
  const f = r.fieldResults.find((x) => x.field === 'time')!;
  assert.equal(f.status, 'near');
  assert.equal(r.pass, true);
});

test('event 命名放宽：年份前缀与动宾语序 → near', () => {
  const s = sample();
  const a = checkRecord(s, rec({ parsed: { event: '2026年实验报告提交', date: '10月12日', time: '', location: '', deadline: '' } }));
  assert.equal(a.fieldResults.find((x) => x.field === 'event')!.status, 'near');
  const b = checkRecord(s, rec({ parsed: { event: '提交实验报告', date: '10月12日', time: '', location: '', deadline: '' } }));
  assert.equal(b.fieldResults.find((x) => x.field === 'event')!.status, 'near');
  assert.equal(b.pass, true);
});

test('event 不同事项 → 仍 fail', () => {
  const r = checkRecord(sample(), rec({ parsed: { event: '运动会', date: '10月12日', time: '', location: '', deadline: '' } }));
  assert.equal(r.fieldResults.find((x) => x.field === 'event')!.status, 'fail');
});

// ---- checker：schema ----
test('非 JSON 输出 → 整条失败并带错误', () => {
  const r = checkRecord(sample(), rec({ parsed: null, parseError: '输出中未找到 JSON 对象' }));
  assert.equal(r.pass, false);
  assert.ok(r.error);
});

test('缺字段/多余字段 → schema fail', () => {
  const r = checkRecord(sample(), rec({ parsed: { event: '实验报告提交', date: '10月12日', extra: 'x' } }));
  assert.equal(r.fieldResults.find((x) => x.field === 'time')!.rule, 'schema');
  assert.equal(r.fieldResults.find((x) => x.field === 'extra')!.rule, 'schema(多余字段)');
});

// ---- executor：extractJson ----
test('extractJson 容忍围栏与前后杂文', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```').value, { a: 1 });
  assert.equal(extractJson('好的，结果如下：{"a":1} 以上。').ok, true);
  assert.equal(extractJson('没有对象').ok, false);
  assert.equal(extractJson('{"a":').ok, false);
});

// ---- report：多数决聚合 ----
test('3 次重复 1 次失败 → 多数决通过', () => {
  const s = sample();
  const good = rec({ parsed: { event: '实验报告提交', date: '10月12日', time: '', location: '', deadline: '' } });
  const bad = rec({ parsed: { event: '实验报告提交', date: '10月12日', time: '18:00', location: '', deadline: '' } });
  const d = build(s, [good, good, bad], [good, good, good]);
  assert.equal(d.baseline.passCount, 1);
  assert.equal(d.candidate.passCount, 1);
  // 基线虽通过，但那 1 次失败是关键违规 → criticalCount 如实暴露波动
  assert.equal(d.baseline.criticalCount, 1);
});

// ---- report：结论分级与 punchline ----
const version = (name: string): VersionConfig => ({ id: name, name, model: 'm', systemPrompt: '', userTemplate: '{{input}}', temperature: 0, maxTokens: 2000 });

function build(s: KernelSample, base: ExecRecord[], cand: ExecRecord[]) {
  return buildReportData({
    taskName: '测试任务',
    samples: [s],
    baselineRecords: base,
    candidateRecords: cand,
    baselineVersion: version('基线'),
    candidateVersion: version('候选'),
    meta: { mode: 'real', model: 'm', reps: 1, timeText: '', pricingText: '' },
  });
}

const pass = (rep = 1) => rec({ rep, parsed: { event: '实验报告提交', date: '10月12日', time: '', location: '', deadline: '' } });
const failCritical = (rep = 1) => rec({ rep, parsed: { event: '实验报告提交', date: '10月12日', time: '18:00', location: '', deadline: '' } });
const failNonCritical = (rep = 1) => rec({ rep, parsed: { event: '实验报告提交', date: '10月13日', time: '', location: '', deadline: '' } });

test('基线过候选关键失败 → reject，punchline 含通过率与费用变化', () => {
  const d = build(sample(), [rec({ costCNY: 0.1, parsed: { event: '实验报告提交', date: '10月12日', time: '', location: '', deadline: '' } })], [rec({ costCNY: 0.2, parsed: { event: '实验报告提交', date: '10月12日', time: '18:00', location: '', deadline: '' } })]);
  assert.equal(d.verdictLevel, 'reject');
  assert.match(d.verdict, /候选通过 0\/1（基线 1\/1/);
  assert.match(d.verdict, /费用\+100%/);
  assert.match(d.verdict, /违反关键要求/);
});

test('新增失败但不涉关键 → review；全过且有修复 → adopt；无差异 → same', () => {
  assert.equal(build(sample(), [pass()], [failNonCritical()]).verdictLevel, 'review');
  assert.equal(build(sample(), [failCritical()], [pass()]).verdictLevel, 'adopt');
  assert.equal(build(sample(), [pass()], [pass()]).verdictLevel, 'same');
});

test('Markdown 导出包含各章节', () => {
  const d = build(sample(), [pass()], [failCritical()]);
  const md = renderMarkdown('任务', d);
  for (const h of ['## 结论', '## 总体对比', '## 分类统计', '## 一、新增失败', '## 二、新增通过', '## 三、两版皆失败', '## 四、近似通过复核清单']) {
    assert.ok(md.includes(h), `缺少 ${h}`);
  }
});

test('normalize 处理空白与全角标点', () => {
  assert.equal(normalize(' 10月12日 '), normalize('10月12日'));
  assert.equal(normalize('上午10：00'), '上午10:00');
});
