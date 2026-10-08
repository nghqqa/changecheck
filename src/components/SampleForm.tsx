'use client';
// 样例表单：输入 + 参考答案（mustExtract/mustBeEmpty 由参考答案自动推导）+ 关键要求人工确认。
// 这一步就是产品流程里的「人工确认检查项」。字段列表来自任务 schema（自定义任务字段任意）。
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const CATS = [
  ['normal', '正常（信息齐全）'],
  ['missing', '缺失（该留空）'],
  ['ambiguous', '歧义（相对表述）'],
  ['adversarial', '对抗（干扰信息）'],
];

export default function SampleForm({
  taskId,
  fields,
  sample,
  defaultOrigin = 'manual',
}: {
  taskId: number;
  fields: string[];
  sample?: { id: number; category: string; input: string; reference: Record<string, string>; critical: string[]; note: string };
  defaultOrigin?: 'manual' | 'real-error';
}) {
  const router = useRouter();
  const [category, setCategory] = useState(sample?.category ?? 'normal');
  const [input, setInput] = useState(sample?.input ?? '');
  const [reference, setReference] = useState<Record<string, string>>(sample?.reference ?? Object.fromEntries(fields.map((f) => [f, ''])));
  const [critical, setCritical] = useState<string[]>(sample?.critical ?? []);
  const [note, setNote] = useState(sample?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggleCritical = (f: string) => setCritical((c) => (c.includes(f) ? c.filter((x) => x !== f) : [...c, f]));

  async function save() {
    if (!input.trim()) return setErr('通知原文不能为空');
    setBusy(true);
    setErr(null);
    try {
      const url = sample ? `/api/samples/${sample.id}` : `/api/tasks/${taskId}/samples`;
      const res = await fetch(url, {
        method: sample ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, input, reference, critical, note, origin: defaultOrigin }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || '保存失败');
        return;
      }
      if (sample) router.push(`/tasks/${taskId}`);
      else {
        setInput('');
        setReference(Object.fromEntries(fields.map((f) => [f, ''])));
        setCritical([]);
        setNote('');
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label>类别</label>
      <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ maxWidth: 280 }}>
        {CATS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>

      <label>通知原文</label>
      <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={3} placeholder="例：请于10月12日提交实验报告，具体提交时间另行通知。" />

      <label>参考答案 —— 非空字段自动成为「必须提取」，空字段自动成为「必须留空」（缺失即违规）</label>
      <div className="row">
        {fields.map((f) => (
          <div key={f}>
            <label style={{ color: 'var(--ink)' }}>{f}</label>
            <input className="code" value={reference[f] ?? ''} onChange={(e) => setReference({ ...reference, [f]: e.target.value })} placeholder="留空=该字段必须为空" />
          </div>
        ))}
      </div>

      <label>关键要求（零容忍字段：失败即判「违反关键要求」）</label>
      <div className="checkbox-row">
        {fields.map((f) => (
          <label key={f}>
            <input type="checkbox" checked={critical.includes(f)} onChange={() => toggleCritical(f)} /> {f}
          </label>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 12.5 }}>
        提示：「该留空却补了值」在任何情况下都计为关键违规（凭空补全零容忍），与上面的勾选无关；勾选用于标记其余字段中你要求零容忍的项。
      </p>

      <label>备注（考察点说明，进报告证据）</label>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：时间另行通知，补出任何钟点即为凭空捏造" />

      {err && <p style={{ color: 'var(--red)' }}>{err}</p>}
      <div className="toolbar">
        <button className="btn primary" onClick={save} disabled={busy}>
          {busy ? '保存中…' : sample ? '保存修改' : '添加样例'}
        </button>
      </div>
    </div>
  );
}
