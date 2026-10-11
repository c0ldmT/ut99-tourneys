import { describe, expect, it } from 'vitest';
import { buildStructure, dropInOrder, losersRoundSize, type MatchNode } from '../src/index.js';

const SIZES = [8, 16, 32] as const;

function feeds(nodes: MatchNode[], kind: 'winner' | 'loser', id: string) {
  return nodes.filter((n) => n.sources.some((s) => s.kind === kind && s.matchId === id));
}

describe('structure', () => {
  it.each(SIZES)('single elimination of %i has size-1 matches', (size) => {
    const nodes = buildStructure('single', size, { default: 1 }, true);
    expect(nodes).toHaveLength(size - 1);
    expect(nodes.every((n) => n.side === 'W')).toBe(true);
  });

  it.each(SIZES)('double elimination of %i has 2n-2 matches plus optional reset', (size) => {
    expect(buildStructure('double', size, { default: 1 }, false)).toHaveLength(2 * size - 2);
    expect(buildStructure('double', size, { default: 1 }, true)).toHaveLength(2 * size - 1);
  });

  it.each(SIZES)('every first-round slot is used exactly once (%i)', (size) => {
    const slots = buildStructure('double', size, { default: 1 }, true)
      .flatMap((n) => n.sources)
      .flatMap((s) => (s.kind === 'slot' ? [s.slot] : []))
      .sort((a, b) => a - b);
    expect(slots).toEqual(Array.from({ length: size }, (_, i) => i));
  });

  it.each(SIZES)('double %i: every match routes winner and loser exactly once', (size) => {
    const nodes = buildStructure('double', size, { default: 1 }, false);
    for (const n of nodes) {
      if (n.id === 'GF1') continue;
      expect(feeds(nodes, 'winner', n.id), `winner of ${n.id}`).toHaveLength(1);
      // Winners-bracket losers drop into the losers bracket; losers-bracket losers are out.
      expect(feeds(nodes, 'loser', n.id), `loser of ${n.id}`).toHaveLength(n.side === 'W' ? 1 : 0);
    }
  });

  it('losers round sizes for 32', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((j) => losersRoundSize(32, j))).toEqual([
      8, 8, 4, 4, 2, 2, 1, 1,
    ]);
  });

  it('drop-in order alternates reverse and half swap', () => {
    expect(dropInOrder(2, 4)).toEqual([4, 3, 2, 1]);
    expect(dropInOrder(3, 4)).toEqual([3, 4, 1, 2]);
    expect(dropInOrder(4, 2)).toEqual([2, 1]);
    expect(dropInOrder(5, 1)).toEqual([1]);
  });

  it('depth interleaves winners and losers rounds', () => {
    const nodes = buildStructure('double', 8, { default: 1 }, true);
    const d = Object.fromEntries(nodes.map((n) => [n.id, n.depth]));
    expect(d['W1-1']).toBe(0);
    expect(d['W2-1']).toBe(1);
    expect(d['L1-1']).toBe(1);
    expect(d['L2-1']).toBe(2);
    expect(d['W3-1']).toBe(2);
    expect(d['L4-1']).toBe(4);
    expect(d['GF1']).toBe(5);
    expect(d['GF2']).toBe(6);
  });

  it('applies best-of policy per stage', () => {
    const policy = { default: 1, semifinal: 3, final: 5, lbFinal: 3, grandFinal: 7 };
    const de = Object.fromEntries(
      buildStructure('double', 8, policy, true).map((n) => [n.id, n.bestOf]),
    );
    expect(de).toMatchObject({
      'W1-1': 1,
      'W2-1': 3,
      'W3-1': 5,
      'L3-1': 1,
      'L4-1': 3,
      GF1: 7,
      GF2: 7,
    });
    const se = Object.fromEntries(
      buildStructure('single', 16, policy, true).map((n) => [n.id, n.bestOf]),
    );
    expect(se).toMatchObject({ 'W2-1': 1, 'W3-1': 3, 'W4-1': 5 });
  });
});

describe('critical path', () => {
  it('height counts the matches still following', () => {
    const d = Object.fromEntries(
      buildStructure('double', 8, { default: 1 }, true).map((n) => [n.id, n.height]),
    );
    expect(d).toMatchObject({
      'W1-1': 6,
      'W2-1': 5,
      'L1-1': 5,
      'L2-1': 4,
      'W3-1': 3,
      'L3-1': 3,
      GF2: 0,
    });
  });
});
