export interface SelectionResult {
  selection: number[];
  anchor: number;
}

/** Windows-style list selection: click selects, Ctrl/Cmd toggles, Shift selects a range. */
export function nextSelection(
  current: number[],
  orderedIds: number[],
  index: number,
  anchorIndex: number | null,
  mods: { ctrl: boolean; shift: boolean },
): SelectionResult {
  const id = orderedIds[index];
  if (id === undefined) return { selection: current, anchor: anchorIndex ?? 0 };
  if (mods.shift && anchorIndex !== null) {
    const from = Math.min(anchorIndex, index);
    const to = Math.max(anchorIndex, index);
    const range = orderedIds.slice(from, to + 1);
    return {
      selection: mods.ctrl ? Array.from(new Set([...current, ...range])) : range,
      anchor: anchorIndex,
    };
  }
  if (mods.ctrl) {
    return {
      selection: current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
      anchor: index,
    };
  }
  return { selection: [id], anchor: index };
}
