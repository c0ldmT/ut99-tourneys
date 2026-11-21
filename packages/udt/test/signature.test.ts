import { describe, expect, it } from 'vitest';
import {
  drawSignatures,
  signatureEffect,
  signatureEligible,
  signatureModCode,
  signatureStrength,
  SIGNATURES,
  SIGNATURE_EFFECT,
  type Signature,
  type SignatureProfile,
} from '../src/index.js';

/** An average bot of skill 5 (the marks of the others are measured against such bots). */
const base = (botId: string, more: Partial<SignatureProfile> = {}): SignatureProfile => ({
  botId,
  skill: 5,
  age: 3,
  careerLevel: 12,
  statGames: 100,
  kills: 1000,
  deaths: 1000,
  headshots: 50,
  sprees: 20,
  multiKills: 100,
  firstBloods: 10,
  damageGames: 100,
  damageTaken: 150_000,
  favoriteWeapon: { name: 'Shock Rifle', kills: 250 },
  maps: [
    { map: 'DM-Deck16][', games: 30, won: 15 },
    { map: 'DM-Morpheus', games: 30, won: 15 },
  ],
  games: 100,
  gamesWon: 50,
  ...more,
});

describe('signatures (plan P4, decision 271)', () => {
  it('needs age 2 and career level 10; level 2 from career level 20', () => {
    expect(signatureEligible({ age: 1, careerLevel: 30 })).toBe(false);
    expect(signatureEligible({ age: 2, careerLevel: 9 })).toBe(false);
    expect(signatureEligible({ age: 2, careerLevel: 10 })).toBe(true);
    const got = drawSignatures(
      [
        base('a', { headshots: 150 }),
        base('b', { headshots: 150, careerLevel: 20 }),
        base('young', { headshots: 150, age: 1 }),
        base('avg1'),
        base('avg2'),
      ],
      new Map(),
      3,
    );
    expect(got.get('a')).toEqual({ code: 'marksman', level: 1, since: 3 });
    expect(got.get('b')).toMatchObject({ code: 'marksman', level: 2 });
    expect(got.has('young')).toBe(false);
  });

  it('takes the mark that stands out most against bots of its skill', () => {
    const avg = [base('x1'), base('x2'), base('x3')];
    const got = drawSignatures(
      [
        ...avg,
        base('weapon', { favoriteWeapon: { name: 'Flak Cannon', kills: 600 } }),
        base('streak', { sprees: 60 }),
        base('multi', { multiKills: 300 }),
        base('tough', { damageTaken: 400_000 }),
        base('opener', { firstBloods: 40 }),
        base('home', {
          maps: [
            { map: 'DM-Deck16][', games: 30, won: 28 },
            { map: 'DM-Morpheus', games: 30, won: 10 },
          ],
        }),
      ],
      new Map(),
      3,
    );
    expect(got.get('weapon')).toMatchObject({ code: 'weapon', weapon: 'UT_FlakCannon' });
    expect(got.get('streak')?.code).toBe('streak');
    expect(got.get('multi')?.code).toBe('multi');
    expect(got.get('tough')?.code).toBe('tough');
    expect(got.get('opener')?.code).toBe('opener');
    expect(got.get('home')).toMatchObject({ code: 'home', map: 'DM-Deck16][' });
  });

  it('keeps a held signature and only raises its level', () => {
    const held = new Map<string, Signature>([['a', { code: 'tough', level: 1, since: 2 }]]);
    const got = drawSignatures(
      [base('a', { headshots: 300, careerLevel: 25 }), base('b'), base('c')],
      held,
      4,
    );
    expect(got.get('a')).toEqual({ code: 'tough', level: 2, since: 2 });
    expect(drawSignatures([base('a', { careerLevel: 12 })], held, 4).has('a')).toBe(false);
  });

  it('needs enough numbers', () => {
    expect(
      drawSignatures([base('few', { statGames: 5, headshots: 300 })], new Map(), 3).has('few'),
    ).toBe(false);
  });

  it('has an effect per level, a mod code and a strength in the model', () => {
    for (const c of SIGNATURES) {
      expect(SIGNATURE_EFFECT[c][1]).toBeGreaterThan(SIGNATURE_EFFECT[c][0]);
      expect(signatureEffect({ code: c, level: 2 })).toBe(SIGNATURE_EFFECT[c][1]);
    }
    expect(signatureModCode({ code: 'weapon', level: 2, since: 1 })).toBe('w2');
    expect(signatureModCode(null)).toBeNull();
    expect(signatureStrength({ level: 1 })).toBeLessThan(signatureStrength({ level: 2 }));
    expect(signatureStrength(null)).toBe(0);
  });
});
