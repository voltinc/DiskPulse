import { X } from 'lucide-react';
import { useApp } from '../../stores/appStore';
import { formatDuration, formatNumber, formatSize } from '../../utils/format';
import { Button } from '../common/Button';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[110px]">
      <div className="text-[22px] font-light leading-7 text-ink tabular-nums">{value}</div>
      <div className="text-xs text-ink-3">{label}</div>
    </div>
  );
}

export function ScanProgressPanel() {
  const progress = useApp((s) => s.progress);
  const root = useApp((s) => s.scanRoot);
  const units = useApp((s) => s.settings.units);
  const cancel = useApp((s) => s.cancelScan);
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-5 px-8"
      role="status"
      aria-live="polite"
    >
      <div className="text-center">
        <div className="text-[18px] text-ink">Scanning {root}</div>
        <div className="text-sm text-ink-3">Reading folders in parallel. Nothing is changed on disk.</div>
      </div>
      <div className="h-[6px] w-[min(520px,80%)] overflow-hidden rounded bg-field">
        <div className="h-full w-1/3 rounded bg-accent animate-indeterminate" />
      </div>
      <div className="flex flex-wrap justify-center gap-x-8 gap-y-3">
        <Stat label="Items found" value={formatNumber(progress?.scanned_count ?? 0)} />
        <Stat label="Folders" value={formatNumber(progress?.directories_scanned ?? 0)} />
        <Stat label="Files" value={formatNumber(progress?.files_scanned ?? 0)} />
        <Stat label="Data seen" value={formatSize(progress?.bytes_processed ?? 0, units)} />
        <Stat label="Elapsed" value={formatDuration(progress?.elapsed_ms ?? 0)} />
        {(progress?.errors_count ?? 0) > 0 && (
          <Stat label="Unreadable" value={formatNumber(progress?.errors_count ?? 0)} />
        )}
      </div>
      <div
        className="w-[min(720px,90%)] truncate text-center text-xs text-ink-3"
        dir="rtl"
        title={progress?.current_path}
      >
        <bdo dir="ltr">{progress?.current_path ?? ''}</bdo>
      </div>
      <Button onClick={() => void cancel()}>
        <X size={14} /> Cancel scan
      </Button>
    </div>
  );
}
