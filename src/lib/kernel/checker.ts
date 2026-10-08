// 内核·检查器：字段级规则检查（移植自 m0/lib/checker.js，实测经验已吸收）。
// 规则层级：schema（JSON/字段）→ empty（该留空却补值=凭空补全，恒为关键违规）
//         → required（应提取却为空）→ exact（应与参考答案/原文一致）。
// 近似通过（near）：event 按命名题放宽（包含/字符集等价）；日期数字保护防 10月1日⊂10月17日 假近似。

import type { ExecRecord, KernelSample } from './executor';

export const FIELDS = ['event', 'date', 'time', 'location', 'deadline'];

export interface FieldResult {
  field: string;
  rule: string;
  expected: string | null;
  actual: string | null;
  status: 'pass' | 'near' | 'fail';
  critical: boolean;
}

export interface CheckResult {
  pass: boolean;
  criticalViolation: boolean;
  fieldResults: FieldResult[];
  error: string | null;
}

export function normalize(s: unknown): string {
  return String(s ?? '')
    .replace(/\s+/g, '')
    .replace(/：/g, ':')
    .replace(/，/g, ',')
    .replace(/；/g, ';')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/[「」『』"'"]/g, '');
}

function digits(s: string): string {
  return (s.match(/\d+/g) || []).join(',');
}

// 语义改变词：出现在其中一侧而另一侧没有 → 含义反转/修饰，必须判失败而非近似
// （"提交实验报告"vs"不提交实验报告"、"北京"vs"北京以外"、"下午2:00"vs"下午2:00以后"）
const MODIFIERS = ['不', '无', '非', '未', '别', '以外', '之内', '之外', '以前', '之后', '以后', '之前', '左右', '前后', '超过', '不到', '至少', '最多', '最少', '起见'];
function modifierDelta(a: string, b: string): boolean {
  const sa = new Set(MODIFIERS.filter((m) => a.includes(m)));
  const sb = new Set(MODIFIERS.filter((m) => b.includes(m)));
  if (sa.size !== sb.size) return true;
  for (const m of sa) if (!sb.has(m)) return true;
  return false;
}

// 括号注解差异：一侧是另一侧加上完整括号注解（10月17日 vs 10月17日（周五））→ 含义未变，进人工复核
function bracketAnnotation(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short === '' || long === short) return false;
  if (!long.startsWith(short)) return false;
  return /^[（(][^（）()]*[）)]$/.test(long.slice(short.length));
}

/** 旧版宽容近似（数字序列一致且互相包含）——仅在用户明确关闭"逐字一致"要求时启用 */
function looseNear(a: string, b: string): boolean {
  const contained = a.includes(b) || b.includes(a);
  return contained && digits(a) === digits(b);
}

// event 是命名题：年份/主办方限定词、动宾语序差异不应判错（但语义改变词不对称必须判错）
function isEventNear(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (modifierDelta(a, b)) return false;
  if (a.includes(b) || b.includes(a)) return true;
  return [...a].sort().join('') === [...b].sort().join('');
}

export interface CheckOptions {
  /** 事项名等价放宽（默认开；关闭后 event 必须逐字一致） */
  eventNear: boolean;
  /** 逐字一致（默认开；关闭后非事项字段允许旧版宽容近似，进人工复核清单） */
  verbatim: boolean;
  /** 凭空补全是否计为关键违规（默认开；关闭后仍判失败但不触发一票否决） */
  emptyCritical: boolean;
}

export const DEFAULT_CHECK_OPTIONS: CheckOptions = { eventNear: true, verbatim: true, emptyCritical: true };

export function checkRecord(sample: KernelSample, record: Pick<ExecRecord, 'parsed' | 'parseError' | 'error'>, opts: CheckOptions = DEFAULT_CHECK_OPTIONS): CheckResult {
  const fieldResults: FieldResult[] = [];
  const fail = (field: string, rule: string, expected: string | null, actual: string | null, critical: boolean) =>
    fieldResults.push({ field, rule, expected, actual, status: 'fail', critical });
  const near = (field: string, rule: string, expected: string, actual: string) =>
    fieldResults.push({ field, rule, expected, actual, status: 'near', critical: false });
  const ok = (field: string) => fieldResults.push({ field, rule: 'ok', expected: null, actual: null, status: 'pass', critical: false });

  if (record.error) {
    return { pass: false, criticalViolation: sample.critical.length > 0, fieldResults: [], error: `调用失败: ${record.error}` };
  }
  if (!record.parsed || typeof record.parsed !== 'object') {
    return { pass: false, criticalViolation: sample.critical.length > 0, fieldResults: [], error: record.parseError || '输出不是 JSON' };
  }

  const out = record.parsed as Record<string, unknown>;
  const extraKeys = Object.keys(out).filter((k) => !FIELDS.includes(k));

  for (const f of FIELDS) {
    const ref = sample.reference[f] ?? '';
    if (!(f in out)) {
      fail(f, 'schema', ref === '' ? '""' : ref, '(字段缺失)', sample.critical.includes(f));
      continue;
    }
    const val = out[f];
    if (typeof val !== 'string') {
      fail(f, 'schema', '字符串', `类型 ${typeof val}`, sample.critical.includes(f));
      continue;
    }
    if (ref === '') {
      // 关键规则：原文未给出 → 必须留空；非空 = 凭空补全（可由验收要求降级为非关键失败）
      if (normalize(val) === '') ok(f);
      else fail(f, 'empty(必须留空)', '""', val, opts.emptyCritical);
      continue;
    }
    const na = normalize(val);
    const nref = normalize(ref);
    if (na === '') {
      fail(f, 'required(必须提取)', ref, '""', sample.critical.includes(f));
      continue;
    }
    if (na === nref) {
      ok(f);
      continue;
    }
    // 语义改变词不对称 → 一律失败，任何字段都不放行
    if (modifierDelta(na, nref)) {
      fail(f, 'exact(含义改变)', ref, val, sample.critical.includes(f));
      continue;
    }
    if (f === 'event') {
      // 事项名是命名题：等价表达可接受（可由验收要求关闭为逐字严格）
      if (opts.eventNear && isEventNear(na, nref)) near(f, 'exact(事项名等价)', ref, val);
      else fail(f, 'exact(应与原文一致)', ref, val, sample.critical.includes(f));
      continue;
    }
    // 日期/时间/地点/截止：默认严格逐字；仅括号注解差异进人工复核
    if (bracketAnnotation(na, nref)) {
      near(f, 'exact(注解差异)', ref, val);
    } else if (!opts.verbatim && looseNear(na, nref)) {
      near(f, 'exact(近似·已放宽逐字)', ref, val);
    } else {
      fail(f, 'exact(应与原文一致)', ref, val, sample.critical.includes(f));
    }
  }
  for (const k of extraKeys) {
    fieldResults.push({ field: k, rule: 'schema(多余字段)', expected: '(应不存在)', actual: String(out[k]).slice(0, 40), status: 'fail', critical: false });
  }

  return {
    pass: !fieldResults.some((r) => r.status === 'fail'),
    criticalViolation: fieldResults.some((r) => r.status === 'fail' && r.critical),
    fieldResults,
    error: null,
  };
}
