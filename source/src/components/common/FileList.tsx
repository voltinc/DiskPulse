import { ExternalLink, FolderOpen, Trash2 } from 'lucide-react';
import { useRef, type MouseEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useNodeActions } from '../../hooks/useNodeActions';
import { useApp } from '../../stores/appStore';
import type { NodeSummary } from '../../types';
import { CATEGORY_NAMES } from '../../utils/colors';
import { formatDate, formatSize, parentPath } from '../../utils/format';
import { nextSelection } from '../../utils/selection';
import { useContextMenu } from './Menu';
import { NodeIcon } from './NodeIcon';

const COLS = '24px minmax(170px,1.5fr) 80px 80px 96px minmax(130px,1.2fr) 100px 80px';
const HEADER = 28;
const ROW = 28;

/** Virtualized table of nodes with multi-select, quick actions and a context menu. */
export function FileList({
  items,
  selection,
  onSelection,
}: {
  items: NodeSummary[];
  selection: number[];
  onSelection: (ids: number[]) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const anchor = useRef<number | null>(null);
  const units = useApp((s) => s.settings.units);
  const actions = useNodeActions();
  const menu = useContextMenu();
  const selected = new Set(selection);
  const virt = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW,
    overscan: 12,
    scrollMargin: HEADER,
  });
  const ids = items.map((n) => n.id);

  const click = (e: MouseEvent, index: number) => {
    const r = nextSelection(selection, ids, index, anchor.current, {
      ctrl: e.ctrlKey || e.metaKey,
      shift: e.shiftKey,
    });
    anchor.current = r.anchor;
    onSelection(r.selection);
  };

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-auto rounded-sm border border-line bg-field/40">
      <div className="min-w-[780px]">
        <div
          className="sticky top-0 z-10 grid items-center gap-2 border-b border-line bg-[#2a2a2a] px-2 text-xs text-ink-3"
          style={{ gridTemplateColumns: COLS, height: HEADER }}
        >
          <input
            type="checkbox"
            aria-label="Select all"
            checked={items.length > 0 && selection.length === items.length}
            onChange={(e) => onSelection(e.target.checked ? ids : [])}
          />
          <span>Name</span>
          <span className="text-right">Size</span>
          <span className="text-right">On disk</span>
          <span>Type</span>
          <span>Location</span>
          <span>Modified</span>
          <span />
        </div>
        <div className="relative" style={{ height: virt.getTotalSize() - HEADER }}>
          {virt.getVirtualItems().map((vi) => {
            const n = items[vi.index];
            if (!n) return null;
            const isSel = selected.has(n.id);
            return (
              <div
                key={n.id}
                onClick={(e) => click(e, vi.index)}
                onDoubleClick={() =>
                  n.kind === 'directory' ? actions.showInTreemap(n.id) : void actions.open(n)
                }
                onContextMenu={(e) => {
                  const target = isSel ? items.filter((x) => selected.has(x.id)) : [n];
                  if (!isSel) onSelection([n.id]);
                  menu.show(e, actions.menuFor(target));
                }}
                className={`group absolute left-0 grid w-full items-center gap-2 px-2 text-[13px] ${isSel ? 'bg-[#33415a]' : 'hover:bg-white/5'}`}
                style={{
                  gridTemplateColumns: COLS,
                  height: ROW,
                  transform: `translateY(${vi.start - HEADER}px)`,
                }}
              >
                <input
                  type="checkbox"
                  aria-label={`Select ${n.name}`}
                  checked={isSel}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => {
                    anchor.current = vi.index;
                    onSelection(isSel ? selection.filter((x) => x !== n.id) : [...selection, n.id]);
                  }}
                />
                <span className="flex min-w-0 items-center gap-2" title={n.path}>
                  <NodeIcon node={n} />
                  <span className="truncate">{n.name}</span>
                </span>
                <span className="text-right tabular-nums">{formatSize(n.size, units)}</span>
                <span className="text-right tabular-nums text-ink-3">{formatSize(n.allocated, units)}</span>
                <span className="truncate text-ink-2">
                  {n.is_symlink
                    ? 'Link'
                    : n.kind === 'directory'
                      ? 'Folder'
                      : n.extension
                        ? `${n.extension.toUpperCase()} - ${CATEGORY_NAMES[n.category] ?? ''}`
                        : (CATEGORY_NAMES[n.category] ?? 'File')}
                </span>
                <span className="truncate text-ink-3" title={parentPath(n.path)}>
                  {parentPath(n.path)}
                </span>
                <span className="text-ink-3">{formatDate(n.modified)}</span>
                <span
                  className={`flex justify-end gap-0.5 ${isSel ? '' : 'opacity-0 group-hover:opacity-100'}`}
                >
                  <IconButton label="Show in file manager" onClick={() => void actions.reveal(n.id)}>
                    <FolderOpen size={14} />
                  </IconButton>
                  {n.kind === 'file' && (
                    <IconButton label="Open" onClick={() => void actions.open(n)}>
                      <ExternalLink size={14} />
                    </IconButton>
                  )}
                  <IconButton label="Move to Trash" danger onClick={() => actions.trash([n.id])}>
                    <Trash2 size={14} />
                  </IconButton>
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {menu.element}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`rounded p-1 hover:bg-white/15 ${danger ? 'text-[#ff7b72]' : 'text-ink-2 hover:text-ink'}`}
    >
      {children}
    </button>
  );
}
