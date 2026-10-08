// CLI 内核编排：配置即代码（changecheck.json）→ 调内核执行 → 报告落盘 → 退出码映射。
// 纯函数化（无 process 依赖），供 changecheck.ts 入口与单元测试复用。
// 退出码语义（D7）：0=无新增失败（允许还债式改进）；1=新增关键违规（阻断）；2=新增普通失败（复核）；3=配置/环境错误。
import fs from 'node:fs';
import type { ExecRecord, KernelSample, VersionConfig } from '../src/lib/kernel/executor';
import { runVersion, DEFAULT_BASE_URL, DEFAULT_PRICING } from '../src/lib/kernel/executor';
import { DEFAULT_CHECK_OPTIONS, type CheckOptions } from '../src/lib/kernel/checker';
import { buildReportData, renderMarkdown, type ReportData } from '../src/lib/kernel/report';

export interface ConfigField {
  name: string;
  desc?: string;
}

export interface ConfigVersion {
  name: string;
  model?: string;
  systemPrompt: string;
  userTemplate?: string;
  temperature?: number;
  maxTokens?: number;
  priceIn?: number;
  priceOut?: number;
}

export interface ConfigSample {
  category?: string;
  input: string;
  reference: Record<string, string>;
  critical?: string[];
  note?: string;
}

export interface CCConfig {
  task: { name: string; fields: ConfigField[] };
  settings?: {
    mode?: 'real' | 'mock';
    reps?: number;
    concurrency?: number;
    model?: string;
    baseURL?: string;
    pricing?: { in?: number; out?: number };
    /** 验收规则开关（缺省严格口径；与 Web 端要求引导派生的规则同构） */
    rules?: Partial<CheckOptions>;
  };
  versions: { baseline: ConfigVersion; candidate: ConfigVersion };
  samples: ConfigSample[];
}

export function validateConfig(cfg: unknown): { config?: CCConfig; errors: string[] } {
  const errors: string[] = [];
  const c = cfg as CCConfig;
  if (!c || typeof c !== 'object') return { errors: ['配置必须是 JSON 对象'] };
  if (!c.task?.name) errors.push('task.name 必填');
  if (!Array.isArray(c.task?.fields) || c.task.fields.length === 0) errors.push('task.fields 至少 1 个字段');
  else if (c.task.fields.length > 12) errors.push('task.fields 最多 12 个');
  else {
    const names = c.task.fields.map((f) => String(f?.name ?? '').trim());
    names.forEach((n, i) => {
      if (!n) errors.push(`task.fields[${i}].name 为空`);
    });
    if (new Set(names).size !== names.length) errors.push('task.fields 存在重复字段名');
  }
  if (!c.versions?.baseline?.systemPrompt) errors.push('versions.baseline.systemPrompt 必填');
  if (!c.versions?.candidate?.systemPrompt) errors.push('versions.candidate.systemPrompt 必填');
  if (!Array.isArray(c.samples) || c.samples.length === 0) errors.push('samples 至少 1 条');

  const fields = (c.task?.fields ?? []).map((f) => String(f?.name ?? '').trim());
  (c.samples ?? []).forEach((s, i) => {
    if (!s?.input) errors.push(`samples[${i}].input 为空`);
    if (!s?.reference || typeof s.reference !== 'object') errors.push(`samples[${i}].reference 必须是对象`);
    else {
      const unknown = Object.keys(s.reference).filter((k) => !fields.includes(k));
      if (unknown.length) errors.push(`samples[${i}].reference 含 schema 外字段: ${unknown.join('/')}`);
    }
    (s?.critical ?? []).forEach((f) => {
      if (!fields.includes(f)) errors.push(`samples[${i}].critical 引用了 schema 外字段: ${f}`);
    });
  });
  return errors.length ? { errors } : { config: c, errors };
}

function toVersion(v: ConfigVersion, defaultModel: string): VersionConfig {
  return {
    id: v.name,
    name: v.name,
    model: v.model || defaultModel,
    systemPrompt: v.systemPrompt,
    userTemplate: v.userTemplate ?? '输入：\n{{input}}\n\n只输出 JSON。',
    temperature: v.temperature ?? 0,
    maxTokens: v.maxTokens ?? 2000,
    priceIn: v.priceIn ?? null,
    priceOut: v.priceOut ?? null,
  };
}

export interface RunResult {
  report: ReportData;
  markdown: string;
  baselineRecords: ExecRecord[];
  candidateRecords: ExecRecord[];
  /** 0=无新增失败 1=新增关键违规 2=新增普通失败 */
  exitCode: 0 | 1 | 2;
}

export async function runConfig(cfg: CCConfig, env: { apiKey?: string; baseURL?: string } = {}): Promise<RunResult> {
  const settings = cfg.settings ?? {};
  const mode = settings.mode === 'real' ? 'real' : 'mock';
  const defaultModel = settings.model ?? process.env.DEEPSEEK_MODEL ?? 'deepseek-flash';
  const fields = cfg.task.fields.map((f) => f.name);
  const samples: KernelSample[] = cfg.samples.map((s, i) => ({
    id: i + 1,
    category: s.category ?? 'normal',
    input: s.input,
    reference: s.reference,
    critical: s.critical ?? [],
    note: s.note ?? '',
    fields,
  }));
  const checkOpts: CheckOptions = { ...DEFAULT_CHECK_OPTIONS, ...(settings.rules ?? {}) };
  const pricing = {
    inputPerMTok: settings.pricing?.in ?? DEFAULT_PRICING.inputPerMTok,
    outputPerMTok: settings.pricing?.out ?? DEFAULT_PRICING.outputPerMTok,
  };
  const opts = {
    mode: mode as 'real' | 'mock',
    reps: Math.min(5, Math.max(1, settings.reps ?? 1)),
    concurrency: Math.min(8, Math.max(1, settings.concurrency ?? 4)),
    apiKey: env.apiKey ?? process.env.DEEPSEEK_API_KEY,
    baseURL: env.baseURL ?? settings.baseURL ?? DEFAULT_BASE_URL,
    pricing,
  };
  if (mode === 'real' && !opts.apiKey) throw new Error('mode=real 需要环境变量 DEEPSEEK_API_KEY（或先用 --mode mock）');

  const baselineVersion = toVersion(cfg.versions.baseline, defaultModel);
  const candidateVersion = toVersion(cfg.versions.candidate, defaultModel);
  const baselineRecords = await runVersion(baselineVersion, samples, opts);
  const candidateRecords = await runVersion(candidateVersion, samples, opts);

  const report = buildReportData({
    taskName: cfg.task.name,
    samples,
    baselineRecords,
    candidateRecords,
    baselineVersion,
    candidateVersion,
    checkOpts,
    meta: {
      mode,
      model: candidateVersion.model,
      reps: opts.reps,
      timeText: new Date().toLocaleString('zh-CN'),
      pricingText: `输入 ¥${pricing.inputPerMTok}/输出 ¥${pricing.outputPerMTok}（元/百万token；版本可覆盖）`,
    },
  });

  // 退出码：仅新增失败非零（D7）——关键违规=1（阻断），普通新增失败=2（复核）
  const exitCode: RunResult['exitCode'] = report.diff.newCriticalViolations > 0 ? 1 : report.diff.newFailures > 0 ? 2 : 0;
  return { report, markdown: renderMarkdown(cfg.task.name, report), baselineRecords, candidateRecords, exitCode };
}

/** 读取配置文件（JSON），带友好错误 */
export function loadConfigFile(path: string): CCConfig {
  if (!fs.existsSync(path)) throw new Error(`配置文件不存在: ${path}`);
  let raw: string;
  try {
    raw = fs.readFileSync(path, 'utf8');
  } catch (e) {
    throw new Error(`读取失败: ${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`JSON 解析失败: ${(e as Error).message}`);
  }
  const { config, errors } = validateConfig(parsed);
  if (errors.length) throw new Error(`配置校验失败：\n- ${errors.join('\n- ')}`);
  return config!;
}

/** init 脚手架：可直接运行的最小配置（客服工单示例） */
export function scaffoldConfig(): CCConfig {
  return {
    task: {
      name: '客服工单信息提取',
      fields: [
        { name: 'title', desc: '工单主题' },
        { name: 'priority', desc: '优先级（高/中/低）' },
        { name: 'due', desc: '解决截止时间，未给则留空' },
      ],
    },
    settings: { mode: 'mock', reps: 1, model: 'deepseek-flash' },
    versions: {
      baseline: {
        name: '基线 · 现行提示词',
        systemPrompt:
          '从客服工单中提取字段，只输出 JSON：{"title":"工单主题","priority":"优先级","due":"截止时间"}\n字段值逐字取自原文；未提及的字段一律输出空字符串——宁可留空，严禁编造。',
      },
      candidate: {
        name: '候选 · 修改后的提示词',
        systemPrompt:
          '从客服工单中提取字段，只输出 JSON：{"title":"工单主题","priority":"优先级","due":"截止时间"}\n提取要完整规范，未提及的字段可按常识补全。',
      },
    },
    samples: [
      {
        category: 'normal',
        input: '工单#1024：无法登录，优先级高，周五前解决。',
        reference: { title: '无法登录', priority: '高', due: '周五前' },
        critical: ['priority'],
        note: '全字段齐全',
      },
      {
        category: 'missing',
        input: '工单#1025：导出报表一直转圈，麻烦看看。',
        reference: { title: '导出报表一直转圈', priority: '', due: '' },
        critical: ['priority', 'due'],
        note: '未写优先级与截止时间，必须留空',
      },
      {
        category: 'adversarial',
        input: '工单#1026：原定周三处理的权限申请，已改到周四中午 12:00 处理。',
        reference: { title: '权限申请', priority: '', due: '周四中午 12:00' },
        critical: ['due'],
        note: '改期取新时间，周三为干扰项',
      },
    ],
  };
}
