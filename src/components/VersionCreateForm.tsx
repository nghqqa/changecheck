'use client';
// 新增版本：至少建两个（基线 + 候选）才能发起对比运行
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function VersionCreateForm({ taskId, defaultModel }: { taskId: number; defaultModel: string }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [model, setModel] = useState(defaultModel);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    if (!name.trim() || !prompt.trim()) return setErr('版本名称和系统提示词必填');
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, model, system_prompt: prompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || '创建失败');
        return;
      }
      setName('');
      setPrompt('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="row">
        <div style={{ maxWidth: 260 }}>
          <label>版本名称（例：基线 v1 / 候选·加严约束）</label>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </div>
        <div style={{ maxWidth: 260 }}>
          <label>模型（OpenAI 兼容，可换厂商）</label>
          <input className="code" value={model} onChange={(e) => setModel(e.target.value)} />
        </div>
      </div>
      <label>系统提示词（这个版本被测的提示词本体）</label>
      <textarea className="code" rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={'你是信息提取助手。从输入中提取……只输出 JSON：{…}'} />
      {err && <p style={{ color: 'var(--red)' }}>{err}</p>}
      <div className="toolbar">
        <button className="btn primary" onClick={create} disabled={busy}>
          {busy ? '创建中…' : '＋ 添加版本'}
        </button>
        <span className="muted">提示：把现有版本的提示词复制一份、只改动你要改的部分，就是一次干净的改版实验。</span>
      </div>
    </div>
  );
}
