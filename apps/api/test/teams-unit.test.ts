import { createRng } from '@tourney/bracket';
import { describe, expect, it } from 'vitest';
import {
  assignBots,
  fits,
  formTeams,
  joinRole,
  openStarterPlaces,
} from '../src/tournaments/teams.js';

const team = (id: string, starters: number, subs = 0) => ({
  id,
  members: [
    ...Array.from({ length: starters }, (_, i) => ({ userId: `${id}s${i}`, sub: false })),
    ...Array.from({ length: subs }, (_, i) => ({ userId: `${id}b${i}`, sub: true })),
  ],
});

describe('team capacity', () => {
  it('counts open starter places in teams and in new teams', () => {
    const c = { size: 4, teamSize: 3, teams: [team('a', 3), team('b', 1, 2)], solos: 0 };
    expect(openStarterPlaces(c)).toBe(2 + 2 * 3);
    expect(fits({ ...c, solos: 8 })).toBe(true);
    expect(fits({ ...c, solos: 9 })).toBe(false);
  });

  it('behaves like a player limit in 1v1', () => {
    expect(fits({ size: 8, teamSize: 1, teams: [], solos: 8 })).toBe(true);
    expect(fits({ size: 8, teamSize: 1, teams: [], solos: 9 })).toBe(false);
  });

  it('knows the role of a new member', () => {
    expect(joinRole(team('a', 1), 2)).toBe('starter');
    expect(joinRole(team('a', 2, 1), 2)).toBe('sub');
    expect(joinRole(team('a', 2, 2), 2)).toBeNull();
  });
});

describe('forming teams', () => {
  it('fills short teams first, evenly, then draws new teams', () => {
    const solos = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
    const r = formTeams({
      size: 8,
      teamSize: 3,
      teams: [team('a', 1), team('b', 2), team('c', 3)],
      solos,
      rng: createRng(1),
    });
    const into = (id: string) => r.fills.filter((f) => f.teamId === id).length;
    expect([into('a'), into('b'), into('c')]).toEqual([2, 1, 0]);
    expect(r.created.map((g) => g.length)).toEqual([3, 1]);
    const all = [...r.fills.map((f) => f.userId), ...r.created.flat()].sort();
    expect(all).toEqual(solos);
  });

  it('refuses more teams than the bracket holds', () => {
    expect(() =>
      formTeams({
        size: 4,
        teamSize: 2,
        teams: [],
        solos: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
        rng: createRng(1),
      }),
    ).toThrow(/5 teams do not fit/);
  });
});

describe('bots for teams', () => {
  const pool = ['A', 'B', 'C', 'D', 'E'].map((name) => ({ name, skill: 3 }));

  it('spreads the pool over the teams and never repeats a bot within a team', () => {
    const fills = assignBots([2, 0, 3, 3], pool, createRng(2));
    expect(fills.map((f) => f.length)).toEqual([2, 0, 3, 3]);
    for (const f of fills) expect(new Set(f.map((b) => b.name)).size).toBe(f.length);
    // The first five bots handed out are all different.
    expect(
      new Set(
        fills
          .flat()
          .slice(0, 5)
          .map((b) => b.name),
      ).size,
    ).toBe(5);
  });

  it('needs enough different bots for one team', () => {
    expect(() => assignBots([3], pool.slice(0, 2), createRng(1))).toThrow(/need 3 different bots/);
  });
});
