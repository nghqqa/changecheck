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
}

export interface VersionConfig {
  id: number | string;
  name: string;
  model: string;
  systemPrompt: string;
  userTemplate: string;
  temperature: number;
  maxTokens: number;
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

async function callOnce(ctx: CallCtx, userPrompt: string, attempt = 1): Promise<Omit<ExecRecord, 'versionId' | 'sampleId' | 'rep' | 'parsed' | 'parseError'>> {
  const started = Date.now();
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
      return { raw: '', latencyMs: Date.now() - started, usage: null, costCNY: 0, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const raw = data.choices?.[0]?.message?.content ?? '';
    const usage = data.usage ? { promptTokens: data.usage.prompt_tokens ?? 0, completionTokens: data.usage.completion_tokens ?? 0 } : null;
    const costCNY = usage
      ? (usage.promptTokens / 1e6) * ctx.pricing.inputPerMTok + (usage.completionTokens / 1e6) * ctx.pricing.outputPerMTok
      : null;
    return { raw, latencyMs: Date.now() - started, usage, costCNY, error: null };
  } catch (e) {
    if (attempt < 3) {
      await sleep(2000 * attempt);
      return callOnce(ctx, userPrompt, attempt + 1);
    }
    return { raw: '', latencyMs: Date.now() - started, usage: null, costCNY: 0, error: `网络错误: ${(e as Error).message}` };
  }
}

// ---- mock 模式：确定性模拟（无 key 演示全流程用；行为模型来自 M0 实测观察） ----
const MOCK_FILL: Record<string, string> = { date: '2026年10月15日', time: '18:00', location: '待定', deadline: '2026年10月20日18:00' };
const MOCK_CONVERT: Record<string, string> = {
  下周五: '2026年10月16日', 本周四: '2026年10月15日', 下周一: '2026年10月19日', 明天: '2026年10月8日',
  这周五: '2026年10月9日', 今晚: '2026年10月7日20:00', 下个月: '2026年11月15日', 每周五: '2026年10月9日',
  '12月底': '2026年12月31日', 周六: '2026年10月10日', 每周六: '2026年10月10日',
};

function mockCall(version: VersionConfig, sample: KernelSample, rep: number): Omit<ExecRecord, 'versionId' | 'sampleId' | 'rep' | 'parsed' | 'parseError'> {
  const ref = sample.reference;
  const hash = (s: string) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0);
  const h = hash(String(sample.id)) + rep;
  const out: Record<string, string> = { ...ref };
  const isBaselineLike = /稳定|旧版|baseline/i.test(version.name) || version.id === 'old';
  if (isBaselineLike) {
    // 基线：忠实输出参考答案
  } else {
    if (sample.category === 'missing' || sample.category === 'ambiguous') {
      for (const f of Object.keys(ref)) if (ref[f] === '') out[f] = MOCK_FILL[f] ?? '待定';
      if (ref.date && MOCK_CONVERT[ref.date]) out.date = MOCK_CONVERT[ref.date];
      else if (ref.date) out.date = `2026年${ref.date}`;
      if (ref.time === '晚上' || ref.time === '上午') out.time = ref.time === '晚上' ? '19:00' : '9:00';
    } else if (sample.category === 'adversarial') {
      // 对抗类：模拟被干扰项带偏（M0 真实跑中观察到的行为模式）
      if (h % 2 === 0 && ref.date) out.date = `2026年${ref.date}`;
    } else {
      if (h % 2 === 0 && ref.date) out.date = `2026年${ref.date}`;
      if (h % 5 === 0 && ref.deadline === '') out.deadline = MOCK_FILL.deadline;
    }
  }
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
}

/** 批量执行一个版本 */
export async function runVersion(version: VersionConfig, samples: KernelSample[], opts: RunVersionOpts): Promise<ExecRecord[]> {
  const concurrency = opts.concurrency ?? 4;
  const jobs = samples.flatMap((s) => Array.from({ length: opts.reps }, (_, i) => ({ sample: s, rep: i + 1 })));
  const records: ExecRecord[] = new Array(jobs.length);
  let idx = 0;
  let done = 0;
  async function worker() {
    while (idx < jobs.length) {
      const my = idx++;
      const { sample, rep } = jobs[my];
      const userPrompt = version.userTemplate.replace('{{input}}', sample.input);
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
            pricing: opts.pricing || DEFAULT_PRICING,
          },
          userPrompt
        );
      }
      const parsed = r.error ? null : extractJson(r.raw);
      records[my] = {
        versionId: version.id,
        sampleId: sample.id,
        rep,
        raw: r.raw ?? '',
        parsed: parsed?.ok ? parsed.value ?? null : null,
        parseError: parsed && !parsed.ok ? parsed.error ?? '解析失败' : null,
        latencyMs: r.latencyMs ?? null,
        usage: r.usage,
        costCNY: r.costCNY ?? null,
        error: r.error ?? null,
      };
      done++;
      opts.onProgress?.(done, jobs.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return records;
}
