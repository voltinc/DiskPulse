import { Cloud, Folder, Network, ScanSearch } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../components/common/Button';
import { Panel } from '../components/common/Panel';
import { useLoad } from '../hooks/useLoad';
import { useScanActions } from '../hooks/useScanActions';
import { api } from '../services/api';
import { useApp } from '../stores/appStore';
import type { LocationInfo } from '../types';
import { formatSize } from '../utils/format';

function LocationRow({
  icon,
  title,
  path,
  description,
  extra,
}: {
  icon: ReactNode;
  title: string;
  path: string;
  description: string;
  extra?: string;
}) {
  const scanning = useApp((s) => s.scanStatus === 'scanning');
  const { scanPath } = useScanActions();
  return (
    <div className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
      <div className="shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px]">{title}</div>
        <div className="truncate text-xs text-ink-3" title={path}>
          {path}
        </div>
        <div className="text-[12.5px] text-ink-3">{extra ? `${description} - ${extra}` : description}</div>
      </div>
      <Button
        disabled={scanning}
        onClick={() => {
          void scanPath(path);
          useApp.getState().setView('tree');
        }}
      >
        <ScanSearch size={14} /> Scan
      </Button>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-3 text-[13px] text-ink-3">{children}</p>;
}

export function CleanupPage() {
  const locations = useLoad<LocationInfo[]>(() => api.cleanupLocations(), []);
  return (
    <Panel
      title="Cleanup"
      subtitle="Places where disposable data usually builds up on this computer"
      className="h-full"
    >
      <div className="min-h-0 flex-1 overflow-y-auto pr-2">
        <p className="mb-2 text-[13px] text-ink-2">
          Scanning a location only reads it. Review the results in the Directory Tree, then move what you do
          not need to the Trash. Nothing is deleted automatically, and some system folders may need
          administrator rights to be read in full.
        </p>
        {locations.loading && <Empty>Looking for cleanup locations…</Empty>}
        {locations.error && <Empty>{locations.error}</Empty>}
        {locations.data?.length === 0 && (
          <Empty>No well-known cleanup folders were found on this computer.</Empty>
        )}
        {locations.data?.map((l) => (
          <LocationRow
            key={l.path}
            icon={<Folder size={22} color="#e8b84a" fill="#e8b84a33" />}
            title={l.label}
            path={l.path}
            description={l.description}
          />
        ))}
      </div>
    </Panel>
  );
}

export function CloudPage() {
  const cloud = useLoad<LocationInfo[]>(() => api.cloudLocations(), []);
  const drives = useApp((s) => s.drives);
  const units = useApp((s) => s.settings.units);
  const shares = drives.filter((d) => d.network);
  return (
    <Panel
      title="Cloud & Network"
      subtitle="Network shares and cloud-sync folders found on this computer"
      className="h-full"
    >
      <div className="min-h-0 flex-1 overflow-y-auto pr-2">
        <h3 className="mb-1 mt-1 text-[13px] text-ink-2">Network shares</h3>
        {shares.length === 0 && (
          <Empty>
            No network shares are mounted. Map or mount a share, then refresh the drive list from View.
          </Empty>
        )}
        {shares.map((d) => (
          <LocationRow
            key={d.mount_point}
            icon={<Network size={22} className="text-[#4fc3c9]" />}
            title={d.label}
            path={d.mount_point}
            description={`${d.file_system || 'network'} - ${formatSize(d.used_space, units)} used of ${formatSize(d.total_space, units)}`}
            extra="scans over the network can be slow"
          />
        ))}
        <h3 className="mb-1 mt-4 text-[13px] text-ink-2">Cloud sync folders</h3>
        <p className="mb-1 text-xs text-ink-3">
          Online-only files report their full logical size but take almost no space on disk, so compare the
          Size and On disk columns after scanning.
        </p>
        {cloud.loading && <Empty>Looking for cloud folders…</Empty>}
        {cloud.data?.length === 0 && (
          <Empty>
            No OneDrive, Dropbox, Google Drive, iCloud or similar folders were found in your user folder.
          </Empty>
        )}
        {cloud.data?.map((l) => (
          <LocationRow
            key={l.path}
            icon={<Cloud size={22} className="text-accent" />}
            title={l.label}
            path={l.path}
            description={l.description}
          />
        ))}
      </div>
    </Panel>
  );
}
