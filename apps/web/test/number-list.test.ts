import { describe, expect, it } from 'vitest';
import { formatList, parseList } from '../src/app/core/number-list';

describe('number lists of the league settings', () => {
  it('reads what it writes, in German with decimal commas', () => {
    expect(formatList([1.4, 1, 0.7], true)).toBe('1,4 · 1 · 0,7');
    expect(parseList('1,4 · 1 · 0,7', true)).toEqual([1.4, 1, 0.7]);
    expect(parseList('1200 · 700 · 400 · 200', false)).toEqual([1200, 700, 400, 200]);
  });

  it('takes other separators and thousands, refuses what is no number', () => {
    expect(parseList('1.200 · 700', true)).toEqual([1200, 700]);
    expect(parseList('1,200; 700', false)).toEqual([1200, 700]);
    expect(parseList('1200 700 ·', false)).toEqual([1200, 700]);
    expect(parseList('2 1', false)).toEqual([2, 1]);
    expect(parseList('1200 · x · 400', false)).toBeNull();
    expect(parseList('', false)).toEqual([]);
  });
});
