import { invoke } from '@tauri-apps/api/core';
import type {
  AppInfo,
  Breakdown,
  ChildrenPage,
  DriveInfo,
  DuplicatePage,
  HistoryRecord,
  LocationInfo,
  Metric,
  NodeSummary,
  ReportFormat,
  ScanSummary,
  Settings,
  SortDir,
  SortKey,
  TreemapRect,
  TrashOutcome,
} from '../types';

// Command argument names are camelCase here; Tauri maps them to the snake_case Rust parameters.
export const api = {
  appInfo: () => invoke<AppInfo>('app_info'),
  exitApp: () => invoke<void>('exit_app'),
  listDrives: () => invoke<DriveInfo[]>('list_drives'),
  cleanupLocations: () => invoke<LocationInfo[]>('get_cleanup_locations'),
  cloudLocations: () => invoke<LocationInfo[]>('get_cloud_locations'),
  getSettings: () => invoke<Settings>('get_settings'),
  saveSettings: (settings: Settings) => invoke<Settings>('save_settings', { settings }),

  startScan: (path: string) => invoke<string>('start_scan', { path }),
  cancelScan: (scanId: string) => invoke<boolean>('cancel_scan', { scanId }),
  scanSummary: (scanId: string) => invoke<ScanSummary>('get_scan_summary', { scanId }),

  children: (
    scanId: string,
    nodeId: number,
    offset: number,
    limit: number,
    sortKey: SortKey,
    sortDir: SortDir,
    filter?: string,
  ) => invoke<ChildrenPage>('get_children', { scanId, nodeId, offset, limit, sortKey, sortDir, filter }),
  nodes: (scanId: string, ids: number[]) => invoke<NodeSummary[]>('get_nodes', { scanId, ids }),
  ancestors: (scanId: string, nodeId: number) => invoke<NodeSummary[]>('get_ancestors', { scanId, nodeId }),
  search: (scanId: string, query: string, scope?: number, limit?: number) =>
    invoke<NodeSummary[]>('search_nodes', { scanId, query, scope, limit }),
  treemap: (scanId: string, nodeId: number, width: number, height: number, depth: number, metric: Metric) =>
    invoke<TreemapRect[]>('get_treemap', { scanId, nodeId, width, height, depth, metric }),
  breakdown: (scanId: string, scope?: number) => invoke<Breakdown>('get_breakdown', { scanId, scope }),
  categoryFiles: (scanId: string, category: number, scope?: number, limit?: number) =>
    invoke<NodeSummary[]>('get_category_files', { scanId, category, scope, limit }),
  largestFiles: (scanId: string, limit = 100, scope?: number) =>
    invoke<NodeSummary[]>('get_largest_files', { scanId, limit, scope }),

  startDuplicates: (scanId: string, minSize?: number, scope?: number) =>
    invoke<void>('start_duplicate_scan', { scanId, minSize, scope }),
  cancelDuplicates: (scanId: string) => invoke<void>('cancel_duplicate_scan', { scanId }),
  duplicateGroups: (scanId: string, offset = 0, limit = 500) =>
    invoke<DuplicatePage>('get_duplicate_groups', { scanId, offset, limit }),

  trash: (scanId: string, ids: number[]) => invoke<TrashOutcome>('trash_nodes', { scanId, ids }),
  reveal: (scanId: string, nodeId: number) => invoke<void>('reveal_node', { scanId, nodeId }),
  open: (scanId: string, nodeId: number, confirmedExecutable = false) =>
    invoke<void>('open_node', { scanId, nodeId, confirmedExecutable }),
  exportReport: (scanId: string, format: ReportFormat, dest: string, includeDuplicates: boolean) =>
    invoke<void>('export_report', { scanId, format, dest, includeDuplicates }),

  history: () => invoke<HistoryRecord[]>('get_history'),
  deleteHistory: (id: string) => invoke<HistoryRecord[]>('delete_history_entry', { id }),
  clearHistory: () => invoke<void>('clear_history'),
};
