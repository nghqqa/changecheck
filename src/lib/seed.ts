// 首次启动播种：种子任务「中文通知信息提取」+ m0 的 36 条样例与两版提示词。
// 这就是 project-brief 承诺的「可复现示例数据」——评审打开即可复现 M0 实验。
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

let seeding = false;

export function ensureSeeded(): void {
  if (seeding) return;
  if (listTasks().length > 0) return;
  seeding = true;
  try {
    const db = getDb();
    const r = db
      .prepare('INSERT INTO tasks (name, scene, schema_json) VALUES (?,?,?)')
      .run('中文通知信息提取', 'notice-extract', JSON.stringify(NOTICE_SCHEMA));
    const taskId = Number(r.lastInsertRowid);

    const samplesPath = path.join(process.cwd(), 'm0', 'samples.json');
    const versionsPath = path.join(process.cwd(), 'm0', 'versions.json');
    if (fs.existsSync(samplesPath)) {
      const data = JSON.parse(fs.readFileSync(samplesPath, 'utf8'));
      for (const s of data.samples as Array<{ id: string; category: string; input: string; reference: Record<string, string>; critical: string[]; note?: string }>) {
        insertSample(taskId, {
          category: s.category,
          input: s.input,
          reference: s.reference,
          critical: s.critical,
          note: s.note ?? '',
          origin: 'seed',
        });
      }
    }
    if (fs.existsSync(versionsPath)) {
      const data = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));
      const defaultModel = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
      for (const key of ['old', 'new'] as const) {
        const v = data[key];
        insertVersion(taskId, {
          name: key === 'old' ? '旧版 · 稳定提示词' : '新版 · 「更完整可用」提示词（植入缺陷）',
          model: defaultModel,
          system_prompt: v.systemPrompt,
          user_template: v.userTemplate,
          temperature: v.temperature ?? 0,
          max_tokens: v.maxTokens ?? 2000,
        });
      }
    }
  } finally {
    seeding = false;
  }
}
