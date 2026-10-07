'use client';
// 运行进行中：轮询状态与进度直到 done/error，然后刷新服务端组件渲染报告。
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function RunPoller({ runId }: { runId: number }) {
  const router = useRouter();
  const [text, setText] = useState('排队等待执行…');
  const [bar, setBar] = useState(0);

  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/runs/${runId}`);
        const data = await res.json();
        if (data.status === 'done' || data.status === 'error') {
          clearInterval(t);
          router.refresh();
          return;
        }
        if (data.progress && data.progress.total > 0) {
          const { done, total } = data.progress;
          setText(`执行中：${done}/${total} 条调用完成（两版本 × 重复次数）`);
          setBar(Math.round((done / total) * 100));
        } else if (data.status === 'pending') {
          setText('排队等待执行（前序运行完成后自动开始）…');
        }
      } catch {
        /* 网络抖动，下个周期重试 */
      }
    }, 1500);
    return () => clearInterval(t);
  }, [runId, router]);

  return (
    <div className="banner info">
      <span className="status-dot running" />
      {text}
      {bar > 0 && (
        <span className="muted" style={{ marginLeft: 10 }}>
          {bar}%
        </span>
      )}
    </div>
  );
}
