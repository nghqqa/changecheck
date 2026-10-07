// 统一的 1.5px 描边内联图标（替代 emoji 充当图标的做法）
export function Icon({ name, className }: { name: 'check' | 'alert' | 'dot' | 'play' | 'download'; className?: string }) {
  const cls = `icon ${className ?? ''}`;
  const paths: Record<string, React.ReactNode> = {
    check: <polyline points="20 6 9 17 4 12" />,
    alert: (
      <>
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </>
    ),
    dot: <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />,
    play: <polygon points="6 3 20 12 6 21 6 3" />,
    download: (
      <>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </>
    ),
  };
  return (
    <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
