import { describe, expect, it } from 'vitest';
import { feedSec, meters, momentumBars, sideSum, split, withKills } from '../src/app/core/live';
import type { KillFeedEntry, LivePlayer } from '../src/app/core/types';

const kill = (sec: number, over: Partial<KillFeedEntry> = {}): KillFeedEntry => ({
  tournamentId: 't',
  matchId: 'm',
  game: 1,
  at: sec * 1000,
  sec,
  kind: 'kill',
  killer: 'A',
  killerSide: 'ea',
  victim: 'B',
  victimSide: 'eb',
  weapon: 'x',
  headshot: false,
  firstBlood: false,
  suicide: false,
  teamKill: false,
  monster: false,
  spree: 0,
  multi: 0,
  ...over,
});

const player = (side: string, over: Partial<LivePlayer> = {}): LivePlayer => ({
  name: 'P',
  side,
  bot: false,
  alive: true,
  health: 100,
  armor: 0,
  weapon: '',
  powerups: 0,
  ampSec: 0,
  kills: 0,
  deaths: 0,
  suicides: 0,
  damageDealt: 100,
  damageTaken: 0,
  items: { amp: 1, belt: 0, armor: 0, keg: 2 },
  ...over,
});

describe('live helpers', () => {
  it('adds the kills after the last sample to the frag timeline', () => {
    const out = withKills(
      [[10, 1, 0]],
      [
        kill(5), // before the sample: already counted
        kill(20),
        kill(25, { killerSide: 'eb' }),
        kill(30, { suicide: true, killerSide: null, victimSide: 'ea' }),
        kill(31, { kind: 'item' }),
        kill(35, { killerSide: null }), // a monster: no side
      ],
      'ea',
      'eb',
    );
    expect(out).toEqual([
      [10, 1, 0],
      [20, 2, 0],
      [25, 2, 1],
      [30, 1, 1],
    ]);
  });

  it('draws the frag difference as bars up for side a and down for side b', () => {
    const bars = momentumBars(
      [
        [0, 0, 0],
        [20, 3, 0],
        [40, 3, 5],
      ],
      60,
      15,
    );
    expect(bars.map((b) => b.side)).toEqual(['even', 'a', 'b']);
    expect(bars[1]!.y + bars[1]!.h).toBe(75);
    expect(bars[2]!.y).toBe(75);
  });

  it('sums a side and splits bars', () => {
    const s = sideSum([player('ea'), player('ea', { alive: false }), player('eb')], 'ea');
    expect(s).toMatchObject({ damage: 200, alive: 1, count: 2, items: { amp: 2, keg: 4 } });
    expect(split(1, 3)).toEqual([25, 75]);
    expect(split(0, 0)).toEqual([0, 0]);
    expect(meters(525)).toBe(10);
    expect(feedSec({ at: 5000 }, 1000)).toBe(4);
    expect(feedSec({ at: 5000, sec: 70 }, 1000)).toBe(70);
  });
});
