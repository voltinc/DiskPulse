import { useApp } from '../../stores/appStore';
import type { ViewId } from '../../types';
import { VIEW_LABELS } from './MenuBar';

const TABS: ViewId[] = [
  'overview',
  'tree',
  'treemap',
  'breakdown',
  'largest',
  'duplicates',
  'history',
  'settings',
];

export function TabStrip() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  return (
    <div role="tablist" className="flex shrink-0 items-end gap-0.5 overflow-x-auto px-1 pb-1.5">
      {TABS.map((id) => (
        <button
          key={id}
          role="tab"
          aria-selected={view === id}
          onClick={() => setView(id)}
          className={`relative whitespace-nowrap rounded px-3 py-1 text-[13px] transition-colors ${view === id ? 'bg-panel text-ink' : 'text-ink-2 hover:bg-white/5 hover:text-ink'}`}
        >
          {VIEW_LABELS[id]}
          {view === id && <span className="absolute inset-x-3 -bottom-[3px] h-[2px] rounded bg-accent" />}
        </button>
      ))}
    </div>
  );
}
