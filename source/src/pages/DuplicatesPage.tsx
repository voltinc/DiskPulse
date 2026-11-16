import { Files, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../components/common/Button';
import { EmptyState } from '../components/common/EmptyState';
import { Panel } from '../components/common/Panel';
import { DuplicateList } from '../components/duplicates/DuplicateList';
import { ScanGate } from '../components/scanner/ScanGate';
import { api } from '../services/api';
import { useApp } from '../stores/appStore';
import type { DuplicateFile, DuplicateGroup } from '../types';
import { formatDuration, formatNumber, formatSize } from '../utils/format';
import { trashName } from '../utils/platform';

const MIN_SIZES: Array<[number, string]> = [
  [1, 'any size'],
  [4096, '4 KB'],
  [65536, '64 KB'],
  [1048576, '1 MB'],
  [10485760, '10 MB'],
  [104857600, '100 MB'],
];
const STAGES: Record<string, string> = {
  grouping: 'Grouping files by size',
  partial_hash: 'Comparing the first 4 KB of each candidate',
  full_hash: 'Verifying the full contents',
  finalizing: 'Finishing up',
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded bg-field px-3 py-2">
      <div className={`text-[20px] font-light leading-6 tabular-nums ${tone ?? ''}`}>{value}</div>
      <div className="text-xs text-ink-3">{label}</div>
    </div>
  );
}

function Content() {
  const scanId = useApp((s) => s.scanId);
  const status = useApp((s) => s.dupStatus);
  const progress = useApp((s) => s.dupProgress);
  const summary = useApp((s) => s.dupSummary);
  const error = useApp((s) => s.dupError);
  const dataVersion = useApp((s) => s.dataVersion);
  const units = useApp((s) => s.settings.units);
  const os = useApp((s) => s.appInfo?.os);
  const defaultMin = useApp((s) => s.settings.min_duplicate_size);
  const [minSize, setMinSize] = useState(defaultMin);
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [marked, setMarked] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!scanId || (status !== 'completed' && status !== 'idle')) return;
    let live = true;
    api
      .duplicateGroups(scanId, 0, 500)
      .then((page) => {
        if (!live) return;
        setGroups(page.groups);
        setTotal(page.total);
        setMarked(new Set());
        if (page.summary && status === 'idle')
          useApp.setState({ dupStatus: 'completed', dupSummary: page.summary });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [scanId, status, dataVersion]);

  const toggleFile = useCallback((group: DuplicateGroup, file: DuplicateFile) => {
    setMarked((prev) => {
      const next = new Set(prev);
      if (next.has(file.node_id)) next.delete(file.node_id);
      else {
        const remaining = group.files.filter(
          (f) => !next.has(f.node_id) && f.node_id !== file.node_id,
        ).length;
        if (remaining === 0) {
          useApp.getState().notify('info', 'Keep at least one copy of every file.');
          return prev;
        }
        next.add(file.node_id);
      }
      return next;
    });
  }, []);

  const keepOne = (pick: (files: DuplicateFile[]) => DuplicateFile) => {
    const next = new Set<number>();
    for (const g of groups) {
      const keep = pick(g.files);
      for (const f of g.files) if (f.node_id !== keep.node_id) next.add(f.node_id);
    }
    setMarked(next);
  };
  const newest = (files: DuplicateFile[]) =>
    files.reduce((a, b) => ((b.modified ?? 0) > (a.modified ?? 0) ? b : a));
  const oldest = (files: DuplicateFile[]) =>
    files.reduce((a, b) => ((b.modified ?? Infinity) < (a.modified ?? Infinity) ? b : a));

  const markedBytes = useMemo(() => {
    let sum = 0;
    for (const g of groups) for (const f of g.files) if (marked.has(f.node_id)) sum += g.size;
    return sum;
  }, [groups, marked]);

  const sizes = MIN_SIZES.some(([v]) => v === minSize)
    ? MIN_SIZES
    : [...MIN_SIZES, [minSize, formatSize(minSize, units)] as [number, string]];
  const running = status === 'running';
  const pct =
    progress && progress.total > 0 ? Math.min(100, (progress.processed / progress.total) * 100) : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          Ignore files smaller than
          <select
            disabled={running}
            value={minSize}
            onChange={(e) => setMinSize(Number(e.target.value))}
            className="h-7 rounded border border-line bg-field px-1.5 text-ink"
          >
            {sizes.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {running ? (
          <Button onClick={() => void useApp.getState().cancelDuplicates()}>
            <X size={14} /> Cancel
          </Button>
        ) : (
          <Button variant="primary" onClick={() => void useApp.getState().startDuplicates(minSize)}>
            <Files size={14} /> {status === 'completed' ? 'Search again' : 'Find duplicates'}
          </Button>
        )}
        <span className="text-xs text-ink-3">
          Files are compared by content (size, first 4 KB, then full BLAKE3 hash), never by name.
        </span>
      </div>

      {running && (
        <div className="rounded bg-field px-3 py-2.5" role="status" aria-live="polite">
          <div className="mb-1.5 flex justify-between text-[13px]">
            <span>{STAGES[progress?.stage ?? 'grouping']}</span>
            <span className="tabular-nums text-ink-3">
              {progress && progress.total > 0
                ? `${formatNumber(progress.processed)} / ${formatNumber(progress.total)}`
                : ''}
            </span>
          </div>
          <div className="h-[6px] overflow-hidden rounded bg-[#333]">
            {pct === null ? (
              <div className="h-full w-1/3 animate-indeterminate rounded bg-accent" />
            ) : (
              <div className="h-full rounded bg-accent transition-[width]" style={{ width: `${pct}%` }} />
            )}
          </div>
          <div className="mt-1 truncate text-xs text-ink-3" title={progress?.current_path}>
            {progress?.current_path}
          </div>
        </div>
      )}
      {status === 'error' && (
        <p className="rounded bg-danger/15 px-3 py-2 text-[13px] text-[#ff9a92]">{error}</p>
      )}
      {status === 'cancelled' && (
        <p className="text-[13px] text-ink-3">The duplicate search was cancelled. Nothing was changed.</p>
      )}

      {status === 'completed' && summary && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Duplicate groups" value={formatNumber(summary.groups_count)} />
            <Stat label="Files involved" value={formatNumber(summary.files_in_groups)} />
            <Stat
              label="Wasted space"
              value={formatSize(summary.wasted_bytes, units)}
              tone="text-[#f0b060]"
            />
            <Stat
              label={`Checked in ${formatDuration(summary.elapsed_ms)}`}
              value={`${formatNumber(summary.candidate_files)} candidates${summary.skipped_files ? `, ${formatNumber(summary.skipped_files)} skipped` : ''}`}
            />
          </div>
          {groups.length > 0 ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="text-ink-2">Select:</span>
                <Button onClick={() => keepOne(newest)}>Keep newest</Button>
                <Button onClick={() => keepOne(oldest)}>Keep oldest</Button>
                <Button variant="ghost" disabled={marked.size === 0} onClick={() => setMarked(new Set())}>
                  Clear
                </Button>
                <Button
                  onClick={() =>
                    setExpanded(expanded.size > 0 ? new Set() : new Set(groups.map((g) => g.id)))
                  }
                >
                  {expanded.size > 0 ? 'Collapse all' : 'Expand all'}
                </Button>
                <span className="flex-1 text-right text-ink-2">
                  {marked.size > 0
                    ? `${formatNumber(marked.size)} marked, ${formatSize(markedBytes, units)}`
                    : 'Nothing is removed unless you mark it and confirm.'}
                </span>
                <Button
                  variant="danger"
                  disabled={marked.size === 0}
                  onClick={() => useApp.getState().requestTrash(Array.from(marked))}
                >
                  <Trash2 size={14} /> Move to {trashName(os)}
                </Button>
              </div>
              {total > groups.length && (
                <p className="text-xs text-ink-3">
                  Showing the {formatNumber(groups.length)} groups that waste the most space (of{' '}
                  {formatNumber(total)}).
                </p>
              )}
              <DuplicateList
                groups={groups}
                expanded={expanded}
                onToggle={(id) =>
                  setExpanded((prev) => {
                    const n = new Set(prev);
                    if (n.has(id)) n.delete(id);
                    else n.add(id);
                    return n;
                  })
                }
                selected={marked}
                onToggleFile={toggleFile}
              />
            </>
          ) : (
            <EmptyState
              icon={<Files size={32} />}
              title="No duplicates found"
              text="No two files of the same size and content were found with these settings. Lower the minimum size to look at smaller files."
            />
          )}
        </>
      )}
      {status === 'idle' && (
        <EmptyState
          icon={<Files size={32} />}
          title="Find files that waste space"
          text="Pick a minimum size and start. Only files whose complete contents match are reported, and you choose what to remove."
        />
      )}
    </div>
  );
}

export function DuplicatesPage() {
  return (
    <Panel
      title="Duplicate Finder"
      subtitle="Byte-for-byte duplicates in the current scan"
      className="h-full"
    >
      <ScanGate>
        <Content />
      </ScanGate>
    </Panel>
  );
}
