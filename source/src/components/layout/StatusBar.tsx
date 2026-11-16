import { useEffect, useState } from 'react';
import { useApp } from '../../stores/appStore';
import { formatNumber, formatSize, relativeTime } from '../../utils/format';

export function StatusBar() {
  const status = useApp((s) => s.scanStatus);
  const summary = useApp((s) => s.summary);
  const progress = useApp((s) => s.progress);
  const drives = useApp((s) => s.drives);
  const units = useApp((s) => s.settings.units);
  const setIssuesOpen = useApp((s) => s.setIssuesOpen);
  const [, tick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const drive = summary
    ? [...drives]
        .sort((a, b) => b.mount_point.length - a.mount_point.length)
        .find((d) => summary.root.path.startsWith(d.mount_point))
    : undefined;

  const state =
    status === 'scanning'
      ? `Scanning… ${formatNumber(progress?.scanned_count ?? 0)} items`
      : status === 'cancelled'
        ? 'Scan cancelled'
        : status === 'error'
          ? 'Scan failed'
          : 'Ready';

  return (
    <footer className="flex h-6 shrink-0 items-center gap-2 bg-win px-2 text-[12px] text-ink-2">
      <span>{state}</span>
      {summary && (
        <>
          <span className="text-ink-3">|</span>
          <span>Last Scan: {relativeTime(summary.finished_at)}</span>
          <span className="text-ink-3">|</span>
          <span>
            {drive
              ? `Used ${formatSize(drive.used_space, units, true)} of ${formatSize(drive.total_space, units, true)}`
              : `Scanned ${formatSize(summary.total_size, units, true)} in ${formatNumber(summary.file_count)} files`}
          </span>
          {summary.errors_count > 0 && (
            <button
              className="ml-auto rounded px-1.5 text-[#f0b060] hover:bg-white/10"
              onClick={() => setIssuesOpen(true)}
            >
              {formatNumber(summary.errors_count)} items could not be read
            </button>
          )}
        </>
      )}
    </footer>
  );
}
