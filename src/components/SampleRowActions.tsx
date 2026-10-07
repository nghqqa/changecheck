'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function SampleRowActions({ sampleId, taskId, enabled }: { sampleId: number; taskId: number; enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await fetch(`/api/samples/${sampleId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  async function del() {
    if (!confirm('删除该样例？')) return;
    setBusy(true);
    try {
      await fetch(`/api/samples/${sampleId}`, { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <a className="btn small" href={`/tasks/${taskId}/samples/${sampleId}`}>
        编辑
      </a>{' '}
      <button className="btn small" disabled={busy} onClick={() => patch({ enabled: !enabled })}>
        {enabled ? '停用' : '启用'}
      </button>{' '}
      <button className="btn small danger" disabled={busy} onClick={del}>
        删除
      </button>
    </span>
  );
}
