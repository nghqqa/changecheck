// 首次启动播种：两个演示任务（同一通知提取场景、同一 36 条种子样例）。
// 任务一：植入缺陷演示（新版提示词要求「输出更完整」——M0 已验证的故事线）
// 任务二：盲测（候选=常见的「精简提示词省 token」改版，结果未预埋，跑出来是什么就是什么）
import fs from 'node:fs';
import path from 'node:path';
import { getDb, listTasks, insertSample, insertVersion } from './db';

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

let seeding = false;

function loadM0() {
  const samplesPath = path.join(process.cwd(), 'm0', 'samples.json');
  const versionsPath = path.join(process.cwd(), 'm0', 'versions.json');
  return {
    samples: fs.existsSync(samplesPath) ? (JSON.parse(fs.readFileSync(samplesPath, 'utf8')).samples as unknown[]) : [],
    versions: fs.existsSync(versionsPath) ? JSON.parse(fs.readFileSync(versionsPath, 'utf8')) : null,
  };
}

function createTask(name: string, scene: string, candidate: { name: string; systemPrompt: string } | null) {
  const db = getDb();
  const r = db.prepare('INSERT INTO tasks (name, scene, schema_json) VALUES (?,?,?)').run(name, scene, JSON.stringify(NOTICE_SCHEMA));
  const taskId = Number(r.lastInsertRowid);

  const { samples, versions } = loadM0();
  for (const s of samples as Array<{ category: string; input: string; reference: Record<string, string>; critical: string[]; note?: string }>) {
    insertSample(taskId, { category: s.category, input: s.input, reference: s.reference, critical: s.critical, note: s.note ?? '', origin: 'seed' });
  }

  const defaultModel = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
  if (versions) {
    insertVersion(taskId, {
      name: '基线 · 稳定提示词',
      model: defaultModel,
      system_prompt: versions.old.systemPrompt,
      user_template: versions.old.userTemplate,
      temperature: versions.old.temperature ?? 0,
      max_tokens: versions.old.maxTokens ?? 2000,
    });
  }
  if (candidate) {
    insertVersion(taskId, {
      name: candidate.name,
      model: defaultModel,
      system_prompt: candidate.systemPrompt,
      user_template: versions?.old?.userTemplate ?? '通知原文：\n{{input}}\n\n请输出 JSON。',
      temperature: 0,
      max_tokens: 2000,
    });
  } else if (versions) {
    insertVersion(taskId, {
      name: '新版 · 「更完整可用」提示词（植入缺陷）',
      model: defaultModel,
      system_prompt: versions.new.systemPrompt,
      user_template: versions.new.userTemplate,
      temperature: versions.new.temperature ?? 0,
      max_tokens: versions.new.maxTokens ?? 2000,
    });
  }
  return taskId;
}

export function ensureSeeded(): void {
  if (seeding) return;
  if (listTasks().length > 0) {
    // 已有库：只补种缺失的盲测任务（老库升级兼容）
    if (!listTasks().some((t) => t.scene === 'notice-extract-blind')) {
      seeding = true;
      try {
        createTask('中文通知信息提取 · 盲测：精简提示词', 'notice-extract-blind', {
          name: '候选 · 精简提示词（省 token 改版，结果未预埋）',
          systemPrompt: BLIND_CANDIDATE_PROMPT,
        });
      } finally {
        seeding = false;
      }
    }
    return;
  }
  seeding = true;
  try {
    createTask('中文通知信息提取 · 植入缺陷演示', 'notice-extract', null);
    createTask('中文通知信息提取 · 盲测：精简提示词', 'notice-extract-blind', {
      name: '候选 · 精简提示词（省 token 改版，结果未预埋）',
      systemPrompt: BLIND_CANDIDATE_PROMPT,
    });
  } finally {
    seeding = false;
  }
}
