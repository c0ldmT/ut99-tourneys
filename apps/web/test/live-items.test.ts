import { describe, expect, it } from 'vitest';
import { challengeLabel, eveningItem } from '../src/app/core/live-items';
import type { ChallengeTag } from '../src/app/core/types';

const t = (k: string, p?: Record<string, string | number>) => (p ? `${k}${JSON.stringify(p)}` : k);

const tag = (over: Partial<ChallengeTag> = {}): ChallengeTag => ({
  id: 'c1',
  season: 1,
  day: '2026-11-27',
  at: '2026-11-27T18:30:00.000Z',
  mode: 'dm',
  teamSize: 3,
  bestOf: 3,
  hardness: null,
  map: null,
  stake: 500,
  pot: 1000,
  prize: 950,
  home: 'Nexus',
  away: 'Iron',
  mine: false,
  main: false,
  ...over,
});

describe('evening rows (decision 340)', () => {
  it('names a challenge by main fight, showcase or format', () => {
    expect(challengeLabel(tag(), t)).toBe('3v3 · Bo3');
    expect(challengeLabel(tag({ mode: 'mh' }), t)).toBe('udt.ch.showcase');
    expect(challengeLabel(tag({ mode: 'mh', main: true }), t)).toBe('udt.ch.ev.main');
  });

  it('makes a row of a challenge or a league game', () => {
    const ch = eveningItem({ id: 't1', phase: 'checkIn', challenge: tag({ mine: true }) }, t);
    expect(ch).toMatchObject({
      key: 't1',
      label: '3v3 · Bo3',
      names: ['Nexus', 'Iron'],
      status: 'phase.checkIn',
      link: ['/t', 't1'],
      mine: true,
    });
    const lg = eveningItem(
      {
        id: 't2',
        phase: 'checkIn',
        league: { kind: 'league', matchday: 4, home: 'A', away: 'B', mine: false },
      },
      t,
    );
    expect(lg).toMatchObject({ label: 'league.matchday{"n":4}', names: ['A', 'B'] });
  });
});
