import { ChevronDown, ChevronRight, ExternalLink, FolderOpen, Trash2 } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useNodeActions } from '../../hooks/useNodeActions';
import { useApp } from '../../stores/appStore';
import type { DuplicateFile, DuplicateGroup } from '../../types';
import { formatDate, formatNumber, formatSize, parentPath } from '../../utils/format';

type Row =
  { type: 'group'; group: DuplicateGroup } | { type: 'file'; group: DuplicateGroup; file: DuplicateFile };
const ROW = 30;

export function DuplicateList({
  groups,
  expanded,
  onToggle,
  selected,
  onToggleFile,
}: {
  groups: DuplicateGroup[];
  expanded: Set<number>;
  onToggle: (groupId: number) => void;
  selected: Set<number>;
  onToggleFile: (group: DuplicateGroup, file: DuplicateFile) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const units = useApp((s) => s.settings.units);
  const actions = useNodeActions();
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const group of groups) {
      out.push({ type: 'group', group });
      if (expanded.has(group.id)) for (const file of group.files) out.push({ type: 'file', group, file });
    }
    return out;
  }, [groups, expanded]);
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW,
    overscan: 12,
  });

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-auto rounded-sm border border-line bg-field/40">
      <div className="relative" style={{ height: virt.getTotalSize() }}>
        {virt.getVirtualItems().map((vi) => {
          const r = rows[vi.index];
          if (!r) return null;
          const style = { height: ROW, transform: `translateY(${vi.start}px)` };
          if (r.type === 'group') {
            const g = r.group;
            const name = g.files[0]?.path.split(/[\\/]/).pop() ?? 'File';
            const open = expanded.has(g.id);
            return (
              <button
                key={`g${g.id}`}
                onClick={() => onToggle(g.id)}
                className="absolute left-0 flex w-full items-center gap-2 bg-[#2c2c2c] px-2 text-left text-[13px] hover:bg-[#333]"
                style={style}
                aria-expanded={open}
              >
                {open ? (
                  <ChevronDown size={14} className="text-ink-2" />
                ) : (
                  <ChevronRight size={14} className="text-ink-2" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {formatNumber(g.files.length)} identical copies of <span className="text-ink">{name}</span>
                </span>
                <span className="tabular-nums text-ink-2">{formatSize(g.size, units)} each</span>
                <span className="w-[140px] text-right tabular-nums text-[#f0b060]">
                  {formatSize(g.wasted, units)} wasted
                </span>
              </button>
            );
          }
          const { file, group } = r;
          const isSel = selected.has(file.node_id);
          return (
            <div
              key={`f${file.node_id}`}
              className={`group absolute left-0 flex w-full items-center gap-2 pl-8 pr-2 text-[13px] ${isSel ? 'bg-[#4a3030]' : 'hover:bg-white/5'}`}
              style={style}
            >
              <input
                type="checkbox"
                checked={isSel}
                onChange={() => onToggleFile(group, file)}
                aria-label={`Mark ${file.path} for removal`}
              />
              <span className="min-w-0 flex-1 truncate" title={file.path}>
                <span className="text-ink">{file.path.split(/[\\/]/).pop()}</span>
                <span className="ml-2 text-ink-3">{parentPath(file.path)}</span>
              </span>
              <span className="w-[100px] text-right text-ink-3">{formatDate(file.modified)}</span>
              <span className="flex w-[84px] justify-end gap-0.5 opacity-0 group-hover:opacity-100">
                <button
                  title="Show in file manager"
                  aria-label="Show in file manager"
                  onClick={() => void actions.reveal(file.node_id)}
                  className="rounded p-1 text-ink-2 hover:bg-white/15 hover:text-ink"
                >
                  <FolderOpen size={14} />
                </button>
                <button
                  title="Open"
                  aria-label="Open"
                  onClick={() =>
                    void actions.open({
                      id: file.node_id,
                      kind: 'file',
                      category: 8,
                      name: file.path.split(/[\\/]/).pop() ?? '',
                      path: file.path,
                    })
                  }
                  className="rounded p-1 text-ink-2 hover:bg-white/15 hover:text-ink"
                >
                  <ExternalLink size={14} />
                </button>
                <button
                  title="Move to Trash"
                  aria-label="Move to Trash"
                  onClick={() => actions.trash([file.node_id])}
                  className="rounded p-1 text-[#ff7b72] hover:bg-white/15"
                >
                  <Trash2 size={14} />
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
