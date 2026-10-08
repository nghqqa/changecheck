// CLI 接入层测试：配置校验 / mock 运行 / 退出码语义
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, runConfig, scaffoldConfig } from '../cli/runner';

test('validateConfig：字段缺失、reference 出界、critical 出界都要报错', () => {
  const { errors } = validateConfig({
    task: { name: 't', fields: [{ name: 'a' }] },
    versions: { baseline: { systemPrompt: 'x' }, candidate: { systemPrompt: 'y' } },
    samples: [
      { input: 'i', reference: { a: '1', ghost: '2' }, critical: ['nope'] },
      { input: '', reference: {} },
    ],
  });
  assert.ok(errors.some((e) => e.includes('ghost')));
  assert.ok(errors.some((e) => e.includes('nope')));
  assert.ok(errors.some((e) => e.includes('samples[1].input')));
});

test('validateConfig：重复字段名报错', () => {
  const { errors } = validateConfig({
    task: { name: 't', fields: [{ name: 'a' }, { name: 'a' }] },
    versions: { baseline: { systemPrompt: 'x' }, candidate: { systemPrompt: 'y' } },
    samples: [{ input: 'i', reference: { a: '1' } }],
  });
  assert.ok(errors.some((e) => e.includes('重复')));
});

test('脚手架配置可通过校验，中性候选 mock 运行 → 退出码 0', async () => {
  const cfg = scaffoldConfig();
  const { errors } = validateConfig(cfg);
  assert.equal(errors.length, 0);
  const r = await runConfig(cfg);
  // 基线与候选在 mock 下行为一致 → 无新增失败 → 0（CI 看门保持绿色）
  assert.equal(r.exitCode, 0);
  assert.equal(r.report.verdictLevel, 'same');
});

test('守门语义：候选引入关键违规 → 退出码 1（阻断）', async () => {
  const cfg = scaffoldConfig();
  // 把候选改成「补全类」改版（mock 行为按名称分流：植入/更完整 → 空字段补默认值）
  cfg.versions.candidate.name = '候选 · 更完整版';
  const r = await runConfig(cfg);
  assert.equal(r.exitCode, 1);
  assert.equal(r.report.diff.newCriticalViolations > 0, true);
  assert.equal(r.report.verdictLevel, 'reject');
  // Markdown 可渲染且含退出依据
  assert.match(r.markdown, /新增关键违规/);
});
