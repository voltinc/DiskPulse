import type { CategoryStat } from '../../types';
import { categoryColor } from '../../utils/colors';
import { formatPercent } from '../../utils/format';

const TAU = Math.PI * 2;

function arc(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const p = (r: number, a: number) =>
    `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${p(r1, a0)} A ${r1} ${r1} 0 ${large} 1 ${p(r1, a1)} L ${p(r0, a1)} A ${r0} ${r0} 0 ${large} 0 ${p(r0, a0)} Z`;
}

export function DonutChart({
  categories,
  selected,
  onSelect,
}: {
  categories: CategoryStat[];
  selected?: number | null;
  onSelect?: (index: number) => void;
}) {
  const total = categories.reduce((a, c) => a + c.size, 0);
  if (total <= 0) return null;
  const cx = 200;
  const cy = 82;
  const r0 = 36;
  const r1 = 62;
  let angle = -Math.PI / 2;
  const segments = categories.map((c) => {
    const span = (c.size / total) * TAU;
    const seg = { c, a0: angle, a1: angle + span, mid: angle + span / 2 };
    angle += span;
    return seg;
  });

  // Labels on each side, nudged apart so they never overlap.
  const place = (side: 'left' | 'right') => {
    const items = segments
      .filter((s) => s.c.percent >= 3 && Math.cos(s.mid) < 0 === (side === 'left'))
      .map((s) => ({ s, y: cy + (r1 + 6) * Math.sin(s.mid) }))
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) items[i]!.y = Math.max(items[i]!.y, items[i - 1]!.y + 27);
    return items;
  };
  const labels = [...place('left'), ...place('right')];

  return (
    <svg
      viewBox="0 0 400 164"
      className="h-full max-h-[190px] w-full"
      role="img"
      aria-label="File breakdown by category"
    >
      {segments.map(({ c, a0, a1 }) =>
        a1 - a0 >= TAU - 1e-6 ? (
          <circle
            key={c.index}
            cx={cx}
            cy={cy}
            r={(r0 + r1) / 2}
            fill="none"
            stroke={categoryColor(c.index)}
            strokeWidth={r1 - r0}
          />
        ) : (
          <path
            key={c.index}
            d={arc(cx, cy, r0, r1, a0, a1)}
            fill={categoryColor(c.index)}
            stroke="#272727"
            strokeWidth={1.5}
            opacity={selected == null || selected === c.index ? 1 : 0.45}
            className={onSelect ? 'cursor-pointer' : ''}
            onClick={() => onSelect?.(c.index)}
          >
            <title>{`${c.name}: ${formatPercent(c.percent)}`}</title>
          </path>
        ),
      )}
      {labels.map(({ s, y }) => {
        const left = Math.cos(s.mid) < 0;
        const x = left ? cx - r1 - 30 : cx + r1 + 30;
        const sx = cx + (r1 + 1) * Math.cos(s.mid);
        const sy = cy + (r1 + 1) * Math.sin(s.mid);
        return (
          <g key={s.c.index} fontSize="11.5" fill="#c9c9c9">
            <polyline
              points={`${sx.toFixed(1)},${sy.toFixed(1)} ${(left ? x + 4 : x - 4).toFixed(1)},${(y - 4).toFixed(1)}`}
              fill="none"
              stroke="#5a5a5a"
              strokeWidth="1"
            />
            <text x={x} y={y - 3} textAnchor={left ? 'end' : 'start'}>
              {s.c.name}
            </text>
            <text x={x} y={y + 10} textAnchor={left ? 'end' : 'start'} fill="#8c8c8c">
              {formatPercent(s.c.percent)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
