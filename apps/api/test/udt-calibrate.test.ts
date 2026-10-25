import { describe, expect, it } from 'vitest';
import { botStrength, gameChance } from '@tourney/udt';
import Database from 'better-sqlite3';
import {
  bestK,
  calibrate,
  readCalibrationGames,
  type CalibrationGame,
} from '../src/udt/calibrate.js';

/** Deterministic random numbers (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Synthetic games drawn from the model with exponent k (bots without traits: score 0.5). */
function games(n: number, size: number, k: number, seed: number): CalibrationGame[] {
  const r = rng(seed);
  const out: CalibrationGame[] = [];
  for (let i = 0; i < n; i++) {
    const side = () => Array.from({ length: size }, () => ({ skill: Math.floor(r() * 8) }));
    const a = side();
    const b = side();
    const mean = (s: { skill: number }[]) =>
      s.reduce((x, bot) => x + botStrength(bot.skill, 0.5), 0) / s.length;
    const sa = mean(a) ** k;
    const sb = mean(b) ** k;
    out.push({ teamSize: size, a, b, winA: r() < sa / (sa + sb) });
  }
  return out;
}

describe('udt:calibrate', () => {
  it('finds the exponent the games were drawn with', () => {
    expect(Math.abs(bestK(games(4000, 1, 3, 1)).k - 3)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(bestK(games(4000, 5, 4.5, 2)).k - 4.5)).toBeLessThanOrEqual(0.75);
  });

  it('reports both groups, the buckets and a levelPoints fit', () => {
    const report = calibrate([...games(600, 1, 3, 3), ...games(300, 5, 4.5, 4)]);
    expect(report.games).toBe(900);
    const duel = report.groups.find((g) => g.label === 'duel')!;
    expect(duel.n).toBe(600);
    expect(duel.k).toBe(3);
    expect(duel.logLoss).toBeLessThan(Math.LN2);
    expect(duel.buckets.map((b) => b.gap)).toContain(1);
    for (const b of duel.buckets) expect(b.model).toBeGreaterThanOrEqual(0.5);
    expect(report.levelPoints.levelPoints).toBeGreaterThan(100);
  });

  it('compares the buckets with the model the simulators use', () => {
    // One game per side: skill 5 beats skill 4; the model says gameChance for it.
    const g: CalibrationGame = {
      teamSize: 1,
      a: [{ skill: 5 }],
      b: [{ skill: 4 }],
      winA: true,
    };
    const duel = calibrate([g]).groups.find((x) => x.label === 'duel')!;
    expect(duel.buckets).toEqual([
      { gap: 1, n: 1, won: 1, model: gameChance(botStrength(5, 0.5), botStrength(4, 0.5), 1) },
    ]);
  });

  it('reads only games between bot-only sides, with replacements', () => {
    const db = new Database(':memory:');
    db.exec(
      'CREATE TABLE tournaments (id TEXT, settings_json TEXT); CREATE TABLE events (tournament_id TEXT, seq INTEGER, type TEXT, json TEXT);',
    );
    db.prepare('INSERT INTO tournaments VALUES (?, ?)').run(
      't1',
      JSON.stringify({ teamSize: 2, game: { adapter: 'ut99-dm' } }),
    );
    const ev = db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)');
    const team = (id: string, skill: number, members: unknown[] = []) => ({
      id,
      kind: 'team',
      members,
      bots: [{ skill }, { skill }],
    });
    const finished = (a: string, b: string) => ({
      data: { scores: { [a]: 10, [b]: 5 }, winnerId: a },
    });
    ev.run(
      't1',
      1,
      'seeding.set',
      JSON.stringify({
        data: { entrants: [team('x', 5), team('y', 3), team('h', 4, [{ userId: 'u' }])] },
      }),
    );
    ev.run('t1', 2, 'match.gameFinished', JSON.stringify(finished('x', 'y')));
    // A side with a human does not count.
    ev.run('t1', 3, 'match.gameFinished', JSON.stringify(finished('h', 'x')));
    ev.run(
      't1',
      4,
      'entrant.replaced',
      JSON.stringify({ data: { entrantId: 'h', replacement: team('h', 2) } }),
    );
    ev.run('t1', 5, 'match.gameFinished', JSON.stringify(finished('y', 'h')));
    ev.run('t1', 6, 'match.gameFinished', '{broken');
    const read = readCalibrationGames(db);
    expect(read).toEqual([
      { teamSize: 2, a: [{ skill: 5 }, { skill: 5 }], b: [{ skill: 3 }, { skill: 3 }], winA: true },
      { teamSize: 2, a: [{ skill: 3 }, { skill: 3 }], b: [{ skill: 2 }, { skill: 2 }], winA: true },
    ]);
  });
});
