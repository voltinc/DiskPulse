import type { Units } from '../types';

const LABELS: Record<Units, string[]> = {
  windows: ['B', 'KB', 'MB', 'GB', 'TB', 'PB'],
  decimal: ['B', 'kB', 'MB', 'GB', 'TB', 'PB'],
  iec: ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'],
};

/** "485 GB" (or "485GB" when `compact`). `windows` is 1024-based with GB labels, like File Explorer. */
export function formatSize(bytes: number, units: Units = 'windows', compact = false): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return compact ? '0B' : '0 B';
  const base = units === 'decimal' ? 1000 : 1024;
  const labels = LABELS[units];
  let value = bytes;
  let i = 0;
  while (value >= base && i < labels.length - 1) {
    value /= base;
    i += 1;
  }
  const digits = i === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  const text = value.toFixed(digits);
  return compact ? `${text}${labels[i]}` : `${text} ${labels[i]}`;
}

const numberFormat = new Intl.NumberFormat('en-US');
export function formatNumber(n: number): string {
  return numberFormat.format(n);
}

export function formatPercent(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return '0%';
  if (p < 0.1) return '<0.1%';
  return p < 10 ? `${p.toFixed(1)}%` : `${Math.round(p)}%`;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 1) return `${Math.max(0, Math.round(ms))} ms`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatDateTime(secs: number | null | undefined): string {
  if (!secs) return '-';
  return new Date(secs * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDate(secs: number | null | undefined): string {
  if (!secs) return '-';
  return new Date(secs * 1000).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function relativeTime(secs: number, nowMs: number = Date.now()): string {
  const diff = Math.max(0, Math.round(nowMs / 1000 - secs));
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  return `${Math.round(diff / 86400)} d ago`;
}

/** Parent folder of a path, for either separator style. */
export function parentPath(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (cut <= 0) return path;
  const parent = path.slice(0, cut);
  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent;
}

export function errorText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
