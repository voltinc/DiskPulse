import { Panel } from '../components/common/Panel';
import { ScanGate } from '../components/scanner/ScanGate';
import { TreeTable } from '../components/tree/TreeTable';
import { useApp } from '../stores/appStore';
import { formatNumber, formatSize } from '../utils/format';

export function TreePage() {
  const summary = useApp((s) => s.summary);
  const units = useApp((s) => s.settings.units);
  return (
    <Panel
      title="Directory Tree"
      subtitle={
        summary
          ? `${summary.root.path} - ${formatSize(summary.total_size, units)} logical, ${formatSize(summary.total_allocated, units)} on disk, ${formatNumber(summary.file_count)} files`
          : 'Scan a drive or folder to browse it'
      }
      className="h-full"
    >
      <ScanGate>
        <TreeTable />
      </ScanGate>
    </Panel>
  );
}
