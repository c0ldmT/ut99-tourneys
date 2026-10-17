import { createRng } from '@tourney/bracket';
import { ServerProfileSchema } from '@tourney/protocol';
import { describe, expect, it } from 'vitest';
import {
  defaultLimits,
  firstRunner,
  formatRaceTime,
  gameProblems,
  raceWinner,
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
  it('ignores the former botWaypointFix option (bot AI enhancements are always on)', () => {
    const r = parseRules({ mapPool: ['MH-NaliVillage'], botWaypointFix: false });
    expect('botWaypointFix' in r).toBe(false);
  });

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
    expect(serverArgs(rules, profile, 'tdm')[1]).toBe(
      'DM-Deck16][?game=UTTourney_v1.TournamentTDM?mutator=BotPack.InstaGibDM?MaxSpectators=32',
    );
    const mod = { bridgeHost: '127.0.0.1', bridgePort: 7790, sharedKey: 'secret' };
    expect(iniChanges(rules, profile, mod, 'tdm', 5)).toContainEqual({
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

describe('Monster Hunt race', () => {
  const run = (entrantId: string, over: Partial<Parameters<typeof raceWinner>[0]> = {}) => ({
    entrantId,
    timeMs: 300_000,
    deaths: 0,
    penaltyMs: 0,
    points: 50,
    finished: true,
    ...over,
  });

  it('decides by final time, finish, points, deaths and lot', () => {
    const rng = createRng(1);
    // 5:00 + 3 deaths x 5 s = 5:15 loses against 5:10.
    expect(raceWinner(run('a', { penaltyMs: 15_000 }), run('b', { timeMs: 310_000 }), rng)).toEqual(
      { winnerId: 'b', decidedBy: 'time' },
    );
    expect(raceWinner(run('a', { finished: false }), run('b', { timeMs: 1_000_000 }), rng)).toEqual(
      {
        winnerId: 'b',
        decidedBy: 'finish',
      },
    );
    expect(
      raceWinner(run('a', { finished: false, points: 80 }), run('b', { finished: false }), rng),
    ).toEqual({ winnerId: 'a', decidedBy: 'points' });
    // Same final time: points, then deaths.
    expect(raceWinner(run('a'), run('b', { deaths: 1 }), rng).decidedBy).toBe('deaths');
    expect(raceWinner(run('a'), run('b'), rng).decidedBy).toBe('lot');
  });

  it('compares the final time to the millisecond, penalty included', () => {
    const rng = createRng(1);
    // Real case (MH-Revenge][): 4:47.6 + 30 x 5 s = 7:17.6 loses against 4:52.3 + 29 x 5 s = 7:17.3,
    // although the raw time and the monster points (16 vs 6) are better.
    const a = run('a', { timeMs: 287_600, deaths: 30, penaltyMs: 150_000, points: 16 });
    const b = run('b', { timeMs: 292_300, deaths: 29, penaltyMs: 145_000, points: 6 });
    expect(raceWinner(a, b, rng)).toEqual({ winnerId: 'b', decidedBy: 'time' });
    expect(raceWinner(b, a, rng)).toEqual({ winnerId: 'b', decidedBy: 'time' });
    // One millisecond is enough.
    expect(raceWinner(run('a', { timeMs: 300_001 }), run('b'), rng)).toEqual({
      winnerId: 'b',
      decidedBy: 'time',
    });
  });

  it('alternates the start after game 1', () => {
    expect(firstRunner(['a', 'b'], ['a', 'b'], createRng(1))).toBe('b');
    expect(['a', 'b']).toContain(firstRunner(['a', 'b'], undefined, createRng(1)));
    expect(formatRaceTime(247_345)).toBe('4:07.3');
  });

  it('checks Monster Hunt settings', () => {
    const rules = { mapPool: ['MH-NaliVillage'], timeLimitMin: 20 };
    expect(gameProblems({ teamSize: 2, game: { adapter: 'ut99-mh', rules } })).toEqual([]);
    expect(gameProblems({ teamSize: 1, game: { adapter: 'ut99-mh', rules } })).toHaveLength(1);
    expect(gameProblems({ teamSize: 2, game: { adapter: 'ut99-xx', rules } })).toHaveLength(1);
    expect(
      validateAgainstInventory(
        parseRules(rules),
        { maps: [{ id: 'MH-NaliVillage' }], packages: ['MonsterHunt'] },
        'mh',
      ),
    ).toEqual(['UTTourneyMH_v1.u is not installed on the server (System folder)']);
  });

  it('starts the Monster Hunt game class with its settings', () => {
    const profile = ServerProfileSchema.parse({
      id: 'p',
      name: 'P',
      os: 'linux',
      installDir: '/opt/ut99',
      lobbyMap: 'DM-Deck16][',
    });
    const rules = parseRules({ mapPool: ['MH-NaliVillage'], timeLimitMin: 20, monsterSkill: 3 });
    expect(serverArgs(rules, profile, 'mh')[1]).toContain('?game=UTTourneyMH_v1.TournamentMH');
    const ini = iniChanges(
      rules,
      profile,
      { bridgeHost: 'h', bridgePort: 1, sharedKey: 'k' },
      'mh',
      2,
    );
    // MonsterHunt reads its config from MonsterHunt.ini: lives and monster skill go to the mod
    // with the race line instead of into Tourney.ini.
    expect(ini.some((c) => c.section === 'UTTourneyMH_v1.TournamentMH')).toBe(false);
    expect(ini).toContainEqual({
      section: 'Engine.GameEngine',
      key: 'ServerPackages',
      ensure: 'MonsterHunt',
    });
  });
});

describe('downloads', () => {
  const mod = { bridgeHost: 'h', bridgePort: 1, sharedKey: 'k' };
  const rules = parseRules({ mapPool: ['DM-Deck16]['] });
  const base = {
    id: 'p',
    name: 'P',
    os: 'linux',
    installDir: '/opt/ut99',
    lobbyMap: 'DM-Deck16][',
  };
  it('lets clients download missing maps and packages, HTTP redirect first', () => {
    const ini = iniChanges(rules, ServerProfileSchema.parse(base), mod);
    const net = ini.filter((c) => c.section === 'IpDrv.TcpNetDriver');
    expect(net).toContainEqual({
      section: 'IpDrv.TcpNetDriver',
      key: 'AllowDownloads',
      value: 'True',
    });
    const ensured = net.flatMap((c) =>
      'ensure' in c && c.key === 'DownloadManagers' ? [c.ensure] : [],
    );
    expect(ensured).toEqual(['IpDrv.HTTPDownload', 'Engine.ChannelDownload']);
    expect(ini.some((c) => c.section === 'IpDrv.HTTPDownload')).toBe(false);
    const withRedirect = iniChanges(
      rules,
      ServerProfileSchema.parse({
        ...base,
        downloadRedirect: 'https://files.example.com/ut/',
        maxClientRate: 100000,
      }),
      mod,
    );
    expect(withRedirect).toContainEqual({
      section: 'IpDrv.HTTPDownload',
      key: 'RedirectToURL',
      value: 'https://files.example.com/ut/',
    });
    expect(withRedirect).toContainEqual({
      section: 'IpDrv.TcpNetDriver',
      key: 'MaxClientRate',
      value: '100000',
    });
  });

  it('sets tick rate and client rate from the bridge settings (469f defaults)', () => {
    const value = (ini: ReturnType<typeof iniChanges>, key: string) =>
      ini.find((c) => c.section === 'IpDrv.TcpNetDriver' && c.key === key && 'value' in c);
    const defaults = iniChanges(rules, ServerProfileSchema.parse(base), mod);
    expect(value(defaults, 'NetServerMaxTickRate')).toMatchObject({ value: '50' });
    expect(value(defaults, 'LanServerMaxTickRate')).toMatchObject({ value: '50' });
    expect(value(defaults, 'MaxClientRate')).toMatchObject({ value: '20000' });
    const custom = iniChanges(
      rules,
      ServerProfileSchema.parse({ ...base, tickRate: 65, maxClientRate: 40000 }),
      mod,
    );
    expect(value(custom, 'NetServerMaxTickRate')).toMatchObject({ value: '65' });
    expect(value(custom, 'LanServerMaxTickRate')).toMatchObject({ value: '65' });
    expect(value(custom, 'MaxClientRate')).toMatchObject({ value: '40000' });
    expect(() => ServerProfileSchema.parse({ ...base, tickRate: 500 })).toThrow();
  });
});
