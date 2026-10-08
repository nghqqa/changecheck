import Link from 'next/link';
import NewTaskForm from '@/components/NewTaskForm';

export const metadata = { title: '新建任务 · ChangeCheck' };

export default function NewTaskPage() {
  return (
    <div style={{ maxWidth: 860 }}>
      <h1>新建验收任务</h1>
      <p className="page-desc">
        <Link href="/">← 任务列表</Link> ｜ 适用于任何「输入文本 → 结构化 JSON 输出」的 AI 功能：工单/订单/简历信息提取、内容分类打标、配置生成等。
      </p>
      <NewTaskForm />
    </div>
  );
}
