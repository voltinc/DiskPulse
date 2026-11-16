import { useCallback, type MouseEvent } from 'react';
import { useContextMenu } from '../components/common/Menu';
import { api } from '../services/api';
import { useApp } from '../stores/appStore';
import type { TreemapRect } from '../types';
import { errorText } from '../utils/format';
import { useNodeActions } from './useNodeActions';

/** Shared click, selection and context-menu behaviour for every treemap on screen. */
export function useTreemapMenu() {
  const actions = useNodeActions();
  const menu = useContextMenu();
  const setSelection = useApp((s) => s.setSelection);

  const onContextMenu = useCallback(
    (e: MouseEvent, rect: TreemapRect) => {
      const { clientX, clientY } = e;
      const scanId = useApp.getState().scanId;
      if (!scanId) return;
      setSelection([rect.id]);
      api
        .nodes(scanId, [rect.id])
        .then((nodes) => {
          if (nodes.length > 0) menu.showAt(clientX, clientY, actions.menuFor(nodes));
        })
        .catch((err) => useApp.getState().notify('error', errorText(err)));
    },
    [actions, menu, setSelection],
  );

  const onSelect = useCallback((rect: TreemapRect) => setSelection([rect.id]), [setSelection]);
  return { actions, menuElement: menu.element, onContextMenu, onSelect };
}
