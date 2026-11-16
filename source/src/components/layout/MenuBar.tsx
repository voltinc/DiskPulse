import { useEffect, useRef, useState } from 'react';
import { useScanActions } from '../../hooks/useScanActions';
import { useApp } from '../../stores/appStore';
import { api } from '../../services/api';
import type { ViewId } from '../../types';
import { MenuList, type MenuItem } from '../common/Menu';

export const VIEW_LABELS: Record<ViewId, string> = {
  overview: 'Overview',
  tree: 'Directory Tree',
  treemap: 'Treemap',
  breakdown: 'Storage Breakdown',
  largest: 'Largest Files',
  duplicates: 'Duplicate Finder',
  history: 'Scan History',
  settings: 'Settings',
  search: 'Search',
  cleanup: 'Cleanup',
  cloud: 'Cloud & Network',
};

export function MenuBar() {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const view = useApp((s) => s.view);
  const status = useApp((s) => s.scanStatus);
  const setView = useApp((s) => s.setView);
  const { scanFolder, scanSelected, rescan } = useScanActions();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', key);
    };
  }, [open]);

  const st = useApp.getState;
  const scanning = status === 'scanning';
  const hasScan = status === 'completed';
  const go = (v: ViewId) => () => setView(v);

  const menus: Record<string, MenuItem[]> = {
    File: [
      { label: 'Scan Folder…', shortcut: 'Ctrl+O', disabled: scanning, onSelect: () => void scanFolder() },
      { label: 'Scan Selected Drive', disabled: scanning, onSelect: () => void scanSelected() },
      { label: 'Rescan', shortcut: 'F5', disabled: scanning, onSelect: () => void rescan() },
      { separator: true },
      { label: 'Export Report as CSV…', disabled: !hasScan, onSelect: () => void st().exportReport('csv') },
      { label: 'Export Report as JSON…', disabled: !hasScan, onSelect: () => void st().exportReport('json') },
      { separator: true },
      { label: 'Exit', onSelect: () => void api.exitApp() },
    ],
    View: [
      ...(
        [
          'overview',
          'tree',
          'treemap',
          'breakdown',
          'largest',
          'duplicates',
          'history',
          'settings',
        ] as ViewId[]
      ).map((v) => ({
        label: VIEW_LABELS[v],
        checked: view === v,
        onSelect: go(v),
      })),
      { separator: true },
      { label: 'Refresh Drives', onSelect: () => void st().refreshDrives() },
    ],
    Tools: [
      { label: 'Duplicate Finder', onSelect: go('duplicates') },
      { label: 'Cleanup', onSelect: go('cleanup') },
      { label: 'Cloud & Network', onSelect: go('cloud') },
      { label: 'Search', shortcut: 'Ctrl+F', onSelect: go('search') },
      { separator: true },
      { label: 'Cancel Scan', disabled: !scanning, onSelect: () => void st().cancelScan() },
      { label: 'Settings', onSelect: go('settings') },
    ],
    Help: [
      { label: 'Scan Issues…', disabled: !hasScan, onSelect: () => st().setIssuesOpen(true) },
      { label: 'About DiskPulse Pro', onSelect: () => st().setAboutOpen(true) },
    ],
  };

  return (
    <div ref={ref} className="flex h-8 shrink-0 items-center gap-0.5 bg-win px-2 text-base" role="menubar">
      {Object.entries(menus).map(([name, items]) => (
        <div key={name} className="relative">
          <button
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === name}
            onClick={() => setOpen(open === name ? null : name)}
            onMouseEnter={() => open && setOpen(name)}
            className={`rounded px-2.5 py-1 text-[13px] hover:bg-white/10 ${open === name ? 'bg-white/10' : ''}`}
          >
            {name}
          </button>
          {open === name && (
            <div className="absolute left-0 top-full z-50 mt-0.5">
              <MenuList items={items} onClose={() => setOpen(null)} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
