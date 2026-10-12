import { computeBracket, type MatchResult } from '@tourney/bracket';
import { describe, expect, it } from 'vitest';
import { BOX_H, BOX_W, layoutBracket, matchScore } from '../src/app/bracket/layout';

const titles = { W: 'W', L: 'L', GF: 'GF', SE: 'SE' };
const slots = (n: number) => Array.from({ length: n }, (_, i) => `e${i + 1}`);

describe('bracket layout', () => {
  it('lays out single elimination in rounds without overlaps', () => {
    const s = computeBracket(
      {
        format: 'single',
        size: 8,
        slots: slots(8),
        grandFinalReset: false,
        bestOf: { default: 1 },
      },
      [],
    );
    const l = layoutBracket(s, titles);
    expect(l.boxes).toHaveLength(7);
    expect(new Set(l.boxes.map((b) => b.x)).size).toBe(3);
    // The final sits between the two semifinals.
    const final = l.boxes.find((b) => b.match.round === 3)!;
    const semis = l.boxes.filter((b) => b.match.round === 2);
    expect(final.y).toBeCloseTo((semis[0]!.y + semis[1]!.y) / 2);
    expect(l.connectors).toHaveLength(6);
    assertNoOverlap(l.boxes);
  });

  it('puts the losers bracket below and the grand final to the right', () => {
    for (const size of [4, 8, 16, 32] as const) {
      const s = computeBracket(
        {
          format: 'double',
          size,
          slots: slots(size),
          grandFinalReset: true,
          bestOf: { default: 1 },
        },
        [],
      );
      const l = layoutBracket(s, titles);
      const w = l.boxes.filter((b) => b.match.side === 'W');
      const lb = l.boxes.filter((b) => b.match.side === 'L');
      const gf = l.boxes.filter((b) => b.match.side === 'GF');
      expect(Math.min(...lb.map((b) => b.y))).toBeGreaterThan(Math.max(...w.map((b) => b.y)));
      expect(Math.min(...gf.map((b) => b.x))).toBeGreaterThan(
        Math.max(...[...w, ...lb].map((b) => b.x)),
      );
      expect(l.sections.map((x) => x.side)).toEqual(['W', 'L', 'GF']);
      assertNoOverlap(l.boxes);
    }
  });

  it('shows frags for one game, games won for a series, live scores while playing', () => {
    const s = computeBracket(
      {
        format: 'single',
        size: 8,
        slots: slots(8),
        grandFinalReset: false,
        bestOf: { default: 3 },
      },
      [],
    );
    const m = s.byId['W1-1']!;
    expect(matchScore(m, [], null)).toEqual(['', '']);
    const games = [{ winnerId: 'e1', scores: { e1: 20, e2: 5 } }];
    expect(matchScore(m, games, { matchId: 'W1-1', scores: { e1: 3, e2: 7 } })).toEqual([
      '1 (3)',
      '0 (7)',
    ]);
    const result: MatchResult = {
      matchId: 'W1-1',
      entrants: ['e1', 'e2'],
      winnerId: 'e1',
      outcome: 'played',
      games: [...games, { winnerId: 'e1', scores: { e1: 20, e2: 19 } }],
    };
    const done = computeBracket(s.definition, [result]).byId['W1-1']!;
    expect(matchScore(done, [], null)).toEqual(['2', '0']);
    const bo1 = computeBracket({ ...s.definition, bestOf: { default: 1 } }, [
      { ...result, games: [games[0]!] },
    ]);
    expect(matchScore(bo1.byId['W1-1']!, [], null)).toEqual(['20', '5']);
  });
});

function assertNoOverlap(boxes: { x: number; y: number; match: { id: string } }[]) {
  for (const a of boxes)
    for (const b of boxes) {
      if (a === b) continue;
      const overlap =
        a.x < b.x + BOX_W && b.x < a.x + BOX_W && a.y < b.y + BOX_H && b.y < a.y + BOX_H;
      expect(overlap, `${a.match.id} overlaps ${b.match.id}`).toBe(false);
    }
}
