import { describe, expect, it } from 'vitest';
import { placeBot, positionOf, sameDraft, type LineupDraft } from '../src/app/core/udt-lineup';

const d: LineupDraft = {
  dm: ['a', 'b', null, null, null],
  mh: ['b', null, null, null, null],
  bench: ['c', null],
};

describe('Dream Team lineup', () => {
  it('swaps two slots', () => {
    const n = placeBot(d, 'dm', 'a', { kind: 'slot', i: 1 });
    expect(n.dm).toEqual(['b', 'a', null, null, null]);
    expect(n.mh).toEqual(d.mh);
  });

  it('moves into a free slot and out again', () => {
    const n = placeBot(d, 'dm', 'a', { kind: 'slot', i: 4 });
    expect(n.dm).toEqual([null, 'b', null, null, 'a']);
    const o = placeBot(n, 'dm', 'a', { kind: 'out' });
    expect(positionOf(o, 'dm', 'a')).toEqual({ kind: 'out' });
  });

  it('a bot from the roster takes a slot; the one there leaves the lineup', () => {
    const n = placeBot(d, 'dm', 'x', { kind: 'slot', i: 0 });
    expect(n.dm[0]).toBe('x');
    expect(positionOf(n, 'dm', 'a')).toEqual({ kind: 'out' });
  });

  it('slot and bench swap; a bot is never in both', () => {
    const n = placeBot(d, 'dm', 'c', { kind: 'slot', i: 0 });
    expect(n.dm[0]).toBe('c');
    expect(n.bench).toEqual(['a', null]);
    const m = placeBot(d, 'mh', 'b', { kind: 'bench', i: 1 });
    expect(m.mh[0]).toBeNull();
    expect(m.bench).toEqual(['c', 'b']);
    // The other mode keeps its slots.
    expect(m.dm).toEqual(d.dm);
  });

  it('a bench bot that also holds a slot of the mode: the place it was taken from counts', () => {
    // b holds DM #2 and (from Monster Hunt) bench 2.
    const dup: LineupDraft = { dm: ['a', 'b', null, null, null], mh: d.mh, bench: ['c', 'b'] };
    const bench1 = { kind: 'bench', i: 1 } as const;
    const out = placeBot(dup, 'dm', 'b', { kind: 'out' }, bench1);
    expect(out.dm).toEqual(dup.dm);
    expect(out.bench).toEqual(['c', null]);
    const swap = placeBot(dup, 'dm', 'b', { kind: 'slot', i: 0 }, bench1);
    expect(swap.dm).toEqual(['b', null, null, null, null]);
    expect(swap.bench).toEqual(['c', 'a']);
  });

  it('dropping on its own place changes nothing', () => {
    expect(sameDraft(placeBot(d, 'dm', 'a', { kind: 'slot', i: 0 }), d)).toBe(true);
    expect(sameDraft(placeBot(d, 'dm', 'z', { kind: 'out' }), d)).toBe(true);
  });
});
