import { describe, expect, it } from 'vitest';
import { errorText, formatDuration, formatPercent, formatSize, parentPath, relativeTime } from './format';

describe('formatSize', () => {
  it('uses 1024-based steps with GB labels by default, like File Explorer', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(1023)).toBe('1023 B');
    expect(formatSize(1024)).toBe('1.00 KB');
    expect(formatSize(485 * 1024 ** 3)).toBe('485 GB');
    expect(formatSize(485 * 1024 ** 3, 'windows', true)).toBe('485GB');
  });
  it('supports decimal and IEC units', () => {
    expect(formatSize(1_500_000, 'decimal')).toBe('1.50 MB');
    expect(formatSize(1024 ** 3, 'iec')).toBe('1.00 GiB');
  });
  it('is safe for bad input', () => {
    expect(formatSize(Number.NaN)).toBe('0 B');
    expect(formatSize(-5)).toBe('0 B');
  });
});

describe('formatPercent', () => {
  it('keeps one decimal below 10%', () => {
    expect(formatPercent(8.56)).toBe('8.6%');
    expect(formatPercent(45.2)).toBe('45%');
    expect(formatPercent(0.04)).toBe('<0.1%');
    expect(formatPercent(0)).toBe('0%');
  });
});

describe('formatDuration and relativeTime', () => {
  it('formats elapsed times', () => {
    expect(formatDuration(450)).toBe('450 ms');
    expect(formatDuration(72_000)).toBe('1m 12s');
    expect(formatDuration(3_900_000)).toBe('1h 5m');
  });
  it('formats relative times', () => {
    const now = 1_000_000_000_000;
    expect(relativeTime(now / 1000 - 10, now)).toBe('just now');
    expect(relativeTime(now / 1000 - 120, now)).toBe('2 min ago');
    expect(relativeTime(now / 1000 - 7200, now)).toBe('2 h ago');
  });
});

describe('parentPath and errorText', () => {
  it('handles both separators', () => {
    expect(parentPath('/home/user/file.txt')).toBe('/home/user');
    expect(parentPath('C:\\Users\\me\\a.txt')).toBe('C:\\Users\\me');
    expect(parentPath('C:\\a.txt')).toBe('C:\\');
  });
  it('turns unknown errors into sentences', () => {
    expect(errorText('boom')).toBe('boom');
    expect(errorText(new Error('bad'))).toBe('bad');
    expect(errorText(42)).toBe('Something went wrong.');
  });
});
