import { describe, expect, it } from 'vitest';
import { career, careerForm, careerPhase, PHASE_EFFECT } from '../src/index.js';

describe('career', () => {
  it('ages with seasons of five games or more', () => {
    const c = career({
      seasons: [
        { season: 1, games: 10, wins: 5 },
        { season: 2, games: 3, wins: 3 },
        { season: 3, games: 20, wins: 14 },
      ],
      current: 3,
    });
    expect(c).toMatchObject({
      age: 2,
      phase: 'rising',
      games: 33,
      wins: 22,
      form: 'hot',
      from: 1,
      to: 3,
    });
    expect(c.level).toBeGreaterThan(1);
    expect(c.retire).toBe(false);
  });

  it('runs through the phases and suggests retirement late', () => {
    expect([
      'rookie',
      'rookie',
      'rising',
      'rising',
      'peak',
      'peak',
      'peak',
      'veteran',
      'veteran',
      'veteran',
      'decline',
    ]).toEqual(Array.from({ length: 11 }, (_, i) => careerPhase(i)));
    const old = career({
      seasons: Array.from({ length: 12 }, (_, i) => ({ season: i + 1, games: 6, wins: 1 })),
      current: 12,
    });
    expect(old).toMatchObject({ phase: 'decline', retire: true, form: 'cold' });
    expect(PHASE_EFFECT.peak.accuracy).toBeGreaterThan(0);
    expect(careerForm(4, 4)).toBe('normal');
  });
});
