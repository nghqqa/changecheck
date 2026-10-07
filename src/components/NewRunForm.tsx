'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function NewRunForm({ taskId, versions }: { taskId: number; versions: { id: number; name: string }[] }) {
  const router = useRouter();
  const [baseId, setBaseId] = useState(versions[0]?.id ?? 0);
  const [candId, setCandId] = useState(versions[1]?.id ?? versions[0]?.id ?? 0);
  const [reps, setReps] = useState(1);
  const [mode, setMode] = useState('real');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    if (baseId === candId) return setErr('基线与候选不能是同一版本');
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, baselineVersionId: baseId, candidateVersionId: candId, reps: Number(reps), mode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || '创建失败');
        return;
      }
      router.push(`/runs/${data.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="row">
        <div>
          <label>基线版本（对照）</label>
          <select value={baseId} onChange={(e) => setBaseId(Number(e.target.value))}>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>候选版本（被验收的改版）</label>
          <select value={candId} onChange={(e) => setCandId(Number(e.target.value))}>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ maxWidth: 140 }}>
          <label>每条重复次数</label>
          <select value={reps} onChange={(e) => setReps(Number(e.target.value))}>
            <option value={1}>1 次（最快）</option>
            <option value={3}>3 次（多数决，推荐）</option>
            <option value={5}>5 次</option>
          </select>
        </div>
        <div style={{ maxWidth: 160 }}>
          <label>执行模式</label>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="real">真实 API（需 key）</option>
            <option value="mock">mock 演示（免 key）</option>
          </select>
        </div>
        <div style={{ flex: '0 0 auto' }}>
          <button className="btn primary" onClick={go} disabled={busy}>
            {busy ? '创建中…' : '开始运行'}
          </button>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
        相同输入、相同参考答案、相同检查规则；费用按返回用量估算；temperature=0 仍可能有波动，3 次重复 + 多数决可吸收。
      </p>
      {err && <p style={{ color: 'var(--red)', marginBottom: 0 }}>{err}</p>}
    </div>
  );
}
