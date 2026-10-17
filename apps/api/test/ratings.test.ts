import { describe, expect, it } from 'vitest';
import type { StatMode, TournamentFacts } from '../src/stats/facts.js';
import {
  computeRatings,
  marginOf,
  RATING_START,
  strengthOf,
  type RatingOptions,
} from '../src/stats/ratings.js';

type P = { key: string; skill?: number };
type G = {
  a: P[];
  b: P[];
  winner: 'a' | 'b';
  scores?: [number, number];
  minute?: number;
  finished?: [boolean, boolean];
};

/** Facts of one tournament with the given games (side a = entrant "A", side b = "B"). */
function facts(mode: StatMode, games: G[], id = 't1'): TournamentFacts {
  const f: TournamentFacts = {
    tournamentId: id,
    name: id,
    mode,
    at: '',
    finished: true,
    entrantNames: { A: 'A', B: 'B' },
    games: [],
    players: [],
    runs: [],
    matches: [],
    participants: [],
  };
  games.forEach((g, i) => {
    const at = new Date(Date.UTC(2026, 9, 17, 20, g.minute ?? i)).toISOString();
    const matchId = `M${i}`;
    const [sa, sb] = g.scores ?? (g.winner === 'a' ? [20, 10] : [10, 20]);
    f.games.push({
      matchId,
      game: 1,
      map: 'DM-Deck16][',
      at,
      entrants: ['A', 'B'],
      winnerEntrantId: g.winner === 'a' ? 'A' : 'B',
      endReason: 'fraglimit',
      scores: { A: sa, B: sb },
    });
    for (const [side, list] of [
      ['A', g.a],
      ['B', g.b],
    ] as const)
      for (const p of list)
        f.players.push({
          key: p.key,
          name: p.key,
          bot: p.key.startsWith('b:'),
          ...(p.skill === undefined ? {} : { skill: p.skill }),
          matchId,
          game: 1,
          run: 0,
          entrantId: side,
          won: (side === 'A') === (g.winner === 'a'),
          map: 'DM-Deck16][',
          at,
        });
    if (g.finished)
      for (const [k, side] of (['A', 'B'] as const).entries())
        f.runs.push({
          matchId,
          game: 1,
          run: k + 1,
          entrantId: side,
          entrantName: side,
          map: 'MH-Revenge][',
          at,
          timeMs: side === 'A' ? sa : sb,
          deaths: 0,
          penaltyMs: 0,
          finalMs: side === 'A' ? sa : sb,
          points: 0,
          finished: g.finished[k]!,
          forfeit: false,
          monsterSkill: 5,
          penaltySec: 5,
          lives: 0,
          members: [],
          hasHuman: false,
        });
  });
  return f;
}

const rating = (
  f: TournamentFacts[],
  key: string,
  mode: StatMode = 'dm',
  o: Partial<RatingOptions> = {},
) => computeRatings(f, o).players[mode].get(key)?.rating;
const gain = (g: G, key: string, mode: StatMode = 'dm') =>
  (rating([facts(mode, [g])], key, mode) ?? RATING_START) - RATING_START;

describe('ratings', () => {
  it('starts at 1500 and moves the winner up, the loser down', () => {
    const r = computeRatings([
      facts('dm', [{ a: [{ key: 'u:1' }], b: [{ key: 'u:2' }], winner: 'a' }]),
    ]);
    const w = r.players.dm.get('u:1')!;
    const l = r.players.dm.get('u:2')!;
    expect(w.rating).toBeGreaterThan(RATING_START);
    expect(l.rating).toBeLessThan(RATING_START);
    expect(w).toMatchObject({ games: 1, wins: 1, provisional: true });
    expect(r.games[0]!.changes.map((c) => c.delta)).toEqual([
      w.rating - RATING_START,
      l.rating - RATING_START,
    ]);
  });

  it('weighs the bot difficulty: an expected win gives little, an upset a lot', () => {
    const godlikeWins = gain(
      { a: [{ key: 'b:x', skill: 7 }], b: [{ key: 'b:y', skill: 1 }], winner: 'a' },
      'b:x',
    );
    const noviceWins = gain(
      { a: [{ key: 'b:x', skill: 7 }], b: [{ key: 'b:y', skill: 1 }], winner: 'b' },
      'b:y',
    );
    const equal = gain(
      { a: [{ key: 'b:x', skill: 4 }], b: [{ key: 'b:y', skill: 4 }], winner: 'a' },
      'b:x',
    );
    expect(godlikeWins).toBeLessThan(equal / 2);
    expect(noviceWins).toBeGreaterThan(equal);
    // The loser side mirrors it: the Novice bot loses little against Godlike.
    const noviceLoses = gain(
      { a: [{ key: 'b:x', skill: 7 }], b: [{ key: 'b:y', skill: 1 }], winner: 'a' },
      'b:y',
    );
    expect(-noviceLoses).toBeLessThan(equal / 2);
  });

  it('gives a human little for beating a weak bot', () => {
    const vsNovice = gain(
      { a: [{ key: 'u:1' }], b: [{ key: 'b:y', skill: 0 }], winner: 'a' },
      'u:1',
    );
    const vsAdept = gain(
      { a: [{ key: 'u:1' }], b: [{ key: 'b:y', skill: 4 }], winner: 'a' },
      'u:1',
    );
    const vsGodlike = gain(
      { a: [{ key: 'u:1' }], b: [{ key: 'b:y', skill: 7 }], winner: 'a' },
      'u:1',
    );
    expect(vsNovice).toBeLessThan(vsAdept * 0.6);
    // No farming: after a few wins against Novice bots a further win is worth almost nothing.
    const farm = computeRatings([
      facts(
        'dm',
        Array.from({ length: 12 }, (_, i) => ({
          a: [{ key: 'u:1' }],
          b: [{ key: `b:n${i % 3}`, skill: 0 }],
          winner: 'a' as const,
        })),
      ),
    ]);
    expect(farm.games.at(-1)!.changes[0]!.delta).toBeLessThan(20);
    expect(vsGodlike).toBeGreaterThan(vsAdept);
  });

  it('stores the bot rating without the difficulty bonus', () => {
    const f = [
      facts('dm', [{ a: [{ key: 'b:x', skill: 7 }], b: [{ key: 'b:y', skill: 1 }], winner: 'a' }]),
    ];
    const r = computeRatings(f);
    const x = r.players.dm.get('b:x')!.rating;
    // Fewer points than for a win between equals (the bonus made the win expected).
    expect(x - RATING_START).toBeLessThan(150);
    expect(strengthOf(r, 'dm', 'b:x', 7, 100)).toBe(x + 300);
    expect(strengthOf(r, 'dm', 'b:x', 1, 100)).toBe(x - 300);
    expect(strengthOf(r, 'dm', 'u:unknown', undefined, 100)).toBe(RATING_START);
  });

  it('scales by the margin', () => {
    const p = { a: [{ key: 'u:1' }], b: [{ key: 'u:2' }], winner: 'a' as const };
    const close = gain({ ...p, scores: [20, 19] }, 'u:1');
    const clear = gain({ ...p, scores: [20, 2] }, 'u:1');
    expect(clear).toBeGreaterThan(close * 1.6);
    expect(marginOf('dm', { score: 20 }, { score: 10 })).toBe(0.5);
    // Monster Hunt: lower time wins; 0.3 s apart is close, a team not at the exit is clear.
    expect(
      marginOf('mh', { score: 437_300, finished: true }, { score: 437_600, finished: true }),
    ).toBeLessThan(0.01);
    expect(marginOf('mh', { score: 400_000, finished: true }, { score: 0, finished: false })).toBe(
      1,
    );
    expect(
      marginOf('mh', { score: 400_000, finished: true }, { score: 500_000, finished: true }),
    ).toBe(1);
    const mh = computeRatings([
      facts('mh', [
        {
          a: [{ key: 'u:1' }],
          b: [{ key: 'u:2' }],
          winner: 'a',
          scores: [400_000, 600_000],
          finished: [true, false],
        },
      ]),
    ]);
    expect(mh.games[0]!.factor).toBe(1.5);
  });

  it('rates teams: every member moves', () => {
    const r = computeRatings([
      facts('tdm', [
        {
          a: [{ key: 'u:1' }, { key: 'b:x', skill: 5 }],
          b: [{ key: 'u:2' }, { key: 'u:3' }],
          winner: 'a',
        },
      ]),
    ]);
    expect(r.players.tdm.get('u:1')!.rating).toBeGreaterThan(RATING_START);
    expect(r.players.tdm.get('b:x')!.rating).toBeGreaterThan(RATING_START);
    expect(r.players.tdm.get('u:3')!.rating).toBeLessThan(RATING_START);
    expect(r.players.dm.size).toBe(0);
  });

  it('skips games with bots when they do not count, and games outside the season', () => {
    const f = [
      facts('dm', [
        { a: [{ key: 'u:1' }], b: [{ key: 'b:y', skill: 4 }], winner: 'a', minute: 1 },
        { a: [{ key: 'u:1' }], b: [{ key: 'u:2' }], winner: 'a', minute: 2 },
      ]),
    ];
    expect(computeRatings(f, { botGames: false }).games).toHaveLength(1);
    expect(computeRatings(f).games).toHaveLength(2);
    const second = new Date(Date.UTC(2026, 9, 17, 20, 2)).toISOString();
    expect(computeRatings(f, { from: second }).games).toHaveLength(1);
    expect(computeRatings(f, { to: second }).games).toHaveLength(1);
  });

  it('plays the games of all tournaments in time order', () => {
    const later = facts(
      'dm',
      [{ a: [{ key: 'u:1' }], b: [{ key: 'u:2' }], winner: 'b', minute: 9 }],
      't2',
    );
    const earlier = facts(
      'dm',
      [{ a: [{ key: 'u:1' }], b: [{ key: 'u:2' }], winner: 'a', minute: 1 }],
      't1',
    );
    const r = computeRatings([later, earlier]);
    expect(r.games.map((g) => g.tournamentId)).toEqual(['t1', 't2']);
    expect(r.players.dm.get('u:1')!.games).toBe(2);
  });
});
