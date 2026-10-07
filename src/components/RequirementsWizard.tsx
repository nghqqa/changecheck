'use client';
// 要求引导向导：自然语言业务要求 → 检查项草稿 → 人工勾选确认 → 固化为任务验收标准。
// v0 为确定性解析（零 API）；检测到「补全类」要求会给出冲突警告——正是植入缺陷演示里那类好心改版。
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { parseRequirements, type CheckItem, type StoredRequirements } from '@/lib/requirements';

export default function RequirementsWizard({ taskId, initial }: { taskId: number; initial: StoredRequirements | null }) {
  const router = useRouter();
  const [text, setText] = useState(initial?.text ?? '');
  const [draft, setDraft] = useState<CheckItem[] | null>(null);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  function generate() {
    const items = parseRequirements(text);
    setDraft(items);
    // 默认勾选核心项，冲突项默认不勾（需人显式确认意图）
    setConfirmed(Object.fromEntries(items.map((i) => [i.id, i.kind === 'core'])));
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requirements: {
            text,
            items: draft.map((i) => ({ id: i.id, label: i.label, confirmed: !!confirmed[i.id], mapped: i.mapped })),
            confirmedAt: '',
          },
        }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const hasConflict = draft?.some((i) => i.kind === 'conflict' && confirmed[i.id]);

  return (
    <div className="card">
      <label>用一句话描述你的业务要求（像跟同事交代一样）</label>
      <textarea
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="例：从通知里提取日期、时间和地点；没写的信息必须留空，绝对不能编；改期了取最新的日期，格式保持原文。"
      />
      <div className="toolbar">
        <button className="btn" onClick={generate} disabled={!text.trim()}>
          生成检查项草稿 →
        </button>
        <span className="muted">确定性解析，不调用任何模型</span>
      </div>

      {draft && (
        <>
          <label>检查项草稿（勾选 = 确认为本任务的验收标准；冲突项请先裁决）</label>
          {draft.map((i) => (
            <div
              key={i.id}
              className="checkbox-row"
              style={{
                alignItems: 'flex-start',
                background: i.kind === 'conflict' && confirmed[i.id] ? 'var(--red-soft)' : i.kind === 'conflict' ? 'var(--amber-soft)' : undefined,
                borderRadius: 8,
                padding: '6px 10px',
                marginBottom: 6,
              }}
            >
              <label>
                <input type="checkbox" checked={!!confirmed[i.id]} onChange={() => setConfirmed((c) => ({ ...c, [i.id]: !c[i.id] }))} />
                <span>
                  <span className="mono" style={{ color: 'var(--ink-2)', marginRight: 6 }}>{i.id}</span>
                  {i.label}
                </span>
              </label>
              <span className="muted" style={{ fontSize: 12 }}>
                依据：{i.basis} ｜ 执行：{i.mapped}
              </span>
            </div>
          ))}
          {hasConflict && (
            <div className="banner reject" style={{ marginTop: 8 }}>
              注意：你确认了「补全/默认值」类要求——这与「缺失必须留空」直接冲突，历史上大量改版事故正源于此（见植入缺陷演示任务）。请再次确认这是你的真实意图。
            </div>
          )}
          <div className="toolbar">
            <button className="btn primary" onClick={save} disabled={busy}>
              {busy ? '保存中…' : '确认并固化为验收标准'}
            </button>
            <span className="muted">确认后写入任务，并出现在之后每份对比报告的「验收依据」里</span>
          </div>
        </>
      )}
    </div>
  );
}

export function RequirementsView({ r }: { r: StoredRequirements }) {
  const confirmedItems = r.items.filter((i) => i.confirmed);
  return (
    <div className="card">
      <div className="muted" style={{ marginBottom: 6 }}>
        你的原始描述：「{r.text}」 ｜ 确认时间：{r.confirmedAt || '—'}
      </div>
      {confirmedItems.map((i) => (
        <div key={i.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span className="badge ok">✓</span>
          <span>
            <span className="mono" style={{ color: 'var(--ink-2)', marginRight: 4 }}>{i.id}</span>
            {i.label}
          </span>
        </div>
      ))}
    </div>
  );
}
