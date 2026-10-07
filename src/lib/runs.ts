// 运行编排：加载任务数据 → 内核执行两版本 → 检查 → 聚合报告 → 落库。
// 报告可由 run_items 全量重算（趋势回溯/导出共用同一份证据）。
import type { ExecRecord, KernelSample, VersionConfig } from './kernel/executor';
import { runVersion, DEFAULT_BASE_URL, DEFAULT_PRICING } from './kernel/executor';
import { checkRecord } from './kernel/checker';
import { buildReportData, type ReportData } from './kernel/report';
import {
  getRun, getTask, getVersion, listSamples, setRunStatus, insertRunItem, finishRun,
  type SampleRow, type VersionRow,
} from './db';

function toKernelSample(s: SampleRow): KernelSample {
  const checks = JSON.parse(s.checks_json) as { critical?: string[] };
  return {
    id: s.id,
    category: s.category,
    input: s.input,
    reference: JSON.parse(s.reference_json),
    critical: checks.critical ?? [],
    note: s.note,
  };
}

function toVersionConfig(v: VersionRow): VersionConfig {
  return {
    id: v.id,
    name: v.name,
    model: v.model,
    systemPrompt: v.system_prompt,
    userTemplate: v.user_template,
    temperature: v.temperature,
    maxTokens: v.max_tokens,
  };
}

const pricing = () => ({
  inputPerMTok: Number(process.env.CC_PRICE_IN ?? DEFAULT_PRICING.inputPerMTok),
  outputPerMTok: Number(process.env.CC_PRICE_OUT ?? DEFAULT_PRICING.outputPerMTok),
});

/** 执行一次对比运行（进程内异步，不阻塞 HTTP 响应；单机 v1 的简易队列） */
export async function executeRun(runId: number): Promise<void> {
  const run = getRun(runId);
  if (!run) return;
  const task = getTask(run.task_id);
  if (!task) return finishRun(runId, 'error', null, '任务不存在');
  const baseVer = getVersion(run.baseline_version_id);
  const candVer = getVersion(run.candidate_version_id);
  if (!baseVer || !candVer) return finishRun(runId, 'error', null, '版本配置不存在');

  setRunStatus(runId, 'running');
  try {
    const samples = listSamples(run.task_id).filter((s) => s.enabled).map(toKernelSample);
    if (samples.length === 0) return finishRun(runId, 'error', null, '没有启用的样例');

    const opts = {
      mode: run.mode as 'real' | 'mock',
      reps: run.reps,
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL,
      pricing: pricing(),
    };
    if (opts.mode === 'real' && !opts.apiKey) return finishRun(runId, 'error', null, '缺少 DEEPSEEK_API_KEY（可在运行配置改用 mock 模式）');

    const baseRecords = await runVersion(toVersionConfig(baseVer), samples, opts);
    const candRecords = await runVersion(toVersionConfig(candVer), samples, opts);

    const persist = (records: ExecRecord[], role: 'baseline' | 'candidate') => {
      for (const r of records) {
        // 检查结果随记录一并落库（报告证据来自 run_items）
        const sample = samples.find((s) => String(s.id) === String(r.sampleId));
        let checkJson: string | null = null;
        if (sample) {
          checkJson = JSON.stringify(checkRecord(sample, r));
        }
        insertRunItem({
          run_id: runId,
          sample_id: Number(r.sampleId),
          version_role: role,
          rep: r.rep,
          raw_output: r.raw.slice(0, 20000),
          parsed_json: r.parsed ? JSON.stringify(r.parsed) : null,
          latency_ms: r.latencyMs,
          usage_json: r.usage ? JSON.stringify(r.usage) : null,
          cost_cny: r.costCNY,
          check_json: checkJson,
          error: r.error,
        });
      }
    };
    persist(baseRecords, 'baseline');
    persist(candRecords, 'candidate');

    const report = buildReportData({
      taskName: task.name,
      samples,
      baselineRecords: baseRecords,
      candidateRecords: candRecords,
      baselineVersion: toVersionConfig(baseVer),
      candidateVersion: toVersionConfig(candVer),
      meta: {
        mode: run.mode,
        model: candVer.model,
        reps: run.reps,
        timeText: new Date().toLocaleString('zh-CN'),
        pricingText: `输入 ¥${opts.pricing.inputPerMTok}/百万token · 输出 ¥${opts.pricing.outputPerMTok}/百万token（估算单价）`,
      },
    });
    finishRun(runId, 'done', JSON.stringify(report), null);
  } catch (e) {
    finishRun(runId, 'error', null, (e as Error).message);
  }
}

/** 从 run_items 重算报告（导出/复盘用，与执行时结果一致） */
export function recomputeReport(runId: number): { taskName: string; data: ReportData } | null {
  const run = getRun(runId);
  if (!run || !run.stats_json) return null;
  return { taskName: getTask(run.task_id)?.name ?? '', data: JSON.parse(run.stats_json) as ReportData };
}
