import { useMemo } from 'react';
import { api } from '../services/api';
import { useApp } from '../stores/appStore';
import type { MenuItem } from '../components/common/Menu';
import type { NodeSummary } from '../types';
import { errorText } from '../utils/format';
import { fileManagerName, trashName } from '../utils/platform';

const EXECUTABLE = 4;

type Target = Pick<NodeSummary, 'id' | 'kind' | 'category' | 'name' | 'path'>;

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

/** File actions shared by every list: reveal, open, copy path, move to Trash, show in treemap. */
export function useNodeActions() {
  return useMemo(() => {
    const st = () => useApp.getState();
    const withScan = (fn: (scanId: string) => Promise<void>) => async () => {
      const id = st().scanId;
      if (!id) return st().notify('error', 'Run a scan first.');
      try {
        await fn(id);
      } catch (e) {
        st().notify('error', errorText(e));
      }
    };

    const reveal = (id: number) => withScan((s) => api.reveal(s, id))();
    const open = async (n: Target) => {
      let confirmed = false;
      if (n.kind === 'file' && n.category === EXECUTABLE) {
        const ok = await st().confirm({
          title: 'Run this program?',
          body: `${n.name} is a program. Opening it will run it on this computer.`,
          confirmLabel: 'Run program',
        });
        if (!ok) return;
        confirmed = true;
      }
      await withScan((s) => api.open(s, n.id, confirmed))();
    };
    const copyPath = async (path: string) => {
      const ok = await copyText(path);
      st().notify(
        ok ? 'info' : 'error',
        ok ? 'Path copied to the clipboard.' : 'The path could not be copied.',
      );
    };
    const showInTreemap = (id: number) => {
      st().setFocusId(id);
      st().setView('treemap');
    };
    const trash = (ids: number[]) => st().requestTrash(ids);

    const menuFor = (nodes: Target[]): MenuItem[] => {
      const os = st().appInfo?.os;
      const one = nodes.length === 1 ? nodes[0] : undefined;
      const items: MenuItem[] = [];
      if (one) {
        if (one.kind === 'directory')
          items.push({ label: 'Open in treemap', onSelect: () => showInTreemap(one.id) });
        else items.push({ label: 'Open', onSelect: () => void open(one) });
        items.push({ label: `Show in ${fileManagerName(os)}`, onSelect: () => void reveal(one.id) });
        items.push({ label: 'Copy path', onSelect: () => void copyPath(one.path) });
        items.push({ separator: true });
      }
      items.push({
        label: `Move ${nodes.length > 1 ? `${nodes.length} items` : 'to'} ${nodes.length > 1 ? 'to ' : ''}${trashName(os)}…`,
        danger: true,
        onSelect: () => trash(nodes.map((n) => n.id)),
      });
      return items;
    };

    return { reveal, open, copyPath, showInTreemap, trash, menuFor };
  }, []);
}
