import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CURRENT_CURVE,
  accuracyToMatch,
  curveFromUc,
  duelSeries,
  fromPct,
  resolveBot,
  toPct,
  VALUE_EDGES,
  withCurve,
} from '../src/index.js';

const file = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const bot = (level: number, acc = 50) => ({ level, accuracy: fromPct(acc) });

describe('skill curve data', () => {
  it('matches the defaultproperties of TourneySkillCurve.uc', () => {
    const uc = file('../../../mods/ut99-tournament/Classes/TourneySkillCurve.uc');
    expect(curveFromUc(uc)).toEqual(CURRENT_CURVE);
  });

  it('has the same trait edges as the mod', () => {
    const uc = file('../../../mods/ut99-tournament/Classes/TourneySkillCurve.uc');
    const code = { aim: 'CEAim', react: 'CEReact', turn: 'CETurn', dodge: 'CEDodge' } as const;
    for (const [trait, e] of Object.entries(VALUE_EDGES)) {
      for (const [k, prop] of Object.entries(code)) {
        const v = e[k as keyof typeof code];
        if (v !== undefined) expect(uc, `${trait} ${k}`).toContain(`${prop}[s] *= ${v}`);
      }
      if (e.view) expect(uc, `${trait} view`).toContain(`CEView[s] += ${e.view}`);
    }
  });

  it('reads the proposal file and checks curve rows', () => {
    const raw = JSON.parse(file('../../../apps/api/scripts/bot-curves/proposal-v1.json'));
    const c = withCurve(CURRENT_CURVE, raw);
    expect(c.accGain).toHaveLength(8);
    expect(() => withCurve(CURRENT_CURVE, { nope: [1, 2, 3, 4, 5, 6, 7, 8] })).toThrow(/unknown/);
    expect(() => withCurve(CURRENT_CURVE, { yaw: [1, 2] })).toThrow(/8 numbers/);
  });
});

describe('bots for the duel', () => {
  it('applies Dream Team traits, tiredness and the career phase', () => {
    expect(fromPct(80)).toBeCloseTo(0.6);
    expect(toPct(0.6)).toBe(80);
    expect(resolveBot({ level: 3, traits: [{ code: 'eagle-eye' }] }).edge.aim).toBeCloseTo(0.86);
    expect(resolveBot({ level: 3, traits: [{ code: 'claudius' }] }).level).toBe(4);
    expect(resolveBot({ level: 3, accuracy: 0.5, tired: true }).accuracy).toBeCloseTo(0.3);
    expect(resolveBot({ level: 3, phase: 'decline' }).accuracy).toBeCloseTo(-0.12);
    const b = resolveBot({ level: 2, traits: [{ code: 'glass-cannon' }] });
    expect(b.body.glass).toBe(true);
    expect(b.body.thick).toBe(false);
  });
});

describe('duel simulator', () => {
  it('is deterministic for a seed', () => {
    const a = duelSeries(bot(3), bot(4), { duels: 40, seed: 3 });
    const b = duelSeries(bot(3), bot(4), { duels: 40, seed: 3 });
    expect(a).toEqual(b);
    expect(a.n).toBe(80);
    expect(a.winA + duelSeries(bot(4), bot(3), { duels: 40, seed: 3 }).winA).toBeCloseTo(1, 0);
  });

  it('lets better bots win', () => {
    expect(duelSeries(bot(7), bot(0), { duels: 60, seed: 1 }).winA).toBeGreaterThan(0.8);
    expect(duelSeries(bot(4, 100), bot(4, 0), { duels: 60, seed: 1 }).winA).toBeGreaterThan(0.6);
    const ambush = duelSeries(bot(4), bot(0), { duels: 60, seed: 1, setup: 'ambush' });
    expect(ambush.winA).toBeGreaterThan(0.7);
    expect(ambush.n).toBe(60);
    expect(ambush.b.firstShot).toBeGreaterThan(0.3);
  });

  it('turns a building block off for both bots (neutral)', () => {
    const o = { duels: 60, seed: 2, curve: withCurve(CURRENT_CURVE, {}) };
    const plain = duelSeries(bot(5), bot(4), o);
    const noAim = duelSeries(bot(5), bot(4), { ...o, neutral: ['aim'] as const });
    expect(noAim.winA).toBeLessThan(plain.winA + 0.1);
  });

  it('finds the accuracy that makes up for a level', () => {
    const v = accuracyToMatch(bot(4), bot(5), { duels: 40, seed: 4 });
    expect(v === null || (v >= -1 && v <= 100)).toBe(true);
  });
});
