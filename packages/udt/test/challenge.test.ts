import { describe, expect, it } from 'vitest';
import {
  brokenRecord,
  challengeMinutes,
  challengePot,
  leagueClashDays,
  stakeCap,
  stakeProblem,
  weekdayOf,
  windowStarts,
  hardnessOfSkill,
  type RecordRun,
} from '../src/challenge.js';

describe('challenges (decision 334)', () => {
  it('keeps a server 15/30/45 minutes for Bo1/3/5 and 45 for a Monster Hunt race', () => {
    expect(challengeMinutes({ mode: 'dm', bestOf: 1 })).toBe(15);
    expect(challengeMinutes({ mode: 'dm', bestOf: 3 })).toBe(30);
    expect(challengeMinutes({ mode: 'dm', bestOf: 5 })).toBe(45);
    expect(challengeMinutes({ mode: 'mh', bestOf: 1 })).toBe(45);
  });

  it('caps the stake at the base × index^0.2 and checks steps', () => {
    expect(stakeCap(2000, 1)).toBe(2000);
    expect(stakeCap(2000, 2.5)).toBe(2400);
    expect(stakeCap(2000, 5)).toBe(2760);
    expect(stakeProblem(0, 2000)).toBeNull();
    expect(stakeProblem(50, 2000)).toBe('low');
    expect(stakeProblem(105, 2000)).toBe('step');
    expect(stakeProblem(2010, 2000)).toBe('high');
    expect(stakeProblem(2000, 2000)).toBeNull();
  });

  it('pays the pot minus the fee to the winner', () => {
    expect(challengePot(500, 5)).toEqual({ pot: 1000, fee: 50, prize: 950 });
    expect(challengePot(500, 0)).toEqual({ pot: 1000, fee: 0, prize: 1000 });
    expect(challengePot(0, 5)).toEqual({ pot: 0, fee: 0, prize: 0 });
  });

  it('lists the start times that end inside the window', () => {
    const w = { from: '19:00', to: '22:00' };
    expect(windowStarts(w, 15)).toHaveLength(12);
    expect(windowStarts(w, 15).at(-1)).toBe('21:45');
    expect(windowStarts(w, 45).at(-1)).toBe('21:15');
    expect(windowStarts({ from: '19:10', to: '20:00' }, 15)).toEqual(['19:15', '19:30', '19:45']);
  });

  it('finds the weekdays the window runs into the league evening', () => {
    const league = { enabled: true, slotDays: [0, 1, 2, 3, 4, 5], slotTime: '22:00' };
    const days = [0, 1, 2, 3, 4, 5, 6];
    expect(leagueClashDays({ days, from: '19:00', to: '22:00' }, league, 100)).toEqual([]);
    expect(leagueClashDays({ days, from: '19:00', to: '22:15' }, league, 100)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    // After the evening is fine, during it not; Sunday has no evening.
    expect(leagueClashDays({ days, from: '23:45', to: '23:59' }, league, 100)).toEqual([]);
    expect(leagueClashDays({ days: [6], from: '21:00', to: '23:00' }, league, 100)).toEqual([]);
    expect(
      leagueClashDays({ days, from: '21:00', to: '23:00' }, { ...league, enabled: false }, 100),
    ).toEqual([]);
  });

  it('counts weekdays from Monday', () => {
    expect(weekdayOf('2026-11-30')).toBe(0); // Monday
    expect(weekdayOf('2026-11-29')).toBe(6); // Sunday
  });
});

describe('brokenRecord (decision 335)', () => {
  const run = (finalMs: number, over: Partial<RecordRun> = {}): RecordRun => ({
    entrantId: 'a',
    map: 'MH-Lonely',
    monsterSkill: 5,
    finalMs,
    finished: true,
    ...over,
  });
  const held = [{ map: 'mh-lonely', monsterSkill: 5, finalMs: 600_000 }];

  it('finds the best finished run that beats the record of its map and skill', () => {
    const fast = run(590_000, { entrantId: 'b' });
    expect(brokenRecord([run(610_000), fast], held)).toBe(fast);
    expect(brokenRecord([run(600_000)], held)).toBeNull();
    // Unfinished and forfeited runs, other skills and a map without a record break none.
    expect(brokenRecord([run(500_000, { finished: false })], held)).toBeNull();
    expect(brokenRecord([run(500_000, { forfeit: true })], held)).toBeNull();
    expect(brokenRecord([run(500_000, { monsterSkill: 6 })], held)).toBeNull();
    expect(brokenRecord([run(500_000, { map: 'MH-Canyon' })], held)).toBeNull();
  });

  it('names the difficulty of a monster skill', () => {
    expect(hardnessOfSkill(5)).toBe('normal');
    expect(hardnessOfSkill(7)).toBe('nightmare');
    expect(hardnessOfSkill(3)).toBeNull();
  });
});
