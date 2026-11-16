import { open, save } from '@tauri-apps/plugin-dialog';
import type { ReportFormat } from '../types';

export async function pickFolder(title = 'Choose a folder to scan'): Promise<string | null> {
  const result = await open({ directory: true, multiple: false, title });
  return typeof result === 'string' ? result : null;
}

export async function pickReportPath(format: ReportFormat, rootName: string): Promise<string | null> {
  const safe = rootName.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'scan';
  const result = await save({
    title: 'Export report',
    defaultPath: `DiskPulse-${safe}.${format}`,
    filters: [{ name: format === 'csv' ? 'CSV' : 'JSON', extensions: [format] }],
  });
  return result ?? null;
}
