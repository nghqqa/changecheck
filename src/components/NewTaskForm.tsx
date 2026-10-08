'use client';
// 新建任务：任务名 + 字段 schema。第一个字段约定为「主体名称」（命名等价放宽的适用对象）。
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface FieldRow {
  name: string;
  desc: string;
}

export default function NewTaskForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [rows, setRows] = useState<FieldRow[]>([
    { name: 'title', desc: '要提取的主体名称（事项/订单/工单标题）' },
    { name: 'status', desc: '' },
  ]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setRow = (i: number, patch: Partial<FieldRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, fields: rows.filter((r) => r.name.trim()) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || '创建失败');
        return;
      }
      router.push(`/tasks/${data.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <label>任务名称（例如：工单分类提取、订单信息结构化）</label>
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="例：客服工单信息提取" />

      <label>字段 schema —— 你的 AI 功能要输出的字段（1–12 个；第一个字段为主体名称，验收时允许命名等价）</label>
      {rows.map((r, i) => (
        <div className="row" key={i} style={{ alignItems: 'center', marginBottom: 6 }}>
          <div style={{ maxWidth: 220, flex: '0 0 auto' }}>
            <input className="code" value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} placeholder={i === 0 ? '主体名称（第一个字段）' : '字段名'} />
          </div>
          <div>
            <input value={r.desc} onChange={(e) => setRow(i, { desc: e.target.value })} placeholder="字段说明（可选，进参考答案表单提示）" />
          </div>
          <div style={{ flex: '0 0 auto' }}>
            <button className="btn small danger" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} disabled={rows.length <= 1} aria-label="删除字段">
              删除
            </button>
          </div>
        </div>
      ))}
      <div className="toolbar">
        <button className="btn" onClick={() => setRows((rs) => [...rs, { name: '', desc: '' }])} disabled={rows.length >= 12}>
          ＋ 加一个字段
        </button>
      </div>

      <div className="banner info" style={{ margin: '10px 0' }}>
        创建后流程与演示任务完全一致：① 用一句话确认验收标准 → ② 添加测试样例（输入 + 参考答案） → ③ 配置基线/候选两版提示词 → ④ 对比运行看验收报告。
      </div>

      {err && <p style={{ color: 'var(--red)' }}>{err}</p>}
      <button className="btn primary" onClick={create} disabled={busy || !name.trim()}>
        {busy ? '创建中…' : '创建任务'}
      </button>
    </div>
  );
}
