import { describe, expect, it } from 'vitest';
import { career, careerPhase, dailyForm, FORM_EFFECT, PHASE_EFFECT } from '../src/index.js';

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
      form: 'normal',
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
    expect(old).toMatchObject({ phase: 'decline', retire: true });
    expect(PHASE_EFFECT.peak.accuracy).toBeGreaterThan(0);
  });

  it('has a random form per bot and day, the same all day', () => {
    expect(dailyForm('b1', '2026-10-22')).toBe(dailyForm('b1', '2026-10-22'));
    const c = career({ seasons: [], id: 'b1', day: '2026-10-22' });
    expect(c.form).toBe(dailyForm('b1', '2026-10-22'));
    // About a fifth in form, a fifth out of form; it changes from day to day.
    const n = { hot: 0, normal: 0, cold: 0 };
    let changes = 0;
    for (let i = 0; i < 2000; i++) {
      const a = dailyForm(`b${i}`, '2026-10-22');
      n[a]++;
      if (a !== dailyForm(`b${i}`, '2026-10-23')) changes++;
    }
    expect(n.hot / 2000).toBeGreaterThan(0.16);
    expect(n.hot / 2000).toBeLessThan(0.24);
    expect(n.cold / 2000).toBeGreaterThan(0.16);
    expect(n.cold / 2000).toBeLessThan(0.24);
    expect(changes).toBeGreaterThan(800);
    expect(FORM_EFFECT.hot).toBe(-FORM_EFFECT.cold);
  });
});
