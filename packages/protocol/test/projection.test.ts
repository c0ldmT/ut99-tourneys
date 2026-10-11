import { describe, expect, it } from 'vitest';
import {
  projectTournament,
  ProjectionError,
  TournamentEventSchema,
  TournamentSettingsSchema,
  type Entrant,
  type NewTournamentEvent,
  type TournamentEvent,
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
