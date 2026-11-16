import { AlertTriangle, FolderSearch, HardDrive } from 'lucide-react';
import type { ReactNode } from 'react';
import { useScanActions } from '../../hooks/useScanActions';
import { useApp } from '../../stores/appStore';
import { Button } from '../common/Button';
import { EmptyState } from '../common/EmptyState';
import { ScanProgressPanel } from './ScanProgressPanel';

/** Renders `children` only when a finished scan exists; otherwise shows the right empty, loading or error state. */
export function ScanGate({ children }: { children: ReactNode }) {
  const status = useApp((s) => s.scanStatus);
  const summary = useApp((s) => s.summary);
  const error = useApp((s) => s.scanError);
  const selectedPath = useApp((s) => s.selectedPath);
  const { scanFolder, scanSelected } = useScanActions();

  if (status === 'scanning') return <ScanProgressPanel />;
  if (status === 'completed' && summary) return <>{children}</>;

  const actions = (
    <>
      <Button variant="primary" onClick={() => void scanSelected()}>
        <HardDrive size={14} /> {selectedPath ? `Scan ${selectedPath}` : 'Scan a drive'}
      </Button>
      <Button onClick={() => void scanFolder()}>
        <FolderSearch size={14} /> Scan a folder…
      </Button>
    </>
  );

  if (status === 'error') {
    return (
      <EmptyState
        icon={<AlertTriangle size={34} />}
        title="The scan could not finish"
        text={error ?? 'Check that the folder exists and that you can read it.'}
      >
        {actions}
      </EmptyState>
    );
  }
  if (status === 'cancelled') {
    return (
      <EmptyState
        icon={<FolderSearch size={34} />}
        title="Scan cancelled"
        text="Partial results are discarded. Start the scan again when you are ready."
      >
        {actions}
      </EmptyState>
    );
  }
  return (
    <EmptyState
      icon={<HardDrive size={34} />}
      title="Nothing scanned yet"
      text="Choose a drive on the left or pick a folder. DiskPulse Pro reads sizes only; it never changes files while scanning."
    >
      {actions}
    </EmptyState>
  );
}
