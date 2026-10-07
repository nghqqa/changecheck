// 运行编排：加载任务数据 → 内核执行两版本 → 检查 → 聚合报告 → 落库。
// 单进程串行队列（一次只执行一个 run，避免并发轰被测 API）；进度逐条持久化，前端轮询展示。
import type { ExecRecord, KernelSample, VersionConfig } from './kernel/executor';
import { runVersion, DEFAULT_BASE_URL, DEFAULT_PRICING } from './kernel/executor';
import { checkRecord } from './kernel/checker';
import { buildReportData, type ReportData } from './kernel/report';
import {
  getRun, getTask, getVersion, listSamples, setRunStatus, insertRunItem, finishRun, updateRunProgress,
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

/** 执行一次对比运行（由队列串行调度） */
async function executeRun(runId: number): Promise<void> {
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

    const total = samples.length * 2 * run.reps;
    updateRunProgress(runId, 0, total);
    let done = 0;
    const onProgress = () => updateRunProgress(runId, ++done, total);

    const baseRecords = await runVersion(toVersionConfig(baseVer), samples, { ...opts, onProgress });
    const candRecords = await runVersion(toVersionConfig(candVer), samples, { ...opts, onProgress });

    const persist = (records: ExecRecord[], role: 'baseline' | 'candidate') => {
      for (const r of records) {
        // 检查结果随记录一并落库（报告证据来自 run_items）
        const sample = samples.find((s) => String(s.id) === String(r.sampleId));
        const checkJson = sample ? JSON.stringify(checkRecord(sample, r)) : null;
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
    updateRunProgress(runId, total, total);
    finishRun(runId, 'done', JSON.stringify(report), null);
  } catch (e) {
    console.error(`[run ${runId}] 执行异常:`, e);
    finishRun(runId, 'error', null, (e as Error).message);
  }
}

// ---- 串行队列：一次只跑一个 run，新 run 排队等待 ----
const queue: number[] = [];
let draining = false;

export function enqueueRun(runId: number): { queuedAhead: number } {
  queue.push(runId);
  const ahead = queue.length - 1;
  void drain();
  return { queuedAhead: ahead };
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const id = queue.shift()!;
      try {
        await executeRun(id);
      } catch (e) {
        console.error(`[run ${id}] 队列执行失败:`, e);
      }
    }
  } finally {
    draining = false;
  }
}

/** 运行完成时快照的报告（样例事后被编辑不影响历史报告——报告反映运行当时的事实） */
export function getRunReport(runId: number): { taskName: string; data: ReportData } | null {
  const run = getRun(runId);
  if (!run || !run.stats_json) return null;
  return { taskName: getTask(run.task_id)?.name ?? '', data: JSON.parse(run.stats_json) as ReportData };
}
