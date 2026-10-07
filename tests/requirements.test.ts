// 要求引导引擎 v0 解析器测试
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRequirements } from '../src/lib/requirements';

test('命中缺失留空与禁止编造要求', () => {
  const items = parseRequirements('没写的信息必须留空，绝对不能编造时间');
  assert.ok(items.some((i) => i.label.includes('留空')));
  assert.ok(items.some((i) => i.label.includes('严禁编造')));
});

test('命中改期取最终与逐字一致要求', () => {
  const items = parseRequirements('改期了取最新日期；输出格式保持原文一致');
  assert.ok(items.some((i) => i.label.includes('最终安排')));
  assert.ok(items.some((i) => i.label.includes('逐字一致')));
});

test('补全类要求被识别为冲突并置顶', () => {
  const items = parseRequirements('没写的留空；但希望输出完整，未给出的给合理默认值');
  const conflict = items.filter((i) => i.kind === 'conflict');
  assert.ok(conflict.length >= 1, '应检出冲突');
  assert.equal(items[0].kind, 'conflict', '冲突项置顶');
  assert.match(items[0].label, /冲突/);
});

test('基础约定始终存在且不重复', () => {
  const a = parseRequirements('随便什么');
  const b = parseRequirements('随便什么');
  assert.ok(a.some((i) => i.label.includes('合法 JSON')));
  assert.equal(a.length, b.length);
  assert.equal(new Set(a.map((i) => i.label)).size, a.length, '检查项去重');
});

test('空输入只给基础约定', () => {
  const items = parseRequirements('');
  assert.ok(items.length >= 2);
  assert.ok(items.every((i) => i.kind === 'core'));
});
