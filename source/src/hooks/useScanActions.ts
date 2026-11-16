import { useMemo } from 'react';
import { pickFolder } from '../services/dialogs';
import { useApp } from '../stores/appStore';
import { errorText } from '../utils/format';

export function useScanActions() {
  return useMemo(() => {
    const st = () => useApp.getState();
    const scanPath = (path: string) => st().startScan(path);
    const scanFolder = async () => {
      try {
        const path = await pickFolder();
        if (path) await st().startScan(path);
      } catch (e) {
        st().notify('error', errorText(e));
      }
    };
    const scanSelected = async () => {
      const path = st().selectedPath;
      if (path) await st().startScan(path);
      else await scanFolder();
    };
    const rescan = async () => {
      const root = st().scanRoot;
      if (root) await st().startScan(root);
      else await scanSelected();
    };
    return { scanPath, scanFolder, scanSelected, rescan };
  }, []);
}
