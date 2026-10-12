import { describe, expect, it } from 'vitest';
import {
  projectTournament,
  ProjectionError,
  TournamentEventSchema,
  TournamentSettingsSchema,
  type Entrant,
  type NewTournamentEvent,
  type TournamentEvent,
  entrantUserIds,
  settingsProblems,
  teamStarters,
} from '../src/index.js';

const settings = TournamentSettingsSchema.parse({
  format: 'single',
  size: 8,
  game: { adapter: 'ut99-dm', rules: {} },
});

const entrants: Entrant[] = Array.from({ length: 8 }, (_, i) =>
  i < 5
    ? { id: `e${i + 1}`, kind: 'human', displayName: `Player${i + 1}`, userId: `u${i + 1}` }
    : {
        id: `e${i + 1}`,
        kind: 'bot',
        displayName: `Bot${i + 1}`,
        bot: { name: `Bot${i + 1}`, skill: 3 },
      },
);

function log(...events: NewTournamentEvent[]): TournamentEvent[] {
  return events.map((e, i) =>
    TournamentEventSchema.parse({ ...e, seq: i + 1, at: new Date(0).toISOString() }),
  );
}

const sys = { kind: 'system' } as const;
const bridge = { kind: 'bridge', id: 'agent1' } as const;

const base: NewTournamentEvent[] = [
  { type: 'tournament.created', actor: sys, data: { tournamentId: 't1', name: 'Cup', settings } },
  {
    type: 'seeding.set',
    actor: { kind: 'admin', id: 'u1' },
    data: {
      entrants,
      rngSeed: 'abc',
      bracket: {
        format: 'single',
        size: 8,
        slots: entrants.map((e) => e.id),
        grandFinalReset: true,
        bestOf: { default: 1 },
      },
    },
  },
  { type: 'checkin.opened', actor: bridge, data: { serverProfileId: 'p1' } },
];

describe('projection', () => {
  it('applies settings defaults', () => {
    expect(settings).toMatchObject({
      grandFinalReset: true,
      bestOf: { default: 1 },
      noShowSec: 180,
      checkInWindowMin: 10,
      botMatchMode: 'watch',
    });
  });

  it('walks through check-in, replacement and a match', () => {
    const p = projectTournament(
      log(
        ...base,
        { type: 'entrant.checkedIn', actor: bridge, data: { entrantId: 'e1' } },
        {
          type: 'entrant.replaced',
          actor: bridge,
          data: {
            entrantId: 'e2',
            reason: 'noShowCheckIn',
            replacement: {
              id: 'e2',
              kind: 'bot',
              displayName: 'Xan',
              bot: { name: 'Xan', skill: 5 },
            },
          },
        },
        { type: 'tournament.started', actor: bridge, data: {} },
        { type: 'match.called', actor: bridge, data: { matchId: 'W1-1', entrants: ['e1', 'e2'] } },
        {
          type: 'match.mapSelected',
          actor: bridge,
          data: { matchId: 'W1-1', game: 1, map: 'DM-Deck16][', method: 'vote' },
        },
        { type: 'match.started', actor: bridge, data: { matchId: 'W1-1', game: 1 } },
      ),
    );
    expect(p.phase).toBe('running');
    expect(p.entrants['e2']?.kind).toBe('bot');
    expect(p.checkedIn).toEqual(['e1']);
    expect(p.currentMatch).toMatchObject({ matchId: 'W1-1', status: 'live', map: 'DM-Deck16][' });
    expect(p.bracket?.byId['W1-1']?.status).toBe('ready');
  });

  it('records games, map history and results', () => {
    const p = projectTournament(
      log(
        ...base,
        { type: 'tournament.started', actor: bridge, data: {} },
        { type: 'match.called', actor: bridge, data: { matchId: 'W1-1', entrants: ['e1', 'e2'] } },
        { type: 'match.started', actor: bridge, data: { matchId: 'W1-1', game: 1 } },
        {
          type: 'match.gameFinished',
          actor: bridge,
          data: {
            matchId: 'W1-1',
            game: 1,
            map: 'DM-Morpheus',
            scores: { e1: 20, e2: 13 },
            winnerId: 'e1',
            endReason: 'fragLimit',
          },
        },
        {
          type: 'match.result',
          actor: bridge,
          data: {
            result: { matchId: 'W1-1', entrants: ['e1', 'e2'], winnerId: 'e1', outcome: 'played' },
          },
        },
      ),
    );
    expect(p.currentMatch).toBeUndefined();
    expect(p.games['W1-1']).toHaveLength(1);
    expect(p.mapHistory).toEqual([{ matchId: 'W1-1', map: 'DM-Morpheus', entrants: ['e1', 'e2'] }]);
    expect(p.bracket?.byId['W1-1']?.winnerId).toBe('e1');
  });

  it('pause returns to the previous phase', () => {
    const p = projectTournament(
      log(...base, {
        type: 'tournament.paused',
        actor: { kind: 'admin' },
        data: { reason: 'server move' },
      }),
    );
    expect(p.phase).toBe('paused');
    expect(p.pausedReason).toBe('server move');
    const q = projectTournament(
      log(
        ...base,
        { type: 'tournament.paused', actor: sys, data: { reason: 'x' } },
        {
          type: 'tournament.resumed',
          actor: sys,
          data: {},
        },
      ),
    );
    expect(q.phase).toBe('checkIn');
  });

  it('rejects gaps, bad order and impossible transitions', () => {
    const events = log(...base);
    expect(() => projectTournament([events[0]!, events[2]!])).toThrow(/expected seq 2/);
    expect(() => projectTournament(events.slice(1))).toThrow(ProjectionError);
    expect(() =>
      projectTournament(
        log(...base, {
          type: 'match.called',
          actor: bridge,
          data: { matchId: 'W1-1', entrants: ['e1', 'e2'] },
        }),
      ),
    ).toThrow(/phase checkIn/);
  });
});

describe('team tournaments', () => {
  const teamSettings = TournamentSettingsSchema.parse({
    format: 'single',
    size: 4,
    teamSize: 2,
    game: { adapter: 'ut99-dm', rules: {} },
  });
  const team = (n: number, members: string[]): Entrant => ({
    id: `t${n}`,
    kind: 'team',
    displayName: `Team ${n}`,
    captainUserId: members[0],
    members: members.map((u, i) => ({ userId: u, displayName: u.toUpperCase(), sub: i >= 2 })),
    bots: members.length < 2 ? [{ name: `Fill${n}`, skill: 3 }] : [],
  });
  const teams = [team(1, ['a', 'b', 'c']), team(2, ['d', 'e']), team(3, ['f']), team(4, [])];
  const teamBase: NewTournamentEvent[] = [
    {
      type: 'tournament.created',
      actor: sys,
      data: { tournamentId: 't1', name: 'Cup', settings: teamSettings },
    },
    {
      type: 'seeding.set',
      actor: { kind: 'admin', id: 'a' },
      data: {
        entrants: teams,
        rngSeed: 'x',
        bracket: {
          format: 'single',
          size: 4,
          slots: teams.map((t) => t.id),
          grandFinalReset: true,
          bestOf: { default: 1 },
        },
      },
    },
    { type: 'checkin.opened', actor: bridge, data: { serverProfileId: 'p1' } },
  ];

  it('accepts team settings and the bracket of 4', () => {
    expect(teamSettings.teamSize).toBe(2);
    expect(settingsProblems(teamSettings)).toEqual([]);
    expect(settingsProblems({ ...teamSettings, size: 32 })).toHaveLength(1);
    expect(settings.teamSize).toBe(1);
  });

  it('tracks member check-ins and lineup changes', () => {
    const p = projectTournament(
      log(
        ...teamBase,
        { type: 'entrant.checkedIn', actor: bridge, data: { entrantId: 't1', userId: 'c' } },
        { type: 'entrant.checkedIn', actor: bridge, data: { entrantId: 't1', userId: 'a' } },
        {
          type: 'team.lineupSet',
          actor: { kind: 'player', id: 'a' },
          data: { entrantId: 't1', starters: ['c', 'a'] },
        },
      ),
    );
    expect(p.checkedIn).toEqual(['t1']);
    expect(p.checkedInUsers).toEqual(['c', 'a']);
    const t1 = p.entrants.t1;
    if (t1?.kind !== 'team') throw new Error('not a team');
    expect(t1.members.map((m) => [m.userId, m.sub])).toEqual([
      ['c', false],
      ['a', false],
      ['b', true],
    ]);
    expect(teamStarters(t1, 2).map((m) => m.userId)).toEqual(['c', 'a']);
    expect(entrantUserIds(t1)).toEqual(['c', 'a', 'b']);
  });

  it('rejects impossible lineups', () => {
    const bad = (starters: string[], entrantId = 't1') =>
      projectTournament(
        log(...teamBase, {
          type: 'team.lineupSet',
          actor: { kind: 'admin', id: 'a' },
          data: { entrantId, starters },
        }),
      );
    expect(() => bad(['a', 'b', 'c'])).toThrow(/at most 2 starters/);
    expect(() => bad(['a', 'x'])).toThrow(/not in the team/);
    expect(() => bad(['a'], 'nope')).toThrow(/is not a team/);
  });
});

describe('Monster Hunt race', () => {
  const start: NewTournamentEvent[] = [
    ...base,
    { type: 'tournament.started', actor: bridge, data: {} },
    { type: 'match.called', actor: bridge, data: { matchId: 'W1-1', entrants: ['e1', 'e2'] } },
    {
      type: 'match.mapSelected',
      actor: bridge,
      data: { matchId: 'W1-1', game: 1, map: 'MH-Egypt', method: 'vote', runOrder: ['e2', 'e1'] },
    },
  ];
  const run = (entrantId: string, timeMs: number): NewTournamentEvent => ({
    type: 'match.runFinished',
    actor: bridge,
    data: {
      matchId: 'W1-1',
      game: 1,
      entrantId,
      map: 'MH-Egypt',
      timeMs,
      deaths: 1,
      penaltyMs: 5000,
      points: 90,
      finished: true,
    },
  });
  const started = (runner: string): NewTournamentEvent => ({
    type: 'match.started',
    actor: bridge,
    data: { matchId: 'W1-1', game: 1, runner },
  });

  it('tracks the runs of a game and keeps them with the game', () => {
    let p = projectTournament(log(...start, started('e2'), run('e2', 300_000)));
    expect(p.currentMatch).toMatchObject({ status: 'mapSelected', map: 'MH-Egypt' });
    expect(p.currentMatch?.runs).toHaveLength(1);
    expect(p.currentMatch?.runner).toBeUndefined();
    p = projectTournament(
      log(...start, started('e2'), run('e2', 300_000), started('e1'), run('e1', 280_000), {
        type: 'match.gameFinished',
        actor: bridge,
        data: {
          matchId: 'W1-1',
          game: 1,
          map: 'MH-Egypt',
          scores: { e2: 305_000, e1: 285_000 },
          winnerId: 'e1',
          endReason: 'race',
        },
      }),
    );
    expect(p.games['W1-1']?.[0]?.runs?.map((r) => r.entrantId)).toEqual(['e2', 'e1']);
    expect(p.currentMatch?.runs).toBeUndefined();
  });

  it('rejects runs out of order', () => {
    expect(() => projectTournament(log(...start, started('e1')))).toThrow(ProjectionError);
    expect(() => projectTournament(log(...start, run('e1', 1)))).toThrow(ProjectionError);
  });
});

describe('admin overrides', () => {
  const played = (
    matchId: string,
    entrants: [string, string],
    winnerId: string,
  ): NewTournamentEvent => ({
    type: 'match.result',
    actor: bridge,
    data: { result: { matchId, entrants, winnerId, outcome: 'played' } },
  });
  const start: NewTournamentEvent[] = [
    ...base,
    { type: 'tournament.started', actor: bridge, data: {} },
    { type: 'match.called', actor: bridge, data: { matchId: 'W1-1', entrants: ['e1', 'e2'] } },
    played('W1-1', ['e1', 'e2'], 'e1'),
    { type: 'match.called', actor: bridge, data: { matchId: 'W1-2', entrants: ['e3', 'e4'] } },
    played('W1-2', ['e3', 'e4'], 'e3'),
    { type: 'match.called', actor: bridge, data: { matchId: 'W2-1', entrants: ['e1', 'e3'] } },
    { type: 'match.started', actor: bridge, data: { matchId: 'W2-1', game: 1 } },
  ];
  const override = (
    matchId: string,
    entrants: [string, string],
    winnerId: string,
  ): NewTournamentEvent => ({
    type: 'match.result',
    actor: { kind: 'admin', id: 'u1' },
    data: { result: { matchId, entrants, winnerId, outcome: 'override' } },
  });

  it('calls off the current match when an earlier result changes its pairing', () => {
    const p = projectTournament(log(...start, override('W1-1', ['e1', 'e2'], 'e2')));
    expect(p.currentMatch).toBeUndefined();
    expect(p.bracket?.byId['W2-1']?.entrants).toEqual(['e2', 'e3']);
  });

  it('keeps the current match when the correction does not touch it', () => {
    const p = projectTournament(log(...start, override('W1-1', ['e1', 'e2'], 'e1')));
    expect(p.currentMatch?.matchId).toBe('W2-1');
  });

  it('decides the current match and restarts a re-called series', () => {
    let p = projectTournament(log(...start, override('W2-1', ['e1', 'e3'], 'e3')));
    expect(p.currentMatch).toBeUndefined();
    expect(p.bracket?.byId['W2-1']?.winnerId).toBe('e3');
    p = projectTournament(
      log(
        ...start,
        {
          type: 'match.gameFinished',
          actor: bridge,
          data: {
            matchId: 'W2-1',
            game: 1,
            map: 'DM-Codex',
            scores: { e1: 20, e3: 3 },
            winnerId: 'e1',
            endReason: 'fragLimit',
          },
        },
        override('W1-1', ['e1', 'e2'], 'e2'),
        { type: 'match.called', actor: bridge, data: { matchId: 'W2-1', entrants: ['e2', 'e3'] } },
      ),
    );
    expect(p.currentMatch).toMatchObject({ matchId: 'W2-1', game: 1 });
    expect(p.games['W2-1']).toBeUndefined();
  });
});
