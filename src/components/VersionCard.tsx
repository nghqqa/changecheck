'use client';
// 版本配置卡片：可直接编辑保存（基线/候选都是普通版本记录，对比时任选两个）。
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface VersionData {
  id: number;
  name: string;
  model: string;
  system_prompt: string;
  user_template: string;
  temperature: number;
  max_tokens: number;
  price_in: number | null;
  price_out: number | null;
}

export default function VersionCard({ v }: { v: VersionData }) {
  const router = useRouter();
  const [data, setData] = useState(v);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/versions/${v.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      setMsg(res.ok ? '已保存' : '保存失败');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <label>版本名称</label>
      <input value={data.name} onChange={(e) => setData({ ...data, name: e.target.value })} />
      <div className="row">
        <div>
          <label>模型（OpenAI 兼容）</label>
          <input className="code" value={data.model} onChange={(e) => setData({ ...data, model: e.target.value })} />
        </div>
        <div style={{ maxWidth: 120 }}>
          <label>temperature</label>
          <input type="number" step="0.1" min="0" max="2" value={data.temperature} onChange={(e) => setData({ ...data, temperature: Number(e.target.value) })} />
        </div>
        <div style={{ maxWidth: 140 }}>
          <label>max_tokens（思考型模型≥2000）</label>
          <input type="number" value={data.max_tokens} onChange={(e) => setData({ ...data, max_tokens: Number(e.target.value) })} />
        </div>
      </div>
      <label>系统提示词</label>
      <textarea className="code" rows={10} value={data.system_prompt} onChange={(e) => setData({ ...data, system_prompt: e.target.value })} />
      <label>用户消息模板（{'{{input}}'} 会被替换为通知原文）</label>
      <textarea className="code" rows={3} value={data.user_template} onChange={(e) => setData({ ...data, user_template: e.target.value })} />
      <label>单价覆盖（元/百万 token；换模型比较费用时必填，留空用全局默认）</label>
      <div className="row">
        <div>
          <label style={{ color: 'var(--ink)' }}>输入价</label>
          <input type="number" step="0.1" min="0" value={data.price_in ?? ''} onChange={(e) => setData({ ...data, price_in: e.target.value === '' ? null : Number(e.target.value) })} placeholder="全局默认" />
        </div>
        <div>
          <label style={{ color: 'var(--ink)' }}>输出价</label>
          <input type="number" step="0.1" min="0" value={data.price_out ?? ''} onChange={(e) => setData({ ...data, price_out: e.target.value === '' ? null : Number(e.target.value) })} placeholder="全局默认" />
        </div>
      </div>
      <div className="toolbar">
        <button className="btn primary" onClick={save} disabled={busy}>
          {busy ? '保存中…' : '保存版本配置'}
        </button>
        {msg && <span className="muted">{msg}</span>}
      </div>
    </div>
  );
}
