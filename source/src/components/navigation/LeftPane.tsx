import { ChevronDown, ChevronRight, Folder, HardDrive, Network, Server, Usb } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useScanActions } from '../../hooks/useScanActions';
import { useApp } from '../../stores/appStore';
import type { DriveInfo, HistoryRecord } from '../../types';
import { formatNumber, formatPercent, formatSize } from '../../utils/format';
import { UsageBar } from '../common/UsageBar';

function Group({
  label,
  icon,
  children,
  defaultOpen = true,
  indent = 0,
}: {
  label: string;
  icon: ReactNode;
  children?: ReactNode;
  defaultOpen?: boolean;
  indent?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 w-full items-center gap-1.5 rounded px-1.5 text-left text-[13px] text-ink hover:bg-white/5"
        style={{ paddingLeft: 6 + indent }}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown size={13} className="text-ink-3" />
        ) : (
          <ChevronRight size={13} className="text-ink-3" />
        )}
        {icon}
        <span className="truncate">{label}</span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

function DriveRow({
  drive,
  scanned,
  selected,
  onSelect,
  onScan,
}: {
  drive: DriveInfo;
  scanned?: { size: number; files: number };
  selected: boolean;
  onSelect: () => void;
  onScan: () => void;
}) {
  const units = useApp((s) => s.settings.units);
  const pct = drive.total_space ? (drive.used_space / drive.total_space) * 100 : 0;
  const Icon = drive.network ? Server : drive.removable ? Usb : HardDrive;
  return (
    <button
      onClick={onSelect}
      onDoubleClick={onScan}
      title={`${drive.mount_point} - ${drive.file_system || 'unknown file system'}. Double-click to scan.`}
      className={`block w-full rounded py-1 pl-9 pr-2 text-left ${selected ? 'bg-[#33415a]' : 'hover:bg-white/5'}`}
    >
      <div className="flex items-center gap-2 text-[13px]">
        <Icon size={15} className="shrink-0 text-ink-2" />
        <span className="min-w-0 flex-1 truncate">{drive.label}</span>
        <span className="w-[66px] shrink-0 rounded-sm bg-[#2f7fd8] px-1.5 text-center text-[12px] leading-[18px] text-white">
          {formatSize(scanned ? scanned.size : drive.used_space, units, true)}
        </span>
        <span className="w-9 shrink-0 text-right text-[12px] text-ink-2">
          {scanned
            ? formatNumber(scanned.files)
            : drive.file_system
                .replace(/^fuse\./i, '')
                .toUpperCase()
                .slice(0, 6)}
        </span>
        <span className="w-10 shrink-0 text-right text-[12px] text-ink-2">{formatPercent(pct)}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-2 pl-[23px] text-[12px] text-ink-3">
        <span className="w-[92px] shrink-0 truncate">
          {formatSize(drive.used_space, units, true)}/{formatSize(drive.total_space, units, true)}
        </span>
        <UsageBar percent={pct} className="flex-1" />
      </div>
    </button>
  );
}

function FolderRow({
  record,
  live,
  selected,
  onSelect,
  onScan,
}: {
  record: HistoryRecord;
  live?: { size: number; files: number };
  selected: boolean;
  onSelect: () => void;
  onScan: () => void;
}) {
  const units = useApp((s) => s.settings.units);
  const name = record.root_path.split(/[\\/]/).filter(Boolean).pop() ?? record.root_path;
  return (
    <button
      onClick={onSelect}
      onDoubleClick={onScan}
      title={`${record.root_path}. Double-click to scan again.`}
      className={`flex w-full items-center gap-2 rounded py-1 pl-9 pr-2 text-left text-[13px] ${selected ? 'bg-[#33415a]' : 'hover:bg-white/5'}`}
    >
      <Folder size={15} className="shrink-0" color="#e8b84a" fill="#e8b84a33" />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="w-[66px] shrink-0 rounded-sm bg-[#2f7fd8] px-1.5 text-center text-[12px] leading-[18px] text-white">
        {formatSize(live ? live.size : record.total_size, units, true)}
      </span>
      <span className="w-9 shrink-0 text-right text-[12px] text-ink-2">
        {formatNumber(live ? live.files : record.file_count)}
      </span>
    </button>
  );
}

export function LeftPane() {
  const appInfo = useApp((s) => s.appInfo);
  const drives = useApp((s) => s.drives);
  const history = useApp((s) => s.history);
  const summary = useApp((s) => s.summary);
  const selectedPath = useApp((s) => s.selectedPath);
  const setSelectedPath = useApp((s) => s.setSelectedPath);
  const { scanPath } = useScanActions();

  const local = drives.filter((d) => !d.network);
  const network = drives.filter((d) => d.network);
  const mounts = useMemo(() => new Set(drives.map((d) => d.mount_point)), [drives]);
  const folders = useMemo(() => {
    const seen = new Set<string>();
    return history
      .filter((h) => !mounts.has(h.root_path) && !seen.has(h.root_path) && seen.add(h.root_path))
      .slice(0, 6);
  }, [history, mounts]);

  const scannedFor = (mount: string) =>
    summary && summary.root.path === mount
      ? { size: summary.total_size, files: summary.file_count }
      : undefined;

  return (
    <aside
      className="flex w-[388px] shrink-0 flex-col overflow-hidden bg-pane"
      aria-label="Drives and folders"
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <Group
          label={`DiskPulse Pro (${appInfo?.host_name ?? '…'})`}
          icon={<Folder size={16} color="#e8b84a" fill="#e8b84a33" />}
        >
          <Group label="Local Drives" icon={<HardDrive size={15} className="text-accent" />} indent={14}>
            {local.length === 0 && (
              <p className="py-2 pl-12 text-[12px] text-ink-3">No local drives were found.</p>
            )}
            {local.map((d) => (
              <DriveRow
                key={d.mount_point}
                drive={d}
                scanned={scannedFor(d.mount_point)}
                selected={selectedPath === d.mount_point}
                onSelect={() => setSelectedPath(d.mount_point)}
                onScan={() => void scanPath(d.mount_point)}
              />
            ))}
          </Group>
          <Group label="Network Shares" icon={<Network size={15} className="text-[#4fc3c9]" />} indent={14}>
            {network.length === 0 && (
              <p className="py-2 pl-12 text-[12px] text-ink-3">No network shares are mounted.</p>
            )}
            {network.map((d) => (
              <DriveRow
                key={d.mount_point}
                drive={d}
                scanned={scannedFor(d.mount_point)}
                selected={selectedPath === d.mount_point}
                onSelect={() => setSelectedPath(d.mount_point)}
                onScan={() => void scanPath(d.mount_point)}
              />
            ))}
          </Group>
          <Group label="Scanned Folders" icon={<Folder size={15} className="text-ink-2" />} indent={14}>
            {folders.length === 0 && (
              <p className="py-2 pl-12 text-[12px] text-ink-3">Folders you scan appear here.</p>
            )}
            {folders.map((h) => (
              <FolderRow
                key={h.root_path}
                record={h}
                live={scannedFor(h.root_path)}
                selected={selectedPath === h.root_path}
                onSelect={() => setSelectedPath(h.root_path)}
                onScan={() => void scanPath(h.root_path)}
              />
            ))}
          </Group>
        </Group>
      </div>
    </aside>
  );
}
