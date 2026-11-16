import { describe, expect, it } from 'vitest';
import { nextSelection } from './selection';

const ids = [10, 11, 12, 13, 14];

describe('nextSelection', () => {
  it('selects a single row on a plain click', () => {
    expect(nextSelection([11], ids, 3, 1, { ctrl: false, shift: false })).toEqual({
      selection: [13],
      anchor: 3,
    });
  });
  it('toggles with ctrl', () => {
    expect(nextSelection([11], ids, 3, 1, { ctrl: true, shift: false }).selection).toEqual([11, 13]);
    expect(nextSelection([11, 13], ids, 3, 3, { ctrl: true, shift: false }).selection).toEqual([11]);
  });
  it('selects ranges in either direction with shift', () => {
    expect(nextSelection([11], ids, 3, 1, { ctrl: false, shift: true }).selection).toEqual([11, 12, 13]);
    expect(nextSelection([13], ids, 0, 3, { ctrl: false, shift: true }).selection).toEqual([10, 11, 12, 13]);
  });
  it('ignores out-of-range clicks', () => {
    expect(nextSelection([11], ids, 99, 1, { ctrl: false, shift: false }).selection).toEqual([11]);
  });
});
