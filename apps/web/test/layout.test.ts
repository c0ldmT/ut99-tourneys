import { computeBracket, type MatchResult } from '@tourney/bracket';
import { describe, expect, it } from 'vitest';
import {
  BOX_H,
  BOX_W,
  BOX_W_RACE,
  layoutBracket,
  matchScore,
  rowFit,
} from '../src/app/bracket/layout';

const titles = { W: 'W', L: 'L', GF: 'GF', SE: 'SE' };
const slots = (n: number) => Array.from({ length: n }, (_, i) => `e${i + 1}`);

describe('bracket layout', () => {
  it('lays out a league matchday (fixtures) as a grid of pairings', () => {
    const s = computeBracket(
      {
        format: 'fixtures',
        size: 12,
        slots: slots(12),
        grandFinalReset: false,
        bestOf: { default: 1 },
      },
      [],
    );
    const l = layoutBracket(s, { ...titles, FX: 'FX' });
    expect(l.boxes).toHaveLength(6);
    expect(l.connectors).toEqual([]);
    expect(l.sections).toEqual([{ side: 'W', title: 'FX', y: 0 }]);
    expect(new Set(l.boxes.map((b) => b.x)).size).toBe(4);
    expect(new Set(l.boxes.map((b) => b.y)).size).toBe(2);
    expect(l.width).toBeLessThanOrEqual(4 * (BOX_W + 34) + 8);
  });

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

  it('shows run times in a Monster Hunt race', () => {
    const def = {
      format: 'single' as const,
      size: 8 as const,
      slots: slots(8),
      grandFinalReset: false,
      bestOf: { default: 1 },
    };
    const m = computeBracket(def, []).byId['W1-1']!;
    const live = {
      matchId: 'W1-1',
      race: { runner: 'e2', timeMs: 61_000, penaltyMs: 5_000 },
    };
    expect(matchScore(m, [], live, true)).toEqual(['', '▶ 1:06.0']);
    // The first run is over, the second team runs: both times are in the bracket.
    const firstRun = [{ entrantId: 'e1', timeMs: 287_600, penaltyMs: 150_000 }];
    expect(matchScore(m, [], live, true, firstRun)).toEqual(['7:17.6', '▶ 1:06.0']);
    // Between the runs (no live run yet): the finished run stays.
    expect(matchScore(m, [], null, true, firstRun)).toEqual(['7:17.6', '']);
    const done = computeBracket(def, [
      {
        matchId: 'W1-1',
        entrants: ['e1', 'e2'],
        winnerId: 'e1',
        outcome: 'played',
        games: [{ winnerId: 'e1', scores: { e1: 310_000, e2: 315_400 } }],
      },
    ]).byId['W1-1']!;
    expect(matchScore(done, [], null, true)).toEqual(['5:10.0', '5:15.4']);
    // Bo3: games won, then the times of the game in progress.
    const bo3 = computeBracket({ ...def, bestOf: { default: 3 } }, []).byId['W1-1']!;
    const played = [{ winnerId: 'e1', scores: { e1: 310_000, e2: 315_400 } }];
    const run2 = [{ entrantId: 'e2', timeMs: 200_000, penaltyMs: 10_000 }];
    const live1 = { matchId: 'W1-1', race: { runner: 'e1', timeMs: 30_000, penaltyMs: 0 } };
    expect(matchScore(bo3, played, live1, true, run2)).toEqual(['1 ▶ 0:30.0', '0 3:30.0']);
    // Runs of a finished match are ignored (the result decides).
    expect(matchScore(done, [], live, true, firstRun)).toEqual(['5:10.0', '5:15.4']);
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

describe('bracket row', () => {
  it('keeps the BOT tag and the name clear of long scores', () => {
    // Short scores: the usual place and up to 16 characters.
    expect(rowFit('20', true)).toEqual({ botX: BOX_W - 64, nameChars: 16 });
    // A Monster Hunt series score moves the tag left and shortens the name.
    const fit = rowFit('1 ▶ 12:17.3', true);
    expect(fit.botX).toBeLessThan(BOX_W - 64);
    expect(10 + fit.nameChars * 6.8).toBeLessThanOrEqual(fit.botX);
    // Monster Hunt boxes are wider: a run time leaves room for a full name and the tag.
    expect(rowFit('▶ 17:17.3', true, BOX_W_RACE).nameChars).toBe(16);
    const wide = layoutBracket(computeBracket(def8(), []), titles, BOX_W_RACE);
    expect(wide.width).toBeGreaterThan(layoutBracket(computeBracket(def8(), []), titles).width);
  });
});

const def8 = () => ({
  format: 'single' as const,
  size: 8 as const,
  slots: slots(8),
  grandFinalReset: false,
  bestOf: { default: 1 },
});
