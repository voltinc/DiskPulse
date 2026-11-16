import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useApp } from '../../stores/appStore';
import type { NodeSummary, TrashOutcome } from '../../types';
import { errorText, formatNumber, formatSize } from '../../utils/format';
import { trashName } from '../../utils/platform';
import { Button } from './Button';
import { Dialog } from './Dialog';

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div
      className="pointer-events-none fixed bottom-9 right-4 z-50 flex w-[360px] flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-start gap-2 rounded-md border border-line bg-[#2f2f2f] px-3 py-2 text-sm text-ink shadow-xl shadow-black/50"
        >
          {t.kind === 'error' ? (
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" />
          ) : t.kind === 'success' ? (
            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-good" />
          ) : (
            <Info size={16} className="mt-0.5 shrink-0 text-accent" />
          )}
          <span className="min-w-0 flex-1 break-words">{t.text}</span>
          <button aria-label="Dismiss" onClick={() => dismiss(t.id)} className="text-ink-3 hover:text-ink">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function ConfirmHost() {
  const req = useApp((s) => s.confirmRequest);
  const resolve = useApp((s) => s.resolveConfirm);
  if (!req) return null;
  return (
    <Dialog
      title={req.title}
      onClose={() => resolve(false)}
      width={440}
      footer={
        <>
          <Button onClick={() => resolve(false)}>Cancel</Button>
          <Button variant={req.danger ? 'danger' : 'primary'} onClick={() => resolve(true)}>
            {req.confirmLabel}
          </Button>
        </>
      }
    >
      <p>{req.body}</p>
    </Dialog>
  );
}

/** Confirmation for every delete: count, size to reclaim, the affected paths, and partial-failure reporting. */
export function TrashDialog() {
  const ids = useApp((s) => s.trashRequest);
  const scanId = useApp((s) => s.scanId);
  const os = useApp((s) => s.appInfo?.os);
  const units = useApp((s) => s.settings.units);
  const close = useApp((s) => s.closeTrash);
  const [nodes, setNodes] = useState<NodeSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<TrashOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNodes(null);
    setOutcome(null);
    setError(null);
    if (!ids || !scanId) return;
    let live = true;
    api
      .nodes(scanId, ids)
      .then((n) => live && setNodes(n))
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [ids, scanId]);

  if (!ids || !scanId) return null;
  const bin = trashName(os);
  // A selected folder already covers the items inside it.
  const idSet = new Set(ids);
  const top = (nodes ?? []).filter((n) => n.parent_id === null || !idSet.has(n.parent_id));
  const files = top.reduce((a, n) => a + (n.kind === 'file' ? 1 : n.file_count), 0);
  const logical = top.reduce((a, n) => a + n.size, 0);
  const allocated = top.reduce((a, n) => a + n.allocated, 0);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.trash(scanId, ids);
      setOutcome(result);
      if (result.trashed.length > 0) {
        useApp
          .getState()
          .notify(
            'success',
            `Moved ${formatNumber(result.trashed.length)} item(s) to the ${bin}. ${formatSize(result.bytes_freed, units)} will be reclaimed once the ${bin} is emptied.`,
          );
        await useApp.getState().afterMutation();
      }
      if (result.failed.length === 0) close();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const failed = outcome?.failed ?? [];
  return (
    <Dialog
      title={outcome ? 'Some items were not moved' : `Move to ${bin}?`}
      onClose={busy ? () => undefined : close}
      width={560}
      footer={
        outcome ? (
          <Button variant="primary" onClick={close}>
            Close
          </Button>
        ) : (
          <>
            <Button onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void run()} disabled={busy || !nodes || top.length === 0}>
              {busy ? 'Moving…' : `Move to ${bin}`}
            </Button>
          </>
        )
      }
    >
      {error && <p className="mb-2 rounded bg-danger/15 px-2 py-1.5 text-[#ff9a92]">{error}</p>}
      {!outcome && (
        <>
          {!nodes && !error && <p>Checking the selection…</p>}
          {nodes && (
            <>
              <p className="text-ink">
                {formatNumber(top.length)} item{top.length === 1 ? '' : 's'} ({formatNumber(files)} file
                {files === 1 ? '' : 's'}) selected.
                <br />
                <span className="text-ink-2">
                  Frees {formatSize(logical, units)} of file data ({formatSize(allocated, units)} of disk
                  space).
                </span>
              </p>
              <ul className="mt-3 max-h-48 overflow-auto rounded border border-line bg-field p-2 text-xs">
                {top.slice(0, 12).map((n) => (
                  <li key={n.id} className="truncate py-0.5" title={n.path}>
                    {n.path} <span className="text-ink-3">- {formatSize(n.size, units)}</span>
                  </li>
                ))}
                {top.length > 12 && (
                  <li className="py-0.5 text-ink-3">…and {formatNumber(top.length - 12)} more</li>
                )}
              </ul>
              <p className="mt-3 text-sm text-ink-3">
                Items are moved to the {bin}, not erased. You can restore them from there. Space is reclaimed
                when the {bin} is emptied.
              </p>
            </>
          )}
        </>
      )}
      {failed.length > 0 && (
        <>
          <p className="mb-2 text-ink">
            {formatNumber(outcome?.trashed.length ?? 0)} moved, {formatNumber(failed.length)} failed:
          </p>
          <ul className="max-h-56 overflow-auto rounded border border-line bg-field p-2 text-xs">
            {failed.map((f) => (
              <li key={f.id} className="py-1">
                <div className="truncate text-ink" title={f.path}>
                  {f.path}
                </div>
                <div className="text-[#ff9a92]">{f.error}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}

export function AboutDialog() {
  const open = useApp((s) => s.aboutOpen);
  const set = useApp((s) => s.setAboutOpen);
  const info = useApp((s) => s.appInfo);
  if (!open) return null;
  const rows: Array<[string, string]> = [
    ['Scan folder', 'Ctrl+O'],
    ['Search', 'Ctrl+F'],
    ['Rescan', 'F5'],
    ['Tree: expand / collapse', 'Right / Left arrow'],
    ['Tree: move to Trash', 'Delete'],
  ];
  return (
    <Dialog
      title="About DiskPulse Pro"
      onClose={() => set(false)}
      footer={
        <Button variant="primary" onClick={() => set(false)}>
          Close
        </Button>
      }
    >
      <p className="text-ink">DiskPulse Pro {info?.version ?? __APP_VERSION__}</p>
      <p className="mt-1">
        Disk space analyzer and storage cleanup utility. Scans run natively in Rust; deletions always go to
        the {trashName(info?.os)}.
      </p>
      <p className="mt-1 text-ink-3">{info ? `${info.os} / ${info.arch}` : ''}</p>
      <table className="mt-3 w-full text-sm">
        <tbody>
          {rows.map(([a, b]) => (
            <tr key={a} className="border-t border-line">
              <td className="py-1 text-ink-2">{a}</td>
              <td className="py-1 text-right text-ink">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}

export function IssuesDialog() {
  const open = useApp((s) => s.issuesOpen);
  const set = useApp((s) => s.setIssuesOpen);
  const summary = useApp((s) => s.summary);
  if (!open || !summary) return null;
  return (
    <Dialog
      title="Items that could not be read"
      onClose={() => set(false)}
      width={640}
      footer={
        <Button variant="primary" onClick={() => set(false)}>
          Close
        </Button>
      }
    >
      {summary.issues.length === 0 ? (
        <p>No problems were reported.</p>
      ) : (
        <>
          <p className="mb-2">
            Showing {summary.issues.length} of {formatNumber(summary.errors_count)}. These folders were
            skipped, usually because of missing permissions. Their size is not included in the totals.
          </p>
          <ul className="rounded border border-line bg-field p-2 text-xs">
            {summary.issues.map((i, n) => (
              <li key={n} className="py-1">
                <div className="truncate text-ink" title={i.path}>
                  {i.path}
                </div>
                <div className="text-ink-3">{i.message}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}
