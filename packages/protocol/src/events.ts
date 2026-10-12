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
    }),
  ),
  event('match.started', z.object({ matchId: Id, game: z.number().int().positive() })),
  event(
    'match.gameFinished',
    z.object({
      matchId: Id,
      game: z.number().int().positive(),
      map: z.string(),
      scores: z.record(z.string(), z.number()),
      winnerId: Id,
      endReason: z.enum(['fragLimit', 'timeLimit', 'suddenDeath', 'forfeit', 'admin']),
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
