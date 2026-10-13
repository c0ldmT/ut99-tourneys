import type { PlayerGameStats, TournamentEvent, TournamentSettings } from '@tourney/protocol';
import { describe, expect, it } from 'vitest';
import { mapRecords, playerDetail, playerTable, records } from '../src/stats/aggregate.js';
import { extractFacts } from '../src/stats/facts.js';

let seq = 0;
const ev = (type: string, data: unknown, minute = seq): TournamentEvent =>
  ({
    type,
    seq: ++seq,
    at: new Date(Date.UTC(2026, 9, 14, 20, minute)).toISOString(),
    actor: { kind: 'bridge' },
    data,
  }) as TournamentEvent;

const settings = (adapter: string, teamSize = 1): TournamentSettings =>
  ({
    format: 'single',
    size: 2,
    teamSize,
    game: { adapter, rules: adapter === 'ut99-mh' ? { monsterSkill: 5, penaltySec: 5 } : {} },
  }) as unknown as TournamentSettings;

const stat = (p: Partial<PlayerGameStats> & { name: string }): PlayerGameStats => ({
  kills: 0,
  deaths: 0,
  suicides: 0,
  teamKills: 0,
  headshots: 0,
  firstBlood: false,
  bestSpree: 0,
  sprees: 0,
  multi2: 0,
  multi3: 0,
  multi4: 0,
  multi5: 0,
  timeSec: 300,
  monsters: 0,
  monsterPoints: 0,
  weapons: {},
  ...p,
});

const humans = [
  { id: 'p1', kind: 'human', displayName: 'Mario', userId: 'u1' },
  { id: 'p2', kind: 'human', displayName: 'Anna', userId: 'u2' },
];

describe('statistics facts', () => {
  it('a 1v1 deathmatch: players, stats, matches, title; simulated games do not count', () => {
    seq = 0;
    const events = [
      ev('seeding.set', { entrants: humans, bracket: {}, rngSeed: 'x' }),
      ev('match.called', { matchId: 'W1', entrants: ['p1', 'p2'] }),
      ev('match.started', { matchId: 'W1', game: 1 }),
      ev('match.playerStats', {
        matchId: 'W1',
        game: 1,
        map: 'DM-Deck16][',
        durationSec: 240,
        players: [
          stat({
            name: 'Mario',
            userId: 'u1',
            entrantId: 'p1',
            kills: 20,
            deaths: 8,
            headshots: 3,
            firstBlood: true,
            bestSpree: 7,
            sprees: 1,
            multi2: 2,
            weapons: { 'Shock Rifle': 15, 'Flak Cannon': 5 },
          }),
          stat({ name: 'Anna', userId: 'u2', entrantId: 'p2', kills: 8, deaths: 20, suicides: 1 }),
        ],
      }),
      ev('match.gameFinished', {
        matchId: 'W1',
        game: 1,
        map: 'DM-Deck16][',
        scores: { p1: 20, p2: 7 },
        winnerId: 'p1',
        endReason: 'fragLimit',
      }),
      ev('match.result', {
        result: { matchId: 'W1', entrants: ['p1', 'p2'], winnerId: 'p1', outcome: 'played' },
      }),
      // a simulated match: no match.started
      ev('match.gameFinished', {
        matchId: 'X1',
        game: 1,
        map: '(simulated)',
        scores: { p1: 20, p2: 3 },
        winnerId: 'p1',
        endReason: 'fragLimit',
      }),
      ev('match.result', {
        result: { matchId: 'X1', entrants: ['p1', 'p2'], winnerId: 'p1', outcome: 'simulated' },
      }),
      ev('tournament.finished', { championId: 'p1' }),
    ];
    const f = extractFacts({ id: 't1', name: 'Cup 1', settings: settings('ut99-dm') }, events);
    expect(f.mode).toBe('dm');
    expect(f.games).toHaveLength(1);
    expect(f.games[0]).toMatchObject({ durationSec: 240, winnerEntrantId: 'p1' });
    expect(f.players.map((p) => [p.key, p.won])).toEqual([
      ['u:u1', true],
      ['u:u2', false],
    ]);
    expect(f.matches).toHaveLength(1);
    expect(f.participants.find((p) => p.ref.key === 'u:u1')?.champion).toBe(true);

    const rows = playerTable([f], { names: new Map([['u:u1', 'Mario T']]) });
    const mario = rows.find((r) => r.key === 'u:u1')!;
    expect(mario).toMatchObject({
      name: 'Mario T',
      tournaments: 1,
      titles: 1,
      matches: 1,
      matchesWon: 1,
      games: 1,
      gamesWon: 1,
      kills: 20,
      frags: 20,
      kd: 2.5,
      headshots: 3,
      firstBloods: 1,
      bestSpree: 7,
      multiKills: 2,
      favoriteWeapon: { name: 'Shock Rifle', kills: 15 },
    });
    expect(rows.find((r) => r.key === 'u:u2')).toMatchObject({ frags: 7, efficiency: 0.28 });

    const rec = records([f]);
    const byId = Object.fromEntries(rec.records.map((r) => [r.id, r]));
    expect(byId['game.frags']).toMatchObject({ value: 20, label: 'Mario', map: 'DM-Deck16][' });
    expect(byId['game.fastestWin']).toMatchObject({ value: 240, unit: 'sec' });
    expect(byId['game.kd']).toMatchObject({ value: 2.5 });
    expect(byId['career.titles']).toMatchObject({ value: 1 });
    expect(byId['career.matchStreak']).toBeUndefined(); // one match is no streak

    const d = playerDetail([f], 'u:u1')!;
    expect(d.weapons[0]).toEqual({ name: 'Shock Rifle', kills: 15 });
    expect(d.recent[0]).toMatchObject({ won: true, opponent: 'Anna' });
    expect(d.records.some((r) => r.id === 'game.frags')).toBe(true);
  });

  it('Monster Hunt: runs with members, map records by time plus penalty, bots count', () => {
    seq = 0;
    const bots = { kind: 'team', members: [], bots: [{ name: 'Loque' }, { name: 'Xan' }] };
    const events = [
      ev('seeding.set', {
        entrants: [
          {
            id: 't1',
            kind: 'team',
            displayName: 'Red',
            members: [{ userId: 'u1', displayName: 'Mario', sub: false }],
            bots: [{ name: 'Lauren' }],
          },
          { id: 't2', displayName: 'Iron Guard', ...bots },
        ],
        bracket: {},
        rngSeed: 'x',
      }),
      ev('match.called', { matchId: 'W1', entrants: ['t1', 't2'] }),
      ev('match.mapSelected', {
        matchId: 'W1',
        game: 1,
        map: 'MH-Canyon',
        method: 'vote',
        runOrder: ['t1', 't2'],
      }),
      ev('match.started', {
        matchId: 'W1',
        game: 1,
        runner: 't1',
        lineups: {
          t1: [
            { name: 'Mario', userId: 'u1' },
            { name: 'Lauren', bot: true },
          ],
        },
      }),
      ev('match.playerStats', {
        matchId: 'W1',
        game: 1,
        run: 1,
        map: 'MH-Canyon',
        durationSec: 300,
        players: [
          stat({ name: 'Mario', userId: 'u1', entrantId: 't1', monsters: 40, monsterPoints: 900 }),
          stat({ name: 'Lauren', bot: true, entrantId: 't1', monsters: 25 }),
        ],
      }),
      ev('match.runFinished', {
        matchId: 'W1',
        game: 1,
        entrantId: 't1',
        map: 'MH-Canyon',
        timeMs: 300_000,
        deaths: 2,
        penaltyMs: 10_000,
        points: 1500,
        finished: true,
      }),
      ev('match.started', { matchId: 'W1', game: 1, runner: 't2' }),
      ev('match.runFinished', {
        matchId: 'W1',
        game: 1,
        entrantId: 't2',
        map: 'MH-Canyon',
        timeMs: 290_000,
        deaths: 5,
        penaltyMs: 25_000,
        points: 1200,
        finished: true,
      }),
      ev('match.gameFinished', {
        matchId: 'W1',
        game: 1,
        map: 'MH-Canyon',
        scores: { t1: 310_000, t2: 315_000 },
        winnerId: 't1',
        endReason: 'race',
      }),
      ev('match.result', {
        result: { matchId: 'W1', entrants: ['t1', 't2'], winnerId: 't1', outcome: 'played' },
      }),
      ev('tournament.finished', { championId: 't1' }),
    ];
    const f = extractFacts({ id: 'mh1', name: 'MH Cup', settings: settings('ut99-mh', 2) }, events);
    expect(f.mode).toBe('mh');
    expect(f.runs).toHaveLength(2);
    expect(f.runs[0]).toMatchObject({ run: 1, finalMs: 310_000, monsterSkill: 5, hasHuman: true });
    expect(f.runs[0]!.members.map((m) => m.key)).toEqual(['u:u1', 'b:lauren']);
    // Bot team without stats or line-up: its bots from the entrant.
    expect(f.runs[1]!.members.map((m) => m.key)).toEqual(['b:loque', 'b:xan']);
    expect(f.runs[1]!.hasHuman).toBe(false);
    expect(f.players).toHaveLength(4);

    const maps = mapRecords([f]);
    expect(maps).toHaveLength(1);
    expect(maps[0]).toMatchObject({ map: 'MH-Canyon', finalMs: 310_000, team: 'Red', deaths: 2 });

    const rows = playerTable([f], { bots: true });
    expect(rows.find((r) => r.key === 'u:u1')).toMatchObject({
      runs: 1,
      runsFinished: 1,
      monsters: 40,
      monsterPoints: 900,
      titles: 1,
    });
    expect(rows.find((r) => r.key === 'b:loque')).toMatchObject({ runs: 1, games: 1, gamesWon: 0 });
    expect(playerTable([f]).some((r) => r.bot)).toBe(false);

    const ids = records([f], { mode: 'mh' }).records.map((r) => [r.id, r.value]);
    expect(ids).toContainEqual(['run.fewestDeaths', 2]);
    expect(ids).toContainEqual(['run.points', 1500]);
    expect(ids).toContainEqual(['run.monsters', 40]);
  });
});
