// M0 验证实验入口
// 用法:
//   node m0/run.js --mock            # 无需 key，模拟两版行为，验证管线（检查器/报告）
//   node m0/run.js                    # 真实调用 DeepSeek（需环境变量 DEEPSEEK_API_KEY）
//   node m0/run.js --limit 10        # 先用前 10 条跑通
//   node m0/run.js --reps 3          # 每条重复 3 次（重要样例复跑）
// 可选环境变量: DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / DEEPSEEK_MODEL(覆盖 versions.json)
//              M0_PRICE_IN / M0_PRICE_OUT （元/百万token，覆盖默认计价）
'use strict';

const fs = require('fs');
const path = require('path');
const { runVersion, DEFAULT_PRICING, DEFAULT_BASE_URL } = require('./lib/llm');
const { buildReport } = require('./lib/report');

function parseArgs(argv) {
  const a = { mock: false, limit: 0, reps: 1, concurrency: 4 };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--mock') a.mock = true;
    else if (t === '--limit') a.limit = Number(argv[++i]) || 0;
    else if (t === '--reps') a.reps = Math.max(1, Number(argv[++i]) || 1);
    else if (t === '--concurrency') a.concurrency = Math.max(1, Number(argv[++i]) || 4);
  }
  return a;
}

(async () => {
  const args = parseArgs(process.argv);
  const root = __dirname;
  const samplesAll = JSON.parse(fs.readFileSync(path.join(root, 'samples.json'), 'utf8')).samples;
  const versions = JSON.parse(fs.readFileSync(path.join(root, 'versions.json'), 'utf8'));
  const samples = args.limit > 0 ? samplesAll.slice(0, args.limit) : samplesAll;

  const pricing = {
    inputPerMTok: Number(process.env.M0_PRICE_IN ?? DEFAULT_PRICING.inputPerMTok),
    outputPerMTok: Number(process.env.M0_PRICE_OUT ?? DEFAULT_PRICING.outputPerMTok),
  };
  if (process.env.DEEPSEEK_MODEL) {
    versions.old.model = versions.new.model = process.env.DEEPSEEK_MODEL;
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!args.mock && !apiKey) {
    console.error('缺少 DEEPSEEK_API_KEY。真实运行请先设置环境变量，或先用 --mock 验证管线。');
    process.exit(1);
  }

  const mode = args.mock ? 'mock' : 'real';
  const ts = new Date();
  const stamp = ts.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  console.log(`M0 验证实验 ｜ 模式=${mode} ｜ 模型=${versions.old.model} ｜ 样例=${samples.length} ｜ 每条重复=${args.reps}`);

  const opts = {
    mock: args.mock,
    reps: args.reps,
    concurrency: args.concurrency,
    apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL,
    pricing,
  };

  console.log(`\n▶ 运行旧版：${versions.old.label}`);
  const recordsOld = await runVersion(versions.old, samples, opts);
  console.log(`▶ 运行新版：${versions.new.label}`);
  const recordsNew = await runVersion(versions.new, samples, opts);

  const report = buildReport({
    samples,
    recordsBy: { old: recordsOld, new: recordsNew },
    versions,
    meta: {
      mode,
      model: versions.old.model,
      reps: args.reps,
      timeText: ts.toLocaleString('zh-CN'),
      pricingText: `输入 ¥${pricing.inputPerMTok}/百万token · 输出 ¥${pricing.outputPerMTok}/百万token（估算单价）`,
    },
  });

  const outDir = path.join(root, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, `report-${mode}-${stamp}.md`);
  const resultPath = path.join(outDir, `results-${mode}-${stamp}.json`);
  fs.writeFileSync(reportPath, report.markdown, 'utf8');
  fs.writeFileSync(
    resultPath,
    JSON.stringify({ meta: { mode, model: versions.old.model, reps: args.reps, stamp }, versions, samples, records: { old: recordsOld, new: recordsNew } }, null, 2),
    'utf8'
  );

  console.log('\n================ 结果摘要 ================');
  console.log(report.summary);
  console.log('==========================================');
  console.log(`报告: ${reportPath}`);
  console.log(`原始数据: ${resultPath}`);
})().catch((e) => {
  console.error('运行失败:', e);
  process.exit(1);
});
