import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';

export function Dialog({
  title,
  onClose,
  children,
  footer,
  width = 520,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/55" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[84vh] flex-col rounded-lg border border-line bg-[#2b2b2b] shadow-2xl shadow-black/60"
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 pb-1 pt-3">
          <h3 className="text-[16px] font-semibold text-ink">{title}</h3>
          <button
            aria-label="Close"
            onClick={onClose}
            className="rounded p-1 text-ink-3 hover:bg-white/10 hover:text-ink"
          >
            <X size={15} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-2 text-base text-ink-2">{children}</div>
        {footer && (
          <footer className="flex justify-end gap-2 rounded-b-lg bg-[#242424] px-4 py-3">{footer}</footer>
        )}
      </div>
    </div>
  );
}
