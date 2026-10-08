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

test('非日期字段：默认逐字一致，无括号注解的包含差异判失败', () => {
  // "10:00" 是 "上午10:00" 的子串但非纯注解 → 默认严格：fail（不再静默放行）
  const s = sample({ reference: { event: '例会', date: '10月8日', time: '上午10:00', location: '会议室', deadline: '' } });
  const r = checkRecord(s, rec({ parsed: { event: '例会', date: '10月8日', time: '10:00', location: '会议室', deadline: '' } }));
  const f = r.fieldResults.find((x) => x.field === 'time')!;
  assert.equal(f.status, 'fail');
  // 用户在验收要求里明确关闭「逐字一致」→ 降级为 near（进人工复核清单）
  const lenient = checkRecord(s, rec({ parsed: { event: '例会', date: '10月8日', time: '10:00', location: '会议室', deadline: '' } }), { eventNear: true, verbatim: false, emptyCritical: true });
  assert.equal(lenient.fieldResults.find((x) => x.field === 'time')!.status, 'near');
});

test('语义反转/修饰词不对称 → 任何字段都判失败（含事项名）', () => {
  const mk = (reference: Record<string, string>, field: string, val: string) =>
    checkRecord(sample({ reference, critical: [] }), rec({ parsed: { event: '实验报告提交', date: '10月12日', time: '', location: '', deadline: '', ...reference, [field]: val } }));
  // 事件名反转："不提交实验报告" 包含 "提交实验报告" 但含义相反
  const a = mk({ event: '提交实验报告', date: '10月12日', time: '', location: '', deadline: '' }, 'event', '不提交实验报告');
  assert.equal(a.fieldResults.find((x) => x.field === 'event')!.status, 'fail');
  // 时间修饰："下午2:00以后" 改变了含义
  const b = mk({ event: '例会', date: '10月12日', time: '下午2:00', location: '', deadline: '' }, 'time', '下午2:00以后');
  assert.equal(b.fieldResults.find((x) => x.field === 'time')!.status, 'fail');
  // 地点范围："北京以外" 反转
  const c = mk({ event: '例会', date: '10月12日', time: '', location: '北京', deadline: '' }, 'location', '北京以外');
  assert.equal(c.fieldResults.find((x) => x.field === 'location')!.status, 'fail');
});

test('括号注解差异 → near（人工复核清单），不判失败', () => {
  const s = sample({ reference: { event: '期中考试', date: '10月17日', time: '下午2:00', location: 'B栋302', deadline: '' } });
  const r = checkRecord(s, rec({ parsed: { event: '期中考试', date: '10月17日（周五）', time: '下午2:00', location: 'B栋302', deadline: '' } }));
  assert.equal(r.fieldResults.find((x) => x.field === 'date')!.status, 'near');
  assert.equal(r.pass, true);
});

test('eventNear 关闭后：事项名等价不再放行，必须逐字一致', () => {
  const s = sample();
  const r = checkRecord(s, rec({ parsed: { event: '2026年实验报告提交', date: '10月12日', time: '', location: '', deadline: '' } }), { eventNear: false, verbatim: true, emptyCritical: true });
  assert.equal(r.fieldResults.find((x) => x.field === 'event')!.status, 'fail');
});

test('emptyCritical 关闭后：凭空补全仍判失败但不再是一票否决', () => {
  const s = sample(); // reference.time = ''，输出补 18:00
  const r = checkRecord(s, rec({ parsed: { event: '实验报告提交', date: '10月12日', time: '18:00', location: '', deadline: '' } }), { eventNear: true, verbatim: true, emptyCritical: false });
  const f = r.fieldResults.find((x) => x.field === 'time')!;
  assert.equal(f.status, 'fail');
  assert.equal(f.critical, false);
  assert.equal(r.pass, false);
  assert.equal(r.criticalViolation, false);
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
  assert.match(d.verdict, /新增关键违规/);
  assert.equal(d.diff.newCriticalViolations, 1);
});

test('核心修复：关键违规被多数决掩盖 + 另一条改善 → 仍 reject（不得建议采用）', () => {
  // 样例A（missing）：基线 3 次全败（漏提取）→ 候选 3 次全过 = 改善；样例B：基线 3 次全过 → 候选 2 过 1 次关键违规（多数决通过）
  const good = { event: '实验报告提交', date: '10月12日', time: '', location: '', deadline: '' };
  const missingSample = sample({ id: 'A', reference: good, critical: ['date'] });
  const okSample = sample({ id: 'B', reference: good, critical: ['date'] });
  const baseRec = (sid: string, parsed: Record<string, string>, rep = 1) => rec({ sampleId: sid, rep, parsed });
  const base = [
    baseRec('A', { ...good, date: '' }, 1), baseRec('A', { ...good, date: '' }, 2), baseRec('A', { ...good, date: '' }, 3), // 基线漏提取
    baseRec('B', good, 1), baseRec('B', good, 2), baseRec('B', good, 3),
  ];
  const cand = [
    baseRec('A', good, 1), baseRec('A', good, 2), baseRec('A', good, 3), // 修复
    baseRec('B', good, 1), baseRec('B', good, 2), baseRec('B', { ...good, time: '18:00' }, 3), // 1/3 凭空补全（time 为空字段 → 关键违规）
  ];
  const d = buildReportData({
    taskName: '混合案例',
    samples: [missingSample, okSample],
    baselineRecords: base,
    candidateRecords: cand,
    baselineVersion: version('基线'),
    candidateVersion: version('激进提速版'),
    meta: { mode: 'mock', model: 'm', reps: 3, timeText: '', pricingText: '' },
  });
  // 通过率 1/2 → 2/2 提升，但新增关键违规必须一票否决
  assert.equal(d.candidate.passCount, 2);
  assert.equal(d.diff.newPasses, 1);
  assert.equal(d.diff.newCriticalViolations, 1);
  assert.equal(d.diff.hiddenCritical, 1, '该关键违规整条被多数决判通过');
  assert.equal(d.verdictLevel, 'reject');
  assert.match(d.verdict, /多数决.*忽视|极易被忽视/);
});

test('升级检测：基线普通失败 → 候选关键失败，属于新增关键违规而非"两版皆失败"', () => {
  const ref = { event: '实验报告提交', date: '10月12日', time: '', location: '', deadline: '' };
  const s = sample({ reference: ref, critical: ['date'] });
  // 基线只错非关键字段（event 改写）→ 失败但无关键违规
  const baseFail = rec({ parsed: { ...ref, event: '运动会' } });
  // 候选错在关键字段（date 漏提取）→ 关键违规 → 关键层面退步
  const candCritical = rec({ parsed: { ...ref, date: '' } });
  const d = build(s, [baseFail], [candCritical]);
  assert.equal(d.verdictLevel, 'reject');
  assert.equal(d.diff.newCriticalViolations, 1);
  assert.equal(d.diff.bothFail, 0, '升级样例归入新增退步，不算两版皆失败');
});

test('费用未知时不产出费用变化文字（仅耗时变化不被写成费用）', () => {
  const d = build(
    sample(),
    [rec({ costCNY: null, latencyMs: 1000, parsed: { event: '实验报告提交', date: '10月12日', time: '', location: '', deadline: '' } })],
    [rec({ costCNY: null, latencyMs: 500, parsed: { event: '实验报告提交', date: '10月12日', time: '', location: '', deadline: '' } })]
  );
  assert.match(d.verdict, /耗时-50%/);
  assert.doesNotMatch(d.verdict, /费用[+-]/);
});

test('新增失败但不涉关键 → review；全过且有修复 → adopt；无差异 → same', () => {
  assert.equal(build(sample(), [pass()], [failNonCritical()]).verdictLevel, 'review');
  assert.equal(build(sample(), [failCritical()], [pass()]).verdictLevel, 'adopt');
  assert.equal(build(sample(), [pass()], [pass()]).verdictLevel, 'same');
});

test('Markdown 导出包含各章节', () => {
  const d = build(sample(), [pass()], [failCritical()]);
  const md = renderMarkdown('任务', d);
  for (const h of ['## 结论', '## 总体对比', '## 分类统计', '## 一、新增退步', '## 二、新增通过', '## 三、两版皆失败', '## 四、近似通过复核清单']) {
    assert.ok(md.includes(h), `缺少 ${h}`);
  }
});

test('normalize 处理空白与全角标点', () => {
  assert.equal(normalize(' 10月12日 '), normalize('10月12日'));
  assert.equal(normalize('上午10：00'), '上午10:00');
});

// ---- 自定义任务字段 ----
test('自定义字段：按任务 schema 检查，约定外字段判 schema 违规', () => {
  const s = sample({
    id: 'C1',
    fields: ['title', 'due', 'owner'],
    reference: { title: '季度报告', due: '周五', owner: '张三' },
    critical: ['due'],
  });
  // 输出多了任务外字段、漏了 owner
  const r = checkRecord(s, rec({ parsed: { title: '季度报告', due: '周五', date: '10月12日' } }));
  assert.equal(r.fieldResults.find((x) => x.field === 'date')!.rule, 'schema(多余字段)');
  assert.equal(r.fieldResults.find((x) => x.field === 'owner')!.rule, 'schema');
  assert.equal(r.pass, false);
});

test('自定义字段：第一个字段为主体名称，享受命名等价放宽', () => {
  const s = sample({
    id: 'C2',
    fields: ['title', 'due'],
    reference: { title: '季度报告', due: '' },
    critical: [],
  });
  const r = checkRecord(s, rec({ parsed: { title: '2026年季度报告', due: '' } }));
  assert.equal(r.fieldResults.find((x) => x.field === 'title')!.status, 'near');
  assert.equal(r.pass, true);
  // 缺失字段必须留空的规则对自定义字段同样生效（due 为空，输出补了值 → 关键违规）
  const v = checkRecord(s, rec({ parsed: { title: '季度报告', due: '下周五' } }));
  assert.equal(v.criticalViolation, true);
});
