import { useEffect } from 'react';
import { AboutDialog, ConfirmHost, IssuesDialog, Toasts, TrashDialog } from './components/common/Overlays';
import { MenuBar } from './components/layout/MenuBar';
import { StatusBar } from './components/layout/StatusBar';
import { TabStrip } from './components/layout/TabStrip';
import { Toolbar } from './components/layout/Toolbar';
import { LeftPane } from './components/navigation/LeftPane';
import { useBackendEvents } from './hooks/useBackendEvents';
import { useScanActions } from './hooks/useScanActions';
import { BreakdownPage } from './pages/BreakdownPage';
import { DuplicatesPage } from './pages/DuplicatesPage';
import { HistoryPage } from './pages/HistoryPage';
import { LargestPage } from './pages/LargestPage';
import { CleanupPage, CloudPage } from './pages/LocationsPage';
import { OverviewPage } from './pages/OverviewPage';
import { SearchPage } from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { TreePage } from './pages/TreePage';
import { TreemapPage } from './pages/TreemapPage';
import { useApp } from './stores/appStore';
import type { ViewId } from './types';

const PAGES: Record<ViewId, () => JSX.Element> = {
  overview: OverviewPage,
  tree: TreePage,
  treemap: TreemapPage,
  breakdown: BreakdownPage,
  largest: LargestPage,
  duplicates: DuplicatesPage,
  history: HistoryPage,
  settings: SettingsPage,
  search: SearchPage,
  cleanup: CleanupPage,
  cloud: CloudPage,
};

export default function App() {
  const view = useApp((s) => s.view);
  const { scanFolder, rescan } = useScanActions();
  useBackendEvents();

  useEffect(() => {
    void useApp.getState().init();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const st = useApp.getState();
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        if (st.scanStatus !== 'scanning') void scanFolder();
      } else if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        st.setView('search');
      } else if (e.key === 'F5') {
        e.preventDefault();
        if (st.scanStatus !== 'scanning') void rescan();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scanFolder, rescan]);

  const Page = PAGES[view];
  return (
    <div className="flex h-full flex-col bg-win text-ink">
      <MenuBar />
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <LeftPane />
        <main className="flex min-w-0 flex-1 flex-col border-l border-[#262626] bg-win p-2.5 pt-1.5">
          <TabStrip />
          <div className="min-h-0 flex-1">
            <Page />
          </div>
        </main>
      </div>
      <StatusBar />
      <TrashDialog />
      <ConfirmHost />
      <AboutDialog />
      <IssuesDialog />
      <Toasts />
    </div>
  );
}
