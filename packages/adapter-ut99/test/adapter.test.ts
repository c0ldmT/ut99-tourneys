import { createRng } from '@tourney/bracket';
import { ServerProfileSchema } from '@tourney/protocol';
import { describe, expect, it } from 'vitest';
import {
  iniChanges,
  loserPickMap,
  parseRules,
  randomMap,
  resolveMapVote,
  serverArgs,
  serverBinaryCandidates,
  simulateSeries,
  validateAgainstInventory,
  winChance,
  type MapVoteInput,
} from '../src/index.js';

const pool = ['DM-Deck16][', 'DM-Morpheus', 'DM-Phobos', 'DM-Codex', 'DM-Pressure', 'DM-Curse]['];

const vote = (over: Partial<MapVoteInput> = {}): MapVoteInput => ({
  pool,
  entrants: ['a', 'b'],
  ballots: [],
  history: [],
  picksPerPlayer: 3,
  avoidRecentMaps: 3,
  rng: createRng(1),
  ...over,
});

describe('rules', () => {
  it('applies the agreed defaults', () => {
    const r = parseRules({ mapPool: pool });
    expect(r).toMatchObject({
      fragLimit: 20,
      timeLimitMin: 10,
      suddenDeath: true,
      mapMode: 'vote',
      countdownSec: 5,
      voteTimeoutSec: 30,
    });
  });

  it('rejects unusable rules', () => {
    expect(() => parseRules({ mapPool: [] })).toThrow();
    expect(() => parseRules({ mapPool: pool, fragLimit: 0, timeLimitMin: 0 })).toThrow(/both be 0/);
    expect(() => parseRules({ mapPool: pool, mutators: ['not a class'] })).toThrow();
  });

  it('finds maps missing on the server, case-insensitively', () => {
    const r = parseRules({ mapPool: ['DM-Deck16][', 'DM-Missing'] });
    expect(validateAgainstInventory(r, { maps: [{ id: 'dm-deck16][' }] })).toEqual([
      'map DM-Missing is not installed on the server',
    ]);
  });
});

describe('map vote', () => {
  it('a common pick beats one player’s favourite', () => {
    const out = resolveMapVote(
      vote({
        ballots: [
          { entrantId: 'a', picks: ['DM-Phobos', 'DM-Codex'] },
          { entrantId: 'b', picks: ['DM-Morpheus', 'DM-Codex'] },
        ],
      }),
    );
    // Codex: 2 + 2 + 3 bonus = 7, Phobos 3, Morpheus 3
    expect(out.map).toBe('DM-Codex');
    expect(out.tiedFor).toEqual(['DM-Codex']);
    expect(out.scores[0]).toMatchObject({
      map: 'DM-Codex',
      votePoints: 4,
      mutualBonus: 3,
      total: 7,
    });
  });

  it('no overlap: tie between the two favourites is decided reproducibly', () => {
    const input = {
      ballots: [
        { entrantId: 'a', picks: ['DM-Phobos'] },
        { entrantId: 'b', picks: ['DM-Morpheus'] },
      ],
    };
    const r1 = resolveMapVote(vote({ ...input, rng: createRng('s') }));
    const r2 = resolveMapVote(vote({ ...input, rng: createRng('s') }));
    expect(r1.tiedFor.sort()).toEqual(['DM-Morpheus', 'DM-Phobos']);
    expect(r1.map).toBe(r2.map);
  });

  it('recently played maps are penalised', () => {
    const out = resolveMapVote(
      vote({
        ballots: [
          { entrantId: 'a', picks: ['DM-Codex', 'DM-Phobos'] },
          { entrantId: 'b', picks: ['DM-Codex', 'DM-Phobos'] },
        ],
        history: [
          { map: 'DM-Codex', entrants: ['x', 'y'] },
          { map: 'DM-Codex', entrants: ['a', 'z'] },
        ],
      }),
    );
    // Codex: 6 + 3 - 4 (recent twice) - 1 (a played it) = 4; Phobos: 4 + 3 = 7
    expect(out.map).toBe('DM-Phobos');
  });

  it('players without a ballot and bots vote randomly; garbage picks are ignored', () => {
    const out = resolveMapVote(
      vote({ ballots: [{ entrantId: 'a', picks: ['dm-phobos', 'DM-Unknown', 'DM-Phobos'] }] }),
    );
    expect(out.ballots[0]).toEqual({ entrantId: 'a', picks: ['DM-Phobos'], random: false });
    expect(out.ballots[1]?.random).toBe(true);
    expect(out.ballots[1]?.picks).toHaveLength(3);
    expect(pool).toContain(out.map);
  });

  it('only voted maps can win', () => {
    for (let seed = 0; seed < 50; seed++) {
      const out = resolveMapVote(vote({ rng: createRng(seed) }));
      const voted = new Set(out.ballots.flatMap((b) => b.picks));
      expect(voted.has(out.map)).toBe(true);
    }
  });

  it('random mode avoids recent and already played maps when possible', () => {
    const history = pool.slice(0, 4).map((map) => ({ map, entrants: ['x', 'y'] as const }));
    for (let seed = 0; seed < 30; seed++) {
      const m = randomMap({ ...vote({ rng: createRng(seed) }), history, avoidRecentMaps: 3 });
      expect(['DM-Deck16][', 'DM-Pressure', 'DM-Curse][']).toContain(m);
    }
  });

  it('loser picks the next map in a series', () => {
    expect(
      loserPickMap({
        pool,
        loserPicks: ['DM-Codex', 'DM-Phobos'],
        playedInSeries: ['DM-Codex'],
        rng: createRng(1),
      }),
    ).toEqual({ map: 'DM-Phobos', random: false });
    expect(
      loserPickMap({ pool, loserPicks: [], playedInSeries: [], rng: createRng(1) }).random,
    ).toBe(true);
  });
});

describe('bot simulation', () => {
  it('weights by skill', () => {
    expect(winChance(3, 3)).toBe(0.5);
    expect(winChance(7, 0)).toBeGreaterThan(0.98);
  });

  it('produces a valid best-of series', () => {
    for (let seed = 0; seed < 20; seed++) {
      const s = simulateSeries({ skills: [4, 5], bestOf: 3, fragLimit: 20, rng: createRng(seed) });
      const wins = s.games.filter((g) => g.winner === s.winner).length;
      expect(wins).toBe(2);
      expect(s.games.length).toBeLessThanOrEqual(3);
      for (const g of s.games) {
        expect(g.scores[g.winner]).toBe(20);
        expect(g.scores[1 - g.winner]).toBeLessThan(20);
      }
    }
  });
});

describe('server launch', () => {
  const profile = ServerProfileSchema.parse({
    id: 'p1',
    name: 'Pi',
    os: 'linux',
    installDir: '/opt/ut99',
    lobbyMap: 'DM-Deck16][',
    serverName: 'Tourney',
  });
  const rules = parseRules({ mapPool: pool, mutators: ['BotPack.InstaGibDM'] });

  it('builds the command line', () => {
    expect(serverArgs(rules, profile)).toEqual([
      'server',
      'DM-Deck16][?game=UTTourney_v1.TournamentDM?mutator=BotPack.InstaGibDM?MaxSpectators=32',
      'port=7777',
      'ini=Tourney.ini',
      'userini=TourneyUser.ini',
      'log=Tourney.log',
    ]);
  });

  it('prefers 469f binary names and has fallbacks per OS/arch', () => {
    expect(serverBinaryCandidates('linux', 'arm64')[0]).toBe('System/ucc-bin-arm64');
    expect(serverBinaryCandidates('windows', 'x64')).toContain('System/UCC.exe');
  });

  it('registers the mod package and the bridge connection in the ini', () => {
    const changes = iniChanges(rules, profile, {
      bridgeHost: '127.0.0.1',
      bridgePort: 7790,
      sharedKey: 'secret',
    });
    expect(changes).toContainEqual({
      section: 'Engine.GameEngine',
      key: 'ServerPackages',
      ensure: 'UTTourney_v1',
    });
    expect(changes).toContainEqual({
      section: 'UTTourney_v1.TournamentConfig',
      key: 'SharedKey',
      value: 'secret',
    });
  });
});
