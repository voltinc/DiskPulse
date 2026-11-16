import { ChevronRight } from 'lucide-react';
import type { NodeSummary } from '../../types';

export function Breadcrumbs({
  items,
  onNavigate,
}: {
  items: NodeSummary[];
  onNavigate: (id: number) => void;
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-0.5 overflow-hidden text-sm text-ink-2"
    >
      {items.map((n, i) => (
        <span key={n.id} className="flex min-w-0 items-center gap-0.5">
          {i > 0 && <ChevronRight size={12} className="shrink-0 text-ink-3" />}
          <button
            onClick={() => onNavigate(n.id)}
            className={`truncate rounded px-1.5 py-0.5 hover:bg-white/10 ${i === items.length - 1 ? 'text-ink' : ''}`}
            title={n.path}
          >
            {n.name || n.path}
          </button>
        </span>
      ))}
    </nav>
  );
}
