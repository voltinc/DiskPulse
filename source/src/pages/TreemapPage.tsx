import { ArrowUp, ExternalLink, FolderOpen, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Breadcrumbs } from '../components/common/Breadcrumbs';
import { Button } from '../components/common/Button';
import { Panel } from '../components/common/Panel';
import { ScanGate } from '../components/scanner/ScanGate';
import { TreemapView, type ColorMode } from '../components/treemap/TreemapView';
import { useTreemapMenu } from '../hooks/useTreemapMenu';
import { api } from '../services/api';
import { useApp } from '../stores/appStore';
import type { Metric, NodeSummary } from '../types';
import { CATEGORY_COLORS, CATEGORY_NAMES } from '../utils/colors';
import { formatDateTime, formatNumber, formatSize } from '../utils/format';

const segment = (active: boolean) =>
  `h-6 px-2.5 text-[12.5px] ${active ? 'bg-active text-ink' : 'text-ink-2 hover:bg-white/10'}`;

function Content() {
  const scanId = useApp((s) => s.scanId);
  const focusId = useApp((s) => s.focusId);
  const setFocusId = useApp((s) => s.setFocusId);
  const selection = useApp((s) => s.selection);
  const setSelection = useApp((s) => s.setSelection);
  const dataVersion = useApp((s) => s.dataVersion);
  const settings = useApp((s) => s.settings);
  const [colorMode, setColorMode] = useState<ColorMode>('folder');
  const [metric, setMetric] = useState<Metric>(settings.treemap_metric);
  const [depth, setDepth] = useState(settings.treemap_depth);
  const [trail, setTrail] = useState<NodeSummary[]>([]);
  const [picked, setPicked] = useState<NodeSummary | null>(null);
  const tm = useTreemapMenu();
  const u = settings.units;

  useEffect(() => {
    if (!scanId) return;
    let live = true;
    api
      .ancestors(scanId, focusId)
      .then((t) => live && setTrail(t))
      .catch(() => live && setFocusId(0)); // the folder was removed: go back to the top
    return () => {
      live = false;
    };
  }, [scanId, focusId, dataVersion, setFocusId]);

  useEffect(() => {
    const id = selection[0];
    if (!scanId || id === undefined) return setPicked(null);
    let live = true;
    api
      .nodes(scanId, [id])
      .then((n) => live && setPicked(n[0] ?? null))
      .catch(() => live && setPicked(null));
    return () => {
      live = false;
    };
  }, [scanId, selection, dataVersion]);

  const here = trail[trail.length - 1];
  const parentId = here?.parent_id ?? null;
  const goto = (id: number) => {
    setSelection([]);
    setFocusId(id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={parentId === null}
          onClick={() => parentId !== null && goto(parentId)}
          title="Go up one level"
        >
          <ArrowUp size={14} /> Up
        </Button>
        <div className="min-w-0 flex-1">
          <Breadcrumbs items={trail} onNavigate={goto} />
        </div>
        <div className="flex overflow-hidden rounded border border-line" role="group" aria-label="Size shown">
          <button
            className={segment(metric === 'logical')}
            onClick={() => setMetric('logical')}
            title="What the files report"
          >
            Logical
          </button>
          <button
            className={segment(metric === 'allocated')}
            onClick={() => setMetric('allocated')}
            title="Space reserved on disk"
          >
            On disk
          </button>
        </div>
        <div className="flex overflow-hidden rounded border border-line" role="group" aria-label="Colour by">
          <button className={segment(colorMode === 'folder')} onClick={() => setColorMode('folder')}>
            By folder
          </button>
          <button className={segment(colorMode === 'type')} onClick={() => setColorMode('type')}>
            By file type
          </button>
        </div>
        <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
          Levels
          <select
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
            className="h-6 rounded border border-line bg-field px-1 text-ink"
          >
            {[1, 2, 3].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="min-h-0 flex-1">
        <TreemapView
          nodeId={focusId}
          depth={depth}
          metric={metric}
          colorMode={colorMode}
          selectedIds={selection}
          onSelect={tm.onSelect}
          onContextMenu={tm.onContextMenu}
          onOpen={(r) =>
            r.kind === 'directory'
              ? goto(r.id)
              : void tm.actions.open({ id: r.id, kind: r.kind, category: r.category, name: r.name, path: '' })
          }
        />
      </div>
      {colorMode === 'type' && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-2">
          {CATEGORY_NAMES.map((n, i) => (
            <span key={n} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CATEGORY_COLORS[i] }} />
              {n}
            </span>
          ))}
          <span className="text-ink-3">
            Folders take the colour of the type that uses most of their space.
          </span>
        </div>
      )}
      <div className="flex min-h-[30px] flex-wrap items-center gap-2 text-[13px] text-ink-2">
        {picked ? (
          <>
            <span className="min-w-0 flex-1 truncate" title={picked.path}>
              <span className="text-ink">{picked.name}</span> - {formatSize(picked.size, u)} (
              {formatSize(picked.allocated, u)} on disk) -{' '}
              {picked.kind === 'directory'
                ? `${formatNumber(picked.file_count)} files`
                : `modified ${formatDateTime(picked.modified)}`}
            </span>
            <Button onClick={() => void tm.actions.reveal(picked.id)}>
              <FolderOpen size={14} /> Show in file manager
            </Button>
            {picked.kind === 'file' && (
              <Button onClick={() => void tm.actions.open(picked)}>
                <ExternalLink size={14} /> Open
              </Button>
            )}
            <Button variant="danger" onClick={() => tm.actions.trash([picked.id])}>
              <Trash2 size={14} /> Move to Trash
            </Button>
          </>
        ) : here ? (
          <span>
            {here.name || here.path}: {formatSize(here.size, u)} logical, {formatSize(here.allocated, u)} on
            disk, {formatNumber(here.file_count)} files. Click a folder to open it, click a file to select it.
          </span>
        ) : null}
      </div>
      {tm.menuElement}
    </div>
  );
}

export function TreemapPage() {
  return (
    <Panel title="Treemap" subtitle="Rectangle area is proportional to size" className="h-full">
      <ScanGate>
        <Content />
      </ScanGate>
    </Panel>
  );
}
