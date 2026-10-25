import { describe, expect, it } from 'vitest';
import { botStrength, gameChance, GAME_MODEL_K, SKILL_STRENGTH } from '../src/index.js';

describe('game model', () => {
  it('gives even sides an even chance and is symmetric', () => {
    expect(gameChance(3, 3)).toBeCloseTo(0.5);
    expect(gameChance(3, 3, 5)).toBeCloseTo(0.5);
    expect(gameChance(4.6, 3.4) + gameChance(3.4, 4.6)).toBeCloseTo(1);
    expect(gameChance(0, 0)).toBe(0.5);
  });

  it('uses k = 3 in 1v1 and 4.5 in teams', () => {
    const [a, b] = [SKILL_STRENGTH[5]!, SKILL_STRENGTH[4]!];
    expect(gameChance(a, b, 1)).toBeCloseTo(a ** 3 / (a ** 3 + b ** 3));
    expect(gameChance(a, b, 5)).toBeCloseTo(a ** 4.5 / (a ** 4.5 + b ** 4.5));
    expect(GAME_MODEL_K).toEqual({ duel: 3, team: 4.5 });
    // Teams decide more clearly than duels with the same gap.
    expect(gameChance(a, b, 5)).toBeGreaterThan(gameChance(a, b, 1));
  });

  it('matches the real games: a one-skill favourite wins about three of four duels', () => {
    // Mean over all one-step pairings (the export: 77 % in 65 duels, the model 76 %).
    const ps = [0, 1, 2, 3, 4, 5, 6].map((s) =>
      gameChance(botStrength(s + 1, 0.5), botStrength(s, 0.5), 1),
    );
    const mean = ps.reduce((x, p) => x + p, 0) / ps.length;
    expect(mean).toBeGreaterThan(0.7);
    expect(mean).toBeLessThan(0.82);
  });

  it('moves a bot +-15 % with its value score and clamps the skill', () => {
    expect(botStrength(4, 0)).toBeCloseTo(3.4 * 0.85);
    expect(botStrength(4, 1)).toBeCloseTo(3.4 * 1.15);
    expect(botStrength(9, 0.5)).toBeCloseTo(9.5);
    expect(botStrength(-1, 0.5)).toBeCloseTo(1);
  });
});
