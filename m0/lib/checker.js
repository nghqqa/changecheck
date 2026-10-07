// 检查器：对单条执行记录做字段级检查。
// 规则来源（模拟「要求引导引擎」的产出）：样例里的参考答案 + 检查项
//   - schema   : 输出必须是一个仅含 5 个约定字段的 JSON 对象
//   - empty    : 参考答案为空的字段，输出必须为空字符串（违者=凭空补全，关键要求）
//   - required : 参考答案非空的字段，输出必须非空
//   - exact    : 值必须与参考答案一致（原文逐字提取）；数字序列不同则绝不放宽
// 近似通过（near）：互相包含且数字序列一致 —— 计为通过，但列入人工复核清单。
'use strict';

const FIELDS = ['event', 'date', 'time', 'location', 'deadline'];

/** 归一化：去空白、全角标点转半角，用于公平比对 */
function normalize(s) {
  return String(s ?? '')
    .replace(/\s+/g, '')
    .replace(/：/g, ':')
    .replace(/，/g, ',')
    .replace(/；/g, ';')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/[「」『』"'"]/g, '');
}

/** 抽取数字序列（保护日期陷阱：10月1日 不得近似匹配 10月17日） */
function digits(s) {
  return (String(s ?? '').match(/\d+/g) || []).join(',');
}

function isNear(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  const contained = na.includes(nb) || nb.includes(na);
  return contained && digits(na) === digits(nb);
}

// event 是命名题不是逐字题：年份/主办方等限定词前缀、动宾/名词语序差异不应判错。
// 放宽为：包含关系（不查数字限定词）或字符多重集相同（语序无关）。
function isEventNear(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na.includes(nb) || nb.includes(na)) return true;
  const chars = (s) => [...s].sort().join('');
  return chars(na) === chars(nb);
}

/**
 * 检查一条执行记录。
 * @returns {{pass:boolean, criticalViolation:boolean, fieldResults:Array, error:string|null}}
 */
function checkRecord(sample, record) {
  const fieldResults = [];
  const fail = (field, rule, expected, actual, critical) =>
    fieldResults.push({ field, rule, expected, actual, status: 'fail', critical: !!critical });
  const near = (field, rule, expected, actual) =>
    fieldResults.push({ field, rule, expected, actual, status: 'near' });
  const ok = (field) => fieldResults.push({ field, rule: 'ok', expected: null, actual: null, status: 'pass' });

  if (record.error) {
    return { pass: false, criticalViolation: sample.critical.length > 0, fieldResults: [], error: `调用失败: ${record.error}` };
  }
  if (!record.parsed || typeof record.parsed !== 'object') {
    return { pass: false, criticalViolation: sample.critical.length > 0, fieldResults: [], error: record.parseError || '输出不是 JSON' };
  }

  const out = record.parsed;
  const extraKeys = Object.keys(out).filter((k) => !FIELDS.includes(k));

  for (const f of FIELDS) {
    const ref = sample.reference[f];
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
      // 关键规则：原文未给出 → 必须留空；非空 = 凭空补全（零容忍，恒为关键要求）
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

  const hasFail = fieldResults.some((r) => r.status === 'fail');
  const criticalViolation = fieldResults.some((r) => r.status === 'fail' && r.critical);
  return { pass: !hasFail, criticalViolation, fieldResults, error: null };
}

module.exports = { checkRecord, FIELDS, normalize };
