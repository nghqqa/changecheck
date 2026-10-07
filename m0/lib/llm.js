// 执行器：批量调用被测模型（OpenAI 兼容协议，DeepSeek 默认），记录用量与耗时。
// 真实模式读环境变量 DEEPSEEK_API_KEY；mock 模式无需 key，用于验证检查器与报告链路。
'use strict';

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
// deepseek-chat 估算单价（元 / 百万 token）。以官网当时价格为准，可通过环境变量覆盖。
const DEFAULT_PRICING = { inputPerMTok: 2, outputPerMTok: 8 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeEndpoint(baseURL) {
  return String(baseURL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

/** 从模型原始输出中提取 JSON 对象（容忍 ```json 围栏与前后杂文） */
function extractJson(raw) {
  if (raw == null) return { ok: false, error: '空输出' };
  let s = String(raw).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return { ok: false, error: '输出中未找到 JSON 对象', raw: String(raw) };
  }
  try {
    return { ok: true, value: JSON.parse(s.slice(start, end + 1)) };
  } catch (e) {
    return { ok: false, error: `JSON 解析失败: ${e.message}`, raw: String(raw) };
  }
}

/** 单次真实调用（含重试）。返回 {raw, latencyMs, usage, costCNY, error} */
async function callOnce({ baseURL, apiKey, model, systemPrompt, userPrompt, temperature, maxTokens, pricing }, attempt = 1) {
  const started = Date.now();
  try {
    const res = await fetch(`${normalizeEndpoint(baseURL)}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature,
        max_tokens: maxTokens,
        stream: false,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // 限频/网关/服务端错误：退避重试
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await sleep(2000 * attempt);
        return callOnce({ baseURL, apiKey, model, systemPrompt, userPrompt, temperature, maxTokens, pricing }, attempt + 1);
      }
      return { error: `HTTP ${res.status}: ${body.slice(0, 200)}`, latencyMs: Date.now() - started, usage: null, costCNY: 0 };
    }
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content ?? '';
    const usage = data?.usage ? { promptTokens: data.usage.prompt_tokens ?? 0, completionTokens: data.usage.completion_tokens ?? 0 } : null;
    const costCNY = usage
      ? (usage.promptTokens / 1e6) * pricing.inputPerMTok + (usage.completionTokens / 1e6) * pricing.outputPerMTok
      : null; // 缺用量时为 null → 报告标「未知」
    return { raw, latencyMs: Date.now() - started, usage, costCNY };
  } catch (e) {
    if (attempt < 3) {
      await sleep(2000 * attempt);
      return callOnce({ baseURL, apiKey, model, systemPrompt, userPrompt, temperature, maxTokens, pricing }, attempt + 1);
    }
    return { error: `网络错误: ${e.message}`, latencyMs: Date.now() - started, usage: null, costCNY: 0 };
  }
}

// ---- mock 模式：确定性模拟，验证检查器/报告链路，不回答真实模型行为 ----
const MOCK_FILL = {
  date: '2026年10月15日',
  time: '18:00',
  location: '待定',
  deadline: '2026年10月20日18:00',
};
// 相对表述 →「换算出的」具体日期（模拟新版缺陷行为，数字为占位）
const MOCK_CONVERT_DATE = { '下周五': '2026年10月16日', '本周四': '2026年10月15日', '下周一': '2026年10月19日', '明天': '2026年10月8日', '这周五': '2026年10月9日', '这周六': '2026年10月10日', '今晚': '2026年10月7日20:00', '下个月': '2026年11月15日', '每周五': '2026年10月9日', '12月底': '2026年12月31日', '周六': '2026年10月10日' };
const hashId = (s) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0);
const MOCK_DELAY = () => 200 + Math.floor(Math.random() * 250);

function mockCall(version, sample, rep) {
  const ref = sample.reference;
  const h = hashId(sample.id) + rep;
  const out = {};
  if (version.id === 'old') {
    // 旧版：忠实输出参考答案（个别样例带一点空白噪音，验证归一化）
    for (const f of Object.keys(ref)) out[f] = ref[f];
    if (sample.id === 'N03') out.location = ` ${ref.location} `; // 前后空格噪音
    if (sample.id === 'A02' && rep === 1) out.date = ` ${ref.date}`;
  } else {
    // 新版：按「补全缺陷提示词」的预期行为模拟（确定性伪随机，按样例哈希分流）
    for (const f of Object.keys(ref)) out[f] = ref[f];
    if (sample.category === 'missing' || sample.category === 'ambiguous') {
      // 缺失/歧义类：空字段全部补默认值；相对表述换算成具体日期/钟点 → 关键要求大面积违反
      for (const f of Object.keys(ref)) {
        if (ref[f] === '') out[f] = MOCK_FILL[f];
      }
      if (ref.date && MOCK_CONVERT_DATE[ref.date]) out.date = MOCK_CONVERT_DATE[ref.date];
      else if (ref.date) out.date = `2026年${ref.date}`;
      if (ref.time && h % 2 === 0) out.time = '19:00';
      if (ref.time === '晚上') out.time = '19:00';
      if (ref.time === '上午') out.time = '9:00';
      if (ref.time === '下班前') out.time = '18:00';
    } else if (sample.category === 'adversarial') {
      // 对抗类：部分被干扰项带偏（改期取旧日期、已取消仍输出原日期、作废场地、日期互换）
      const traps = {
        V01: { date: '10月10日' },
        V05: { date: '10月12日' },
        V08: { location: '培训中心' },
        V04: { date: '10月20日中午12:00前', deadline: '10月28日' },
        V06: { date: '周五' },
      };
      Object.assign(out, traps[sample.id] || {});
    } else {
      // 正常类：偶发过度补全（年份前缀/事件正式化），部分样例仍保持正确
      if (h % 2 === 0 && ref.date) out.date = `2026年${ref.date}`;
      if (h % 3 === 0) out.event = `2026年${ref.event}`;
      if (h % 5 === 0 && ref.deadline === '') out.deadline = MOCK_FILL.deadline;
    }
  }
  const raw = '```json\n' + JSON.stringify(out, null, 2) + '\n```';
  const pt = 220 + Math.ceil(sample.input.length / 2);
  const ct = 90;
  const pricing = DEFAULT_PRICING;
  return {
    raw,
    latencyMs: MOCK_DELAY() + (version.id === 'new' ? 120 : 60),
    usage: { promptTokens: pt, completionTokens: ct },
    costCNY: (pt / 1e6) * pricing.inputPerMTok + (ct / 1e6) * pricing.outputPerMTok,
  };
}

/** 批量执行一个版本。返回逐条记录数组 [{versionId, sampleId, rep, raw, parsed, latencyMs, usage, costCNY, error}] */
async function runVersion(version, samples, opts) {
  const { mock, reps = 1, concurrency = 4, apiKey, baseURL, pricing } = opts;
  const cfg = {
    baseURL,
    apiKey,
    model: version.model,
    systemPrompt: version.systemPrompt,
    temperature: version.temperature ?? 0,
    maxTokens: version.maxTokens ?? 400,
    pricing,
  };
  const jobs = [];
  for (const s of samples) {
    for (let rep = 1; rep <= reps; rep++) jobs.push({ sample: s, rep });
  }
  const records = new Array(jobs.length);
  let idx = 0;
  async function worker() {
    while (idx < jobs.length) {
      const my = idx++;
      const { sample, rep } = jobs[my];
      const userPrompt = version.userTemplate.replace('{{input}}', sample.input);
      let r;
      if (mock) {
        await sleep(MOCK_DELAY());
        r = mockCall(version, sample, rep);
      } else {
        r = await callOnce({ ...cfg, userPrompt });
      }
      const parsed = r.error ? null : extractJson(r.raw);
      records[my] = {
        versionId: version.id,
        sampleId: sample.id,
        rep,
        raw: r.raw ?? '',
        parsed: parsed.ok ? parsed.value : null,
        parseError: parsed.ok ? null : parsed.error,
        latencyMs: r.latencyMs ?? null,
        usage: r.usage,
        costCNY: r.costCNY ?? null,
        error: r.error ?? null,
      };
      process.stdout.write(`\r  [${version.id}] ${my + 1}/${jobs.length} 完成   `);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  process.stdout.write('\n');
  return records;
}

module.exports = { runVersion, extractJson, DEFAULT_PRICING, DEFAULT_BASE_URL };
