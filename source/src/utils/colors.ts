// Palette sampled from the reference treemap and donut chart.
export const CATEGORY_NAMES = [
  'Videos',
  'Images',
  'Documents',
  'Archives',
  'Executables',
  'Audio',
  'Source code',
  'System files',
  'Other',
] as const;

export const CATEGORY_COLORS = [
  '#1f7ad8', // Videos - blue
  '#9b3fc6', // Images - purple
  '#27a85d', // Documents - green
  '#e3c52a', // Archives - yellow
  '#e0483e', // Executables - red
  '#ee8a22', // Audio - orange
  '#1fb5b0', // Source code - teal
  '#a08a6a', // System files - tan
  '#7b8794', // Other - grey
] as const;

/** Folder colours in treemap order: blue, green, purple, yellow, orange, red, teal, pink. */
export const FOLDER_PALETTE = [
  '#1f7ad8',
  '#27a85d',
  '#9b3fc6',
  '#e3c52a',
  '#ee8a22',
  '#e0483e',
  '#1fb5b0',
  '#d9488f',
] as const;

export function categoryColor(index: number): string {
  return CATEGORY_COLORS[index] ?? CATEGORY_COLORS[CATEGORY_COLORS.length - 1]!;
}

function mix(hex: string, target: number, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const c = (n >> shift) & 255;
    return Math.round(c + (target - c) * amount);
  };
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

const cache = new Map<string, string>();

/** Colour for a treemap rectangle. Nested rectangles alternate lighter/darker so depth stays readable. */
export function rectColor(
  mode: 'folder' | 'type',
  group: number,
  category: number,
  depth: number,
  header: boolean,
): string {
  const key = `${mode}|${group}|${category}|${depth}|${header}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const base = mode === 'folder' ? FOLDER_PALETTE[group % FOLDER_PALETTE.length]! : categoryColor(category);
  let color = base;
  if (header) color = mix(base, 0, 0.35);
  else if (depth === 2) color = mix(base, 255, 0.1);
  else if (depth >= 3) color = mix(base, 0, 0.12);
  cache.set(key, color);
  return color;
}

/** True for fills that need dark text (the yellow blocks), measured by relative luminance. */
export function isLightColor(color: string): boolean {
  let r = 0;
  let g = 0;
  let b = 0;
  if (color.startsWith('#')) {
    const n = parseInt(color.slice(1), 16);
    r = (n >> 16) & 255;
    g = (n >> 8) & 255;
    b = n & 255;
  } else {
    const m = color.match(/\d+/g);
    if (m && m.length >= 3) [r, g, b] = m.map(Number) as [number, number, number];
  }
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.62;
}
