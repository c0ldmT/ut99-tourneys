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
  /**
   * Optional HTTP redirect for faster downloads: a web server with the maps and packages as
   * compressed .uz files (ucc compress). Without it clients download from the game server itself.
   */
  downloadRedirect: z.url().max(256).optional(),
  /**
   * Bandwidth per client in bytes/s (the highest netspeed the server accepts; also the download
   * speed from the game server). Default as in the 469f patch.
   */
  maxClientRate: z.number().int().min(5_000).max(1_000_000).default(20_000),
  /** Server ticks per second (internet and LAN). Default as in the 469f patch. */
  tickRate: z.number().int().min(10).max(200).default(50),
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
  /** Monster Hunt: the running team gives up its run (counts as not finished). */
  z.object({ kind: z.literal('match.forfeitRun'), tournamentId: Id, matchId: Id }),
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

/** label: the description ('' if none); meta: a voice pack's meta class (`BotPack.VoiceMale`). */
const AssetSchema = z.object({
  name: z.string().min(1).max(128),
  label: z.string().max(64),
  meta: z.string().max(128).optional(),
});
/**
 * What the game installation offers for bots (UT99: `Object=` lines of the .int files in
 * System/ and SystemLocalized/int/): bot classes, texture entries (skins and faces, with or
 * without a description), voice packs with their meta class, weapons.
 */
export const GameAssetsSchema = z.object({
  botClasses: z.array(AssetSchema).max(500).default([]),
  textures: z.array(AssetSchema).max(5000).default([]),
  voices: z.array(AssetSchema).max(500).default([]),
  weapons: z.array(AssetSchema).max(500).default([]),
  /** Texture packages with skins (Textures/*skin*.utx) and their textures, read from the files. */
  skinPackages: z
    .array(z.object({ pkg: z.string().max(64), textures: z.array(z.string().max(64)).max(300) }))
    .max(200)
    .default([]),
});
export type GameAssets = z.infer<typeof GameAssetsSchema>;

export const AgentInventory = envelope(
  'agent.inventory',
  z.object({
    profileId: Id,
    adapter: z.string(),
    maps: z.array(MapInfoSchema),
    bots: z.array(BotSpecSchema),
    /** UnrealScript packages in System (e.g. "SmartStockBots"), to check optional server mods. */
    packages: z.array(z.string().max(64)).max(1000).default([]),
    /** Bot classes, skins and faces, voices and weapons installed (from the .int files). */
    assets: GameAssetsSchema.optional(),
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

/**
 * Monster Hunt map records for the HUD: best final time (run time plus penalty) per map.
 * `counts`: runs of this tournament count for the statistics, so a better finish here is a new
 * record (the bridge then updates its copy and the mod announces it).
 */
export const MapRecordsSchema = z.object({
  counts: z.boolean(),
  maps: z
    .array(
      z.object({
        map: z.string().min(1).max(64),
        finalMs: z.number().int().nonnegative(),
        /** Team (or player) that holds it. */
        by: z.string().max(64),
      }),
    )
    .max(1000),
});
export type MapRecords = z.infer<typeof MapRecordsSchema>;

/** Occasions a bot says something in the chat. */
export const BOT_LINE_KINDS = [
  'start',
  'kill',
  'death',
  'win',
  'loss',
  'rivalKill',
  'rivalDeath',
  'betWon',
  'betLost',
] as const;
export type BotLineKind = (typeof BOT_LINE_KINDS)[number];
export const BotLineKindSchema = z.enum(BOT_LINE_KINDS);

/**
 * A website bot's personality for the game: chat lines per occasion (placeholders {me},
 * {victim}, {killer}, {map}), how talkative it is, and its rivals (players or bots by their name
 * in the game; a nemesis is hunted down as well).
 */
export const BotPersonalitySchema = z.object({
  /** The bot's name in the game. */
  name: z.string().min(1).max(32),
  /** Chance to say something on an occasion, 0..100. */
  talk: z.number().int().min(0).max(100),
  lines: z.array(z.object({ kind: BotLineKindSchema, text: z.string().min(1).max(120) })).max(64),
  rivals: z
    .array(
      z.object({
        name: z.string().min(1).max(32),
        level: z.enum(['rival', 'nemesis']),
      }),
    )
    .max(16),
  /**
   * The bot's latest decided bet with Neuro, if it was decided after the bot's last game: it
   * talks about it at the start of its next game ({amount} Neuro won or lost, {pick}).
   */
  bet: z
    .object({ won: z.boolean(), amount: z.number().int().nonnegative(), pick: z.string().max(64) })
    .optional(),
});
export type BotPersonality = z.infer<typeof BotPersonalitySchema>;

/**
 * Neuro shop: a player's dedication (approved by an admin) – a line the website bots say when
 * they frag the player (`kill`) or are fragged by them (`death`); "" = none.
 */
export const DedicationSchema = z.object({
  /** The player's name in the game. */
  name: z.string().min(1).max(32),
  kill: z.string().max(120),
  death: z.string().max(120),
});
export type Dedication = z.infer<typeof DedicationSchema>;

/** Full event log or delta for a tournament (website -> bridge). */
export const TournamentSync = envelope(
  'tournament.sync',
  z.object({
    tournamentId: Id,
    /** Events with seq > fromSeq, in order. fromSeq = 0 means full log. */
    fromSeq: z.number().int().nonnegative(),
    events: z.array(TournamentEventSchema),
    access: z.array(AccessEntrySchema),
    /** Monster Hunt: the map records shown in the HUD (statistics page). */
    records: MapRecordsSchema.optional(),
    /** Personalities of the tournament's website bots (chat lines, rivals). */
    bots: z.array(BotPersonalitySchema).max(256).optional(),
    /** Dedications of the tournament's players (Neuro shop). */
    dedications: z.array(DedicationSchema).max(64).optional(),
    /**
     * Betting: matches take bets at least this many seconds after being called (the first game's
     * countdown waits); 0 or missing = the tournament takes no bets now.
     */
    betWindowSec: z.number().int().min(0).max(600).optional(),
    /**
     * Bot AI help in deathmatch games (website setting): 0 off, 1 failsafe against bots that stand
     * still, 2 also the duel mode (one on one: a bot without an enemy hunts its opponent).
     */
    antiIdle: z.number().int().min(0).max(2).optional(),
    /** Bot skill curve (website setting, all game types); missing = on. */
    skillCurve: z.boolean().optional(),
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

/** Kill feed of the game in progress (live only, not persisted). */
export const KillFeedEntrySchema = z.object({
  tournamentId: Id,
  matchId: Id,
  game: z.number().int().positive(),
  /** Unix ms. */
  at: z.number().int(),
  killer: z.string().max(64),
  /** Entrant id of the killer's side; null: a monster or the world (suicide). */
  killerSide: Id.nullable(),
  victim: z.string().max(64),
  victimSide: Id.nullable(),
  weapon: z.string().max(64),
  headshot: z.boolean(),
  firstBlood: z.boolean(),
  suicide: z.boolean(),
  teamKill: z.boolean(),
  monster: z.boolean(),
  spree: z.number().int().nonnegative(),
  multi: z.number().int().nonnegative(),
  /** A bot's chat line instead of a kill: `killer` is the bot, `killerSide` its side. */
  chat: z.string().max(160).optional(),
});
export type KillFeedEntry = z.infer<typeof KillFeedEntrySchema>;
export const MatchFeed = envelope('match.feed', KillFeedEntrySchema);

export const BridgeToWebsiteSchema = z.discriminatedUnion('type', [
  AgentHello,
  AgentInventory,
  AgentServerStatus,
  EventsAppend,
  CommandAck,
  MatchLive,
  MatchFeed,
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
