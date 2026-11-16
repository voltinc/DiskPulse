import type { ReactNode } from 'react';
import { Panel } from '../components/common/Panel';
import { useApp } from '../stores/appStore';
import type { Metric, Units } from '../types';
import { formatSize } from '../utils/format';

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-line py-3 last:border-0">
      <div className="min-w-0">
        <div className="text-[14px] text-ink">{label}</div>
        {hint && <div className="mt-0.5 max-w-[560px] text-[12.5px] text-ink-3">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const selectClass = 'h-7 rounded border border-line bg-field px-2 text-base text-ink';

export function SettingsPage() {
  const s = useApp((st) => st.settings);
  const info = useApp((st) => st.appInfo);
  const update = useApp((st) => st.updateSettings);
  return (
    <Panel title="Settings" subtitle="Changes are saved automatically" className="h-full">
      <div className="min-h-0 flex-1 overflow-y-auto pr-2">
        <Field
          label="Scan threads"
          hint="How many folders are read at once. Automatic uses twice the number of CPU cores. Lower it on slow spinning disks or network shares."
        >
          <select
            className={selectClass}
            value={s.threads}
            onChange={(e) => void update({ threads: Number(e.target.value) })}
          >
            <option value={0}>Automatic</option>
            {[1, 2, 4, 8, 16, 32].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Stay on one file system"
          hint="Do not enter folders that belong to another disk or mount (for example network shares inside your home folder). Symbolic links are never followed."
        >
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={s.stay_on_filesystem}
            onChange={(e) => void update({ stay_on_filesystem: e.target.checked })}
            aria-label="Stay on one file system"
          />
        </Field>
        <Field
          label="Smallest file to check for duplicates"
          hint="Files below this size are skipped, which keeps duplicate searches fast."
        >
          <select
            className={selectClass}
            value={s.min_duplicate_size}
            onChange={(e) => void update({ min_duplicate_size: Number(e.target.value) })}
          >
            {[1, 4096, 65536, 1048576, 10485760, 104857600].map((n) => (
              <option key={n} value={n}>
                {n === 1 ? 'Any size' : formatSize(n, s.units)}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Size units"
          hint="Windows style shows 1024-based values with GB labels, like File Explorer."
        >
          <select
            className={selectClass}
            value={s.units}
            onChange={(e) => void update({ units: e.target.value as Units })}
          >
            <option value="windows">1024-based, GB (Windows style)</option>
            <option value="decimal">1000-based, GB (decimal)</option>
            <option value="iec">1024-based, GiB (binary)</option>
          </select>
        </Field>
        <Field
          label="Treemap measures"
          hint="Logical size is what files report. Size on disk is the space reserved for them, which differs for small, sparse, compressed or cloud-only files."
        >
          <select
            className={selectClass}
            value={s.treemap_metric}
            onChange={(e) => void update({ treemap_metric: e.target.value as Metric })}
          >
            <option value="logical">Logical size</option>
            <option value="allocated">Size on disk</option>
          </select>
        </Field>
        <Field label="Treemap nesting levels" hint="How many folder levels the Treemap page draws at once.">
          <select
            className={selectClass}
            value={s.treemap_depth}
            onChange={(e) => void update({ treemap_depth: Number(e.target.value) })}
          >
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Field label="About">
          <span className="text-sm text-ink-2">
            DiskPulse Pro {info?.version ?? __APP_VERSION__}
            {info ? ` - ${info.os} ${info.arch}` : ''}
          </span>
        </Field>
      </div>
    </Panel>
  );
}
