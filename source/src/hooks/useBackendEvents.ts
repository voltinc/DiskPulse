import { useEffect } from 'react';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { onEvent } from '../services/events';
import { useApp } from '../stores/appStore';

/** Subscribe to every backend event once; all listeners are removed on unmount. */
export function useBackendEvents(): void {
  useEffect(() => {
    let disposed = false;
    const unlisten: UnlistenFn[] = [];
    const s = () => useApp.getState();
    const subs = [
      onEvent<Parameters<ReturnType<typeof s>['onScanStarted']>[0]>('scan-started', (p) =>
        s().onScanStarted(p),
      ),
      onEvent<Parameters<ReturnType<typeof s>['onScanProgress']>[0]>('scan-progress', (p) =>
        s().onScanProgress(p),
      ),
      onEvent<Parameters<ReturnType<typeof s>['onScanCompleted']>[0]>('scan-completed', (p) =>
        s().onScanCompleted(p),
      ),
      onEvent<Parameters<ReturnType<typeof s>['onScanCancelled']>[0]>('scan-cancelled', (p) =>
        s().onScanCancelled(p),
      ),
      onEvent<Parameters<ReturnType<typeof s>['onScanError']>[0]>('scan-error', (p) => s().onScanError(p)),
      onEvent<Parameters<ReturnType<typeof s>['onDupProgress']>[0]>('duplicates-progress', (p) =>
        s().onDupProgress(p),
      ),
      onEvent<Parameters<ReturnType<typeof s>['onDupCompleted']>[0]>('duplicates-completed', (p) =>
        s().onDupCompleted(p),
      ),
      onEvent<Parameters<ReturnType<typeof s>['onDupCancelled']>[0]>('duplicates-cancelled', (p) =>
        s().onDupCancelled(p),
      ),
      onEvent<Parameters<ReturnType<typeof s>['onDupError']>[0]>('duplicates-error', (p) =>
        s().onDupError(p),
      ),
    ];
    for (const sub of subs) {
      void sub.then((fn) => {
        if (disposed) fn();
        else unlisten.push(fn);
      });
    }
    return () => {
      disposed = true;
      unlisten.forEach((fn) => fn());
    };
  }, []);
}
