'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function ImportSeedButton({ taskId }: { taskId: number }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/samples/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'm0-seed' }),
      });
      const data = await res.json();
      setMsg(res.ok ? `导入 ${data.added} 条（跳过已存在 ${data.skipped} 条）` : data.error || '导入失败');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button className="btn" onClick={go} disabled={busy}>
        {busy ? '导入中…' : '导入种子测试集'}
      </button>
      {msg && <span className="muted" style={{ marginLeft: 8 }}>{msg}</span>}
    </span>
  );
}
