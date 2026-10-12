import { createRng } from '@tourney/bracket';
import { ServerProfileSchema } from '@tourney/protocol';
import { describe, expect, it } from 'vitest';
import {
  defaultLimits,
  teamBallot,
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
      mapMode: 'vote',
      countdownSec: 5,
      voteTimeoutSec: 45,
      friendlyFirePct: 0,
    });
  });

  it('suggests team limits by team size', () => {
    expect(defaultLimits(1)).toEqual({ fragLimit: 20, timeLimitMin: 10 });
    expect(defaultLimits(2)).toEqual({ fragLimit: 30, timeLimitMin: 15 });
    expect(defaultLimits(5)).toEqual({ fragLimit: 60, timeLimitMin: 15 });
    expect(() => parseRules({ mapPool: pool, friendlyFirePct: 30 })).toThrow();
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

describe('team ballots', () => {
  it('adds up Borda points per team and keeps the first-named order on ties', () => {
    const b = teamBallot(
      [
        ['DM-Phobos', 'DM-Codex', 'DM-Deck16]['],
        ['DM-Codex', 'dm-phobos'],
        ['DM-Morpheus', 'DM-Nowhere'],
      ],
      pool,
      3,
    );
    // Phobos 3+2, Codex 2+3, Morpheus 3, Deck 1: Phobos and Codex tie, Phobos was named first.
    expect(b).toEqual(['DM-Phobos', 'DM-Codex', 'DM-Morpheus']);
    expect(teamBallot([], pool, 3)).toEqual([]);
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

  it('runs the team game class with room for both teams', () => {
    expect(serverArgs(rules, profile, 3)[1]).toBe(
      'DM-Deck16][?game=UTTourney_v1.TournamentTDM?mutator=BotPack.InstaGibDM?MaxSpectators=32',
    );
    const mod = { bridgeHost: '127.0.0.1', bridgePort: 7790, sharedKey: 'secret' };
    expect(iniChanges(rules, profile, mod, 5)).toContainEqual({
      section: 'UTTourney_v1.TournamentTDM',
      key: 'MaxPlayers',
      value: '12',
    });
    expect(iniChanges(rules, profile, mod)).toContainEqual({
      section: 'UTTourney_v1.TournamentDM',
      key: 'MaxPlayers',
      value: '4',
    });
  });

  it('prefers 469f binary names and has fallbacks per OS/arch', () => {
    expect(serverBinaryCandidates('linux', 'arm64')[0]).toBe('System/ucc-bin-arm64');
    expect(serverBinaryCandidates('windows', 'x64')).toContain('System/UCC.exe');
  });

  it('loads SmartStockBots as a server actor only when enabled, and checks it is installed', () => {
    const mod = { bridgeHost: '127.0.0.1', bridgePort: 7790, sharedKey: 'secret' };
    const actor = 'SmartStockBots.SmartStockBots';
    const on = parseRules({ ...rules, smartStockBots: true });
    expect(iniChanges(on, profile, mod)).toContainEqual({
      section: 'Engine.GameEngine',
      key: 'ServerActors',
      ensure: actor,
    });
    expect(iniChanges(rules, profile, mod)).toContainEqual({
      section: 'Engine.GameEngine',
      key: 'ServerActors',
      remove: actor,
    });
    const maps = on.mapPool.map((id) => ({ id }));
    expect(validateAgainstInventory(on, { maps, packages: ['Botpack'] })).toEqual([
      'SmartStockBots.u is not installed on the server (System folder)',
    ]);
    expect(validateAgainstInventory(on, { maps, packages: ['SmartStockBots'] })).toEqual([]);
    expect(validateAgainstInventory(on, { maps })).toEqual([]); // unknown: no complaint
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
      section: 'UTTourney_v1.TournamentDM',
      key: 'bMultiWeaponStay',
      value: 'True',
    });
    expect(changes).toContainEqual({
      section: 'UTTourney_v1.TournamentConfig',
      key: 'SharedKey',
      value: 'secret',
    });
  });
});
