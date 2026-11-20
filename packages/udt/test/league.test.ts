import { describe, expect, it } from 'vitest';
import {
  AUTO_BAND,
  autoBandStep,
  botStrength,
  clubPrestige,
  clubTraitPool,
  clubTraits,
  prestigeEffect,
  prestigeSpent,
  eveningsOf,
  finalFour,
  leagueBots,
  leagueRng,
  matchdaysOf,
  nextTiers,
  pickKeepers,
  promotion,
  relegationPairs,
  rubberBands,
  schedule,
  simulateGame,
  standings,
  tableMoney,
  traitDef,
  traitsEffect,
  valueScore,
  type LeagueResult,
} from '../src/index.js';

const clubs = (n: number, p = 'c') => Array.from({ length: n }, (_, i) => `${p}${i + 1}`);

describe('league fixture list', () => {
  for (const n of [8, 10, 12, 14, 16])
    it(`${n} clubs: everybody meets everybody twice, once at home`, () => {
      const list = clubs(n);
      const days = schedule(list, 'seed');
      expect(days).toHaveLength(matchdaysOf(n));
      const pairs = new Map<string, number>();
      const home = new Map<string, number>();
      for (const d of days) {
        expect(d).toHaveLength(n / 2);
        const seen = new Set<string>();
        for (const p of d) {
          expect(seen.has(p.home) || seen.has(p.away)).toBe(false);
          seen.add(p.home);
          seen.add(p.away);
          pairs.set(`${p.home}>${p.away}`, (pairs.get(`${p.home}>${p.away}`) ?? 0) + 1);
          home.set(p.home, (home.get(p.home) ?? 0) + 1);
        }
      }
      for (const a of list)
        for (const b of list) if (a !== b) expect(pairs.get(`${a}>${b}`)).toBe(1);
      for (const c of list) expect(home.get(c)).toBe(n - 1);
      // Never more than two home or away games in a row in the first half.
      for (const c of list) {
        let run = 0;
        let last = '';
        for (const d of days.slice(0, n - 1)) {
          const p = d.find((x) => x.home === c || x.away === c)!;
          const side = p.home === c ? 'h' : 'a';
          run = side === last ? run + 1 : 1;
          last = side;
          expect(run).toBeLessThanOrEqual(2);
        }
      }
      // Over both halves at most three in a row (the turn of the halves).
      for (const c of list) {
        let run = 0;
        let last = '';
        for (const d of days) {
          const p = d.find((x) => x.home === c || x.away === c)!;
          const side = p.home === c ? 'h' : 'a';
          run = side === last ? run + 1 : 1;
          last = side;
          expect(run).toBeLessThanOrEqual(3);
        }
      }
      // Seeded: the same seed gives the same list.
      expect(schedule(list, 'seed')).toEqual(days);
    });

  it('refuses odd leagues', () => {
    expect(() => schedule(clubs(7), 1)).toThrow();
  });
});

describe('league table', () => {
  const g = (
    home: string,
    away: string,
    hf: number,
    af: number,
    overtime = false,
  ): LeagueResult => ({
    home,
    away,
    homeFrags: hf,
    awayFrags: af,
    overtime,
    winner: hf > af ? home : away,
  });

  it('counts 2 for a win, 2 for an overtime win, 1 for an overtime loss', () => {
    const t = standings(['a', 'b', 'c'], [g('a', 'b', 50, 30), g('b', 'c', 41, 40, true)]);
    const by = Object.fromEntries(t.map((r) => [r.club, r]));
    expect(by.a).toMatchObject({ points: 2, won: 1, played: 1, form: ['W'] });
    expect(by.b).toMatchObject({ points: 2, lost: 1, wonOt: 1, form: ['L', 'OW'] });
    expect(by.c).toMatchObject({ points: 1, lostOt: 1, fragsFor: 40, fragsAgainst: 41 });
    expect(t.map((r) => r.place)).toEqual([1, 2, 3]);
  });

  it('breaks ties by frag difference, frags, the games between them, then a lot', () => {
    // a and b: 2 points each, a with the better difference.
    let t = standings(['a', 'b', 'x', 'y'], [g('a', 'x', 50, 10), g('b', 'y', 50, 30)]);
    expect(t[0]!.club).toBe('a');
    // Same difference, more frags.
    t = standings(['a', 'b', 'x', 'y'], [g('a', 'x', 50, 40), g('y', 'b', 30, 40)]);
    expect(t.map((r) => r.club).slice(0, 2)).toEqual(['a', 'b']);
    // Same points, difference and frags: the game between them decides.
    t = standings(
      ['a', 'b'],
      [g('a', 'b', 50, 40), g('b', 'a', 50, 40), g('b', 'a', 41, 40, true)],
    );
    // b: 2+2 = 4 points (one OT win), a: 2+0+1 = 3.
    expect(t[0]!.club).toBe('b');
    // Fully even: the seeded lot, always the same.
    const even = standings(['a', 'b'], [], 'lot');
    expect(standings(['a', 'b'], [], 'lot')).toEqual(even);
  });

  it('keeps the last five games as form', () => {
    const games = Array.from({ length: 7 }, (_, i) =>
      g('a', 'b', i % 2 ? 50 : 10, i % 2 ? 10 : 50),
    );
    expect(standings(['a', 'b'], games)[0]!.form).toHaveLength(5);
  });
});

describe('promotion, relegation, final four', () => {
  const table = (n: number, p: string) =>
    standings(clubs(n, p), [], 0).map((r, i) => ({ ...r, place: i + 1 }));

  it('pairs places 3-6 against N-2 ... N-5 with 16 clubs', () => {
    const pro = table(16, 'p');
    const div = table(16, 'd');
    const r = promotion([pro, div]);
    expect(r.up.map((m) => m.club)).toEqual([div[0]!.club, div[1]!.club]);
    expect(r.down.map((m) => m.club)).toEqual([pro[15]!.club, pro[14]!.club]);
    expect(r.relegation.map((t) => [t.lowerPlace, t.upperPlace])).toEqual([
      [3, 14],
      [4, 13],
      [5, 12],
      [6, 11],
    ]);
  });

  it('has fewer pairings in small leagues and never touches the final four', () => {
    expect(relegationPairs(2, 8)).toEqual([0, 2]);
    expect(relegationPairs(3, 8)).toEqual([0, 2, 2]);
    expect(relegationPairs(2, 12)).toEqual([0, 4]);
    expect(relegationPairs(3, 12)).toEqual([0, 4, 4]);
    expect(relegationPairs(3, 10)).toEqual([0, 4, 2]);
    const r = promotion([table(8, 'p'), table(8, 'd')]);
    expect(r.relegation.map((t) => [t.lowerPlace, t.upperPlace])).toEqual([
      [3, 6],
      [4, 5],
    ]);
    // Three tiers of 12: the middle tier's places 3-6 go up, 8-10 ... not twice.
    const three = promotion([table(12, 'p'), table(12, 'a'), table(12, 'b')]);
    const middle = three.relegation.filter(
      (t) => t.upper.startsWith('a') || t.lower.startsWith('a'),
    );
    const places = middle.map((t) => (t.upper.startsWith('a') ? t.upperPlace : t.lowerPlace));
    expect(new Set(places).size).toBe(places.length);
  });

  it("moves the clubs: direct moves and the ties' winners", () => {
    const pro = table(16, 'p');
    const div = table(16, 'd');
    const r = promotion([pro, div]);
    const winners = new Map(r.relegation.map((t, i) => [t.upper, i ? t.upper : t.lower]));
    const next = nextTiers([pro, div], winners);
    expect(next.get(div[0]!.club)).toBe(0);
    expect(next.get(pro[15]!.club)).toBe(1);
    expect(next.get(div[2]!.club)).toBe(0); // won its tie
    expect(next.get(pro[13]!.club)).toBe(1);
    expect(next.get(div[3]!.club)).toBe(1);
    expect([...next.values()].filter((t) => t === 0)).toHaveLength(16);
  });

  it('final four: 1 v 4 and 2 v 3', () => {
    const pro = table(16, 'p');
    expect(finalFour(pro)).toEqual([
      { home: pro[0]!.club, away: pro[3]!.club },
      { home: pro[1]!.club, away: pro[2]!.club },
    ]);
  });
});

describe('AI clubs', () => {
  it('rubber band: the median of the tier managers, an empty tier 75 % of the one above', () => {
    const sides = [
      { tier: 0, strength: 10 },
      { tier: 0, strength: 20 },
      { tier: 0, strength: 30 },
      { tier: 1, strength: 12 },
      { tier: 1, strength: 16 },
    ];
    expect(rubberBands(sides, 3)).toEqual([20, 14, 10.5]);
    // Floors: a weak start of the season.
    expect(rubberBands([{ tier: 1, strength: 4 }], 2)).toEqual([8, 7]);
    expect(rubberBands([], 2)).toEqual([8, 7]);
  });

  it('league bots reach the target strength and keep their names', () => {
    for (const target of [6, 10, 17, 25, 36]) {
      const bots = leagueBots('club-x', target);
      expect(bots).toHaveLength(5);
      const got = bots.reduce((s, b) => s + botStrength(b.skill, valueScore(b.traits)), 0);
      expect(Math.abs(got - target) / target).toBeLessThan(0.05);
      for (const b of bots) {
        expect(b.name).toMatch(/^[A-Z][a-z]{2,9}$/);
        for (const v of [b.traits.accuracy!, b.traits.alertness!, b.traits.strafing!])
          expect(Math.abs(v)).toBeLessThanOrEqual(1);
      }
    }
    expect(leagueBots('club-x', 10).map((b) => b.name)).toEqual(
      leagueBots('club-x', 20).map((b) => b.name),
    );
  });

  it('AI club traits (decision 251): seeded, within the rules, growing with the band', () => {
    const pool = clubTraitPool(true);
    for (const code of pool) {
      const d = traitDef(code)!;
      expect(d.mod, code).toBeTruthy();
      expect(d.category).not.toBe('manager');
    }
    expect(pool).not.toContain('monster-bane');
    expect(pool).not.toContain('warden');
    expect(clubTraitPool(false).some((c) => traitDef(c)?.needsWeapon)).toBe(false);
    const three = clubTraits('club-x', 3, 0, 3, 5, ['Botpack.FlakCannon']);
    expect(three).toHaveLength(5);
    expect(clubTraits('club-x', 3, 0, 3, 5, ['Botpack.FlakCannon'])).toEqual(three);
    for (const b of three) {
      expect(b.codes).toHaveLength(3);
      expect(new Set(b.codes).size).toBe(3);
      const defs = b.codes.map((c) => traitDef(c)!);
      expect(defs.filter((d) => d.category === 'body').length).toBeLessThanOrEqual(1);
      expect(defs.filter((d) => d.rarity === 'legendary').length).toBeLessThanOrEqual(1);
      if (defs.some((d) => d.needsWeapon)) expect(b.weapon).toBe('Botpack.FlakCannon');
    }
    // More traits later in the season: the first ones stay.
    const four = clubTraits('club-x', 3, 0, 4);
    const noWeapon = clubTraits('club-x', 3, 0, 3);
    four.forEach((b, i) => expect(b.codes.slice(0, 3)).toEqual(noWeapon[i]!.codes));
    expect(clubTraits('club-x', 3, 3, 0).every((b) => b.codes.length === 0)).toBe(true);
    // Lower tiers draw rarer legendaries: none in the lowest tier.
    const low = Array.from({ length: 40 }, (_, i) => clubTraits(`c${i}`, 1, 3, 5)).flat();
    expect(low.flatMap((b) => b.codes).some((c) => traitDef(c)?.rarity === 'legendary')).toBe(
      false,
    );
  });

  it('league bots with traits keep the target strength (the traits count in the model)', () => {
    const traits = clubTraits('club-y', 3, 0, 4);
    for (const target of [10, 17, 25, 36]) {
      const bots = leagueBots('club-y', target, 5, traits);
      const got = bots.reduce(
        (s, b) => s + botStrength(b.skill, valueScore(b.traits), traitsEffect(b.udtTraits)),
        0,
      );
      expect(Math.abs(got - target) / target, String(target)).toBeLessThan(0.06);
      // The same bots without their traits are weaker.
      const plain = bots.reduce((s, b) => s + botStrength(b.skill, valueScore(b.traits)), 0);
      expect(plain).toBeLessThan(got);
    }
    // Four average traits: about one skill step (strength ×1.6, skill 5 → 6 is ×1.57).
    expect(botStrength(5, 0.5, 4 * 0.48) / botStrength(5, 0.5)).toBeCloseTo(1.62, 1);
  });

  it('AI clubs get prestige like the humans of their tier and keep the strength (decision 263)', () => {
    const p = clubPrestige('club-z', 3, 4);
    expect(p).toHaveLength(5);
    for (const a of p) {
      expect(prestigeSpent(a)).toBe(4);
      expect(Object.values(a).every((v) => v! >= 1 && v! <= 3)).toBe(true);
    }
    // Seeded: more points later in the season keep the earlier ones.
    const more = clubPrestige('club-z', 3, 6);
    for (const [i, a] of p.entries())
      for (const [k, v] of Object.entries(a))
        expect(more[i]![k as keyof typeof a]).toBeGreaterThanOrEqual(v!);
    expect(clubPrestige('club-z', 3, 0).every((a) => prestigeSpent(a) === 0)).toBe(true);
    const bots = leagueBots('club-z', 30, 5, [], p);
    const got = bots.reduce(
      (s, b) =>
        s + botStrength(b.skill, valueScore(b.traits), prestigeEffect(prestigeSpent(b.prestige))),
      0,
    );
    expect(Math.abs(got - 30) / 30).toBeLessThan(0.06);
    expect(bots.every((b) => prestigeSpent(b.prestige) === 4)).toBe(true);
  });

  it('the self-regulating band (decision 252): up above 70 %, down below 55 %, within 0.8-1.3', () => {
    const games = (won: number, n: number) => Array.from({ length: n }, (_, i) => i < won);
    expect(AUTO_BAND).toMatchObject({ min: 0.8, max: 1.3, step: 0.02, window: 20 });
    expect(autoBandStep(1, games(15, 20))).toEqual({ factor: 1.02, rate: 0.75, games: 20 });
    expect(autoBandStep(1, games(10, 20))).toEqual({ factor: 0.98, rate: 0.5, games: 20 });
    expect(autoBandStep(1, games(13, 20)).factor).toBe(1);
    // Only the last 20 games count: 20 old losses, then 20 wins.
    expect(autoBandStep(1, [...games(0, 20), ...games(20, 20)])).toMatchObject({
      factor: 1.02,
      rate: 1,
    });
    // Fewer than half a window: no move yet.
    expect(autoBandStep(1, games(9, 9))).toEqual({ factor: 1, rate: 1, games: 9 });
    expect(autoBandStep(1, [])).toEqual({ factor: 1, rate: null, games: 0 });
    expect(autoBandStep(1.3, games(20, 20)).factor).toBe(1.3);
    expect(autoBandStep(0.8, games(0, 20)).factor).toBe(0.8);
  });

  it('simulated games: the stronger club wins more, frags fit the result', () => {
    const rng = leagueRng(5);
    let wins = 0;
    let ot = 0;
    for (let i = 0; i < 2000; i++) {
      const r = simulateGame({ club: 'a', strength: 12 }, { club: 'b', strength: 10 }, rng);
      if (r.winner === 'a') wins++;
      if (r.overtime) ot++;
      const [w, l] = r.winner === 'a' ? [r.homeFrags, r.awayFrags] : [r.awayFrags, r.homeFrags];
      expect(w).toBeGreaterThan(l);
      if (!r.overtime) expect(w).toBe(50);
      else expect(w).toBe(l + 1);
    }
    // k = 4.5: 1.2^4.5 ≈ 2.27 → 69 %.
    expect(wins / 2000).toBeGreaterThan(0.64);
    expect(wins / 2000).toBeLessThan(0.74);
    expect(ot / 2000).toBeLessThan(0.05);
  });
});

describe('league money and length', () => {
  it('table money per band and tier', () => {
    expect(tableMoney(1, 0)).toBe(1680);
    expect(tableMoney(8, 1)).toBe(700);
    expect(tableMoney(16, 2)).toBeCloseTo(140);
  });

  it('16 clubs: 6 / 15 / 30 evenings short / medium / long', () => {
    expect([5, 2, 1].map((p) => eveningsOf(16, p))).toEqual([6, 15, 30]);
  });

  it('keepers: the strongest own bots', () => {
    const own = [
      { id: 'a', skill: 3, score: 0.5 },
      { id: 'b', skill: 5, score: 0.2 },
      { id: 'c', skill: 4, score: 0.9 },
    ];
    expect(pickKeepers(own, 2).map((b) => b.id)).toEqual(['b', 'c']);
  });
});
