import { describe, expect, it } from 'vitest';
import type { PlayerGameStats } from '@tourney/protocol';
import type { PlayerGameFact, TournamentFacts } from '../src/stats/facts.js';
import { traitReport } from '../src/stats/trait-report.js';

const stats = (over: Partial<PlayerGameStats>): PlayerGameStats => ({
  name: 'x',
  kills: 0,
  deaths: 0,
  suicides: 0,
  teamKills: 0,
  headshots: 0,
  firstBlood: false,
  bestSpree: 0,
  sprees: 0,
  multi2: 0,
  multi3: 0,
  multi4: 0,
  multi5: 0,
  timeSec: 600,
  monsters: 0,
  monsterPoints: 0,
  weapons: {},
  ...over,
});

const player = (name: string, won: boolean, s: Partial<PlayerGameStats>): PlayerGameFact => ({
  key: `b:${name.toLowerCase()}`,
  name,
  bot: true,
  matchId: 'm1',
  game: 1,
  run: 0,
  entrantId: won ? 'ea' : 'eb',
  won,
  map: 'DM-Deck16][',
  at: '2026-10-31T18:00:00.000Z',
  stats: stats({ name, ...s }),
});

describe('trait report (decision 237)', () => {
  it('rows per bot, game and trait; a summary per trait with the baseline', () => {
    const t: TournamentFacts = {
      tournamentId: 't1',
      name: 'Liga',
      mode: 'tdm',
      at: '2026-10-31T18:00:00.000Z',
      finished: true,
      entrantNames: {},
      games: [],
      runs: [],
      matches: [],
      participants: [],
      players: [
        player('Mira', true, {
          kills: 12,
          deaths: 4,
          traits: [
            {
              code: 'aa',
              uses: 3,
              sec: 21,
              kills: 2,
              deaths: 1,
              value: 0,
              value2: 0,
              episodes: [
                { at: 40, sec: 8, kills: 1, died: false },
                { at: 200, sec: 5, kills: 0, died: true },
                { at: 400, sec: 8, kills: 1, died: false },
              ],
            },
            { code: 'wd', uses: 0, sec: 600, kills: 0, deaths: 0, value: 0, value2: 0 },
          ],
        }),
        player('Rex', false, {
          kills: 5,
          deaths: 9,
          traits: [{ code: 'vp', uses: 14, sec: 0, kills: 0, deaths: 0, value: 63, value2: 0 }],
        }),
        // Without a trait log (older mod, or no traits): not in the report.
        player('Old', true, { kills: 7, deaths: 7 }),
      ],
    };
    const r = traitReport([t]);
    expect(r.games).toBe(2);
    expect(r.baseline).toEqual({ games: 2, won: 1, kills: 17, deaths: 13 });
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({
      bot: 'Mira',
      trait: 'vulture',
      rarity: 'uncommon',
      kind: 'episode',
      episodes: 3,
      episodesDied: 1,
      episodesKill: 2,
      episodesQuiet: 0,
      botKills: 12,
      won: true,
    });
    expect(r.rows[1]).toMatchObject({ trait: 'watchdog', rarity: 'epic', kind: 'passive' });
    expect(r.summary.find((s) => s.trait === 'vampire')).toMatchObject({
      kind: 'counter',
      games: 1,
      bots: 1,
      uses: 14,
      value: 63,
      won: 0,
    });
  });
});
