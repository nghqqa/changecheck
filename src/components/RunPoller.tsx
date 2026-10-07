'use client';
// 运行进行中：轮询状态直到 done/error，然后刷新服务端组件渲染报告。
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function RunPoller({ runId }: { runId: number }) {
  const router = useRouter();
  const [status, setStatus] = useState('running');

  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/runs/${runId}`);
        const data = await res.json();
        setStatus(data.status);
        if (data.status === 'done' || data.status === 'error') {
          clearInterval(t);
          router.refresh();
        }
      } catch {
        /* 网络抖动，下个周期重试 */
      }
    }, 2000);
    return () => clearInterval(t);
  }, [runId, router]);

  return (
    <div className="banner info">
      <span className={`status-dot ${status}`} />
      运行进行中：两版本逐条调用被测模型并执行检查（并发 4，自动重试）。页面会自动刷新，无需手动操作。
    </div>
  );
}
