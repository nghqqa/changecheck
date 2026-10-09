// 内核·执行器：批量调用被测模型（OpenAI 兼容协议，DeepSeek 默认）。
// 移植自 m0/lib/llm.js，UI 无关；CLI/MCP（v2）可直接复用。
// 实测经验（M0）：思考型模型必须给足 max_tokens（≥2000），否则思考耗尽额度、正文为空。

export interface KernelSample {
  id: number | string;
  category: string;
  input: string;
  reference: Record<string, string>;
  critical: string[];
  note?: string;
  /** 任务 schema 约定的字段列表（自定义任务；缺省用内置通知提取五字段） */
  fields?: string[];
}

export interface VersionConfig {
  id: number | string;
  name: string;
  model: string;
  systemPrompt: string;
  userTemplate: string;
  temperature: number;
  maxTokens: number;
  /** 可选：该版本专属单价（元/百万 token）。缺省用全局 CC_PRICE_IN/OUT。换模型比较费用时必须分别设置 */
  priceIn?: number | null;
  priceOut?: number | null;
}

export interface ExecRecord {
  versionId: number | string;
  sampleId: number | string;
  rep: number;
  raw: string;
  parsed: Record<string, unknown> | null;
  parseError: string | null;
  latencyMs: number | null;
  usage: { promptTokens: number; completionTokens: number } | null;
  costCNY: number | null;
  error: string | null;
}

export const DEFAULT_BASE_URL = 'https://api.deepseek.com';
export const DEFAULT_PRICING = { inputPerMTok: 2, outputPerMTok: 8 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 单次调用硬超时：防止网络悬挂导致整个 run 永远卡住（思考型模型长推理也需要上限）
const CALL_TIMEOUT_MS = 180_000;

/** 从模型原始输出中提取 JSON 对象（容忍 ```json 围栏与前后杂文） */
export function extractJson(raw: string | null | undefined): { ok: boolean; value?: Record<string, unknown>; error?: string } {
  if (raw == null) return { ok: false, error: '空输出' };
  let s = String(raw).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return { ok: false, error: '输出中未找到 JSON 对象' };
  try {
    return { ok: true, value: JSON.parse(s.slice(start, end + 1)) };
  } catch (e) {
    return { ok: false, error: `JSON 解析失败: ${(e as Error).message}` };
  }
}

interface CallCtx {
  baseURL: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  pricing: { inputPerMTok: number; outputPerMTok: number };
}

// 返回值不含耗时：耗时由外层测量（含重试等待），避免"只算最后一次尝试"低估
type CallOutcome = { raw: string; usage: { promptTokens: number; completionTokens: number } | null; costCNY: number | null; error: string | null };

async function callOnce(ctx: CallCtx, userPrompt: string, attempt = 1): Promise<CallOutcome> {
  try {
    const res = await fetch(`${ctx.baseURL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({
        model: ctx.model,
        messages: [
          { role: 'system', content: ctx.systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: ctx.temperature,
        max_tokens: ctx.maxTokens,
        stream: false,
      }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await sleep(2000 * attempt);
        return callOnce(ctx, userPrompt, attempt + 1);
      }
      return { raw: '', usage: null, costCNY: null, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const raw = data.choices?.[0]?.message?.content ?? '';
    const usage = data.usage ? { promptTokens: data.usage.prompt_tokens ?? 0, completionTokens: data.usage.completion_tokens ?? 0 } : null;
    // 缺用量 → 费用未知（null），绝不记为 0
    const costCNY = usage
      ? (usage.promptTokens / 1e6) * ctx.pricing.inputPerMTok + (usage.completionTokens / 1e6) * ctx.pricing.outputPerMTok
      : null;
    return { raw, usage, costCNY, error: null };
  } catch (e) {
    if (attempt < 3) {
      await sleep(2000 * attempt);
      return callOnce(ctx, userPrompt, attempt + 1);
    }
    const err = e as Error;
    const msg = err.name === 'TimeoutError' || err.name === 'AbortError' ? `调用超时（${Math.round(CALL_TIMEOUT_MS / 1000)}s 无响应）` : `网络错误: ${err.message}`;
    return { raw: '', usage: null, costCNY: null, error: msg };
  }
}

// ---- mock 模式：确定性模拟（无 key 演示全流程用；行为模型来自 M0 实测观察） ----
// 行为按版本名分流，支持"混合案例"演示：
//   基线/稳定/基线·/修复/复跑 → 忠实输出参考答案
//   植入缺陷/更完整           → 空字段全补默认值（task1 剧本）
//   精简                      → 盲测剧本（部分字段漂移）
//   激进/提速                 → 通过率更高，但个别样例少数次运行凭空补全（演示"多数决掩盖新增关键违规"）
const MOCK_FILL: Record<string, string> = { date: '2026年10月15日', time: '18:00', location: '待定', deadline: '2026年10月20日18:00' };
const MOCK_CONVERT: Record<string, string> = {
  下周五: '2026年10月16日', 本周四: '2026年10月15日', 下周一: '2026年10月19日', 明天: '2026年10月8日',
  这周五: '2026年10月9日', 今晚: '2026年10月7日20:00', 下个月: '2026年11月15日', 每周五: '2026年10月9日',
  '12月底': '2026年12月31日', 周六: '2026年10月10日', 每周六: '2026年10月10日',
};

type MockStyle = 'good' | 'aging' | 'defective' | 'blind' | 'mixed' | 'flaky';
function mockStyle(name: string): MockStyle {
  if (/上代/.test(name)) return 'aging';
  if (/不稳定|偶发/.test(name)) return 'flaky';
  if (/修复|复跑|稳定|基线|baseline/i.test(name)) return 'good';
  if (/激进|提速/.test(name)) return 'mixed';
  if (/精简/.test(name)) return 'blind';
  if (/植入|更完整|完整/.test(name)) return 'defective';
  return 'good';
}

function mockCall(version: VersionConfig, sample: KernelSample, rep: number): Omit<ExecRecord, 'versionId' | 'sampleId' | 'rep' | 'parsed' | 'parseError'> {
  const ref = sample.reference;
  const hash = (s: string) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0);
  const h = hash(String(sample.id)) + rep;
  const out: Record<string, string> = { ...ref };
  const style = mockStyle(version.name);
  if (style === 'defective') {
    if (sample.category === 'missing' || sample.category === 'ambiguous') {
      for (const f of Object.keys(ref)) if (ref[f] === '') out[f] = MOCK_FILL[f] ?? '待定';
      if (ref.date && MOCK_CONVERT[ref.date]) out.date = MOCK_CONVERT[ref.date];
      else if (ref.date) out.date = `2026年${ref.date}`;
      if (ref.time === '晚上' || ref.time === '上午') out.time = ref.time === '晚上' ? '19:00' : '9:00';
    } else if (sample.category === 'adversarial') {
      if (h % 2 === 0 && ref.date) out.date = `2026年${ref.date}`;
    } else {
      if (h % 2 === 0 && ref.date) out.date = `2026年${ref.date}`;
      if (h % 5 === 0 && ref.deadline === '') out.deadline = MOCK_FILL.deadline;
    }
  } else if (style === 'blind') {
    if (sample.category === 'missing' || sample.category === 'ambiguous') {
      for (const f of Object.keys(ref)) if (ref[f] === '') out[f] = MOCK_FILL[f] ?? '待定';
      if (ref.date && MOCK_CONVERT[ref.date]) out.date = MOCK_CONVERT[ref.date];
    } else if (sample.category === 'adversarial') {
      if (h % 2 === 0 && ref.date) out.date = `2026年${ref.date}`;
    } else {
      if (h % 2 === 0 && ref.date) out.date = `2026年${ref.date}`;
    }
  } else if (style === 'aging') {
    // 上代基线：多数调用漏提取时间字段（required 失败，2/3 次 → 整条多数决失败）——制造"新版可改善"的空间
    if (ref.time !== '' && h % 2 === 0) out.time = '';
  } else if (style === 'flaky') {
    // 不稳定候选：输出与参考一致，但约 1/3 的调用直接返回非法 JSON（结构性失败，非业务违规）
    if (h % 3 === 0) {
      const pt2 = 220 + Math.ceil(sample.input.length / 2);
      return {
        raw: '抱歉，我无法完成该任务。',
        latencyMs: 300 + (h % 400),
        usage: { promptTokens: pt2, completionTokens: 20 },
        costCNY: (pt2 / 1e6) * 2 + (20 / 1e6) * 8,
        error: null,
      };
    }
  } else if (style === 'mixed') {
    // 通过率更高的候选：缺失/歧义类大多修好（不再补默认值），但个别样例在 1/3 次运行中凭空补全 deadline
    if (sample.category === 'normal' && ref.deadline === '' && h % 4 === 0) out.deadline = MOCK_FILL.deadline;
    if (sample.category === 'missing' && ref.time === '' && h % 4 === 1) out.time = MOCK_FILL.time;
  }
  // style === 'good'：原样输出参考答案
  const pt = 220 + Math.ceil(sample.input.length / 2);
  return {
    raw: '```json\n' + JSON.stringify(out, null, 2) + '\n```',
    latencyMs: 300 + (h % 400),
    usage: { promptTokens: pt, completionTokens: 90 },
    costCNY: (pt / 1e6) * 2 + (90 / 1e6) * 8,
    error: null,
  };
}

export interface RunVersionOpts {
  mode: 'real' | 'mock';
  reps: number;
  concurrency?: number;
  apiKey?: string;
  baseURL?: string;
  pricing?: { inputPerMTok: number; outputPerMTok: number };
  onProgress?: (done: number, total: number) => void;
  /** 每次调用完成后立即回调（用于逐次持久化证据，重启不丢已完成的调用） */
  onRecord?: (record: ExecRecord) => void;
}

/** 批量执行一个版本 */
export async function runVersion(version: VersionConfig, samples: KernelSample[], opts: RunVersionOpts): Promise<ExecRecord[]> {
  const concurrency = opts.concurrency ?? 4;
  const jobs = samples.flatMap((s) => Array.from({ length: opts.reps }, (_, i) => ({ sample: s, rep: i + 1 })));
  const records: ExecRecord[] = new Array(jobs.length);
  let idx = 0;
  let done = 0;
  // 版本专属单价优先于全局（换模型比较费用时按版本分别计价）
  const pricing =
    version.priceIn != null && version.priceOut != null
      ? { inputPerMTok: version.priceIn, outputPerMTok: version.priceOut }
      : opts.pricing || DEFAULT_PRICING;
  async function worker() {
    while (idx < jobs.length) {
      const my = idx++;
      const { sample, rep } = jobs[my];
      const userPrompt = version.userTemplate.replace('{{input}}', sample.input);
      const started = Date.now();
      let r: Awaited<ReturnType<typeof callOnce>>;
      if (opts.mode === 'mock') {
        await sleep(120);
        r = mockCall(version, sample, rep);
      } else {
        r = await callOnce(
          {
            baseURL: opts.baseURL || DEFAULT_BASE_URL,
            apiKey: opts.apiKey || '',
            model: version.model,
            systemPrompt: version.systemPrompt,
            temperature: version.temperature,
            maxTokens: version.maxTokens,
            pricing,
          },
          userPrompt
        );
      }
      const latencyMs = Date.now() - started; // 含重试等待
      const parsed = r.error ? null : extractJson(r.raw);
      const rec: ExecRecord = {
        versionId: version.id,
        sampleId: sample.id,
        rep,
        raw: r.raw ?? '',
        parsed: parsed?.ok ? parsed.value ?? null : null,
        parseError: parsed && !parsed.ok ? parsed.error ?? '解析失败' : null,
        latencyMs,
        usage: r.usage,
        costCNY: r.costCNY,
        error: r.error ?? null,
      };
      records[my] = rec;
      done++;
      opts.onProgress?.(done, jobs.length);
      opts.onRecord?.(rec);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return records;
}
