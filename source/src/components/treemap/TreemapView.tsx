import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { api } from '../../services/api';
import { useApp } from '../../stores/appStore';
import type { Metric, TreemapRect } from '../../types';
import { CATEGORY_NAMES, isLightColor, rectColor } from '../../utils/colors';
import { errorText, formatNumber, formatPercent, formatSize } from '../../utils/format';

export type ColorMode = 'folder' | 'type';

interface Props {
  nodeId: number;
  depth: number;
  metric: Metric;
  colorMode: ColorMode;
  selectedIds: number[];
  onOpen: (rect: TreemapRect) => void;
  onSelect: (rect: TreemapRect) => void;
  onContextMenu: (event: MouseEvent, rect: TreemapRect) => void;
}

const FONT = '"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,sans-serif';

function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${text.slice(0, lo)}…` : '';
}

function drawBase(
  canvas: HTMLCanvasElement,
  rects: TreemapRect[],
  mode: ColorMode,
  w: number,
  h: number,
  metric: Metric,
  units: Parameters<typeof formatSize>[1],
) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  for (const r of rects) {
    const fill = rectColor(mode, r.group, r.category, r.depth, r.header);
    ctx.fillStyle = fill;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = '#191919';
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    const ink = isLightColor(fill) ? '#1d1d1d' : '#ffffff';
    const bytes = metric === 'allocated' ? r.allocated : r.size;
    if (r.header) {
      ctx.fillStyle = '#ffffff';
      ctx.font = `600 12px ${FONT}`;
      ctx.textAlign = 'left';
      const label = fit(ctx, `${r.name}  ${formatSize(bytes, units, true)}`, r.w - 12);
      if (label) ctx.fillText(label, r.x + 6, r.y + 9.5);
    } else if (r.w >= 60 && r.h >= 32) {
      const big = r.w > 190 && r.h > 90;
      const lines = [r.name, formatSize(bytes, units, true), formatPercent(r.percent)];
      const sizes = big ? [17, 15, 13] : [13, 12, 11];
      const count = r.h >= (big ? 84 : 66) ? 3 : r.h >= 48 ? 2 : 1;
      const lineH = big ? 22 : 16;
      const top = r.y + r.h / 2 - ((count - 1) * lineH) / 2;
      ctx.fillStyle = ink;
      ctx.textAlign = 'center';
      for (let i = 0; i < count; i++) {
        ctx.font = `${i === 0 ? '500' : '400'} ${sizes[i]}px ${FONT}`;
        const t = fit(ctx, lines[i] ?? '', r.w - 12);
        if (t) ctx.fillText(t, r.x + r.w / 2, top + i * lineH);
      }
    }
  }
}

export function TreemapView({
  nodeId,
  depth,
  metric,
  colorMode,
  selectedIds,
  onOpen,
  onSelect,
  onContextMenu,
}: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const scanId = useApp((s) => s.scanId);
  const dataVersion = useApp((s) => s.dataVersion);
  const units = useApp((s) => s.settings.units);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [rects, setRects] = useState<TreemapRect[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<{ rect: TreemapRect; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setSize({ w: Math.floor(box.width), h: Math.floor(box.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Layout is computed in Rust; ask again when the area, folder or data changes.
  useEffect(() => {
    if (!scanId || size.w < 20 || size.h < 20) return;
    let live = true;
    const timer = setTimeout(() => {
      api
        .treemap(scanId, nodeId, size.w, size.h, depth, metric)
        .then((r) => {
          if (!live) return;
          setRects(r);
          setError(null);
        })
        .catch((e) => live && setError(errorText(e)));
    }, 60);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [scanId, nodeId, size, depth, metric, dataVersion]);

  // Base layer: only redrawn when the layout or colours change, never for hover or selection.
  useEffect(() => {
    if (base.current && size.w > 0) drawBase(base.current, rects, colorMode, size.w, size.h, metric, units);
  }, [rects, colorMode, size, metric, units]);

  // Overlay layer: hover and selection.
  useEffect(() => {
    const canvas = overlay.current;
    if (!canvas || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const selected = new Set(selectedIds);
    for (const r of rects) {
      if (selected.has(r.id)) {
        ctx.strokeStyle = '#60cdff';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3);
      }
    }
    if (hover) {
      const r = hover.rect;
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x + 0.75, r.y + 0.75, r.w - 1.5, r.h - 1.5);
    }
  }, [hover, selectedIds, rects, size]);

  const hit = (e: MouseEvent): { rect: TreemapRect; x: number; y: number } | null => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    for (let i = rects.length - 1; i >= 0; i--) {
      const r = rects[i]!;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return { rect: r, x, y };
    }
    return null;
  };

  const tip = hover?.rect;
  const tipLeft = hover ? Math.min(hover.x + 14, Math.max(0, size.w - 230)) : 0;
  const tipTop = hover ? Math.min(hover.y + 14, Math.max(0, size.h - 110)) : 0;

  return (
    <div ref={wrap} className="relative h-full min-h-[120px] w-full overflow-hidden rounded-sm bg-field">
      <canvas ref={base} className="absolute inset-0" style={{ width: size.w, height: size.h }} />
      <canvas
        ref={overlay}
        className="absolute inset-0 cursor-pointer"
        style={{ width: size.w, height: size.h }}
        onMouseMove={(e) => setHover(hit(e))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const h = hit(e);
          if (!h) return;
          if (h.rect.kind === 'directory') onOpen(h.rect);
          else onSelect(h.rect);
        }}
        onDoubleClick={(e) => {
          const h = hit(e);
          if (h && h.rect.kind === 'file') onOpen(h.rect);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          const h = hit(e);
          if (h) onContextMenu(e, h.rect);
        }}
      />
      {tip && (
        <div
          className="pointer-events-none absolute z-10 w-[218px] rounded border border-line bg-[#2d2d2d]/95 px-2.5 py-1.5 text-xs shadow-xl shadow-black/50"
          style={{ left: tipLeft, top: tipTop }}
        >
          <div className="truncate text-[13px] text-ink">{tip.name}</div>
          <div className="text-ink-2">
            {tip.kind === 'directory'
              ? `Folder - ${formatNumber(tip.file_count)} files`
              : (CATEGORY_NAMES[tip.category] ?? 'File')}
          </div>
          <div className="text-ink-2">
            {formatSize(tip.size, units)} logical, {formatSize(tip.allocated, units)} on disk
          </div>
          <div className="text-ink-3">
            {formatPercent(tip.percent)} of this view{tip.kind === 'directory' ? ' - click to open' : ''}
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-[#ff9a92]">
          {error}
        </div>
      )}
      {!error && size.w > 0 && rects.length === 0 && scanId && (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-ink-3">
          Nothing to draw here: this folder is empty or only contains empty files.
        </div>
      )}
    </div>
  );
}
