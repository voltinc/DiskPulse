import { Check } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';

export interface MenuItem {
  label?: string;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  shortcut?: string;
  icon?: ReactNode;
  checked?: boolean;
}

export function MenuList({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  return (
    <div
      role="menu"
      className="min-w-[210px] rounded-md border border-line bg-[#2d2d2d] py-1 shadow-xl shadow-black/50"
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="my-1 h-px bg-line" />
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect?.();
            }}
            className={`flex w-full items-center gap-2 px-3 py-[5px] text-left text-base hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent ${
              item.danger ? 'text-[#ff7b72]' : 'text-ink'
            }`}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center text-ink-2">
              {item.checked ? <Check size={13} /> : item.icon}
            </span>
            <span className="flex-1 truncate">{item.label}</span>
            {item.shortcut && <span className="pl-6 text-xs text-ink-3">{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  );
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth - r.width - 6),
      y: Math.min(y, window.innerHeight - r.height - 6),
    });
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', key);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', key);
      window.removeEventListener('wheel', close);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <MenuList items={items} onClose={onClose} />
    </div>
  );
}

export function useContextMenu() {
  const [state, setState] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const close = useCallback(() => setState(null), []);
  const show = useCallback((e: MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    setState({ x: e.clientX, y: e.clientY, items });
  }, []);
  const showAt = useCallback((x: number, y: number, items: MenuItem[]) => setState({ x, y, items }), []);
  const element = state ? <ContextMenu x={state.x} y={state.y} items={state.items} onClose={close} /> : null;
  return { show, showAt, element };
}
