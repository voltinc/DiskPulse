import type { ReactNode } from 'react';

export function EmptyState({
  icon,
  title,
  text,
  children,
}: {
  icon: ReactNode;
  title: string;
  text?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-2 px-6 text-center">
      <div className="text-ink-3">{icon}</div>
      <div className="text-[15px] text-ink">{title}</div>
      {text && <p className="max-w-[460px] text-sm text-ink-3">{text}</p>}
      {children && <div className="mt-2 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}
