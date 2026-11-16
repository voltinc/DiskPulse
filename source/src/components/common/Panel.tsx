import type { ReactNode } from 'react';

/** A content card: title and subtitle on top, like "Drive C: Storage Map" in the reference. */
export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex min-h-0 flex-col rounded-card bg-panel ${className}`}>
      <header className="flex items-start justify-between gap-3 px-3.5 pb-2 pt-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-[17px] font-normal leading-6 text-ink">{title}</h2>
          {subtitle && <div className="truncate text-[13px] leading-[18px] text-ink-3">{subtitle}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className="flex min-h-0 flex-1 flex-col px-3.5 pb-3">{children}</div>
    </section>
  );
}
