import { z } from 'zod';
import { BotSpecSchema, Id, ServerOsSchema } from './domain.js';
import { TournamentEventSchema } from './events.js';

/**
 * Website <-> Bridge agent protocol.
 *
 * Transport: one WebSocket per agent, opened by the bridge (outbound, NAT friendly),
 * authenticated with an agent token in the `Authorization: Bearer` header.
 * Every frame is one JSON envelope: { v, id, type, ts, re?, payload }.
 */

export const PROTOCOL_VERSION = 1 as const;

export const envelope = <T extends string, P extends z.ZodType>(type: T, payload: P) =>
  z.object({
    v: z.literal(PROTOCOL_VERSION),
    /** Unique message id (uuid). */
    id: z.string().min(1).max(64),
    type: z.literal(type),
    /** Unix epoch milliseconds. */
    ts: z.number().int(),
    /** Id of the message this one answers. */
    re: z.string().optional(),
    payload,
  });

// ---------------------------------------------------------------------------------------------
// Shared payload parts
// ---------------------------------------------------------------------------------------------

export const MapInfoSchema = z.object({
  /** Package name without extension, as used in travel URLs, e.g. "DM-Deck16][". */
  id: z.string().min(1).max(64),
  title: z.string().max(128).optional(),
  author: z.string().max(128).optional(),
  idealPlayerCount: z.string().max(32).optional(),
  /** File size in bytes, useful to warn about large downloads for clients. */
  sizeBytes: z.number().int().nonnegative().optional(),
  /** True if the map ships with the retail game / 469 patch (clients have it). */
  stock: z.boolean().optional(),
});
export type MapInfo = z.infer<typeof MapInfoSchema>;

export const ServerProfileSchema = z.object({
  id: Id,
  name: z.string().min(1).max(64),
  os: ServerOsSchema,
  /** UT installation root on the bridge machine. */
  installDir: z.string().min(1),
  /** Overrides the default server binary for the OS (e.g. System/ucc-bin-arm64). */
  binary: z.string().optional(),
  port: z.number().int().min(1).max(65535).default(7777),
  /** Map shown while waiting for players and between tournament phases. */
  lobbyMap: z.string().min(1),
  maxSpectators: z.number().int().min(0).max(64).default(32),
  serverName: z.string().max(64).optional(),
  /** Address players use to connect, e.g. "ut.example.com:7777" (shown on the website). */
  publicAddress: z.string().max(128).optional(),
  /** Extra server URL options / command line arguments, appended verbatim. */
  extraArgs: z.string().max(512).optional(),
});
export type ServerProfile = z.infer<typeof ServerProfileSchema>;

/**
 * A game server profile as the bridge reports it. Profiles (install path, binary, arguments)
 * are configured on the bridge machine only: the website can pick a profile by id but never
 * define what the bridge executes.
 */
export const AgentProfileSchema = z.object({
  id: Id,
  name: z.string().min(1).max(64),
  os: ServerOsSchema,
  port: z.number().int().min(1).max(65535),
  lobbyMap: z.string(),
  serverName: z.string().max(64).optional(),
  /** Address players use to connect, e.g. "ut.example.com:7777". */
  publicAddress: z.string().max(128).optional(),
  /** True if the bridge starts and stops the server itself. */
  manage: z.boolean(),
});
export type AgentProfile = z.infer<typeof AgentProfileSchema>;

export const ServerStateSchema = z.enum(['stopped', 'starting', 'running', 'stopping', 'crashed']);

export const ConnectedPlayerSchema = z.object({
  /** Website user id, if the token was recognized. */
  userId: z.string().optional(),
  name: z.string(),
  role: z.enum(['player', 'spectator']),
});

/** Access control entry: who may join the game server and in which role. */
export const AccessEntrySchema = z.object({
  userId: Id,
  displayName: z.string().min(1).max(32),
  /** Personal join token (the `?tk=` URL option). */
  token: z.string().min(8).max(64),
  /** Entrant id if the user plays in the tournament. */
  entrantId: Id.optional(),
});
export type AccessEntry = z.infer<typeof AccessEntrySchema>;

// ---------------------------------------------------------------------------------------------
// Commands (website -> bridge), answered with command.ack
// ---------------------------------------------------------------------------------------------

export const AgentCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inventory.rescan'), profileId: Id }),
  /**
   * Starts the game server and opens check-in for a tournament (or resumes it after a bridge
   * restart). The event log and the access list arrive before with `tournament.sync`.
   */
  z.object({
    kind: z.literal('tournament.run'),
    tournamentId: Id,
    profileId: Id,
    /** Bots that replace players who do not check in. */
    botPool: z.array(BotSpecSchema).min(1),
  }),
  z.object({ kind: z.literal('tournament.forceStart'), tournamentId: Id }),
  z.object({ kind: z.literal('tournament.pause'), tournamentId: Id, reason: z.string().max(200) }),
  z.object({ kind: z.literal('tournament.resume'), tournamentId: Id }),
  z.object({ kind: z.literal('tournament.abort'), tournamentId: Id, reason: z.string().max(200) }),
  z.object({ kind: z.literal('match.restart'), tournamentId: Id, matchId: Id }),
  z.object({ kind: z.literal('server.stop') }),
  /** Grants or revokes game server access (e.g. a spectator clicked "watch"). */
  z.object({
    kind: z.literal('access.upsert'),
    tournamentId: Id,
    entries: z.array(AccessEntrySchema),
  }),
  z.object({ kind: z.literal('access.revoke'), tournamentId: Id, userIds: z.array(Id) }),
  z.object({ kind: z.literal('announce'), message: z.string().min(1).max(200) }),
]);
export type AgentCommand = z.infer<typeof AgentCommandSchema>;

// ---------------------------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------------------------

export const AgentHello = envelope(
  'agent.hello',
  z.object({
    agentId: Id,
    agentVersion: z.string(),
    os: ServerOsSchema,
    arch: z.string(),
    /** Game adapters this agent supports, e.g. ["ut99-dm"]. */
    adapters: z.array(z.string()),
    /** Last event seq the agent knows per tournament, so the website can send only the delta. */
    knownSeq: z.record(z.string(), z.number().int().nonnegative()),
    profiles: z.array(AgentProfileSchema).default([]),
    /** Tournament the agent is currently running, if any. */
    activeTournamentId: Id.optional(),
  }),
);

export const AgentWelcome = envelope(
  'agent.welcome',
  z.object({ agentId: Id, serverTime: z.number().int() }),
);

export const AgentInventory = envelope(
  'agent.inventory',
  z.object({
    profileId: Id,
    adapter: z.string(),
    maps: z.array(MapInfoSchema),
    bots: z.array(BotSpecSchema),
    /** UnrealScript packages in System (e.g. "SmartStockBots"), to check optional server mods. */
    packages: z.array(z.string().max(64)).max(1000).default([]),
    scannedAt: z.iso.datetime(),
    warnings: z.array(z.string()).default([]),
  }),
);

export const AgentServerStatus = envelope(
  'server.status',
  z.object({
    state: ServerStateSchema,
    profileId: Id.optional(),
    tournamentId: Id.optional(),
    pid: z.number().int().optional(),
    port: z.number().int().optional(),
    map: z.string().optional(),
    /** True while the mod is connected to the bridge. */
    modConnected: z.boolean(),
    players: z.array(ConnectedPlayerSchema),
    uptimeSec: z.number().nonnegative().optional(),
    detail: z.string().max(500).optional(),
  }),
);

/** Full event log or delta for a tournament (website -> bridge). */
export const TournamentSync = envelope(
  'tournament.sync',
  z.object({
    tournamentId: Id,
    /** Events with seq > fromSeq, in order. fromSeq = 0 means full log. */
    fromSeq: z.number().int().nonnegative(),
    events: z.array(TournamentEventSchema),
    access: z.array(AccessEntrySchema),
  }),
);

/** Bridge proposes new events based on the log up to `baseSeq`. */
export const EventsAppend = envelope(
  'events.append',
  z.object({
    tournamentId: Id,
    baseSeq: z.number().int().nonnegative(),
    /** Events without seq/at; the website assigns them. */
    events: z.array(z.record(z.string(), z.unknown())),
  }),
);

export const EventsAck = envelope(
  'events.ack',
  z.object({
    tournamentId: Id,
    accepted: z.boolean(),
    /** On accept: the stored events. On reject: the events the bridge was missing. */
    events: z.array(TournamentEventSchema),
    reason: z.string().optional(),
  }),
);

export const AgentCommandMessage = envelope(
  'command',
  z.object({ commandId: Id, command: AgentCommandSchema }),
);

export const CommandAck = envelope(
  'command.ack',
  z.object({ commandId: Id, ok: z.boolean(), error: z.string().optional() }),
);

/** Live, non-persistent match telemetry for the website (scores while playing, countdowns, ready state). */
export const MatchLive = envelope(
  'match.live',
  z.object({
    tournamentId: Id,
    matchId: Id,
    game: z.number().int().positive(),
    phase: z.enum([
      'voting',
      'loading',
      'readyCheck',
      'countdown',
      'live',
      'overtime',
      'paused',
      'post',
    ]),
    map: z.string().optional(),
    scores: z.record(z.string(), z.number()).optional(),
    ready: z.record(z.string(), z.boolean()).optional(),
    /** Unix ms when the current phase times out (vote end, no-show forfeit, ...). */
    deadline: z.number().int().optional(),
    secondsLeft: z.number().optional(),
    /** Monster Hunt race: the run in progress (the finished run is in the event log). */
    race: z
      .object({
        runner: Id,
        run: z.number().int().min(1).max(2),
        timeMs: z.number().int().nonnegative(),
        deaths: z.number().int().nonnegative(),
        penaltyMs: z.number().int().nonnegative(),
        points: z.number().int(),
      })
      .optional(),
  }),
);

export const AgentLog = envelope(
  'agent.log',
  z.object({ level: z.enum(['debug', 'info', 'warn', 'error']), message: z.string().max(2000) }),
);

export const BridgeToWebsiteSchema = z.discriminatedUnion('type', [
  AgentHello,
  AgentInventory,
  AgentServerStatus,
  EventsAppend,
  CommandAck,
  MatchLive,
  AgentLog,
]);
export const WebsiteToBridgeSchema = z.discriminatedUnion('type', [
  AgentWelcome,
  TournamentSync,
  EventsAck,
  AgentCommandMessage,
]);
export type BridgeToWebsite = z.infer<typeof BridgeToWebsiteSchema>;
export type WebsiteToBridge = z.infer<typeof WebsiteToBridgeSchema>;
