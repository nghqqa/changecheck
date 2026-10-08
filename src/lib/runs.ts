// 运行编排：点击运行时保存不可变快照（版本配置 + 测试集 + 检查规则）→ 内核执行 → 逐条落库 → 聚合报告。
// 单进程串行队列；每次调用完成即持久化，服务重启只丢未完成的调用，已完成证据不丢。
import type { ExecRecord, KernelSample, VersionConfig } from './kernel/executor';
import { runVersion, DEFAULT_BASE_URL, DEFAULT_PRICING } from './kernel/executor';
import { checkRecord, type CheckOptions } from './kernel/checker';
import { buildReportData, type ReportData } from './kernel/report';
import { DEFAULT_RULES, type CheckerRules } from './requirements';
import {
  getRun, getTask, getVersion, listSamples, setRunStatus, insertRunItem, finishRun, updateRunProgress,
  type SampleRow, type VersionRow,
} from './db';

// ---- 运行快照：点击运行那一刻的事实，之后编辑版本/样例不影响该 run 的可复现性 ----
export interface RunSnapshot {
  taskName: string;
  baselineVersion: VersionConfig;
  candidateVersion: VersionConfig;
  samples: KernelSample[];
  checkOpts: CheckOptions;
  requirementsText?: string;
}

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
    priceIn: v.price_in,
    priceOut: v.price_out,
  };
}

/** 构建并返回运行快照（在 insertRun 之前调用，结果随 run 落库） */
export function buildSnapshot(taskId: number, baseId: number, candId: number): RunSnapshot | { error: string } {
  const task = getTask(taskId);
  const baseVer = getVersion(baseId);
  const candVer = getVersion(candId);
  if (!task) return { error: '任务不存在' };
  if (!baseVer || !candVer) return { error: '版本配置不存在' };
  const samples = listSamples(taskId).filter((s) => s.enabled).map(toKernelSample);
  if (samples.length === 0) return { error: '没有启用的样例' };

  const req = task.requirements_json ? (JSON.parse(task.requirements_json) as { text?: string; rules?: CheckerRules; items?: { label: string; confirmed: boolean }[] }) : null;
  const checkOpts: CheckOptions = {
    verbatim: req?.rules?.verbatim ?? DEFAULT_RULES.verbatim,
    eventNear: req?.rules?.eventNear ?? DEFAULT_RULES.eventNear,
    emptyCritical: req?.rules?.emptyCritical ?? DEFAULT_RULES.emptyCritical,
  };
  // 老数据兼容：无 rules 字段时按确认项现算（与保存时同一套派生口径的近似——无 ruleKey 时保持默认）
  return {
    taskName: task.name,
    baselineVersion: toVersionConfig(baseVer),
    candidateVersion: toVersionConfig(candVer),
    samples,
    checkOpts,
    requirementsText: req?.text,
  };
}

const pricing = () => ({
  inputPerMTok: Number(process.env.CC_PRICE_IN ?? DEFAULT_PRICING.inputPerMTok),
  outputPerMTok: Number(process.env.CC_PRICE_OUT ?? DEFAULT_PRICING.outputPerMTok),
});

/** 执行一次对比运行（由队列串行调度；数据一律来自快照） */
async function executeRun(runId: number): Promise<void> {
  const run = getRun(runId);
  if (!run) return;
  const snap: RunSnapshot | null = run.snapshot_json ? JSON.parse(run.snapshot_json) : null;
  if (!snap) return finishRun(runId, 'error', null, '缺少运行快照（旧数据），请重新发起运行');

  setRunStatus(runId, 'running');
  try {
    const { samples, checkOpts } = snap;
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
    // 逐次持久化：每次调用完成立即写入 run_items（重启丢进度不丢证据）
    const persistOne = (r: ExecRecord, role: 'baseline' | 'candidate') => {
      const sample = samples.find((s) => String(s.id) === String(r.sampleId));
      const checkJson = sample ? JSON.stringify(checkRecord(sample, r, checkOpts)) : null;
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
    };
    const collector = (role: 'baseline' | 'candidate') => (r: ExecRecord) => {
      persistOne(r, role);
      onProgress();
    };

    const baseRecords = await runVersion(snap.baselineVersion, samples, { ...opts, onRecord: collector('baseline') });
    const candRecords = await runVersion(snap.candidateVersion, samples, { ...opts, onRecord: collector('candidate') });

    const report = buildReportData({
      taskName: snap.taskName,
      samples,
      baselineRecords: baseRecords,
      candidateRecords: candRecords,
      baselineVersion: snap.baselineVersion,
      candidateVersion: snap.candidateVersion,
      checkOpts,
      meta: {
        mode: run.mode,
        model: snap.candidateVersion.model,
        reps: run.reps,
        timeText: new Date().toLocaleString('zh-CN'),
        pricingText:
          `基线/候选单价：输入 ¥${snap.baselineVersion.priceIn ?? opts.pricing.inputPerMTok}/输出 ¥${snap.baselineVersion.priceOut ?? opts.pricing.outputPerMTok}、` +
          `输入 ¥${snap.candidateVersion.priceIn ?? opts.pricing.inputPerMTok}/输出 ¥${snap.candidateVersion.priceOut ?? opts.pricing.outputPerMTok}（元/百万token，未设置时用全局估算价）`,
        checkRules: checkOpts,
        requirements: snap.requirementsText ? { text: snap.requirementsText, items: [] } : undefined,
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
  const snap = run.snapshot_json ? (JSON.parse(run.snapshot_json) as RunSnapshot) : null;
  return { taskName: snap?.taskName ?? getTask(run.task_id)?.name ?? '', data: JSON.parse(run.stats_json) as ReportData };
}
