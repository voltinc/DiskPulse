import { History, RotateCw, Trash2 } from 'lucide-react';
import { useScanActions } from '../hooks/useScanActions';
import { api } from '../services/api';
import { useApp } from '../stores/appStore';
import { Button } from '../components/common/Button';
import { EmptyState } from '../components/common/EmptyState';
import { Panel } from '../components/common/Panel';
import { errorText, formatDateTime, formatDuration, formatNumber, formatSize } from '../utils/format';

export function HistoryPage() {
  const history = useApp((s) => s.history);
  const units = useApp((s) => s.settings.units);
  const scanning = useApp((s) => s.scanStatus === 'scanning');
  const { scanPath } = useScanActions();

  const remove = async (id: string) => {
    try {
      useApp.setState({ history: await api.deleteHistory(id) });
    } catch (e) {
      useApp.getState().notify('error', errorText(e));
    }
  };
  const clearAll = async () => {
    const ok = await useApp.getState().confirm({
      title: 'Clear scan history?',
      body: 'This removes the list of past scans. Your files are not touched.',
      confirmLabel: 'Clear history',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.clearHistory();
      useApp.setState({ history: [] });
    } catch (e) {
      useApp.getState().notify('error', errorText(e));
    }
  };

  return (
    <Panel
      title="Scan History"
      subtitle="Results are not stored; scan again to explore a location"
      className="h-full"
      actions={
        history.length > 0 ? (
          <Button onClick={() => void clearAll()}>
            <Trash2 size={14} /> Clear history
          </Button>
        ) : undefined
      }
    >
      {history.length === 0 ? (
        <EmptyState
          icon={<History size={32} />}
          title="No scans yet"
          text="Every finished scan is listed here with its totals."
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-sm border border-line">
          <table className="w-full min-w-[820px] text-[13px]">
            <thead className="sticky top-0 bg-[#2a2a2a] text-xs text-ink-3">
              <tr>
                <th className="px-3 py-2 text-left font-normal">Location</th>
                <th className="px-3 py-2 text-left font-normal">Scanned</th>
                <th className="px-3 py-2 text-right font-normal">Duration</th>
                <th className="px-3 py-2 text-right font-normal">Size</th>
                <th className="px-3 py-2 text-right font-normal">On disk</th>
                <th className="px-3 py-2 text-right font-normal">Files</th>
                <th className="px-3 py-2 text-right font-normal">Folders</th>
                <th className="w-[170px] px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-t border-line hover:bg-white/5">
                  <td className="max-w-[300px] truncate px-3 py-1.5" title={h.root_path}>
                    {h.root_path}
                  </td>
                  <td className="px-3 py-1.5 text-ink-2">{formatDateTime(h.started_at)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">
                    {formatDuration(h.duration_ms)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatSize(h.total_size, units)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">
                    {formatSize(h.total_allocated, units)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(h.file_count)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(h.dir_count)}</td>
                  <td className="px-3 py-1.5 text-right">
                    <Button
                      variant="ghost"
                      disabled={scanning}
                      onClick={() => void scanPath(h.root_path)}
                      title="Scan this location again"
                    >
                      <RotateCw size={13} /> Rescan
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => void remove(h.id)}
                      aria-label="Remove from history"
                    >
                      <Trash2 size={13} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
