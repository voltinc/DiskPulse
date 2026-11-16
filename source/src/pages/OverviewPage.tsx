import { useMemo } from 'react';
import { useApp } from '../stores/appStore';
import { api } from '../services/api';
import { useLoad } from '../hooks/useLoad';
import { useTreemapMenu } from '../hooks/useTreemapMenu';
import { Panel } from '../components/common/Panel';
import { ScanGate } from '../components/scanner/ScanGate';
import { DonutChart } from '../components/storage/DonutChart';
import { TreemapView } from '../components/treemap/TreemapView';
import { formatNumber, formatSize } from '../utils/format';

function Content() {
  const summary = useApp((s) => s.summary);
  const scanId = useApp((s) => s.scanId);
  const drives = useApp((s) => s.drives);
  const settings = useApp((s) => s.settings);
  const selection = useApp((s) => s.selection);
  const dataVersion = useApp((s) => s.dataVersion);
  const setFocusId = useApp((s) => s.setFocusId);
  const setView = useApp((s) => s.setView);
  const tm = useTreemapMenu();
  const breakdown = useLoad(
    () => (scanId ? api.breakdown(scanId) : Promise.reject('No scan')),
    [scanId, dataVersion],
  );

  const drive = useMemo(
    () => (summary ? drives.find((d) => d.mount_point === summary.root.path) : undefined),
    [drives, summary],
  );
  if (!summary) return null;
  const u = settings.units;
  const title = `${drive ? drive.label : summary.root.name || summary.root.path}: Storage Map`;
  const subtitle = drive
    ? `${formatSize(drive.used_space, u, true)} Used / ${formatSize(drive.total_space, u, true)} Total`
    : `${formatSize(summary.total_size, u)} in ${formatNumber(summary.file_count)} files (${formatSize(summary.total_allocated, u)} on disk)`;
  const cats = breakdown.data?.categories ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      <Panel title={title} subtitle={subtitle} className="min-h-0 flex-1">
        <TreemapView
          nodeId={0}
          depth={1}
          metric={settings.treemap_metric}
          colorMode="folder"
          selectedIds={selection}
          onSelect={tm.onSelect}
          onContextMenu={tm.onContextMenu}
          onOpen={(r) => {
            if (r.kind === 'directory') {
              setFocusId(r.id);
              setView('treemap');
            } else
              void tm.actions.open({ id: r.id, kind: r.kind, category: r.category, name: r.name, path: '' });
          }}
        />
      </Panel>
      <Panel title="File Breakdown Summary" subtitle="By file type" className="h-[216px] shrink-0">
        <div className="flex min-h-0 flex-1 items-center gap-4">
          <div className="h-full min-w-0 flex-[1.2]">
            {cats.length > 0 ? (
              <DonutChart categories={cats} />
            ) : (
              <p className="pt-8 text-center text-sm text-ink-3">
                {breakdown.loading ? 'Analyzing files…' : 'There are no files to analyze.'}
              </p>
            )}
          </div>
          <div className="h-[130px] w-px bg-line" />
          <table className="min-w-0 flex-1 text-[17px] font-light">
            <tbody>
              {cats.slice(0, 4).map((c) => (
                <tr key={c.index}>
                  <td className="truncate py-[3px] pr-3">{c.name}</td>
                  <td className="py-[3px] pr-3 text-right tabular-nums">{formatSize(c.size, u, true)}</td>
                  <td className="py-[3px] text-right tabular-nums">{formatNumber(c.files)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {tm.menuElement}
    </div>
  );
}

export function OverviewPage() {
  return (
    <ScanGate>
      <Content />
    </ScanGate>
  );
}
