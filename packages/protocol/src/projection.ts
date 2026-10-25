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

/** Monster Hunt race: one team's run. */
export interface RunRecord {
  entrantId: string;
  map: string;
  timeMs: number;
  deaths: number;
  penaltyMs: number;
  points: number;
  finished: boolean;
  /** Ended by the organizer. */
  forfeit?: boolean;
}

export interface GameRecord {
  game: number;
  map: string;
  scores: Record<string, number>;
  winnerId: string;
  endReason: string;
  /** Monster Hunt race: both runs, in the order they were played. */
  runs?: RunRecord[];
}

export interface CurrentMatch {
  matchId: string;
  entrants: [string, string];
  /** Game number currently being prepared or played. */
  game: number;
  map?: string;
  mapMethod?: string;
  status: 'called' | 'mapSelected' | 'live';
  /** Monster Hunt race: run order of the current game, finished runs, the running team. */
  runOrder?: [string, string];
  runs?: RunRecord[];
  runner?: string;
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
  /** Team tournaments: members who connected during check-in (user ids). */
  checkedInUsers: string[];
  bracketDefinition?: BracketDefinition;
  rngSeed?: string;
  /** Rating of each entrant at the seeding (player, bot or team average). */
  seedRatings?: Record<string, number>;
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
    checkedInUsers: [],
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
        if (e.data.ratings) p.seedRatings = e.data.ratings;
        else delete p.seedRatings;
        p.phase = 'seeded';
        break;
      case 'checkin.opened':
        if (p.phase !== 'seeded') fail(`cannot open check-in in phase ${p.phase}`);
        p.phase = 'checkIn';
        break;
      case 'entrant.checkedIn':
        if (!p.entrants[e.data.entrantId]) fail(`unknown entrant ${e.data.entrantId}`);
        if (!p.checkedIn.includes(e.data.entrantId)) p.checkedIn.push(e.data.entrantId);
        if (e.data.userId && !p.checkedInUsers.includes(e.data.userId)) {
          p.checkedInUsers.push(e.data.userId);
        }
        break;
      case 'team.lineupSet': {
        const team = p.entrants[e.data.entrantId];
        if (team?.kind !== 'team') fail(`${e.data.entrantId} is not a team`);
        if (p.phase === 'finished' || p.phase === 'aborted') fail(`tournament is ${p.phase}`);
        const t = team as Extract<Entrant, { kind: 'team' }>;
        const starters = [...new Set(e.data.starters)];
        if (starters.length > p.settings.teamSize) fail(`at most ${p.settings.teamSize} starters`);
        const unknown = starters.filter((u) => !t.members.some((m) => m.userId === u));
        if (unknown.length) fail(`not in the team: ${unknown.join(', ')}`);
        const ordered = [
          ...starters.map((u) => t.members.find((m) => m.userId === u)!),
          ...t.members.filter((m) => !starters.includes(m.userId)),
        ];
        p.entrants[t.id] = {
          ...t,
          members: ordered.map((m) => ({ ...m, sub: !starters.includes(m.userId) })),
        };
        break;
      }
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
        // A match is called once; games left from an earlier call were made void by an admin
        // override (its pairing changed or it was interrupted), so the series starts over.
        delete p.games[e.data.matchId];
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
        if (e.data.runOrder) {
          cm.runOrder = e.data.runOrder;
          cm.runs = [];
        }
        break;
      }
      case 'match.started': {
        const cm = requireCurrent(p, e.data.matchId, fail);
        cm.game = e.data.game;
        cm.status = 'live';
        if (e.data.runner) {
          if (!cm.runOrder) fail('runner without a run order');
          if (e.data.runner !== cm.runOrder?.[cm.runs?.length ?? 0])
            fail(`${e.data.runner} does not run now`);
          cm.runner = e.data.runner;
        }
        break;
      }
      case 'match.runFinished': {
        const cm = requireCurrent(p, e.data.matchId, fail);
        if (!cm.runOrder || !cm.runs) fail('no race in this game');
        if (cm.game !== e.data.game) fail(`game ${e.data.game} is not the current game`);
        const runs = cm.runs as RunRecord[];
        if (runs.length >= 2) fail('both runs are already finished');
        if (cm.runOrder?.[runs.length] !== e.data.entrantId)
          fail(`${e.data.entrantId} does not run now`);
        const d = e.data;
        runs.push({
          entrantId: d.entrantId,
          map: d.map,
          timeMs: d.timeMs,
          deaths: d.deaths,
          penaltyMs: d.penaltyMs,
          points: d.points,
          finished: d.finished,
          ...(d.forfeit ? { forfeit: true } : {}),
        });
        // Back to the loaded map: the other team runs next (same map).
        cm.status = 'mapSelected';
        delete cm.runner;
        break;
      }
      case 'match.playerStats':
        // statistics only (the website's stats); the tournament state does not change
        break;
      case 'match.gameFinished': {
        const cm = requireCurrent(p, e.data.matchId, fail);
        const list = (p.games[e.data.matchId] ??= []);
        list.push({
          game: e.data.game,
          map: e.data.map,
          scores: e.data.scores,
          winnerId: e.data.winnerId,
          endReason: e.data.endReason,
          ...(cm.runs?.length ? { runs: cm.runs } : {}),
        });
        p.mapHistory.push({ matchId: e.data.matchId, map: e.data.map, entrants: cm.entrants });
        cm.game = e.data.game + 1;
        cm.status = 'called';
        delete cm.map;
        delete cm.mapMethod;
        delete cm.runOrder;
        delete cm.runs;
        delete cm.runner;
        break;
      }
      case 'match.result': {
        p.results.push(e.data.result);
        const cm = p.currentMatch;
        if (cm?.matchId === e.data.result.matchId) delete p.currentMatch;
        else if (cm && p.bracketDefinition && e.data.result.outcome === 'override') {
          // An admin corrected an earlier match: the current match may not exist any more in this
          // form (other entrants), then it is called off and scheduled again.
          const node = computeBracket(p.bracketDefinition, p.results).byId[cm.matchId];
          const [a, b] = node?.entrants ?? [];
          const same =
            node?.status === 'ready' &&
            ((a === cm.entrants[0] && b === cm.entrants[1]) ||
              (a === cm.entrants[1] && b === cm.entrants[0]));
          if (!same) delete p.currentMatch;
        }
        break;
      }
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
        // Only a league matchday (fixtures) ends without a champion.
        if ((p.bracketDefinition?.format === 'fixtures') !== (e.data.championId === undefined))
          fail(e.data.championId ? 'a league matchday has no champion' : 'the champion is missing');
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
