import { create } from 'zustand';
import { api } from '../services/api';
import { pickReportPath } from '../services/dialogs';
import type {
  AppInfo,
  DriveInfo,
  DuplicateProgress,
  DuplicateSummary,
  HistoryRecord,
  ReportFormat,
  ScanProgress,
  ScanSummary,
  Settings,
  ViewId,
} from '../types';
import { errorText } from '../utils/format';

export type ScanStatus = 'idle' | 'scanning' | 'completed' | 'cancelled' | 'error';
export type DupStatus = 'idle' | 'running' | 'completed' | 'cancelled' | 'error';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
}

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

export const DEFAULT_SETTINGS: Settings = {
  threads: 0,
  stay_on_filesystem: true,
  min_duplicate_size: 1024 * 1024,
  units: 'windows',
  treemap_depth: 2,
  treemap_metric: 'logical',
};

interface AppStore {
  view: ViewId;
  appInfo: AppInfo | null;
  drives: DriveInfo[];
  history: HistoryRecord[];
  settings: Settings;
  selectedPath: string | null;

  scanStatus: ScanStatus;
  scanId: string | null;
  scanRoot: string | null;
  progress: ScanProgress | null;
  summary: ScanSummary | null;
  scanError: string | null;

  dupStatus: DupStatus;
  dupProgress: DuplicateProgress | null;
  dupSummary: DuplicateSummary | null;
  dupError: string | null;

  focusId: number;
  selection: number[];
  dataVersion: number;
  trashRequest: number[] | null;
  confirmRequest: ConfirmRequest | null;
  aboutOpen: boolean;
  issuesOpen: boolean;
  toasts: Toast[];

  setView: (view: ViewId) => void;
  setSelectedPath: (path: string | null) => void;
  setFocusId: (id: number) => void;
  setSelection: (ids: number[]) => void;
  setAboutOpen: (open: boolean) => void;
  setIssuesOpen: (open: boolean) => void;
  init: () => Promise<void>;
  refreshDrives: () => Promise<void>;
  refreshHistory: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  startScan: (path: string) => Promise<void>;
  cancelScan: () => Promise<void>;
  startDuplicates: (minSize?: number, scope?: number) => Promise<void>;
  cancelDuplicates: () => Promise<void>;
  afterMutation: () => Promise<void>;
  requestTrash: (ids: number[]) => void;
  closeTrash: () => void;
  confirm: (request: Omit<ConfirmRequest, 'resolve'>) => Promise<boolean>;
  resolveConfirm: (ok: boolean) => void;
  exportReport: (format: ReportFormat) => Promise<void>;
  notify: (kind: Toast['kind'], text: string) => void;
  dismissToast: (id: number) => void;

  onScanStarted: (p: { scan_id: string; root: string }) => void;
  onScanProgress: (p: ScanProgress) => void;
  onScanCompleted: (p: { scan_id: string; summary: ScanSummary }) => void;
  onScanCancelled: (p: { scan_id: string }) => void;
  onScanError: (p: { scan_id: string; message: string }) => void;
  onDupProgress: (p: DuplicateProgress) => void;
  onDupCompleted: (p: { scan_id: string; summary: DuplicateSummary }) => void;
  onDupCancelled: (p: { scan_id: string }) => void;
  onDupError: (p: { scan_id: string; message: string }) => void;
}

let toastCounter = 0;

export const useApp = create<AppStore>()((set, get) => ({
  view: 'overview',
  appInfo: null,
  drives: [],
  history: [],
  settings: DEFAULT_SETTINGS,
  selectedPath: null,

  scanStatus: 'idle',
  scanId: null,
  scanRoot: null,
  progress: null,
  summary: null,
  scanError: null,

  dupStatus: 'idle',
  dupProgress: null,
  dupSummary: null,
  dupError: null,

  focusId: 0,
  selection: [],
  dataVersion: 0,
  trashRequest: null,
  confirmRequest: null,
  aboutOpen: false,
  issuesOpen: false,
  toasts: [],

  setView: (view) => set({ view }),
  setSelectedPath: (selectedPath) => set({ selectedPath }),
  setFocusId: (focusId) => set({ focusId }),
  setSelection: (selection) => set({ selection }),
  setAboutOpen: (aboutOpen) => set({ aboutOpen }),
  setIssuesOpen: (issuesOpen) => set({ issuesOpen }),

  init: async () => {
    const [info, drives, settings, history] = await Promise.allSettled([
      api.appInfo(),
      api.listDrives(),
      api.getSettings(),
      api.history(),
    ]);
    const patch: Partial<AppStore> = {};
    if (info.status === 'fulfilled') patch.appInfo = info.value;
    if (drives.status === 'fulfilled') {
      patch.drives = drives.value;
      const first = drives.value.find((d) => !d.network) ?? drives.value[0];
      if (first && !get().selectedPath) patch.selectedPath = first.mount_point;
    }
    if (settings.status === 'fulfilled') patch.settings = settings.value;
    if (history.status === 'fulfilled') patch.history = history.value;
    set(patch);
  },

  refreshDrives: async () => {
    try {
      set({ drives: await api.listDrives() });
    } catch (e) {
      get().notify('error', errorText(e));
    }
  },

  refreshHistory: async () => {
    try {
      set({ history: await api.history() });
    } catch (e) {
      get().notify('error', errorText(e));
    }
  },

  updateSettings: async (patch) => {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    try {
      set({ settings: await api.saveSettings(next) });
    } catch (e) {
      get().notify('error', `Settings could not be saved: ${errorText(e)}`);
    }
  },

  startScan: async (path) => {
    if (get().scanStatus === 'scanning') {
      get().notify('info', 'A scan is already running.');
      return;
    }
    set({
      scanStatus: 'scanning',
      scanId: null,
      scanRoot: path,
      progress: null,
      summary: null,
      scanError: null,
      dupStatus: 'idle',
      dupProgress: null,
      dupSummary: null,
      focusId: 0,
      selection: [],
      selectedPath: path,
    });
    try {
      const id = await api.startScan(path);
      set((s) => (s.scanStatus === 'scanning' && !s.scanId ? { scanId: id } : {}));
    } catch (e) {
      set({ scanStatus: 'error', scanError: errorText(e) });
    }
  },

  cancelScan: async () => {
    const id = get().scanId;
    if (!id) return;
    try {
      await api.cancelScan(id);
    } catch (e) {
      get().notify('error', errorText(e));
    }
  },

  startDuplicates: async (minSize, scope) => {
    const id = get().scanId;
    if (!id || get().scanStatus !== 'completed') return;
    set({ dupStatus: 'running', dupProgress: null, dupSummary: null, dupError: null });
    try {
      await api.startDuplicates(id, minSize, scope);
    } catch (e) {
      set({ dupStatus: 'error', dupError: errorText(e) });
    }
  },

  cancelDuplicates: async () => {
    const id = get().scanId;
    if (id) await api.cancelDuplicates(id).catch(() => undefined);
  },

  afterMutation: async () => {
    const id = get().scanId;
    if (!id) return;
    try {
      const [summary, page] = await Promise.all([api.scanSummary(id), api.duplicateGroups(id, 0, 1)]);
      set((s) => ({
        summary,
        selection: [],
        dataVersion: s.dataVersion + 1,
        dupSummary: page.summary ?? s.dupSummary,
      }));
    } catch (e) {
      get().notify('error', errorText(e));
    }
  },

  requestTrash: (ids) => {
    if (ids.length === 0) return;
    if (get().dupStatus === 'running') {
      get().notify('error', 'Cancel the duplicate scan or wait for it to finish before deleting files.');
      return;
    }
    set({ trashRequest: ids });
  },
  closeTrash: () => set({ trashRequest: null }),

  confirm: (request) =>
    new Promise<boolean>((resolve) => {
      set({ confirmRequest: { ...request, resolve } });
    }),
  resolveConfirm: (ok) => {
    const req = get().confirmRequest;
    set({ confirmRequest: null });
    req?.resolve(ok);
  },

  exportReport: async (format) => {
    const { scanId, summary, dupStatus } = get();
    if (!scanId || !summary) {
      get().notify('info', 'Scan a drive or folder first, then export its report.');
      return;
    }
    try {
      const dest = await pickReportPath(format, summary.root.name);
      if (!dest) return;
      await api.exportReport(scanId, format, dest, dupStatus === 'completed');
      get().notify('success', `Report saved to ${dest}`);
    } catch (e) {
      get().notify('error', `Export failed: ${errorText(e)}`);
    }
  },

  notify: (kind, text) => {
    const id = ++toastCounter;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 9000 : 5000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  onScanStarted: (p) => set((s) => (s.scanStatus === 'scanning' ? { scanId: s.scanId ?? p.scan_id } : {})),
  onScanProgress: (p) =>
    set((s) =>
      s.scanStatus === 'scanning' && (!s.scanId || s.scanId === p.scan_id)
        ? { scanId: p.scan_id, progress: p }
        : {},
    ),
  onScanCompleted: (p) => {
    set((s) => ({
      scanStatus: 'completed',
      scanId: p.scan_id,
      summary: p.summary,
      scanRoot: p.summary.root.path,
      progress: null,
      focusId: 0,
      selection: [],
      dataVersion: s.dataVersion + 1,
    }));
    void get().refreshHistory();
    void get().refreshDrives();
  },
  onScanCancelled: () => set({ scanStatus: 'cancelled', progress: null }),
  onScanError: (p) => set({ scanStatus: 'error', scanError: p.message, progress: null }),

  onDupProgress: (p) => set((s) => (s.dupStatus === 'running' ? { dupProgress: p } : {})),
  onDupCompleted: (p) =>
    set((s) => ({
      dupStatus: 'completed',
      dupSummary: p.summary,
      dupProgress: null,
      dataVersion: s.dataVersion + 1,
    })),
  onDupCancelled: () => set({ dupStatus: 'cancelled', dupProgress: null }),
  onDupError: (p) => set({ dupStatus: 'error', dupError: p.message, dupProgress: null }),
}));
