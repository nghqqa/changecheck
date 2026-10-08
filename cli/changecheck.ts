// changecheck 命令行入口（接入层形态：CI/本地守门，Web 只是同一内核的展示面）
// 用法：
//   npx tsx cli/changecheck.ts init [文件路径]     # 生成配置脚手架（默认 ./changecheck.json）
//   npx tsx cli/changecheck.ts run <配置文件> [--mode real|mock] [--reps n] [--out 目录]
// 退出码：0=无新增失败  1=新增关键违规（阻断）  2=新增普通失败（复核）  3=配置/环境错误
import fs from 'node:fs';
import path from 'node:path';
import { loadConfigFile, runConfig, scaffoldConfig } from './runner';

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (cmd === 'init') {
    const file = (typeof rest[0] === 'string' && !rest[0].startsWith('--') ? rest[0] : './changecheck.json') as string;
    if (fs.existsSync(file)) {
      console.error(`已存在 ${file}，未覆盖。`);
      process.exitCode = 3;
      return;
    }
    fs.writeFileSync(file, JSON.stringify(scaffoldConfig(), null, 2), 'utf8');
    console.log(`已生成配置脚手架：${file}`);
    console.log(`下一步：编辑样例与提示词，然后运行  npx tsx cli/changecheck.ts run ${file} --mode mock`);
    return;
  }

  if (cmd === 'run') {
    const file = typeof rest[0] === 'string' ? rest[0] : 'changecheck.json';
    let config;
    try {
      config = loadConfigFile(file);
    } catch (e) {
      console.error(`✗ ${(e as Error).message}`);
      process.exitCode = 3;
      return;
    }
    const modeOverride = typeof args.mode === 'string' ? (args.mode as 'real' | 'mock') : undefined;
    if (modeOverride) config.settings = { ...config.settings, mode: modeOverride };
    if (args.reps) config.settings = { ...config.settings, reps: Number(args.reps) };

    console.log(`ChangeCheck · ${config.task.name} ｜ 模式=${config.settings?.mode ?? 'mock'} ｜ 样例 ${config.samples.length} 条 × 2 版本 × ${config.settings?.reps ?? 1} 次`);
    let result;
    try {
      result = await runConfig(config);
    } catch (e) {
      console.error(`✗ ${(e as Error).message}`);
      process.exitCode = 3;
      return;
    }

    const outDir = typeof args.out === 'string' ? args.out : path.join(path.dirname(path.resolve(file)), 'changecheck-out');
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const mdPath = path.join(outDir, `report-${stamp}.md`);
    const jsonPath = path.join(outDir, `results-${stamp}.json`);
    fs.writeFileSync(mdPath, result.markdown, 'utf8');
    fs.writeFileSync(
      jsonPath,
      JSON.stringify({ config, report: result.report, baselineRecords: result.baselineRecords, candidateRecords: result.candidateRecords }, null, 2),
      'utf8'
    );

    const r = result.report;
    console.log('');
    console.log(`结论（${r.verdictLevel.toUpperCase()}）：${r.verdict}`);
    console.log(`通过：基线 ${r.baseline.passCount}/${r.total} → 候选 ${r.candidate.passCount}/${r.total} ｜ 新增失败 ${r.diff.newFailures} ｜ 新增关键违规 ${r.diff.newCriticalViolations}（被多数决掩盖 ${r.diff.hiddenCritical}）｜ 新增通过 ${r.diff.newPasses}`);
    console.log(`报告：${mdPath}`);
    console.log(`原始数据：${jsonPath}`);
    process.exitCode = result.exitCode;
    return;
  }

  console.error('用法：changecheck init [文件] ｜ changecheck run <配置文件> [--mode real|mock] [--reps n] [--out 目录]');
  process.exitCode = 3;
}

main().catch((e) => {
  console.error(`✗ ${(e as Error).message}`);
  process.exitCode = 3;
});
