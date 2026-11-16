import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '../components/common/Button';
import { FileList } from '../components/common/FileList';
import { Panel } from '../components/common/Panel';
import { ScanGate } from '../components/scanner/ScanGate';
import { DonutChart } from '../components/storage/DonutChart';
import { useLoad } from '../hooks/useLoad';
import { api } from '../services/api';
import { useApp } from '../stores/appStore';
import { CATEGORY_COLORS } from '../utils/colors';
import { formatNumber, formatPercent, formatSize } from '../utils/format';

function Content() {
  const scanId = useApp((s) => s.scanId);
  const dataVersion = useApp((s) => s.dataVersion);
  const units = useApp((s) => s.settings.units);
  const [category, setCategory] = useState<number | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const breakdown = useLoad(
    () => (scanId ? api.breakdown(scanId) : Promise.reject('No scan')),
    [scanId, dataVersion],
  );
  const files = useLoad(
    () =>
      scanId && category !== null ? api.categoryFiles(scanId, category, undefined, 200) : Promise.resolve([]),
    [scanId, category, dataVersion],
  );
  const cats = breakdown.data?.categories ?? [];

  useEffect(() => {
    if (category === null && cats.length > 0) setCategory(cats[0]!.index);
  }, [cats, category]);
  useEffect(() => setPicked([]), [category, dataVersion]);

  const current = cats.find((c) => c.index === category);
  return (
    <div className="flex h-full min-h-0 gap-3">
      <div className="flex w-[330px] shrink-0 flex-col gap-2 overflow-y-auto">
        <div className="h-[190px] shrink-0">
          {cats.length > 0 ? (
            <DonutChart categories={cats} selected={category} onSelect={setCategory} />
          ) : (
            <p className="pt-10 text-center text-sm text-ink-3">
              {breakdown.loading ? 'Analyzing files…' : (breakdown.error ?? 'There are no files to analyze.')}
            </p>
          )}
        </div>
        <table className="w-full text-[13px]">
          <thead className="text-xs text-ink-3">
            <tr>
              <th className="pb-1 text-left font-normal">Type</th>
              <th className="pb-1 text-right font-normal">Size</th>
              <th className="pb-1 text-right font-normal">Files</th>
              <th className="pb-1 text-right font-normal">Share</th>
            </tr>
          </thead>
          <tbody>
            {cats.map((c) => (
              <tr
                key={c.index}
                onClick={() => setCategory(c.index)}
                className={`cursor-pointer ${category === c.index ? 'bg-[#33415a]' : 'hover:bg-white/5'}`}
              >
                <td className="py-1 pl-1">
                  <span
                    className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle"
                    style={{ background: CATEGORY_COLORS[c.index] }}
                  />
                  {c.name}
                </td>
                <td className="text-right tabular-nums">{formatSize(c.size, units)}</td>
                <td className="text-right tabular-nums text-ink-2">{formatNumber(c.files)}</td>
                <td className="pr-1 text-right tabular-nums text-ink-2">{formatPercent(c.percent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 className="mt-2 text-xs text-ink-3">Largest extensions</h3>
        <table className="w-full text-[13px]">
          <tbody>
            {(breakdown.data?.extensions ?? []).slice(0, 15).map((e) => (
              <tr key={e.extension}>
                <td className="py-0.5 pl-1">
                  {e.extension === '(none)' ? '(no extension)' : `.${e.extension}`}
                </td>
                <td className="text-right tabular-nums">{formatSize(e.size, units)}</td>
                <td className="pr-1 text-right tabular-nums text-ink-2">{formatNumber(e.files)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate text-[15px]">
            {current
              ? `${current.name}: ${formatNumber(current.files)} files, ${formatSize(current.size, units)}`
              : 'Pick a type to inspect its files'}
            {current && current.files > 200 && (
              <span className="ml-2 text-xs text-ink-3">showing the largest 200</span>
            )}
          </div>
          <Button
            variant="danger"
            disabled={picked.length === 0}
            onClick={() => useApp.getState().requestTrash(picked)}
          >
            <Trash2 size={14} /> Move selected{picked.length > 0 ? ` (${formatNumber(picked.length)})` : ''}
          </Button>
        </div>
        {files.data && files.data.length > 0 ? (
          <FileList items={files.data} selection={picked} onSelection={setPicked} />
        ) : (
          <p className="py-10 text-center text-sm text-ink-3">
            {files.loading ? 'Loading files…' : 'No files in this category.'}
          </p>
        )}
      </div>
    </div>
  );
}

export function BreakdownPage() {
  return (
    <Panel
      title="Storage Breakdown"
      subtitle="Files grouped by type. Click a type to see its largest files."
      className="h-full"
    >
      <ScanGate>
        <Content />
      </ScanGate>
    </Panel>
  );
}
