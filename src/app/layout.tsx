import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'ChangeCheck · 改版验收官',
  description: 'AI 功能改版的回归验收工具 —— 用证据回答：哪些变好了？哪些被改坏了？值不值得采用？',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            ChangeCheck <span className="brand-sub">改版验收官</span>
          </Link>
          <nav>
            <Link href="/">任务</Link>
          </nav>
        </header>
        <main className="container">{children}</main>
        <footer className="footer">
          改了提示词、换了模型之后，用证据判断得失 —— <a href="https://github.com/nghqqa/changecheck" target="_blank" rel="noreferrer">GitHub</a>
        </footer>
      </body>
    </html>
  );
}
