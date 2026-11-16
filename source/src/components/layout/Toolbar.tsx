import { Brush, ChevronDown, Cloud, Files, ScanSearch, Search, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useScanActions } from '../../hooks/useScanActions';
import { useApp } from '../../stores/appStore';
import { MenuList, type MenuItem } from '../common/Menu';

function ToolButton({
  icon,
  label,
  onClick,
  disabled,
  active,
  title,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex h-[54px] min-w-[76px] flex-col items-center justify-center gap-1 rounded px-3 text-[13px] text-ink transition-colors hover:bg-white/10 disabled:opacity-45 disabled:hover:bg-transparent ${
        active ? 'bg-active' : ''
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

const Separator = () => <div className="mx-1 h-[52px] w-px bg-[#3a3a3a]" />;

export function Toolbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const status = useApp((s) => s.scanStatus);
  const drives = useApp((s) => s.drives);
  const selectedPath = useApp((s) => s.selectedPath);
  const setView = useApp((s) => s.setView);
  const { scanFolder, scanSelected, scanPath } = useScanActions();
  const scanning = status === 'scanning';
  const hasScan = status === 'completed';

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const scanMenu: MenuItem[] = [
    {
      label: selectedPath ? `Scan ${selectedPath}` : 'Scan selected drive',
      disabled: scanning,
      onSelect: () => void scanSelected(),
    },
    { label: 'Scan Folder…', shortcut: 'Ctrl+O', disabled: scanning, onSelect: () => void scanFolder() },
    { separator: true },
    ...drives.map((d) => ({
      label: `Scan ${d.label}  (${d.mount_point})`,
      disabled: scanning,
      onSelect: () => void scanPath(d.mount_point),
    })),
    { separator: true },
    { label: 'Cancel Scan', disabled: !scanning, onSelect: () => void useApp.getState().cancelScan() },
  ];

  const iconProps = { size: 26, strokeWidth: 1.6 } as const;
  return (
    <div className="flex h-[66px] shrink-0 items-center gap-0.5 border-y border-[#242424] bg-bar px-2.5">
      <div ref={wrap} className="relative flex items-center rounded bg-active/60">
        <ToolButton
          icon={<ScanSearch {...iconProps} className="text-accent" />}
          label="Scan Drive"
          active={scanning}
          disabled={scanning}
          title={scanning ? 'A scan is running' : 'Scan the selected drive (Ctrl+O to pick a folder)'}
          onClick={() => void scanSelected()}
        />
        <button
          aria-label="More scan options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-[54px] w-[22px] items-center justify-center rounded text-ink-2 hover:bg-white/10"
        >
          <ChevronDown size={14} />
        </button>
        {menuOpen && (
          <div className="absolute left-0 top-full z-50 mt-1">
            <MenuList items={scanMenu} onClose={() => setMenuOpen(false)} />
          </div>
        )}
      </div>
      <Separator />
      <ToolButton
        icon={<Files {...iconProps} />}
        label="Duplicate Finder"
        onClick={() => setView('duplicates')}
      />
      <Separator />
      <ToolButton
        icon={<Brush {...iconProps} className="text-[#f0a040]" />}
        label="Cleanup"
        onClick={() => setView('cleanup')}
      />
      <Separator />
      <ToolButton
        icon={<Cloud {...iconProps} className="text-accent" />}
        label="Cloud & Network"
        onClick={() => setView('cloud')}
      />
      <Separator />
      <ToolButton icon={<Search {...iconProps} />} label="Search" onClick={() => setView('search')} />
      <Separator />
      <ExportButton disabled={!hasScan} />
    </div>
  );
}

function ExportButton({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <ToolButton
        icon={<Upload size={26} strokeWidth={1.6} className="text-good" />}
        label="Export Report"
        disabled={disabled}
        title={disabled ? 'Scan a drive or folder first' : 'Save the scan as CSV or JSON'}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1">
          <MenuList
            onClose={() => setOpen(false)}
            items={[
              { label: 'CSV (spreadsheet)…', onSelect: () => void useApp.getState().exportReport('csv') },
              { label: 'JSON (full report)…', onSelect: () => void useApp.getState().exportReport('json') },
            ]}
          />
        </div>
      )}
    </div>
  );
}
