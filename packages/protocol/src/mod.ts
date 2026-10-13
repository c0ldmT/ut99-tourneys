import { z } from 'zod';

/**
 * Bridge <-> UT mod line protocol ("flat JSON lines").
 *
 * Transport: TCP on 127.0.0.1. The mod is the client (UnrealScript TcpLink) and reconnects after
 * every level change, because all actors are destroyed on map travel. The bridge is the server
 * and holds all state; on every (re)connect it sends a full snapshot.
 *
 * Constraints, chosen so a tiny UnrealScript parser suffices and old TcpLink limits are safe:
 * - One JSON object per line, terminated by "\n" (a preceding "\r" is tolerated).
 * - Flat objects only: values are strings, integers or booleans. No nesting, no arrays, no floats.
 * - At most MAX_LINE_BYTES bytes per line including the newline.
 * - ASCII only. Non-ASCII characters are sent as JSON \uXXXX escapes.
 * - Field `t` is the message type. Keys are short to save bytes.
 * - Lists (bracket, standings, vote options, access list) are sent as one line per item,
 *   framed by a header line carrying the item count and a revision number.
 */

export const MOD_PROTOCOL_VERSION = 1 as const;
/** Conservative limit; can be raised once verified against 469f TcpLink. */
export const MAX_LINE_BYTES = 255;
/** Display names are cut to this length before they go on the wire. */
export const MAX_NAME_CHARS = 32;
/** Escaped byte budget for a name, so two names always fit into one bracket line. */
export const MAX_NAME_WIRE_BYTES = 48;

const str = (max = 64) => z.string().max(max);
const int = z.number().int();
/** Player id: the PlayerReplicationInfo.PlayerID of the connection in the current level. */
const pid = int.nonnegative();
/** Side of a match: "a" = first entrant, "b" = second entrant. */
const side = z.enum(['a', 'b']);

// ---------------------------------------------------------------------------------------------
// Mod -> Bridge
// ---------------------------------------------------------------------------------------------

export const ModToBridgeSchema = z.discriminatedUnion('t', [
  /** First line after connecting. `key` is the shared secret from the mod's ini. */
  z.object({
    t: z.literal('hello'),
    key: str(64),
    pv: int, // protocol version
    mv: str(16), // mod version
    eng: int, // engine version, e.g. 469
    lvl: str(64), // current map name
    gm: z.boolean(), // a match game was started on this level (running or just ended): keep the bridge state
  }),
  /** A player connected. `tk` is the token from the URL; the mod already decided the role from the access list. */
  z.object({
    t: z.literal('join'),
    pid,
    tk: str(64),
    name: str(MAX_NAME_CHARS),
    role: z.enum(['a', 'b', 's']),
  }),
  z.object({ t: z.literal('leave'), pid }),
  /** A connection without a valid token was rejected. */
  z.object({ t: z.literal('reject'), name: str(MAX_NAME_CHARS), why: str(32) }),
  z.object({ t: z.literal('ready'), pid }),
  /** Up to three ranked map choices; empty string = no choice. */
  z.object({ t: z.literal('vote'), pid, m1: str(), m2: str(), m3: str() }),
  /** Countdown finished, players spawned. */
  z.object({ t: z.literal('live'), mid: str(16), g: int.positive() }),
  /** Periodic score update (every few seconds and on every frag). */
  z.object({
    t: z.literal('score'),
    mid: str(16),
    g: int.positive(),
    sa: int,
    sb: int,
    tl: int, // seconds left, -1 = no time limit
    ot: z.boolean(), // overtime / sudden death active
  }),
  /** Game ended. */
  z.object({
    t: z.literal('end'),
    mid: str(16),
    g: int.positive(),
    sa: int,
    sb: int,
    w: side,
    why: z.enum(['frag', 'time', 'sd', 'forfeit']),
  }),
  /** A match player disconnected during a live game (the mod paused the game). 1v1 only. */
  z.object({ t: z.literal('lost'), mid: str(16), s: side }),
  /** Monster Hunt race: progress of the running team (every few seconds and on every death). */
  z.object({
    t: z.literal('rp'),
    mid: str(16),
    g: int.positive(),
    n: int.min(1).max(2), // run 1 or 2 of the game
    ms: int.nonnegative(), // run time so far, pauses excluded
    d: int.nonnegative(), // deaths in the team, bots included
    pts: int, // monster points of the team
  }),
  /** Monster Hunt race: the run is over (exit reached, time limit, or no hunters left). */
  z.object({
    t: z.literal('runend'),
    mid: str(16),
    g: int.positive(),
    n: int.min(1).max(2),
    ms: int.nonnegative(),
    d: int.nonnegative(),
    pts: int,
    done: z.boolean(), // reached the exit before the time limit
  }),
  /**
   * Player statistics, sent right before `end` (n = 0) or `runend` (Monster Hunt, n = run): per
   * player or bot one `ps` and one `px` line, `pw` lines for the weapons, then `pse` with the
   * number of players. `i` links the lines of one player within the game.
   */
  z.object({
    t: z.literal('ps'),
    mid: str(16),
    g: int.positive(),
    n: int.min(0).max(2),
    i: int.nonnegative().max(63),
    tk: str(64), // the player's join token ('' for bots)
    bn: str(MAX_NAME_CHARS), // the bot's name ('' for players)
    s: side,
    k: int.nonnegative(), // kills
    d: int.nonnegative(), // deaths
    su: int.nonnegative(), // suicides
    tm: int.nonnegative(), // team kills
    sec: int.nonnegative(), // seconds in the game
  }),
  z.object({
    t: z.literal('px'),
    mid: str(16),
    g: int.positive(),
    n: int.min(0).max(2),
    i: int.nonnegative().max(63),
    hs: int.nonnegative(), // headshots
    fb: z.boolean(), // first blood
    bs: int.nonnegative(), // best spree
    sp: int.nonnegative(), // killing sprees (5 in a row)
    m2: int.nonnegative(), // double kills
    m3: int.nonnegative(), // multi kills
    m4: int.nonnegative(), // ultra kills
    m5: int.nonnegative(), // monster kills (multi kill level)
    mk: int.nonnegative(), // Monster Hunt: monsters killed
    mp: int, // Monster Hunt: monster points
  }),
  z.object({
    t: z.literal('pw'),
    mid: str(16),
    g: int.positive(),
    n: int.min(0).max(2),
    i: int.nonnegative().max(63),
    w: str(32), // weapon name
    c: int.positive(), // kills with it
  }),
  z.object({
    t: z.literal('pse'),
    mid: str(16),
    g: int.positive(),
    n: int.min(0).max(2),
    c: int.nonnegative(), // number of players sent
    sec: int.nonnegative(), // game (run) duration in seconds, pauses excluded
  }),
  /** A chat command the bridge decides on, e.g. "start" (team captain starts with bots). */
  z.object({ t: z.literal('cmd'), pid, c: str(16) }),
  z.object({ t: z.literal('hb'), up: int.nonnegative() }), // heartbeat, uptime in seconds
  z.object({ t: z.literal('err'), msg: str(200) }),
]);
export type ModToBridge = z.infer<typeof ModToBridgeSchema>;

// ---------------------------------------------------------------------------------------------
// Bridge -> Mod
// ---------------------------------------------------------------------------------------------

export const ModPhaseSchema = z.enum([
  'lobby', // waiting for check-in / between phases
  'vote', // map vote open for the next match
  'ready', // map loaded, waiting for both players to ready up
  'countdown',
  'live',
  'paused',
  'post', // game over screen, next match is being prepared
  'finished', // tournament over
]);
export type ModPhase = z.infer<typeof ModPhaseSchema>;

export const BridgeToModSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('welcome'), pv: int, rev: int }),
  /** Tournament name for the HUD. */
  z.object({ t: z.literal('title'), name: str(64) }),
  /** Snapshot framing: everything between sync begin and end replaces the mod's state. */
  z.object({ t: z.literal('sync'), st: z.enum(['begin', 'end']), rev: int }),
  /** Current phase. `sec` = seconds until the phase times out (-1 = none). */
  z.object({ t: z.literal('phase'), p: ModPhaseSchema, mid: str(16), sec: int }),
  /** Current match and rules for the running level. */
  z.object({
    t: z.literal('match'),
    mid: str(16),
    g: int.positive(), // game number in series
    bo: int.positive(),
    wa: int.nonnegative(), // series wins side a
    wb: int.nonnegative(),
    na: str(MAX_NAME_CHARS), // display name side a
    nb: str(MAX_NAME_CHARS),
    fl: int.nonnegative(), // frag limit (team score in team games), 0 = none
    tl: int.nonnegative(), // time limit minutes, 0 = none
    ts: int.min(1).max(5), // players per side: 1 = one on one, else team deathmatch
    ff: int.min(0).max(100), // team games: friendly fire in percent
  }),
  /**
   * A bot playing for a side. 1v1: the side is a bot (sent with the match). Team games: the bots
   * that fill a team, sent with the countdown, and bots standing in for disconnected players.
   */
  z.object({
    t: z.literal('bot'),
    s: side,
    name: str(MAX_NAME_CHARS),
    sk: int.min(0).max(7),
    cls: str(128),
  }),
  /** Team games: a bot joins the running game for a side (stands in for a disconnected player). */
  z.object({
    t: z.literal('botadd'),
    s: side,
    name: str(MAX_NAME_CHARS),
    sk: int.min(0).max(7),
    cls: str(128),
  }),
  /**
   * Monster Hunt race, sent with the match: which side runs on this level (the other team
   * watches), the penalty per death and the other team's finished run of this game (p* fields,
   * pt = -1 if this is the first run).
   */
  z.object({
    t: z.literal('race'),
    rs: side,
    n: int.min(1).max(2),
    pen: int.nonnegative(), // seconds per death
    pt: int.min(-1), // other team: final time in ms (time + penalty)
    pd: int.nonnegative(),
    pp: int,
    pf: z.boolean(),
    // Monster Hunt settings, applied by the mod when the next level loads (MonsterHunt reads its
    // config from MonsterHunt.ini, not from Tourney.ini): lives (0 = unlimited), monster skill,
    // weapon stay, hardcore.
    lv: int.min(0).max(99),
    mk: int.min(0).max(7),
    ws: z.boolean(),
    hc: z.boolean(),
    wf: z.boolean(), // bots use the tournament's waypoint fix (TourneyMHBotExtension)
  }),
  /**
   * Monster Hunt, after `race`: the map's record (final time in ms, -1 = none, -2 = no records:
   * the HUD hides the line) and who holds it.
   * `rn`: a better finish in this run is a new record (the tournament counts for the statistics).
   */
  z.object({ t: z.literal('mrec'), ms: int.min(-2), by: str(MAX_NAME_CHARS), rn: z.boolean() }),
  /** Team games: a stand-in bot leaves (the player is back). */
  z.object({ t: z.literal('botdel'), name: str(MAX_NAME_CHARS) }),
  /** Team games: the bridge declared a side ready (all ready, captain start, bot team). */
  z.object({ t: z.literal('tready'), s: side }),
  /** Access list header + entries. Role a/b = match player of the current match, s = spectator. */
  z.object({ t: z.literal('acl'), n: int.nonnegative(), rev: int }),
  z.object({
    t: z.literal('acle'),
    tk: str(64),
    name: str(MAX_NAME_CHARS),
    r: z.enum(['a', 'b', 's']),
  }),
  /** Incremental access change outside a snapshot. */
  z.object({
    t: z.literal('acladd'),
    tk: str(64),
    name: str(MAX_NAME_CHARS),
    r: z.enum(['a', 'b', 's']),
  }),
  z.object({ t: z.literal('acldel'), tk: str(64) }),
  /** Map vote: header, one line per option, closed by vclose. */
  z.object({ t: z.literal('vopen'), mid: str(16), n: int.positive(), sec: int.positive() }),
  z.object({ t: z.literal('vmap'), i: int.positive(), map: str(64), title: str(64) }),
  z.object({ t: z.literal('vclose'), map: str(64) }),
  /**
   * Load a map for a match. The mod performs the ServerTravel to `map` + its own game class + `opt`
   * (extra URL options such as "?mutator=BotPack.InstaGibDM").
   */
  z.object({
    t: z.literal('travel'),
    map: str(64),
    mid: str(16),
    g: int.positive(),
    opt: str(100),
  }),
  z.object({ t: z.literal('cd'), sec: int.positive() }),
  z.object({ t: z.literal('pause'), on: z.boolean(), why: str(100) }),
  /** Ends the current game, e.g. after a forfeit decided by the bridge. */
  z.object({ t: z.literal('abort'), mid: str(16), w: side, why: str(32) }),
  /** Bracket for the HUD: header + one line per match + end. */
  z.object({
    t: z.literal('brh'),
    fmt: z.enum(['single', 'double']),
    size: int.positive(),
    n: int.nonnegative(),
    rev: int,
  }),
  z.object({
    t: z.literal('brm'),
    id: str(16),
    s: z.enum(['W', 'L', 'GF']),
    r: int.positive(),
    i: int.positive(),
    na: str(MAX_NAME_CHARS), // "" = not determined yet
    nb: str(MAX_NAME_CHARS),
    sa: int, // -1 = no score
    sb: int,
    st: z.enum(['w', 'r', 'c', 'v', 'l']), // waiting, ready, completed, void, live
    w: z.enum(['a', 'b', '']),
  }),
  /** Standings for the HUD: header + one line per entrant. */
  z.object({ t: z.literal('sth'), n: int.nonnegative(), rev: int }),
  z.object({
    t: z.literal('ste'),
    name: str(MAX_NAME_CHARS),
    pl: int, // placement, 0 = still in
    w: int.nonnegative(),
    l: int.nonnegative(),
    bot: z.boolean(),
  }),
  /** Big warning in the middle of one player's screen (e.g. last reconnect before a forfeit). */
  z.object({ t: z.literal('warn'), pid: int, msg: str(160) }),
  /** Message to everyone (pid = -1) or one player. */
  z.object({ t: z.literal('say'), pid: int, msg: str(160) }),
]);
export type BridgeToMod = z.infer<typeof BridgeToModSchema>;

// ---------------------------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------------------------

export class ModLineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModLineError';
  }
}

/** Escapes everything outside printable ASCII as \uXXXX. */
function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

function assertFlat(obj: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(obj)) {
    const ok =
      typeof v === 'string' ||
      typeof v === 'boolean' ||
      (typeof v === 'number' && Number.isInteger(v));
    if (!ok) throw new ModLineError(`field "${k}" must be a string, integer or boolean`);
  }
}

/** Serializes a bridge->mod message to one wire line (with trailing newline). */
export function encodeModLine(message: BridgeToMod | ModToBridge): string {
  assertFlat(message as Record<string, unknown>);
  const line = asciiJson(message) + '\n';
  if (line.length > MAX_LINE_BYTES) {
    throw new ModLineError(
      `line has ${line.length} bytes, max is ${MAX_LINE_BYTES}: ${line.slice(0, 60)}...`,
    );
  }
  return line;
}

/** Parses and validates a mod->bridge line. Throws ModLineError on garbage. */
export function decodeModToBridge(line: string): ModToBridge {
  return decode(line, ModToBridgeSchema);
}

/** Parses and validates a bridge->mod line (used by the mod simulator and tests). */
export function decodeBridgeToMod(line: string): BridgeToMod {
  return decode(line, BridgeToModSchema);
}

function decode<T>(line: string, schema: z.ZodType<T>): T {
  const trimmed = line.replace(/\r?\n$/, '');
  if (trimmed.length + 1 > MAX_LINE_BYTES) throw new ModLineError('line too long');
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    throw new ModLineError(`not JSON: ${trimmed.slice(0, 60)}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ModLineError('not a JSON object');
  }
  assertFlat(raw as Record<string, unknown>);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ModLineError(`invalid message: ${parsed.error.message}`);
  return parsed.data;
}

/**
 * Cuts a display name so it stays within MAX_NAME_CHARS characters and MAX_NAME_WIRE_BYTES
 * bytes after escaping (a non-ASCII character costs 6 bytes as \uXXXX).
 * Characters outside the Basic Multilingual Plane (emoji) are dropped: UT99 cannot render them.
 */
export function wireName(name: string): string {
  let out = '';
  let bytes = 0;
  let chars = 0;
  for (const ch of name) {
    if (ch.length > 1) continue; // astral plane
    const cost = asciiJson(ch).length - 2;
    if (chars + 1 > MAX_NAME_CHARS || bytes + cost > MAX_NAME_WIRE_BYTES) break;
    out += ch;
    bytes += cost;
    chars++;
  }
  return out;
}

/**
 * Splits a long text into chunks that each fit into a `say` line.
 * Splits on spaces where possible.
 */
export function splitText(text: string, maxChars = 160): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    if (w.length > maxChars) {
      if (cur) out.push(cur);
      for (let i = 0; i < w.length; i += maxChars) out.push(w.slice(i, i + maxChars));
      cur = '';
      continue;
    }
    if ((cur ? cur.length + 1 : 0) + w.length > maxChars) {
      out.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  return out;
}

/** Splits an incoming TCP byte stream into lines. Keeps the incomplete remainder buffered. */
export class LineSplitter {
  private buffer = '';
  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    if (this.buffer.length > MAX_LINE_BYTES * 4) {
      this.buffer = '';
      throw new ModLineError('unterminated line exceeds buffer');
    }
    return lines.map((l) => l.replace(/\r$/, '')).filter((l) => l.length > 0);
  }
}
