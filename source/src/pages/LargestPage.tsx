import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '../components/common/Button';
import { FileList } from '../components/common/FileList';
import { Panel } from '../components/common/Panel';
import { ScanGate } from '../components/scanner/ScanGate';
import { useLoad } from '../hooks/useLoad';
import { api } from '../services/api';
import { useApp } from '../stores/appStore';
import { formatNumber, formatSize } from '../utils/format';

function Content() {
  const scanId = useApp((s) => s.scanId);
  const dataVersion = useApp((s) => s.dataVersion);
  const units = useApp((s) => s.settings.units);
  const [picked, setPicked] = useState<number[]>([]);
  const files = useLoad(
    () => (scanId ? api.largestFiles(scanId, 100) : Promise.reject('No scan')),
    [scanId, dataVersion],
  );
  useEffect(() => setPicked([]), [dataVersion]);
  const items = files.data ?? [];
  const chosen = items.filter((n) => picked.includes(n.id));
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2 text-[13px] text-ink-2">
        <span className="flex-1">
          {items.length > 0
            ? `${formatNumber(items.length)} files, ${formatSize(
                items.reduce((a, n) => a + n.size, 0),
                units,
              )} together.`
            : ''}
          {chosen.length > 0 &&
            ` ${formatNumber(chosen.length)} selected (${formatSize(
              chosen.reduce((a, n) => a + n.size, 0),
              units,
            )}).`}
        </span>
        <Button
          variant="danger"
          disabled={picked.length === 0}
          onClick={() => useApp.getState().requestTrash(picked)}
        >
          <Trash2 size={14} /> Move selected to Trash
        </Button>
      </div>
      {items.length > 0 ? (
        <FileList items={items} selection={picked} onSelection={setPicked} />
      ) : (
        <p className="py-10 text-center text-sm text-ink-3">
          {files.loading
            ? 'Finding the largest files…'
            : (files.error ?? 'No files were found in this scan.')}
        </p>
      )}
    </div>
  );
}

export function LargestPage() {
  return (
    <Panel
      title="Top 100 Largest Files"
      subtitle="The biggest files in this scan, found with a bounded top-K pass"
      className="h-full"
    >
      <ScanGate>
        <Content />
      </ScanGate>
    </Panel>
  );
}
