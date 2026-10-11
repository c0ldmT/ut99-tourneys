import {
  computeBracket,
  type BracketDefinition,
  type BracketState,
  type MatchResult,
} from '@tourney/bracket';
import type { Entrant, TournamentSettings } from './domain.js';
import type { TournamentEvent } from './events.js';

/**
 * Folds the event log into the current tournament state. Used identically by website and bridge.
 */

export type TournamentPhase =
  | 'draft' // created, not seeded
  | 'seeded' // bracket fixed, server not started
  | 'checkIn' // server running, waiting for players
  | 'running'
  | 'paused'
  | 'finished'
  | 'aborted';

export interface GameRecord {
  game: number;
  map: string;
  scores: Record<string, number>;
  winnerId: string;
  endReason: string;
}

export interface CurrentMatch {
  matchId: string;
  entrants: [string, string];
  /** Game number currently being prepared or played. */
  game: number;
  map?: string;
  mapMethod?: string;
  status: 'called' | 'mapSelected' | 'live';
}

export interface TournamentProjection {
  tournamentId: string;
  name: string;
  settings: TournamentSettings;
  phase: TournamentPhase;
  headSeq: number;
  /** Current occupant per entrant id (after replacements). */
  entrants: Record<string, Entrant>;
  checkedIn: string[];
  bracketDefinition?: BracketDefinition;
  rngSeed?: string;
  results: MatchResult[];
  bracket?: BracketState;
  currentMatch?: CurrentMatch;
  /** Finished games per match id (best-of series). */
  games: Record<string, GameRecord[]>;
  /** Every map played so far, in order (input for repetition penalties). */
  mapHistory: { matchId: string; map: string; entrants: [string, string] }[];
  pausedReason?: string;
  abortedReason?: string;
  championId?: string;
}

export class ProjectionError extends Error {
  constructor(
    message: string,
    public readonly seq?: number,
  ) {
    super(seq === undefined ? message : `event #${seq}: ${message}`);
    this.name = 'ProjectionError';
  }
}

export function projectTournament(events: readonly TournamentEvent[]): TournamentProjection {
  const first = events[0];
  if (!first || first.type !== 'tournament.created') {
    throw new ProjectionError('log must start with tournament.created');
  }
  const p: TournamentProjection = {
    tournamentId: first.data.tournamentId,
    name: first.data.name,
    settings: first.data.settings,
    phase: 'draft',
    headSeq: 0,
    entrants: {},
    checkedIn: [],
    results: [],
    games: {},
    mapHistory: [],
  };
  let phaseBeforePause: TournamentPhase = 'draft';

  for (const e of events) {
    if (e.seq !== p.headSeq + 1) {
      throw new ProjectionError(`expected seq ${p.headSeq + 1}, got ${e.seq}`, e.seq);
    }
    p.headSeq = e.seq;
    const fail = (msg: string) => {
      throw new ProjectionError(msg, e.seq);
    };

    switch (e.type) {
      case 'tournament.created':
        if (e.seq !== 1) fail('tournament.created must be the first event');
        break;
      case 'seeding.set':
        if (p.phase !== 'draft' && p.phase !== 'seeded') fail(`cannot seed in phase ${p.phase}`);
        p.entrants = Object.fromEntries(e.data.entrants.map((x) => [x.id, x]));
        for (const id of e.data.bracket.slots) {
          if (!p.entrants[id]) fail(`slot entrant ${id} is not in the entrant list`);
        }
        p.bracketDefinition = e.data.bracket;
        p.rngSeed = e.data.rngSeed;
        p.phase = 'seeded';
        break;
      case 'checkin.opened':
        if (p.phase !== 'seeded') fail(`cannot open check-in in phase ${p.phase}`);
        p.phase = 'checkIn';
        break;
      case 'entrant.checkedIn':
        if (!p.entrants[e.data.entrantId]) fail(`unknown entrant ${e.data.entrantId}`);
        if (!p.checkedIn.includes(e.data.entrantId)) p.checkedIn.push(e.data.entrantId);
        break;
      case 'entrant.replaced':
        if (!p.entrants[e.data.entrantId]) fail(`unknown entrant ${e.data.entrantId}`);
        if (e.data.replacement.id !== e.data.entrantId)
          fail('replacement must keep the entrant id');
        p.entrants[e.data.entrantId] = e.data.replacement;
        break;
      case 'tournament.started':
        if (p.phase !== 'checkIn') fail(`cannot start in phase ${p.phase}`);
        p.phase = 'running';
        break;
      case 'match.called':
        if (p.phase !== 'running') fail(`cannot call a match in phase ${p.phase}`);
        p.currentMatch = {
          matchId: e.data.matchId,
          entrants: e.data.entrants,
          game: (p.games[e.data.matchId]?.length ?? 0) + 1,
          status: 'called',
        };
        break;
      case 'match.mapSelected': {
        const cm = requireCurrent(p, e.data.matchId, fail);
        cm.game = e.data.game;
        cm.map = e.data.map;
        cm.mapMethod = e.data.method;
        cm.status = 'mapSelected';
        break;
      }
      case 'match.started': {
        const cm = requireCurrent(p, e.data.matchId, fail);
        cm.game = e.data.game;
        cm.status = 'live';
        break;
      }
      case 'match.gameFinished': {
        const cm = requireCurrent(p, e.data.matchId, fail);
        const list = (p.games[e.data.matchId] ??= []);
        list.push({
          game: e.data.game,
          map: e.data.map,
          scores: e.data.scores,
          winnerId: e.data.winnerId,
          endReason: e.data.endReason,
        });
        p.mapHistory.push({ matchId: e.data.matchId, map: e.data.map, entrants: cm.entrants });
        cm.game = e.data.game + 1;
        cm.status = 'called';
        delete cm.map;
        delete cm.mapMethod;
        break;
      }
      case 'match.result':
        p.results.push(e.data.result);
        if (p.currentMatch?.matchId === e.data.result.matchId) delete p.currentMatch;
        break;
      case 'tournament.paused':
        if (p.phase === 'paused') break;
        phaseBeforePause = p.phase;
        p.phase = 'paused';
        p.pausedReason = e.data.reason;
        break;
      case 'tournament.resumed':
        if (p.phase !== 'paused') fail('not paused');
        p.phase = phaseBeforePause;
        delete p.pausedReason;
        break;
      case 'tournament.finished':
        p.phase = 'finished';
        p.championId = e.data.championId;
        delete p.currentMatch;
        break;
      case 'tournament.aborted':
        p.phase = 'aborted';
        p.abortedReason = e.data.reason;
        delete p.currentMatch;
        break;
      default: {
        const never: never = e;
        fail(`unhandled event ${(never as { type: string }).type}`);
      }
    }
  }

  if (p.bracketDefinition) p.bracket = computeBracket(p.bracketDefinition, p.results);
  return p;
}

function requireCurrent(
  p: TournamentProjection,
  matchId: string,
  fail: (msg: string) => never,
): CurrentMatch {
  if (!p.currentMatch || p.currentMatch.matchId !== matchId) {
    fail(`match ${matchId} is not the current match`);
  }
  return p.currentMatch as CurrentMatch;
}
