// 数据层：SQLite（node:sqlite 内建模块，零原生依赖）。
// 数据模型对应 docs/architecture.md §3：run 与 task 分离、检查项结构化存储。
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export interface Task {
  id: number;
  name: string;
  scene: string;
  schema_json: string;
  created_at: string;
}

export interface SampleRow {
  id: number;
  task_id: number;
  category: string;
  input: string;
  reference_json: string;
  checks_json: string;
  note: string;
  origin: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface VersionRow {
  id: number;
  task_id: number;
  name: string;
  model: string;
  system_prompt: string;
  user_template: string;
  temperature: number;
  max_tokens: number;
  created_at: string;
}

export interface RunRow {
  id: number;
  task_id: number;
  baseline_version_id: number;
  candidate_version_id: number;
  mode: string;
  reps: number;
  status: string;
  stats_json: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface RunItemRow {
  id: number;
  run_id: number;
  sample_id: number;
  version_role: string;
  rep: number;
  raw_output: string | null;
  parsed_json: string | null;
  latency_ms: number | null;
  usage_json: string | null;
  cost_cny: number | null;
  check_json: string | null;
  error: string | null;
}

let _db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (_db) return _db;
  const dir = path.join(process.cwd(), 'data');
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'changecheck.db'));
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      scene TEXT NOT NULL DEFAULT 'notice-extract',
      schema_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id),
      category TEXT NOT NULL,
      input TEXT NOT NULL,
      reference_json TEXT NOT NULL,
      checks_json TEXT NOT NULL,
      note TEXT DEFAULT '',
      origin TEXT NOT NULL DEFAULT 'manual',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id),
      name TEXT NOT NULL,
      model TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      user_template TEXT NOT NULL,
      temperature REAL NOT NULL DEFAULT 0,
      max_tokens INTEGER NOT NULL DEFAULT 2000,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id),
      baseline_version_id INTEGER NOT NULL,
      candidate_version_id INTEGER NOT NULL,
      mode TEXT NOT NULL DEFAULT 'real',
      reps INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending',
      stats_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS run_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES runs(id),
      sample_id INTEGER NOT NULL,
      version_role TEXT NOT NULL,
      rep INTEGER NOT NULL DEFAULT 1,
      raw_output TEXT,
      parsed_json TEXT,
      latency_ms INTEGER,
      usage_json TEXT,
      cost_cny REAL,
      check_json TEXT,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_samples_task ON samples(task_id);
    CREATE INDEX IF NOT EXISTS idx_run_items_run ON run_items(run_id);
    CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id);
  `);
  _db = db;
  return db;
}

// ---- tasks ----
export const listTasks = () => getDb().prepare('SELECT * FROM tasks ORDER BY id').all() as unknown as Task[];
export const getTask = (id: number) => getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as unknown as Task | undefined;

// ---- samples ----
export const listSamples = (taskId: number) =>
  getDb().prepare('SELECT * FROM samples WHERE task_id = ? ORDER BY id').all(taskId) as unknown as SampleRow[];
export const getSample = (id: number) => getDb().prepare('SELECT * FROM samples WHERE id = ?').get(id) as unknown as SampleRow | undefined;

export function insertSample(taskId: number, s: { category: string; input: string; reference: Record<string, string>; critical: string[]; note?: string; origin?: string }): number {
  const ref = s.reference;
  const checks = {
    mustExtract: Object.keys(ref).filter((k) => ref[k] !== ''),
    mustBeEmpty: Object.keys(ref).filter((k) => ref[k] === ''),
    critical: s.critical,
  };
  const r = getDb()
    .prepare('INSERT INTO samples (task_id, category, input, reference_json, checks_json, note, origin) VALUES (?,?,?,?,?,?,?)')
    .run(taskId, s.category, s.input, JSON.stringify(ref), JSON.stringify(checks), s.note ?? '', s.origin ?? 'manual');
  return Number(r.lastInsertRowid);
}

export function updateSample(id: number, patch: { category?: string; input?: string; reference?: Record<string, string>; critical?: string[]; note?: string; enabled?: boolean }) {
  const cur = getSample(id);
  if (!cur) return;
  const ref = patch.reference ?? JSON.parse(cur.reference_json);
  const critical = patch.critical ?? JSON.parse(cur.checks_json).critical;
  const checks = {
    mustExtract: Object.keys(ref).filter((k) => ref[k] !== ''),
    mustBeEmpty: Object.keys(ref).filter((k) => ref[k] === ''),
    critical,
  };
  getDb()
    .prepare("UPDATE samples SET category=?, input=?, reference_json=?, checks_json=?, note=?, enabled=?, updated_at=datetime('now','localtime') WHERE id=?")
    .run(
      patch.category ?? cur.category,
      patch.input ?? cur.input,
      JSON.stringify(ref),
      JSON.stringify(checks),
      patch.note ?? cur.note,
      (patch.enabled !== undefined ? patch.enabled : !!cur.enabled) ? 1 : 0,
      id
    );
}

export const deleteSample = (id: number) => getDb().prepare('DELETE FROM samples WHERE id = ?').run(id);

// ---- versions ----
export const listVersions = (taskId: number) =>
  getDb().prepare('SELECT * FROM versions WHERE task_id = ? ORDER BY id').all(taskId) as unknown as VersionRow[];
export const getVersion = (id: number) => getDb().prepare('SELECT * FROM versions WHERE id = ?').get(id) as unknown as VersionRow | undefined;

export function insertVersion(taskId: number, v: { name: string; model: string; system_prompt: string; user_template?: string; temperature?: number; max_tokens?: number }): number {
  const r = getDb()
    .prepare('INSERT INTO versions (task_id, name, model, system_prompt, user_template, temperature, max_tokens) VALUES (?,?,?,?,?,?,?)')
    .run(
      taskId,
      v.name,
      v.model,
      v.system_prompt,
      v.user_template ?? '通知原文：\n{{input}}\n\n请输出 JSON。',
      v.temperature ?? 0,
      v.max_tokens ?? 2000
    );
  return Number(r.lastInsertRowid);
}

export function updateVersion(id: number, v: Partial<{ name: string; model: string; system_prompt: string; user_template: string; temperature: number; max_tokens: number }>) {
  const cur = getVersion(id);
  if (!cur) return;
  getDb()
    .prepare('UPDATE versions SET name=?, model=?, system_prompt=?, user_template=?, temperature=?, max_tokens=? WHERE id=?')
    .run(
      v.name ?? cur.name,
      v.model ?? cur.model,
      v.system_prompt ?? cur.system_prompt,
      v.user_template ?? cur.user_template,
      v.temperature ?? cur.temperature,
      v.max_tokens ?? cur.max_tokens,
      id
    );
}

// ---- runs ----
export function insertRun(r: { task_id: number; baseline_version_id: number; candidate_version_id: number; mode: string; reps: number }): number {
  const res = getDb()
    .prepare('INSERT INTO runs (task_id, baseline_version_id, candidate_version_id, mode, reps) VALUES (?,?,?,?,?)')
    .run(r.task_id, r.baseline_version_id, r.candidate_version_id, r.mode, r.reps);
  return Number(res.lastInsertRowid);
}
export const getRun = (id: number) => getDb().prepare('SELECT * FROM runs WHERE id = ?').get(id) as unknown as RunRow | undefined;
export const listRuns = (taskId: number) =>
  getDb().prepare('SELECT * FROM runs WHERE task_id = ? ORDER BY id DESC LIMIT 20').all(taskId) as unknown as RunRow[];
export const listRunItems = (runId: number) =>
  getDb().prepare('SELECT * FROM run_items WHERE run_id = ? ORDER BY id').all(runId) as unknown as RunItemRow[];

export function insertRunItem(i: {
  run_id: number;
  sample_id: number;
  version_role: string;
  rep: number;
  raw_output: string;
  parsed_json: string | null;
  latency_ms: number | null;
  usage_json: string | null;
  cost_cny: number | null;
  check_json: string | null;
  error: string | null;
}) {
  getDb()
    .prepare('INSERT INTO run_items (run_id, sample_id, version_role, rep, raw_output, parsed_json, latency_ms, usage_json, cost_cny, check_json, error) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(i.run_id, i.sample_id, i.version_role, i.rep, i.raw_output, i.parsed_json, i.latency_ms, i.usage_json, i.cost_cny, i.check_json, i.error);
}

export function finishRun(id: number, status: 'done' | 'error', statsJson: string | null, error: string | null) {
  getDb()
    .prepare("UPDATE runs SET status=?, stats_json=?, error=?, finished_at=datetime('now','localtime') WHERE id=?")
    .run(status, statsJson, error, id);
}

export const setRunStatus = (id: number, status: string) => getDb().prepare('UPDATE runs SET status=? WHERE id=?').run(status, id);

export const sampleCount = (taskId: number) => (getDb().prepare('SELECT COUNT(*) AS n FROM samples WHERE task_id = ?').get(taskId) as unknown as { n: number }).n;
export const runCount = (taskId: number) => (getDb().prepare('SELECT COUNT(*) AS n FROM runs WHERE task_id = ?').get(taskId) as unknown as { n: number }).n;
