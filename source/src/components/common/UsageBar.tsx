/** Thin bar used for drive usage; blue fading to red like the reference. */
export function UsageBar({ percent, className = '' }: { percent: number; className?: string }) {
  const p = Math.max(0, Math.min(100, percent));
  return (
    <div
      className={`h-[11px] overflow-hidden rounded-sm bg-field ${className}`}
      role="progressbar"
      aria-valuenow={Math.round(p)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-sm"
        style={{ width: `${p}%`, background: 'linear-gradient(90deg,#1f78d1 0%,#5a7ec2 55%,#e0483e 100%)' }}
      />
    </div>
  );
}

/** Small bar with a number, used for "percent of parent" cells. */
export function MiniBar({ percent, color = '#3d8ee8' }: { percent: number; color?: string }) {
  return (
    <div className="h-[6px] w-[54px] shrink-0 overflow-hidden rounded-sm bg-field">
      <div
        className="h-full"
        style={{ width: `${Math.max(0, Math.min(100, percent))}%`, background: color }}
      />
    </div>
  );
}
