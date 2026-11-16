import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ChevronsUp, Search, Trash2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useDebounced } from '../../hooks/useDebounced';
import { useNodeActions } from '../../hooks/useNodeActions';
import { api } from '../../services/api';
import { useApp } from '../../stores/appStore';
import type { NodeSummary, SortDir, SortKey } from '../../types';
import { CATEGORY_NAMES, categoryColor } from '../../utils/colors';
import { formatDateTime, formatNumber, formatPercent, formatSize } from '../../utils/format';
import { trashName } from '../../utils/platform';
import { nextSelection } from '../../utils/selection';
import { Breadcrumbs } from '../common/Breadcrumbs';
import { Button } from '../common/Button';
import { useContextMenu } from '../common/Menu';
import { NodeIcon } from '../common/NodeIcon';
import { MiniBar } from '../common/UsageBar';

const PAGE = 400;
const HEADER = 28;
const ROW = 26;
const COLS = '340px 100px 92px 92px 132px 76px 140px 360px';
const TOTAL_WIDTH = 1420;

interface Page {
  items: NodeSummary[];
  total: number;
  loading: boolean;
}

type Row =
  | { type: 'node'; node: NodeSummary; depth: number }
  | { type: 'more'; parentId: number; depth: number; remaining: number; loading: boolean };

const COLUMNS: Array<{ label: string; key?: SortKey; align?: 'right' }> = [
  { label: 'Name', key: 'name' },
  { label: 'Type', key: 'type' },
  { label: 'Size', key: 'size', align: 'right' },
  { label: 'On disk', key: 'allocated', align: 'right' },
  { label: '% of parent', key: 'size' },
  { label: 'Files', key: 'files', align: 'right' },
  { label: 'Modified', key: 'modified' },
  { label: 'Path' },
];

export function TreeTable() {
  const scanId = useApp((s) => s.scanId);
  const summary = useApp((s) => s.summary);
  const dataVersion = useApp((s) => s.dataVersion);
  const units = useApp((s) => s.settings.units);
  const os = useApp((s) => s.appInfo?.os);
  const selection = useApp((s) => s.selection);
  const setSelection = useApp((s) => s.setSelection);
  const actions = useNodeActions();
  const menu = useContextMenu();

  const [expanded, setExpanded] = useState<Set<number>>(() => new Set([0]));
  const [pages, setPages] = useState<Map<number, Page>>(() => new Map());
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'size', dir: 'desc' });
  const [filter, setFilter] = useState('');
  const query = useDebounced(filter.trim(), 250);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [trail, setTrail] = useState<NodeSummary[]>([]);
  const generation = useRef(0);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const anchor = useRef<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (parentId: number, append: boolean) => {
      if (!scanId) return;
      const existing = pagesRef.current.get(parentId);
      if (existing?.loading) return;
      const g = generation.current;
      const base = append && existing ? existing.items : [];
      setPages((prev) =>
        new Map(prev).set(parentId, { items: base, total: existing?.total ?? 0, loading: true }),
      );
      try {
        const res = await api.children(
          scanId,
          parentId,
          base.length,
          PAGE,
          sort.key,
          sort.dir,
          query || undefined,
        );
        if (g !== generation.current) return;
        setPages((prev) =>
          new Map(prev).set(parentId, { items: [...base, ...res.items], total: res.total, loading: false }),
        );
      } catch {
        if (g !== generation.current) return;
        if (parentId === 0) {
          setPages((prev) => new Map(prev).set(0, { items: [], total: 0, loading: false }));
        } else {
          // The folder disappeared from the result (for example after a delete): collapse it.
          setPages((prev) => {
            const m = new Map(prev);
            m.delete(parentId);
            return m;
          });
          setExpanded((prev) => {
            const s = new Set(prev);
            s.delete(parentId);
            return s;
          });
        }
      }
    },
    [scanId, sort, query],
  );

  // New scan, sort, filter or data change: drop cached pages and reload what is expanded.
  useEffect(() => {
    generation.current += 1;
    setPages(new Map());
  }, [scanId, sort, query, dataVersion]);
  useEffect(() => {
    setExpanded(new Set([0]));
    setActiveId(null);
    setTrail([]);
    anchor.current = null;
  }, [scanId]);
  useEffect(() => {
    for (const id of expanded) if (!pages.has(id)) void load(id, false);
  }, [expanded, pages, load]);

  useEffect(() => {
    if (!scanId || activeId === null) return;
    let live = true;
    api
      .ancestors(scanId, activeId)
      .then((t) => live && setTrail(t))
      .catch(() => live && setTrail([]));
    return () => {
      live = false;
    };
  }, [scanId, activeId, dataVersion]);

  const rows = useMemo<Row[]>(() => {
    if (!summary) return [];
    const out: Row[] = [{ type: 'node', node: summary.root, depth: 0 }];
    const walk = (id: number, depth: number) => {
      const p = pages.get(id);
      if (!p) return;
      for (const n of p.items) {
        out.push({ type: 'node', node: n, depth });
        if (n.kind === 'directory' && expanded.has(n.id)) walk(n.id, depth + 1);
      }
      if (p.items.length < p.total)
        out.push({
          type: 'more',
          parentId: id,
          depth,
          remaining: p.total - p.items.length,
          loading: p.loading,
        });
    };
    if (expanded.has(0)) walk(0, 1);
    return out;
  }, [summary, pages, expanded]);

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW,
    overscan: 14,
    scrollMargin: HEADER,
  });
  const virtualItems = virt.getVirtualItems();

  // "Load more" rows fetch themselves as soon as they scroll into view.
  useEffect(() => {
    for (const vi of virtualItems) {
      const r = rows[vi.index];
      if (r?.type === 'more' && !r.loading) void load(r.parentId, true);
    }
  }, [virtualItems, rows, load]);

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  const orderedIds = useMemo(() => rows.map((r) => (r.type === 'node' ? r.node.id : -1)), [rows]);
  const selected = useMemo(() => new Set(selection), [selection]);

  const select = (e: MouseEvent, index: number) => {
    const r = nextSelection(selection, orderedIds, index, anchor.current, {
      ctrl: e.ctrlKey || e.metaKey,
      shift: e.shiftKey,
    });
    anchor.current = r.anchor;
    setSelection(r.selection.filter((id) => id >= 0));
    const row = rows[index];
    if (row?.type === 'node') setActiveId(row.node.id);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const current = activeId ?? selection[selection.length - 1] ?? null;
    const idx = current === null ? -1 : rows.findIndex((r) => r.type === 'node' && r.node.id === current);
    const goto = (to: number) => {
      const r = rows[to];
      if (r?.type !== 'node') return;
      setActiveId(r.node.id);
      setSelection([r.node.id]);
      anchor.current = to;
      virt.scrollToIndex(to);
    };
    const step = (dir: 1 | -1) => {
      let i = idx + dir;
      while (rows[i] && rows[i]!.type !== 'node') i += dir;
      if (rows[i]) goto(i);
    };
    const row = idx >= 0 ? rows[idx] : undefined;
    const node = row?.type === 'node' ? row.node : undefined;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        step(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        step(-1);
        break;
      case 'ArrowRight':
        if (node?.kind === 'directory' && !expanded.has(node.id)) toggle(node.id);
        break;
      case 'ArrowLeft':
        if (node && expanded.has(node.id) && node.id !== 0) toggle(node.id);
        else if (node?.parent_id != null) {
          const p = rows.findIndex((r) => r.type === 'node' && r.node.id === node.parent_id);
          if (p >= 0) goto(p);
        }
        break;
      case 'Enter':
        if (node?.kind === 'directory') toggle(node.id);
        else if (node) void actions.open(node);
        break;
      case 'Delete':
        if (selection.some((id) => id !== 0)) actions.trash(selection.filter((id) => id !== 0));
        break;
      default:
    }
  };

  const loaded = useMemo(() => {
    const m = new Map<number, NodeSummary>();
    for (const r of rows) if (r.type === 'node') m.set(r.node.id, r.node);
    return m;
  }, [rows]);
  const chosen = selection.map((id) => loaded.get(id)).filter((n): n is NodeSummary => !!n);
  const chosenSize = chosen.reduce((a, n) => a + n.size, 0);
  const chosenAlloc = chosen.reduce((a, n) => a + n.allocated, 0);
  const deletable = selection.filter((id) => id !== 0);

  const sortBy = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' || key === 'type' ? 'asc' : 'desc' },
    );
  const rootEmpty = pages.get(0) && pages.get(0)!.total === 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-7 w-[260px] items-center gap-2 rounded border border-line bg-field px-2 focus-within:border-accent">
          <Search size={14} className="text-ink-3" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name in expanded folders"
            aria-label="Filter by name"
            className="w-full bg-transparent text-base outline-none placeholder:text-ink-3"
          />
        </label>
        <Button onClick={() => setExpanded(new Set([0]))}>
          <ChevronsUp size={14} /> Collapse all
        </Button>
        <Button variant="danger" disabled={deletable.length === 0} onClick={() => actions.trash(deletable)}>
          <Trash2 size={14} /> Move to {trashName(os)}
          {deletable.length > 0 ? ` (${formatNumber(deletable.length)})` : ''}
        </Button>
        <div className="min-w-0 flex-1">
          {trail.length > 0 && (
            <Breadcrumbs
              items={trail}
              onNavigate={(id) => {
                setActiveId(id);
                setSelection([id]);
                const i = rows.findIndex((r) => r.type === 'node' && r.node.id === id);
                if (i >= 0) virt.scrollToIndex(i);
              }}
            />
          )}
        </div>
      </div>

      <div
        ref={scroller}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 overflow-auto rounded-sm border border-line bg-field/40 outline-none focus:border-accent/60"
        role="treegrid"
        aria-label="Directory tree"
      >
        <div style={{ minWidth: TOTAL_WIDTH }}>
          <div
            className="sticky top-0 z-10 grid items-center gap-2 border-b border-line bg-[#2a2a2a] px-2 text-xs text-ink-3"
            style={{ gridTemplateColumns: COLS, height: HEADER }}
          >
            {COLUMNS.map((c) =>
              c.key ? (
                <button
                  key={c.label}
                  onClick={() => sortBy(c.key!)}
                  className={`flex items-center gap-1 hover:text-ink ${c.align === 'right' ? 'justify-end' : ''} ${sort.key === c.key ? 'text-ink' : ''}`}
                >
                  {c.label}
                  {sort.key === c.key &&
                    (sort.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                </button>
              ) : (
                <span key={c.label}>{c.label}</span>
              ),
            )}
          </div>
          <div className="relative" style={{ height: Math.max(0, virt.getTotalSize() - HEADER) }}>
            {virtualItems.map((vi) => {
              const r = rows[vi.index];
              if (!r) return null;
              const style = {
                gridTemplateColumns: COLS,
                height: ROW,
                transform: `translateY(${vi.start - HEADER}px)`,
              } as const;
              if (r.type === 'more') {
                return (
                  <div
                    key={`more-${r.parentId}`}
                    className="absolute left-0 grid w-full items-center px-2 text-xs text-ink-3"
                    style={style}
                  >
                    <span style={{ paddingLeft: r.depth * 16 + 30 }}>
                      {r.loading ? 'Loading…' : `Loading ${formatNumber(r.remaining)} more…`}
                    </span>
                  </div>
                );
              }
              const n = r.node;
              const isSel = selected.has(n.id);
              const isDir = n.kind === 'directory';
              return (
                <div
                  key={n.id}
                  role="row"
                  aria-selected={isSel}
                  onClick={(e) => select(e, vi.index)}
                  onDoubleClick={() => (isDir ? toggle(n.id) : void actions.open(n))}
                  onContextMenu={(e) => {
                    const targets = isSel ? chosen : [n];
                    if (!isSel) {
                      setSelection([n.id]);
                      setActiveId(n.id);
                    }
                    const list = targets.filter((t) => t.id !== 0);
                    const items =
                      list.length > 0
                        ? actions.menuFor(list)
                        : actions.menuFor([n]).filter((i) => !i.danger && !i.separator);
                    menu.show(e, items);
                  }}
                  className={`absolute left-0 grid w-full items-center gap-2 px-2 text-[13px] ${isSel ? 'bg-[#33415a]' : 'hover:bg-white/5'}`}
                  style={style}
                >
                  <span className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: r.depth * 16 }}>
                    {isDir && n.child_count > 0 ? (
                      <button
                        aria-label={expanded.has(n.id) ? 'Collapse' : 'Expand'}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(n.id);
                        }}
                        className="rounded p-0.5 text-ink-2 hover:bg-white/10"
                      >
                        {expanded.has(n.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </button>
                    ) : (
                      <span className="w-[18px] shrink-0" />
                    )}
                    <NodeIcon node={n} />
                    <span className="truncate" title={n.name}>
                      {n.name || n.path}
                    </span>
                    {!n.accessible && (
                      <span className="shrink-0 rounded bg-[#5a4420] px-1 text-[11px] text-[#f0c070]">
                        no access
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-1.5 truncate text-ink-2">
                    {!isDir && (
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: categoryColor(n.category) }}
                      />
                    )}
                    <span className="truncate">
                      {n.is_symlink
                        ? 'Link'
                        : isDir
                          ? 'Folder'
                          : n.extension
                            ? n.extension.toUpperCase()
                            : (CATEGORY_NAMES[n.category] ?? 'File')}
                    </span>
                  </span>
                  <span className="text-right tabular-nums">{formatSize(n.size, units)}</span>
                  <span className="text-right tabular-nums text-ink-3">{formatSize(n.allocated, units)}</span>
                  <span className="flex items-center gap-2 text-ink-2">
                    <MiniBar percent={n.percent_of_parent} />
                    <span className="tabular-nums">
                      {n.parent_id === null ? '100%' : formatPercent(n.percent_of_parent)}
                    </span>
                  </span>
                  <span className="text-right tabular-nums text-ink-2">
                    {isDir ? formatNumber(n.file_count) : ''}
                  </span>
                  <span className="truncate text-ink-3">{formatDateTime(n.modified)}</span>
                  <span className="truncate text-ink-3" title={n.path}>
                    {n.path}
                  </span>
                </div>
              );
            })}
          </div>
          {rootEmpty && (
            <p className="p-6 text-center text-sm text-ink-3">
              {query ? `No items match "${query}" in this folder.` : 'This folder is empty.'}
            </p>
          )}
        </div>
      </div>

      <div className="flex h-5 items-center gap-3 text-xs text-ink-3">
        {chosen.length > 0 ? (
          <span>
            {formatNumber(chosen.length)} selected - {formatSize(chosenSize, units)} logical,{' '}
            {formatSize(chosenAlloc, units)} on disk
          </span>
        ) : (
          <span>
            Click to select, Ctrl/Shift for several, double-click a folder to expand it. Arrow keys also work.
          </span>
        )}
      </div>
      {menu.element}
    </div>
  );
}
