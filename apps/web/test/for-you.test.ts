import { describe, expect, it } from 'vitest';
import { firstSteps, forYou } from '../src/app/core/for-you';
import { DICT } from '../src/app/core/i18n-dict';
import type { UdtHub } from '../src/app/core/types';

const NOW = '2026-12-05T12:00:00.000Z';
const inHours = (h: number) => new Date(Date.parse(NOW) + h * 3_600_000).toISOString();

function hub(over: Partial<UdtHub> = {}, team: Partial<NonNullable<UdtHub['team']>> = {}): UdtHub {
  return {
    season: 1,
    today: '2026-12-05',
    now: NOW,
    onboarding: null,
    team: {
      name: 'Nexus',
      tag: 'NX',
      bots: 7,
      lineup: 5,
      tired: 0,
      striking: 0,
      points: 0,
      prestige: 0,
      ...team,
    },
    league: { visible: true, running: true, next: null, place: 3, tier: 0 },
    packs: { legendaryIn: 20, traits: 1 },
    cups: { live: false, open: 0, entered: 0, next: null },
    transfers: { tradesIn: 0, marketAt: inHours(40) },
    ...over,
  };
}

const next = (h: number) => ({
  at: inHours(h),
  kind: 'league' as const,
  matchday: 8,
  opponent: 'Black Legion',
  home: true,
});

describe('For you on the hub (decision 311)', () => {
  it('has nothing without a team or with nothing to do', () => {
    expect(forYou(hub({ team: null }))).toEqual([]);
    expect(forYou(hub())).toEqual([]);
  });

  it('puts an incomplete lineup before a close league game first and keeps it', () => {
    const h = hub(
      { league: { visible: true, running: true, next: next(30), place: 3, tier: 0 } },
      { lineup: 1, points: 4 },
    );
    h.transfers.tradesIn = 2;
    const items = forYou(h);
    expect(items.map((i) => i.id)).toEqual(['lineup', 'trades', 'points']);
    expect(items[0]).toMatchObject({ urgent: true, sub: { key: 'udt.fd.lineupLeague' } });
  });

  it('is not urgent when the game is far, or for a cup the manager did not enter', () => {
    const far = hub(
      { league: { visible: true, running: true, next: next(80), place: 3, tier: 0 } },
      { lineup: 3 },
    );
    expect(forYou(far)[0]).toMatchObject({ id: 'lineup', urgent: false });
    const cup = hub(
      {
        cups: {
          live: false,
          open: 1,
          entered: 0,
          next: { id: 't1', name: 'Cup #5', at: inHours(5), entered: false },
        },
      },
      { lineup: 4 },
    );
    expect(forYou(cup).map((i) => [i.id, i.urgent])).toEqual([
      ['lineup', false],
      ['cup', false],
    ]);
  });

  it('shows the market day only within a day', () => {
    expect(forYou(hub({ transfers: { tradesIn: 0, marketAt: inHours(10) } }))[0]?.id).toBe(
      'market',
    );
  });

  it('has every text it uses', () => {
    const h = hub(
      {
        league: { visible: true, running: true, next: next(20), place: 3, tier: 0 },
        cups: {
          live: false,
          open: 1,
          entered: 0,
          next: { id: 't1', name: 'Cup', at: inHours(50), entered: false },
        },
        transfers: { tradesIn: 1, marketAt: inHours(3) },
      },
      { lineup: 2, points: 1, prestige: 2, striking: 1, tired: 2 },
    );
    const items = forYou(h);
    expect(items).toHaveLength(7);
    for (const lang of ['en', 'de'] as const)
      for (const i of items)
        for (const k of [i.title, i.action, i.sub?.key, `udt.area.${i.area}`])
          if (k) expect(DICT[lang][k], `${lang} ${k}`).toBeDefined();
  });
});

describe('First steps (decision 312)', () => {
  it('lists five steps for a new manager until all are done', () => {
    const fresh = hub({ team: null, onboarding: { cup: false, market: false, pack: false } });
    const s = firstSteps(fresh)!;
    expect(s.map((x) => [x.id, x.done])).toEqual([
      ['team', false],
      ['lineup', false],
      ['cup', false],
      ['market', false],
      ['pack', false],
    ]);
    for (const lang of ['en', 'de'] as const)
      for (const x of s) {
        expect(DICT[lang][`udt.fs.step.${x.id}`]).toBeDefined();
        expect(DICT[lang][`udt.fs.text.${x.id}`]).toBeDefined();
      }
    expect(
      firstSteps(hub({ onboarding: { cup: true, market: true, pack: false } }))!.filter(
        (x) => !x.done,
      ),
    ).toHaveLength(1);
    expect(firstSteps(hub({ onboarding: { cup: true, market: true, pack: true } }))).toBeNull();
    // Managers of earlier seasons: none.
    expect(firstSteps(hub())).toBeNull();
  });
});
