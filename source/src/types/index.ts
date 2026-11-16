// Mirrors the payloads produced by the Rust backend (snake_case on purpose: it matches the event
// payloads in the product specification and avoids a conversion layer).

export type NodeKind = 'file' | 'directory';

export interface NodeSummary {
  id: number;
  parent_id: number | null;
  name: string;
  path: string;
  relative_path: string;
  kind: NodeKind;
  /** Logical size: what the file reports. */
  size: number;
  /** Allocated size: space reserved on disk. */
  allocated: number;
  file_count: number;
  dir_count: number;
  modified: number | null;
  extension: string | null;
  category: number;
  is_symlink: boolean;
  accessible: boolean;
  child_count: number;
  percent_of_parent: number;
}

export interface ChildrenPage {
  total: number;
  items: NodeSummary[];
}

export interface ScanIssue {
  path: string;
  message: string;
}

export interface ScanSummary {
  scan_id: string;
  root: NodeSummary;
  started_at: number;
  finished_at: number;
  duration_ms: number;
  total_size: number;
  total_allocated: number;
  file_count: number;
  dir_count: number;
  errors_count: number;
  issues: ScanIssue[];
  stayed_on_filesystem: boolean;
}

export interface ScanProgress {
  scan_id: string;
  scanned_count: number;
  directories_scanned: number;
  files_scanned: number;
  bytes_processed: number;
  current_path: string;
  elapsed_ms: number;
  errors_count: number;
}

export interface DriveInfo {
  label: string;
  name: string;
  mount_point: string;
  file_system: string;
  total_space: number;
  available_space: number;
  used_space: number;
  kind: 'ssd' | 'hdd' | 'unknown';
  removable: boolean;
  network: boolean;
}

export interface LocationInfo {
  label: string;
  path: string;
  description: string;
}

export interface CategoryStat {
  index: number;
  name: string;
  size: number;
  allocated: number;
  files: number;
  percent: number;
}

export interface ExtensionStat {
  extension: string;
  category: number;
  size: number;
  files: number;
}

export interface Breakdown {
  total_size: number;
  total_files: number;
  categories: CategoryStat[];
  extensions: ExtensionStat[];
}

export interface TreemapRect {
  id: number;
  name: string;
  kind: NodeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  size: number;
  allocated: number;
  percent: number;
  category: number;
  group: number;
  file_count: number;
  header: boolean;
}

export interface DuplicateFile {
  node_id: number;
  path: string;
  modified: number | null;
  allocated: number;
}

export interface DuplicateGroup {
  id: number;
  hash: string;
  size: number;
  wasted: number;
  files: DuplicateFile[];
}

export interface DuplicateSummary {
  groups_count: number;
  files_in_groups: number;
  wasted_bytes: number;
  candidate_files: number;
  skipped_files: number;
  elapsed_ms: number;
}

export interface DuplicatePage {
  summary: DuplicateSummary | null;
  total: number;
  groups: DuplicateGroup[];
}

export interface DuplicateProgress {
  scan_id: string;
  stage: 'grouping' | 'partial_hash' | 'full_hash' | 'finalizing';
  processed: number;
  total: number;
  current_path: string;
}

export interface TrashFailure {
  id: number;
  path: string;
  error: string;
}

export interface TrashOutcome {
  trashed: number[];
  failed: TrashFailure[];
  bytes_freed: number;
  allocated_freed: number;
}

export interface HistoryRecord {
  id: string;
  root_path: string;
  started_at: number;
  duration_ms: number;
  total_size: number;
  total_allocated: number;
  file_count: number;
  dir_count: number;
  errors_count: number;
}

export type Units = 'windows' | 'decimal' | 'iec';
export type Metric = 'logical' | 'allocated';

export interface Settings {
  threads: number;
  stay_on_filesystem: boolean;
  min_duplicate_size: number;
  units: Units;
  treemap_depth: number;
  treemap_metric: Metric;
}

export interface AppInfo {
  version: string;
  host_name: string;
  os: string;
  arch: string;
}

export type SortKey = 'name' | 'type' | 'size' | 'allocated' | 'files' | 'modified';
export type SortDir = 'asc' | 'desc';

export type ViewId =
  | 'overview'
  | 'tree'
  | 'treemap'
  | 'breakdown'
  | 'largest'
  | 'duplicates'
  | 'history'
  | 'settings'
  | 'search'
  | 'cleanup'
  | 'cloud';

export type ReportFormat = 'csv' | 'json';
