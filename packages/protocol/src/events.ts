import { z } from 'zod';
import {
  BracketDefinitionSchema,
  EntrantSchema,
  Id,
  MatchResultSchema,
  TournamentSettingsSchema,
} from './domain.js';

/**
 * Tournament event log (event sourcing).
 *
 * The website stores the canonical log. The tournament state is a pure function of the log:
 * the bracket comes from `seeding.set` + all `match.result` events via the bracket engine.
 * The bridge appends events (results, check-ins, map choices) with optimistic concurrency:
 * it sends the sequence number it based its decision on; the website accepts the batch only
 * if that is still the head, otherwise the bridge receives the missing events and re-decides.
 */

export const ActorSchema = z.object({
  /** `player`: a team captain changing the lineup on the website. */
  kind: z.enum(['admin', 'bridge', 'system', 'player']),
  /** User id for admins and players, agent id for bridges. */
  id: z.string().optional(),
});

const count = z.number().int().nonnegative();

/**
 * One player's (or bot's) statistics of a game (Monster Hunt: of a run), counted by the mod.
 * Players are identified by their website user id, bots by their name.
 */
export const PlayerGameStatsSchema = z.object({
  name: z.string().min(1).max(32),
  userId: Id.optional(),
  bot: z.boolean().optional(),
  /** The entrant the player played for (side a or b of the match). */
  entrantId: Id.optional(),
  kills: count,
  deaths: count,
  suicides: count,
  teamKills: count,
  headshots: count,
  firstBlood: z.boolean(),
  /** Most kills in a row without dying. */
  bestSpree: count,
  /** Killing sprees (5 kills in a row). */
  sprees: count,
  /** Multi kills (kills less than 3 s apart): double (2), multi (3), ultra (4), monster (5+). */
  multi2: count,
  multi3: count,
  multi4: count,
  multi5: count,
  /** Seconds in the game. */
  timeSec: count,
  /** Monster Hunt: monsters killed and monster points. */
  monsters: count,
  monsterPoints: z.number().int(),
  /** Kills per weapon (weapon name -> kills). */
  weapons: z.record(z.string().min(1).max(32), z.number().int().positive()),
});
export type PlayerGameStats = z.infer<typeof PlayerGameStatsSchema>;

const event = <T extends string, D extends z.ZodType>(type: T, data: D) =>
  z.object({
    type: z.literal(type),
    /** 1-based, gapless per tournament. Assigned by the website. */
    seq: z.number().int().positive(),
    /** ISO timestamp. */
    at: z.iso.datetime(),
    actor: ActorSchema,
    data,
  });

export const TournamentEventSchema = z.discriminatedUnion('type', [
  event(
    'tournament.created',
    z.object({
      tournamentId: Id,
      name: z.string().min(1).max(100),
      settings: TournamentSettingsSchema,
    }),
  ),
  event(
    'seeding.set',
    z.object({
      entrants: z.array(EntrantSchema),
      bracket: BracketDefinitionSchema,
      rngSeed: z.string(),
      /** Rating (strength) of each entrant at the seeding: player, bot or team average. */
      ratings: z.record(Id, z.number()).optional(),
    }),
  ),
  event('checkin.opened', z.object({ serverProfileId: Id })),
  event(
    'entrant.checkedIn',
    z.object({
      entrantId: Id,
      /** Team tournaments: the member who connected. The team counts as checked in with the first. */
      userId: Id.optional(),
    }),
  ),
  /** Team tournaments: who starts. Members not listed become substitutes. Applies from the next game. */
  event('team.lineupSet', z.object({ entrantId: Id, starters: z.array(Id) })),
  event(
    'entrant.replaced',
    z.object({
      entrantId: Id,
      replacement: EntrantSchema,
      reason: z.enum(['noShowCheckIn', 'admin']),
    }),
  ),
  event('tournament.started', z.object({})),
  event('match.called', z.object({ matchId: Id, entrants: z.tuple([Id, Id]) })),
  event(
    'match.mapSelected',
    z.object({
      matchId: Id,
      /** 1-based game number within a best-of series. */
      game: z.number().int().positive(),
      map: z.string().min(1),
      method: z.enum(['vote', 'random', 'loserPick', 'admin']),
      /** Optional transparency data, e.g. per-map scores of the vote. */
      details: z.record(z.string(), z.unknown()).optional(),
      /** Monster Hunt race: which entrant runs first and which second in this game. */
      runOrder: z.tuple([Id, Id]).optional(),
    }),
  ),
  event(
    'match.started',
    z.object({
      matchId: Id,
      game: z.number().int().positive(),
      /** Monster Hunt race: the entrant whose run started (the other team watches). */
      runner: Id.optional(),
      /** Team games: who played for each entrant (humans first, then bots). */
      lineups: z
        .record(
          Id,
          z.array(
            z.object({
              name: z.string().min(1).max(32),
              userId: Id.optional(),
              bot: z.boolean().optional(),
            }),
          ),
        )
        .optional(),
    }),
  ),
  /** Monster Hunt race: one team's run of the current game is over. */
  event(
    'match.runFinished',
    z.object({
      matchId: Id,
      game: z.number().int().positive(),
      entrantId: Id,
      map: z.string(),
      /** From the start to the exit (or to the time limit), pauses excluded. */
      timeMs: z.number().int().nonnegative(),
      /** Deaths in the team, bots included. */
      deaths: z.number().int().nonnegative(),
      /** deaths x the tournament's penalty per death. */
      penaltyMs: z.number().int().nonnegative(),
      /** Monster points of the team (tie-breaker). */
      points: z.number().int(),
      /** Reached the exit before the time limit. */
      finished: z.boolean(),
      /** The organizer ended the run (it counts as not finished). */
      forfeit: z.boolean().optional(),
    }),
  ),
  event(
    'match.gameFinished',
    z.object({
      matchId: Id,
      game: z.number().int().positive(),
      map: z.string(),
      scores: z.record(z.string(), z.number()),
      winnerId: Id,
      /** `race`: Monster Hunt, decided by the two runs (scores are the final times in ms). */
      endReason: z.enum(['fragLimit', 'timeLimit', 'suddenDeath', 'forfeit', 'admin', 'race']),
    }),
  ),
  /**
   * Player statistics of a game (Monster Hunt: of one run, `run` 1 or 2). Comes before the
   * game's `match.gameFinished` (Monster Hunt: before the run's `match.runFinished`). Does not
   * change the tournament state; the website builds its statistics from it.
   */
  event(
    'match.playerStats',
    z.object({
      matchId: Id,
      game: z.number().int().positive(),
      run: z.number().int().min(1).max(2).optional(),
      map: z.string(),
      /** Seconds from the start of the game (run) to its end, pauses excluded. */
      durationSec: count,
      players: z.array(PlayerGameStatsSchema).max(64),
    }),
  ),
  event('match.result', z.object({ result: MatchResultSchema })),
  event('tournament.paused', z.object({ reason: z.string().max(200) })),
  event('tournament.resumed', z.object({})),
  event('tournament.finished', z.object({ championId: Id })),
  event('tournament.aborted', z.object({ reason: z.string().max(200) })),
]);

export type TournamentEvent = z.infer<typeof TournamentEventSchema>;
export type TournamentEventType = TournamentEvent['type'];
export type EventOf<T extends TournamentEventType> = Extract<TournamentEvent, { type: T }>;

/** An event before the website assigned seq and timestamp. */
export type NewTournamentEvent = TournamentEvent extends infer E
  ? E extends TournamentEvent
    ? Omit<E, 'seq' | 'at'>
    : never
  : never;
