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

function isNear(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  const contained = na.includes(nb) || nb.includes(na);
  return contained && digits(na) === digits(nb);
}

// event 是命名题：年份/主办方限定词、动宾语序差异不应判错
function isEventNear(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na.includes(nb) || nb.includes(na)) return true;
  return [...na].sort().join('') === [...nb].sort().join('');
}

export function checkRecord(sample: KernelSample, record: Pick<ExecRecord, 'parsed' | 'parseError' | 'error'>): CheckResult {
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
      // 关键规则：原文未给出 → 必须留空；非空 = 凭空补全（零容忍）
      if (normalize(val) === '') ok(f);
      else fail(f, 'empty(必须留空)', '""', val, true);
      continue;
    }
    if (normalize(val) === '') {
      fail(f, 'required(必须提取)', ref, '""', sample.critical.includes(f));
      continue;
    }
    if (normalize(val) === normalize(ref)) {
      ok(f);
    } else if (f === 'event' && isEventNear(val, ref)) {
      near(f, 'exact(事项名等价)', ref, val);
    } else if (isNear(val, ref)) {
      near(f, 'exact(近似)', ref, val);
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
