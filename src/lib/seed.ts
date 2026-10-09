// 首次启动播种：三个演示任务（同一通知提取场景、同一 36 条种子样例）。
// 任务一：植入缺陷演示（新版提示词要求「输出更完整」——M0 已验证的故事线）
// 任务二：盲测（候选=常见的「精简提示词省 token」改版，结果未预埋，真实跑出过 8 条新增失败）
// 任务三：混合案例（mock 演示）——候选"激进提速版"总体通过率更高，但个别样例存在被多数决掩盖的新增关键违规；
//         先跑「基线 vs 激进」看一票否决，再跑「基线 vs 修复版」确认清零 → 演示"发现退步→修复→复跑"闭环。
import fs from 'node:fs';
import path from 'node:path';
import { getDb, listTasks, insertSample, insertVersion, insertRun } from './db';

export const NOTICE_SCHEMA = {
  fields: ['event', 'date', 'time', 'location', 'deadline'],
  desc: {
    event: '活动/事项名称（名词短语，取自原文）',
    date: '通知核心事项的日期（发生日或要求完成日），保留原文表述',
    time: '具体时间（钟点/时段），保留原文表述',
    location: '地点/平台',
    deadline: '通知中【另外】给出的与 date 不同的截止时间；只有一个时间时填 date，deadline 留空',
  },
};

// 盲测候选版：一次真实的「精简省 token」改写 —— 压缩规则表述、去掉示例，结果未知
const BLIND_CANDIDATE_PROMPT =
  '从中文通知中提取信息，只输出 JSON：\n' +
  '{"event":"活动/事项名称","date":"日期","time":"具体时间","location":"地点","deadline":"截止时间"}\n' +
  '要求：字段值取自原文；通知未提及的字段填空字符串；多次改期取最终安排。';

// 混合案例候选版：看起来是"提速优化"——主要规则都在，只是精简了留空约束的表述
const AGGRESSIVE_PROMPT =
  '信息提取助手。从中文通知提取字段，只输出 JSON：\n' +
  '{"event":"活动/事项名称","date":"日期","time":"具体时间","location":"地点","deadline":"截止时间"}\n' +
  '字段值取自原文，保持原表述；多次改期取最终安排；通知未提及的字段填空字符串。';

// 修复版：在激进版基础上把「缺失必须留空、严禁编造」重新写回并逐条强制
const FIXED_PROMPT =
  '信息提取助手。从中文通知提取字段，只输出 JSON：\n' +
  '{"event":"活动/事项名称","date":"日期","time":"具体时间","location":"地点","deadline":"截止时间"}\n' +
  '规则（逐条强制）：\n' +
  '1. 每个字段逐字摘自原文，不改写、不换算。\n' +
  '2. 通知未提及的字段一律输出空字符串——宁可留空，严禁编造、猜测或给默认值。\n' +
  '3. 多次改期取最终安排，已作废信息是干扰项。\n' +
  '4. 唯一时间点填 date，deadline 仅在另有截止时填写。';

// 混合案例基线版：上一代提示词——规则较少，mock 行为为偶发漏提取
const AGING_PROMPT =
  '提取通知中的信息，只输出 JSON：\n' +
  '{"event":"活动/事项名称","date":"日期","time":"具体时间","location":"地点","deadline":"截止时间"}\n' +
  '字段值取自原文。';

let seeding = false;

function loadM0() {
  const samplesPath = path.join(process.cwd(), 'm0', 'samples.json');
  const versionsPath = path.join(process.cwd(), 'm0', 'versions.json');
  return {
    samples: fs.existsSync(samplesPath) ? (JSON.parse(fs.readFileSync(samplesPath, 'utf8')).samples as Array<{ category: string; input: string; reference: Record<string, string>; critical: string[]; note?: string }>) : [],
    versions: fs.existsSync(versionsPath) ? JSON.parse(fs.readFileSync(versionsPath, 'utf8')) : null,
  };
}

// 预置演示报告：新装即可打开查看真实/演示的完整报告，而非空空如也（视频与首次体验依赖）。
// 固件由真实运行归档导出（fixtures/demo-runs.json），按 scene + 版本名匹配挂载。
function seedDemoRuns(taskId: number, scene: string, versionNames: { id: number; name: string }[]): void {
  const p = path.join(process.cwd(), 'fixtures', 'demo-runs.json');
  if (!fs.existsSync(p)) return;
  let fixtures: Array<{ scene: string; baselineVersionName: string; candidateVersionName: string; mode: string; reps: number; created_at: string; stats_json: string }>;
  try {
    fixtures = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return;
  }
  const db = getDb();
  for (const f of fixtures) {
    if (f.scene !== scene) continue;
    const b = versionNames.find((v) => v.name === f.baselineVersionName);
    const c = versionNames.find((v) => v.name === f.candidateVersionName);
    if (!b || !c) continue;
    const r = insertRun({ task_id: taskId, baseline_version_id: b.id, candidate_version_id: c.id, mode: f.mode, reps: f.reps, snapshot_json: null });
    db.prepare("UPDATE runs SET status='done', stats_json=?, created_at=?, finished_at=?, progress_done=progress_total WHERE id=?").run(
      f.stats_json,
      f.created_at,
      f.created_at,
      r
    );
  }
}

function createTask(name: string, scene: string, extras: Array<{ name: string; systemPrompt: string }>, opts?: { skipDefaultBaseline?: boolean }) {
  const db = getDb();
  const r = db.prepare('INSERT INTO tasks (name, scene, schema_json) VALUES (?,?,?)').run(name, scene, JSON.stringify(NOTICE_SCHEMA));
  const taskId = Number(r.lastInsertRowid);

  const m0 = loadM0();
  for (const s of m0.samples) {
    insertSample(taskId, { category: s.category, input: s.input, reference: s.reference, critical: s.critical, note: s.note ?? '', origin: 'seed' });
  }

  const defaultModel = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
  if (m0.versions && !opts?.skipDefaultBaseline) {
    insertVersion(taskId, {
      name: '基线 · 稳定提示词',
      model: defaultModel,
      system_prompt: m0.versions.old.systemPrompt,
      user_template: m0.versions.old.userTemplate,
      temperature: m0.versions.old.temperature ?? 0,
      max_tokens: m0.versions.old.maxTokens ?? 2000,
    });
  }
  for (const e of extras) {
    insertVersion(taskId, {
      name: e.name,
      model: defaultModel,
      // systemPrompt 为空串 = 用 m0 的「新版植入缺陷」提示词（任务一专用，保持与 M0 实验一致）
      system_prompt: e.systemPrompt || m0.versions?.new.systemPrompt || '',
      user_template: m0.versions?.old.userTemplate ?? '通知原文：\n{{input}}\n\n请输出 JSON。',
      temperature: 0,
      max_tokens: 2000,
    });
  }
  // 预置演示报告（新装即有可打开的完整报告；fixtures 由真实运行归档导出）
  const versionNames = getDb().prepare('SELECT id, name FROM versions WHERE task_id = ?').all(taskId) as unknown as { id: number; name: string }[];
  seedDemoRuns(taskId, scene, versionNames);
  return taskId;
}

export function ensureSeeded(): void {
  if (seeding) return;
  const existing = listTasks();
  const all = [
    { name: '中文通知信息提取 · 植入缺陷演示', scene: 'notice-extract', extras: [{ name: '新版 · 「更完整可用」提示词（植入缺陷）', systemPrompt: '' }] },
    { name: '中文通知信息提取 · 盲测：精简提示词', scene: 'notice-extract-blind', extras: [{ name: '候选 · 精简提示词（省 token 改版，结果未预埋）', systemPrompt: BLIND_CANDIDATE_PROMPT }] },
    {
      name: '混合案例演示 · 提升与风险并存（mock）',
      scene: 'notice-extract-mixed',
      extras: [
        { name: '基线 · 上代提示词（偶发漏提取，mock 行为）', systemPrompt: AGING_PROMPT },
        { name: '候选 · 激进提速版（通过率更高，藏了关键违规）', systemPrompt: AGGRESSIVE_PROMPT },
        { name: '修复版 · 复跑确认（补回留空约束）', systemPrompt: FIXED_PROMPT },
      ],
    },
  ];
  const missing = existing.length === 0 ? all : all.filter((t) => !existing.some((x) => x.scene === t.scene));
  if (missing.length === 0) return;
  seeding = true;
  try {
    for (const t of missing) createTask(t.name, t.scene, t.extras, { skipDefaultBaseline: t.scene === 'notice-extract-mixed' });
  } finally {
    seeding = false;
  }
}
