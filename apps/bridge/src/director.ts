import { EventEmitter } from 'node:events';
import {
  createRng,
  nextMatch as scheduleNextMatch,
  type MatchResult,
  type Rng,
} from '@tourney/bracket';
import {
  isBotEntrant,
  projectTournament,
  type AccessEntry,
  type BotSpec,
  type KillFeedEntry,
  type BridgeToMod,
  type MapInfo,
  MAX_NAME_CHARS,
  type BotPersonality,
  type Dedication,
  type MapRecords,
  type ModPhase,
  type ModToBridge,
  type NewTournamentEvent,
  type PlayerGameStats,
  type TeamEntrant,
  type TournamentEvent,
  type TournamentProjection,
  wireName,
} from '@tourney/protocol';
import {
  ADAPTER_MH,
  finalMs,
  firstRunner,
  formatRaceTime,
  loserPickMap,
  parseRules,
  raceWinner,
  randomBallot,
  randomMap,
  resolveMapVote,
  simulateRace,
  simulateSeries,
  teamBallot,
  type Ut99DmRules,
} from '@tourney/adapter-ut99';
import { botEntrant } from './bootstrap.js';
import { blankFeed, LiveBoard, type LiveContext } from './live-board.js';
import type { Clock, TimerHandle } from './clock.js';
import type { EventStore } from './event-store.js';
import type { Logger } from './log.js';
import type { ModHello, ModLink } from './mod-server.js';
import {
  aclLines,
  botConfigLines,
  bracketLines,
  entrantName,
  matchLines,
  phaseLine,
  seriesWins,
  standingsLines,
  travelLine,
  voteLines,
  type RoleContext,
  type Side,
} from './snapshot.js';
import {
  actingCaptain,
  botSkill,
  isMember,
  isTeam,
  lineupFor,
  memberName,
  pickBots,
} from './teams.js';

export interface DirectorTiming {
  /** Minimum time between the end of a game and the next map change (scoreboard time). */
  postGameDelayMs: number;
  /** Delay before a simulated bot vs bot match is decided. */
  simulateDelayMs: number;
  /** Re-send the travel command if the mod has not come back on the new map after this long. */
  loadingTimeoutMs: number;
  /** While the tournament waits for someone, tell the server who and why this often (0 = off). */
  reminderIntervalMs: number;
  /** Team games: a bot takes the place of a disconnected player after this long. */
  standInDelayMs: number;
  /** Team games: captains may start with bots for missing players after this long in the ready check. */
  captainStartMs: number;
}

const DEFAULT_TIMING: DirectorTiming = {
  postGameDelayMs: 10_000,
  simulateDelayMs: 3_000,
  loadingTimeoutMs: 90_000,
  reminderIntervalMs: 30_000,
  standInDelayMs: 20_000,
  captainStartMs: 60_000,
};

/** Events from the website that do not change the course of the tournament (applied in passing). */
const PASSIVE_EVENTS = new Set<string>(['team.lineupSet']);

const cloneRecords = (r: MapRecords): MapRecords => ({
  counts: r.counts,
  maps: r.maps.map((m) => ({ ...m })),
});

/** The record of a map (UT map names are case-insensitive). */
function recordFor(r: MapRecords | undefined, map: string) {
  const k = map.toLowerCase();
  return r?.maps.find((m) => m.map.toLowerCase() === k);
}

export interface DirectorOptions {
  tournamentId: string;
  agentId: string;
  store: EventStore;
  mod: ModLink;
  clock: Clock;
  log: Logger;
  access: AccessEntry[];
  botPool: BotSpec[];
  /** Map metadata from the inventory, used for vote titles. */
  maps?: MapInfo[];
  /** Monster Hunt: map records from the statistics (shown in the HUD). */
  mapRecords?: MapRecords;
  /** Personalities of the website bots (chat lines, rivals). */
  botPersonalities?: readonly BotPersonality[];
  /** Players' dedications (Neuro shop), sent with each match. */
  dedications?: readonly Dedication[];
  /**
   * Betting (website): a match takes bets for at least this many seconds after it was called;
   * when everybody is ready earlier, the countdown of its first game waits. 0 = no betting.
   */
  betWindowSec?: number;
  /** Bot AI help in deathmatch (0 off, 1 failsafe, 2 also duel mode), sent with each match. */
  antiIdle?: number;
  /** Bot skill curve (mod 0.13.0, all game types), sent with each match; default on. */
  skillCurve?: boolean;
  timing?: Partial<DirectorTiming>;
}

/** Non-persistent match telemetry for the website. */
export interface LiveInfo {
  tournamentId: string;
  matchId: string;
  game: number;
  phase: 'voting' | 'loading' | 'readyCheck' | 'countdown' | 'live' | 'paused' | 'post';
  map?: string;
  scores?: Record<string, number>;
  ready?: Record<string, boolean>;
  deadline?: number;
  /** Monster Hunt race: the run in progress. */
  race?: {
    runner: string;
    run: number;
    timeMs: number;
    deaths: number;
    penaltyMs: number;
    points: number;
  };
}

type VoteMethod = 'vote' | 'loserPick';

/** An event as the director writes it; actor, seq and timestamp are added on append. */
type EventDraft = NewTournamentEvent extends infer E
  ? E extends NewTournamentEvent
    ? Omit<E, 'actor'>
    : never
  : never;

type Stage =
  | { kind: 'idle' }
  | { kind: 'checkIn'; deadline: number }
  | { kind: 'between' }
  | {
      kind: 'voting';
      matchId: string;
      game: number;
      method: VoteMethod;
      voters: string[];
      ballots: Map<string, string[]>;
      deadline: number;
    }
  | { kind: 'loading'; matchId: string; game: number; map: string }
  | ({
      kind: 'readyCheck';
      matchId: string;
      game: number;
      map: string;
      deadline: number;
    } & ReadyState)
  | ({ kind: 'countdown'; matchId: string; game: number; map: string } & ReadyState)
  | {
      kind: 'live';
      matchId: string;
      game: number;
      map: string;
      scores: [number, number];
      lost?: string;
    }
  | { kind: 'simulating'; matchId: string }
  | { kind: 'finished'; deadline: number };

/**
 * Who is on the server and ready. Keys are entrant ids in 1v1 and user ids in team games.
 * Kept from the ready check into the countdown, so a player leaving the countdown does not
 * reset everybody else.
 */
/** The statistics lines of one player in one game (run), see `collectStat`. */
interface StatLine {
  ps?: Extract<ModToBridge, { t: 'ps' }>;
  px?: Extract<ModToBridge, { t: 'px' }>;
  weapons: Record<string, number>;
}

interface ReadyState {
  ready: Set<string>;
  present: Set<string>;
  /** Team games: teams the bridge declared ready (all ready, captain start, time up). */
  teamReady: Set<string>;
  /** Start of the ready check (captains may start with bots some time after). */
  since: number;
}

interface ConnectedPlayer {
  pid: number;
  token: string;
  name: string;
  userId?: string;
  entrantId?: string;
}

/**
 * Drives a tournament on one game server: check-in, match order, map vote, travel, ready check,
 * countdown, live game, forfeits, best-of series and the final.
 *
 * All decisions are written to the event log first; the in-memory stage only tracks what is
 * happening on the server right now. Inputs (mod lines, timers, commands) are processed strictly
 * one after another through a queue.
 */
export class MatchDirector extends EventEmitter {
  private events: TournamentEvent[] = [];
  private proj!: TournamentProjection;
  private rules!: Ut99DmRules;
  private stage: Stage = { kind: 'idle' };
  private players = new Map<number, ConnectedPlayer>();
  private rev = 0;
  private queue: Promise<void> = Promise.resolve();
  private timer?: {
    handle: TimerHandle;
    due: number;
    fn: () => Promise<void> | void;
    /** What the timer waits for (betting phase). */
    tag?: string;
  };
  private suspended?: { remaining: number; fn: () => Promise<void> | void };
  private cooldownUntil = 0;
  /** Disconnects per match and entrant during live games (for maxReconnects). */
  private disconnects = new Map<string, Map<string, number>>();
  private readonly timing: DirectorTiming;
  /** Who may join the server; replaced by the website while the tournament runs. */
  private access: AccessEntry[];
  /** Monster Hunt: map records (statistics); kept current with the runs of this tournament. */
  private mapRecords?: MapRecords;
  /** Betting window in ms (0: none) and when each match was called. */
  private betWindowMs = 0;
  private antiIdle = 0;
  private skillCurve = true;
  private calledAt = new Map<string, number>();
  /** Website bots' personalities by lower-case name in the game. */
  private personas = new Map<string, BotPersonality>();
  /** Players' dedications (Neuro shop). */
  private dedications: readonly Dedication[] = [];
  /**
   * Team games: line-up of the current game (user ids per entrant), fixed before the map loads.
   * Monster Hunt: per run, only the running team has a line-up.
   */
  private lineup?: {
    matchId: string;
    game: number;
    run: number;
    sides: Record<string, string[]>;
  };
  /** Team games: bots playing the current game per entrant (from the countdown on). */
  private gameBots: Record<string, BotSpec[]> = {};
  /** Team games: who played the current game, for match.started. */
  private startLineups?: Record<string, { name: string; userId?: string; bot?: boolean }[]>;
  /** Team games: bots standing in for disconnected players (user id -> bot) and pending timers. */
  private standIns = new Map<string, { entrantId: string; bot: BotSpec }>();
  private standInTimers = new Map<string, TimerHandle>();
  /** Team games: players out for the rest of a match (too many disconnects), per match id. */
  private benched = new Map<string, Set<string>>();
  private captainTimer?: TimerHandle;
  /** Monster Hunt: the last progress of the run in progress (for a forfeit by the organizer). */
  private lastProgress?: {
    matchId: string;
    game: number;
    run: number;
    ms: number;
    d: number;
    pts: number;
  };

  constructor(private readonly o: DirectorOptions) {
    super();
    this.timing = { ...DEFAULT_TIMING, ...o.timing };
    this.access = [...o.access];
    if (o.mapRecords) this.mapRecords = cloneRecords(o.mapRecords);
    this.setPersonas(o.botPersonalities);
    this.dedications = [...(o.dedications ?? [])];
    this.betWindowMs = Math.max(0, (o.betWindowSec ?? 0) * 1000);
    this.antiIdle = clampAi(o.antiIdle);
    this.skillCurve = o.skillCurve ?? true;
    this.board = new LiveBoard(
      o.clock,
      (state) => this.emit('state', state),
      (entry) => this.emit('feed', entry),
      (thought) => this.emit('thought', thought),
    );
  }

  // -------------------------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------------------------

  private readonly onHelloListener = (h: ModHello) => void this.enqueue(() => this.onHello(h));
  private readonly onMessageListener = (m: Exclude<ModToBridge, ModHello>) =>
    void this.enqueue(() => this.onMessage(m));
  private stopped = false;
  /** Player statistics lines of the current game/run (ps, px, pw), until `pse` completes them. */
  private statLines = new Map<string, StatLine>();
  private reminder?: TimerHandle;
  /** When the game (Monster Hunt: run) in progress went live (feed times). */
  private liveSince?: number;
  /** Live data of the game in progress (mod 0.16.0): `state`, items and thoughts in the feed. */
  private readonly board: LiveBoard;

  start(): Promise<void> {
    this.o.mod.on('hello', this.onHelloListener);
    this.o.mod.on('message', this.onMessageListener);
    this.scheduleReminder();
    return this.enqueue(async () => {
      await this.reload();
      await this.resumeFromProjection();
    });
  }

  /** Detaches from the mod link and cancels timers. The event log is untouched. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.o.mod.off('hello', this.onHelloListener);
    this.o.mod.off('message', this.onMessageListener);
    await this.queue;
    this.clearTimer();
    if (this.reminder) this.o.clock.clearTimeout(this.reminder);
  }

  /**
   * What the tournament is waiting for right now, as one line for the players, or undefined
   * if nothing is blocking (e.g. a game is running normally).
   */
  waitingFor(): string | undefined {
    const now = this.o.clock.now();
    const left = (deadline: number | undefined) => {
      if (deadline === undefined) return '';
      const s = Math.max(0, Math.round((deadline - now) / 1000));
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    };
    const names = (ids: string[]) => {
      const shown = ids.slice(0, 5).map((id) => this.name(id));
      return ids.length > 5 ? `${shown.join(', ')} +${ids.length - 5} more` : shown.join(', ');
    };
    if (this.proj.phase === 'paused') {
      return `Tournament paused by the organizer: ${this.proj.pausedReason ?? ''}`.trim();
    }
    const s = this.stage;
    switch (s.kind) {
      case 'checkIn': {
        if (this.teamMode) {
          const short = this.humans().filter(
            (id) => this.checkedInCount(id) < this.checkInTarget(id),
          );
          if (!short.length) return undefined;
          const list = short
            .slice(0, 5)
            .map((id) => `${this.name(id)} ${this.checkedInCount(id)}/${this.checkInTarget(id)}`)
            .join(', ');
          return `Waiting for check-in: ${list}${short.length > 5 ? ` +${short.length - 5} more` : ''}. Start in ${left(s.deadline)}; teams with nobody here play with bots.`;
        }
        const missing = this.humans().filter((id) => !this.proj.checkedIn.includes(id));
        if (!missing.length) return undefined;
        const total = this.humans().length;
        return `Waiting for check-in (${total - missing.length}/${total}): ${names(missing)}. Start in ${left(s.deadline)}, missing players are replaced by bots.`;
      }
      case 'voting': {
        const open = s.voters.filter((v) => !s.ballots.has(v));
        if (!open.length) return undefined;
        const shown = open.slice(0, 5).map((v) => this.voterName(v));
        const who =
          open.length > 5 ? `${shown.join(', ')} +${open.length - 5} more` : shown.join(', ');
        return `Map vote ${s.matchId}: waiting for ${who}. Type !vote 2 1 3 (${left(s.deadline)} left).`;
      }
      case 'readyCheck': {
        const { entrants } = this.current();
        if (this.teamMode) {
          const open = entrants.filter((e) => !this.teamIsReady(s, e));
          if (!open.length) return undefined;
          const parts = open.map((e) => {
            const lineup = this.lineupOf(e);
            const here = lineup.filter((u) => s.present.has(u)).length;
            const ready = lineup.filter((u) => s.ready.has(u)).length;
            return `${this.name(e)} ${ready}/${lineup.length} ready${here < lineup.length ? `, ${lineup.length - here} not here` : ''}`;
          });
          const startIn = s.since + this.timing.captainStartMs - now;
          const hint =
            startIn > 0
              ? `Captains can !start with bots in ${left(s.since + this.timing.captainStartMs)}`
              : 'Captains can !start now, bots fill missing places';
          return `${s.matchId} waits for READY (FIRE or !ready): ${parts.join('; ')}. ${hint}. Time up in ${left(s.deadline)}.`;
        }
        const open = entrants.filter((e) => !this.isBot(e) && !s.ready.has(e));
        if (!open.length) return undefined;
        const who = open
          .map(
            (e) =>
              `${this.name(e)} (${s.present.has(e) ? 'press FIRE or !ready' : 'not connected'})`,
          )
          .join(', ');
        return `${s.matchId} waits for READY: ${who}. Forfeit in ${left(s.deadline)}.`;
      }
      case 'live':
        if (!s.lost) return undefined;
        return `Game paused: ${this.name(s.lost)} disconnected. Forfeit in ${left(this.timer?.due)} unless they reconnect.`;
      default:
        return undefined;
    }
  }

  private scheduleReminder(): void {
    if (this.stopped || this.timing.reminderIntervalMs <= 0) return;
    this.reminder = this.o.clock.setTimeout(() => {
      void this.enqueue(() => {
        const msg = this.waitingFor();
        if (msg) this.say(msg);
        this.scheduleReminder();
      });
    }, this.timing.reminderIntervalMs);
  }

  /** Resolves when all queued work is done (tests). */
  idle(): Promise<void> {
    return this.queue;
  }

  get projection(): TournamentProjection {
    return this.proj;
  }

  get stageKind(): Stage['kind'] {
    return this.stage.kind;
  }

  forceStart(): Promise<void> {
    return this.enqueue(async () => {
      if (this.stage.kind === 'checkIn') await this.startTournament();
    });
  }

  pause(reason: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.proj.phase !== 'running' && this.proj.phase !== 'checkIn') return;
      if (!(await this.append({ type: 'tournament.paused', data: { reason } }))) return;
      this.suspendTimer();
      this.send([{ t: 'pause', on: true, why: reason.slice(0, 100) }, this.phase()]);
      this.telemetry('paused');
    });
  }

  /** Website mode: the bridge opens check-in itself once the server is up. */
  openCheckIn(serverProfileId: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.proj.phase !== 'seeded') return;
      if (!(await this.append({ type: 'checkin.opened', data: { serverProfileId } }))) return;
      await this.enterCheckIn();
    });
  }

  /** Ends the tournament early (organizer decision). */
  abort(reason: string): Promise<void> {
    return this.enqueue(async () => {
      const ph = this.proj.phase;
      if (ph === 'finished' || ph === 'aborted' || ph === 'draft') return;
      if (!(await this.append({ type: 'tournament.aborted', data: { reason } }))) return;
      this.clearTimer();
      this.stage = { kind: 'idle' };
      this.say(`The tournament was stopped by the organizer: ${reason}`);
      this.send(this.snapshot());
      this.emit('aborted', reason);
    });
  }

  announce(message: string): Promise<void> {
    return this.enqueue(() => this.say(message));
  }

  /** Replaces the access list (website: watchers, new join tokens) and updates the server. */
  setAccess(entries: readonly AccessEntry[]): Promise<void> {
    return this.enqueue(() => {
      this.access = [...entries];
      this.send(this.aclFor(this.proj.currentMatch?.entrants));
    });
  }

  /** New betting window from the website (0: the tournament takes no bets). */
  setBetWindow(sec: number | undefined): Promise<void> {
    return this.enqueue(() => {
      this.betWindowMs = Math.max(0, (sec ?? 0) * 1000);
    });
  }

  /** New bot AI help from the website: used from the next match line on. */
  setAntiIdle(level: number | undefined): Promise<void> {
    return this.enqueue(() => {
      this.antiIdle = clampAi(level);
    });
  }

  /** New bot skill curve setting from the website: used from the next match line on. */
  setSkillCurve(on: boolean): Promise<void> {
    return this.enqueue(() => {
      this.skillCurve = on;
    });
  }

  /** New bot personalities from the website: used from the next bot lines on. */
  setBotPersonalities(list: readonly BotPersonality[] | undefined): Promise<void> {
    return this.enqueue(() => this.setPersonas(list));
  }

  /** New dedications from the website: sent with the next match lines. */
  setDedications(list: readonly Dedication[] | undefined): Promise<void> {
    return this.enqueue(() => {
      this.dedications = [...(list ?? [])];
    });
  }

  private setPersonas(list: readonly BotPersonality[] | undefined) {
    this.personas = new Map((list ?? []).map((p) => [p.name.toLowerCase(), p]));
  }

  /** Monster Hunt: new map records from the website; the HUD of a running race is updated. */
  setMapRecords(records: MapRecords | undefined): Promise<void> {
    return this.enqueue(() => {
      this.mapRecords = records ? cloneRecords(records) : undefined;
      const cm = this.proj.currentMatch;
      if (this.raceMode && cm?.map && this.runner()) this.send([this.mrecLine(cm.map)]);
    });
  }

  /** The `mrec` line for a map: its record (or none) and whether a better finish counts. */
  private mrecLine(map: string): BridgeToMod {
    if (!this.mapRecords) return { t: 'mrec', ms: -2, by: '', rn: false }; // the HUD hides it
    const rec = recordFor(this.mapRecords, map);
    return {
      t: 'mrec',
      ms: rec ? rec.finalMs : -1,
      by: rec ? rec.by.slice(0, MAX_NAME_CHARS) : '',
      rn: this.mapRecords.counts,
    };
  }

  /**
   * Somebody else changed the log (an admin on the website while the bridge was offline):
   * reload and continue from the new state.
   */
  refresh(): Promise<void> {
    return this.enqueue(async () => {
      const before = this.proj.headSeq;
      const onServer = this.stageMatch();
      await this.reload();
      if (this.proj.headSeq === before) return;
      const fresh = this.events.slice(before);
      if (fresh.every((e) => PASSIVE_EVENTS.has(e.type))) {
        // A captain changed the line-up: it applies to the next game, nothing to re-plan.
        this.o.log.info(`applied ${fresh.map((e) => e.type).join(', ')} from the website`);
        return;
      }
      this.callOffIfGone(onServer);
      await this.resumeFromProjection();
      if (this.proj.phase === 'aborted') this.emit('aborted', this.proj.abortedReason ?? '');
    });
  }

  /** Players currently on the server (for status reports). */
  connectedPlayers(): { name: string; userId?: string; role: 'player' | 'spectator' }[] {
    const match: readonly string[] = this.proj?.currentMatch?.entrants ?? [];
    return [...this.players.values()].map((p) => ({
      name: p.name,
      ...(p.userId ? { userId: p.userId } : {}),
      role: p.entrantId && match.includes(p.entrantId) ? 'player' : 'spectator',
    }));
  }

  resume(): Promise<void> {
    return this.enqueue(async () => {
      if (this.proj.phase !== 'paused') return;
      if (!(await this.append({ type: 'tournament.resumed', data: {} }))) return;
      this.send([{ t: 'pause', on: false, why: '' }, this.phase()]);
      this.rearmTimer();
    });
  }

  /**
   * Organizer: plays the current game (Monster Hunt: the current run) again on the same map:
   * the map is loaded again and the ready check starts over. Earlier games of the series stay.
   */
  restartGame(matchId: string): Promise<void> {
    return this.enqueueChecked(async () => {
      const cm = this.proj.currentMatch;
      if (!cm || cm.matchId !== matchId) throw new Error(`match ${matchId} is not running`);
      if (this.proj.phase === 'paused')
        throw new Error('the tournament is paused, resume it first');
      if (!cm.map) throw new Error(`${matchId} has no map yet (map vote)`);
      const what = this.raceMode ? `run ${this.raceRun()} of game ${cm.game}` : `game ${cm.game}`;
      this.say(`The organizer restarts ${what} of ${matchId} on ${cm.map}`);
      if (this.stage.kind === 'live') {
        const winner = cm.entrants[0];
        // Ends the running game without a result; the travel follows right away.
        this.send([{ t: 'abort', mid: cm.matchId, w: this.sideOf(winner) ?? 'a', why: 'restart' }]);
      }
      this.o.log.info(`restarting ${matchId} ${what} (organizer)`);
      await this.travel(cm.matchId, cm.game, cm.map);
    });
  }

  // -------------------------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------------------------

  /** The match the server is busy with right now (vote, loading, ready, countdown, live). */
  private stageMatch(): { matchId: string; live: boolean } | undefined {
    const s = this.stage;
    if (!('matchId' in s) || s.kind === 'simulating') return undefined;
    return { matchId: s.matchId, live: s.kind === 'live' || s.kind === 'countdown' };
  }

  /**
   * After a change from the website: if the match on the server is no longer the current match
   * (an organizer set its result, or changed an earlier result so its pairing changed), end it
   * on the server and tell the players.
   */
  private callOffIfGone(onServer: { matchId: string; live: boolean } | undefined): void {
    if (!onServer || this.proj.currentMatch?.matchId === onServer.matchId) return;
    const { matchId } = onServer;
    this.clearTimer();
    this.resetGame();
    this.lineup = undefined;
    this.cooldownUntil = this.o.clock.now() + this.timing.postGameDelayMs;
    const result = this.proj.results.filter((r) => r.matchId === matchId).at(-1);
    const node = this.proj.bracket?.byId[matchId];
    const decided = !!result && node?.status === 'completed' && node.winnerId === result.winnerId;
    if (onServer.live) {
      const w = decided && result.entrants[1] === result.winnerId ? 'b' : 'a';
      this.send([{ t: 'abort', mid: matchId, w, why: decided ? 'admin' : 'void' }]);
    }
    this.say(
      decided
        ? `The organizer decided ${matchId}: ${this.name(result.winnerId)} wins`
        : `The organizer changed an earlier result: ${matchId} is called off and will be played later`,
    );
    this.o.log.info(`${matchId} called off on the server (changed on the website)`);
    this.stage = { kind: 'between' };
  }

  /** Like enqueue, but the caller gets the error (commands from the website report it back). */
  private enqueueChecked(fn: () => Promise<void> | void): Promise<void> {
    let failure: unknown;
    let failed = false;
    return this.enqueue(async () => {
      try {
        await fn();
      } catch (e) {
        failed = true;
        failure = e;
      }
    }).then(() => {
      if (failed) throw failure;
    });
  }

  private enqueue(fn: () => Promise<void> | void): Promise<void> {
    this.queue = this.queue
      .then(() => (this.stopped ? undefined : fn()))
      .catch((e: unknown) => {
        this.o.log.error(`director: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
      });
    return this.queue;
  }

  private async reload(): Promise<void> {
    this.events = await this.o.store.load(this.o.tournamentId);
    if (this.events.length === 0)
      throw new Error(`tournament ${this.o.tournamentId} has no events`);
    this.proj = projectTournament(this.events);
    this.rules = parseRules(this.proj.settings.game.rules);
  }

  /**
   * Appends events. On a concurrency conflict it reloads; if only passive events came in
   * between (a line-up change), it appends again on top of them, otherwise it re-plans and
   * returns false.
   */
  private async append(...events: EventDraft[]): Promise<boolean> {
    const actor = { kind: 'bridge' as const, id: this.o.agentId };
    const full = events.map((e) => ({ ...e, actor })) as NewTournamentEvent[];
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await this.o.store.append(this.o.tournamentId, this.proj.headSeq, full);
      if (res.accepted) {
        this.events.push(...res.events);
        this.proj = projectTournament(this.events);
        return true;
      }
      const before = this.proj.headSeq;
      const onServer = this.stageMatch();
      await this.reload();
      const fresh = this.events.slice(before);
      if (fresh.length && fresh.every((e) => PASSIVE_EVENTS.has(e.type))) continue;
      this.o.log.warn(`event append rejected (${res.reason}), re-planning`);
      this.callOffIfGone(onServer);
      await this.resumeFromProjection();
      return false;
    }
    this.o.log.warn('event append kept being rejected, re-planning');
    await this.resumeFromProjection();
    return false;
  }

  /** How long the first game of a match still waits for bets (ms; 0 = no waiting). */
  private betHoldMs(matchId: string, game: number): number {
    if (!this.betWindowMs || game !== 1) return 0;
    const at = this.calledAt.get(matchId);
    if (at === 0) return 0; // waited already
    // Not known (bridge restarted): a full window.
    const since = at === undefined ? 0 : this.o.clock.now() - at;
    return Math.max(0, this.betWindowMs - since);
  }

  private setTimer(ms: number, fn: () => Promise<void> | void, tag?: string): void {
    this.clearTimer();
    if (this.proj.phase === 'paused') {
      this.suspended = { remaining: ms, fn };
      return;
    }
    const handle = this.o.clock.setTimeout(() => {
      if (this.timer?.handle === handle) this.timer = undefined;
      void this.enqueue(fn);
    }, ms);
    this.timer = { handle, due: this.o.clock.now() + ms, fn, ...(tag ? { tag } : {}) };
  }

  private clearTimer(): void {
    if (this.timer) this.o.clock.clearTimeout(this.timer.handle);
    this.timer = undefined;
    this.suspended = undefined;
  }

  private suspendTimer(): void {
    if (!this.timer) return;
    const remaining = Math.max(0, this.timer.due - this.o.clock.now());
    const fn = this.timer.fn;
    this.clearTimer();
    this.suspended = { remaining, fn };
  }

  private rearmTimer(): void {
    const s = this.suspended;
    this.suspended = undefined;
    if (s) this.setTimer(s.remaining, s.fn);
  }

  private send(lines: readonly BridgeToMod[]): void {
    this.o.mod.send(lines);
  }

  private say(msg: string, pid = -1): void {
    this.o.log.info(`say: ${msg}`);
    this.send([{ t: 'say', pid, msg: msg.slice(0, 160) }]);
  }

  private rng(...parts: (string | number)[]): Rng {
    return createRng(
      [this.proj.rngSeed ?? this.o.tournamentId, this.proj.headSeq, ...parts].join('|'),
    );
  }

  private get pool(): string[] {
    return this.rules.mapPool;
  }

  private name(entrantId: string | undefined): string {
    return entrantName(this.proj, entrantId) || '?';
  }

  private isBot(entrantId: string): boolean {
    return isBotEntrant(this.proj.entrants[entrantId]);
  }

  private get teamMode(): boolean {
    return this.proj.settings.teamSize > 1;
  }

  private get teamSize(): number {
    return this.proj.settings.teamSize;
  }

  /** Monster Hunt: every game is two runs on the same map, one per team, the faster wins. */
  private get raceMode(): boolean {
    return this.proj.settings.game.adapter === ADAPTER_MH;
  }

  /** Monster Hunt: the run of the current game being prepared or played (1 or 2). */
  private raceRun(): number {
    return (this.proj.currentMatch?.runs?.length ?? 0) + 1;
  }

  /** Monster Hunt: the team that runs next (or now); undefined outside a race game. */
  private runner(): string | undefined {
    const cm = this.proj.currentMatch;
    return cm?.runOrder?.[cm.runs?.length ?? 0];
  }

  /** Entrants that play on the server right now: both, or in a race only the running team. */
  private activeEntrants(): string[] {
    const { entrants } = this.current();
    const runner = this.raceMode ? this.runner() : undefined;
    return runner ? [runner] : [...entrants];
  }

  private team(entrantId: string | undefined): TeamEntrant | undefined {
    const e = entrantId ? this.proj.entrants[entrantId] : undefined;
    return isTeam(e) ? e : undefined;
  }

  /** Website users on the server right now. */
  private connectedUsers(): Set<string> {
    const out = new Set<string>();
    for (const p of this.players.values()) if (p.userId) out.add(p.userId);
    return out;
  }

  private pidOf(userId: string): number | undefined {
    for (const p of this.players.values()) if (p.userId === userId) return p.pid;
    return undefined;
  }

  private userName(userId: string): string {
    for (const e of Object.values(this.proj.entrants)) {
      if (isMember(e, userId)) return memberName(e as TeamEntrant, userId);
    }
    return this.access.find((a) => a.userId === userId)?.displayName ?? userId;
  }

  /** Names voters: entrants in 1v1, players in team games. */
  private voterName(key: string): string {
    return this.teamMode ? this.userName(key) : this.name(key);
  }

  /** Team games: the line-up of an entrant for the current game (empty for bot teams). */
  private lineupOf(entrantId: string): string[] {
    const cm = this.proj.currentMatch;
    if (!this.lineup || !cm || this.lineup.matchId !== cm.matchId) return [];
    return this.lineup.sides[entrantId] ?? [];
  }

  private benchedIn(matchId: string): Set<string> {
    let set = this.benched.get(matchId);
    if (!set) {
      set = new Set();
      this.benched.set(matchId, set);
    }
    return set;
  }

  private roleContext(): RoleContext {
    const cm = this.proj.currentMatch;
    const ctx: RoleContext = {};
    if (!cm || !this.teamMode) return ctx;
    if (this.lineup?.matchId === cm.matchId) ctx.lineup = this.lineup.sides;
    const benched = this.benched.get(cm.matchId);
    if (benched) ctx.excluded = benched;
    return ctx;
  }

  private aclFor(entrants: readonly [string, string] | undefined): BridgeToMod[] {
    return aclLines(this.proj, this.access, entrants, ++this.rev, this.roleContext());
  }

  /** Team games: bots of the current game per entrant, including stand-ins. */
  private teamBots(): Record<string, BotSpec[]> {
    const out: Record<string, BotSpec[]> = {};
    for (const [id, bots] of Object.entries(this.gameBots)) out[id] = [...bots];
    for (const s of this.standIns.values()) (out[s.entrantId] ??= []).push(s.bot);
    return out;
  }

  private matchLinesFor(
    matchId: string,
    game: number,
    entrants: readonly [string, string],
  ): BridgeToMod[] {
    const lines = matchLines(
      this.proj,
      this.rules,
      matchId,
      game,
      entrants,
      this.teamMode ? this.teamBots() : undefined,
      this.personas,
      this.dedications,
    );
    const head = lines[0];
    // Monster Hunt has its own bot help; the mod applies this to deathmatch games only.
    if (head?.t === 'match' && this.antiIdle > 0 && !this.raceMode) head.ai = this.antiIdle;
    // The skill curve applies to all game types (Monster Hunt too).
    if (head?.t === 'match') head.sc = this.skillCurve ? 1 : 0;
    const cm = this.proj.currentMatch;
    const runner = this.raceMode ? this.runner() : undefined;
    if (cm?.matchId === matchId && cm.game === game && runner) {
      const prev = cm.runs?.[0];
      lines.push({
        t: 'race',
        rs: entrants[0] === runner ? 'a' : 'b',
        n: this.raceRun(),
        pen: this.rules.penaltySec,
        pt: prev ? finalMs(prev) : -1,
        pd: prev?.deaths ?? 0,
        pp: prev?.points ?? 0,
        pf: prev?.finished ?? false,
        lv: this.rules.lives,
        mk: this.rules.monsterSkill,
        ws: this.rules.weaponStay,
        hc: this.rules.hardcore,
        wf: true, // Monster Hunt bot AI enhancements, always on (mod 0.6.0 still reads the flag)
      });
      if (this.mapRecords && cm.map) lines.push(this.mrecLine(cm.map));
    }
    return lines;
  }

  /** Team games: a team is ready when it is made of bots, was declared ready, or its line-up is. */
  private teamIsReady(s: ReadyState, entrantId: string): boolean {
    if (this.isBot(entrantId) || s.teamReady.has(entrantId)) return true;
    const lineup = this.lineupOf(entrantId);
    return lineup.every((u) => s.present.has(u) && s.ready.has(u));
  }

  private treadyLines(s: ReadyState): BridgeToMod[] {
    const cm = this.proj.currentMatch;
    if (!this.teamMode || !cm) return [];
    return cm.entrants
      .map((e, i): BridgeToMod | undefined =>
        this.teamIsReady(s, e) ? { t: 'tready', s: i === 0 ? 'a' : 'b' } : undefined,
      )
      .filter((l): l is BridgeToMod => l !== undefined);
  }

  /** Clears what belongs to one game on the server (bots, stand-ins, timers). */
  private resetGame(): void {
    for (const t of this.standInTimers.values()) this.o.clock.clearTimeout(t);
    this.standInTimers.clear();
    this.standIns.clear();
    this.gameBots = {};
    this.startLineups = undefined;
    if (this.captainTimer) this.o.clock.clearTimeout(this.captainTimer);
    this.captainTimer = undefined;
    this.board.reset();
    this.liveSince = undefined;
  }

  /** The game (run) in progress for the live data and the feed. */
  private liveCtx(s: { matchId: string; game: number }): LiveContext {
    const cm = this.proj.currentMatch;
    const runner = this.raceMode ? (this.runner() ?? null) : null;
    const since = this.liveSince;
    return {
      tournamentId: this.o.tournamentId,
      matchId: s.matchId,
      game: s.game,
      ...(this.raceMode ? { run: this.raceRun() } : {}),
      // Race mode: the running team plays alone, its side is the runner.
      sideEntrant: (n) => (n > 1 ? null : this.raceMode ? runner : (cm?.entrants[n] ?? null)),
      player: (token) => {
        const { entry } = this.entrantFor(token);
        return entry
          ? { ...(entry.userId ? { userId: entry.userId } : {}), name: entry.displayName }
          : undefined;
      },
      sec: () =>
        since === undefined
          ? undefined
          : Math.max(0, Math.floor((this.o.clock.now() - since) / 1000)),
    };
  }

  /** Live lines belong to the game (run) on the server right now. */
  private isLiveGame(mid: string, g: number, n: number): boolean {
    const s = this.stage;
    if (s.kind !== 'live' || s.matchId !== mid || s.game !== g) return false;
    return this.raceMode ? n === this.raceRun() : n === 0;
  }

  private current(): { matchId: string; entrants: [string, string] } {
    const cm = this.proj.currentMatch;
    if (!cm) throw new Error('no current match');
    return cm;
  }

  private telemetry(phase: LiveInfo['phase'], extra: Partial<LiveInfo> = {}): void {
    const cm = this.proj.currentMatch;
    if (!cm) return;
    this.emit('live', {
      tournamentId: this.o.tournamentId,
      matchId: cm.matchId,
      game: cm.game,
      phase,
      ...(cm.map ? { map: cm.map } : {}),
      ...extra,
    } satisfies LiveInfo);
  }

  // -------------------------------------------------------------------------------------------
  // Snapshot / phases
  // -------------------------------------------------------------------------------------------

  private phase(): BridgeToMod {
    const s = this.stage;
    const secs = (deadline: number) =>
      Math.max(0, Math.round((deadline - this.o.clock.now()) / 1000));
    if (this.proj.phase === 'paused')
      return phaseLine('paused', this.proj.currentMatch?.matchId ?? '');
    const map: Record<Stage['kind'], ModPhase> = {
      idle: 'lobby',
      checkIn: 'lobby',
      between: 'post',
      voting: 'vote',
      loading: 'post',
      readyCheck: 'ready',
      countdown: 'countdown',
      live: 'live',
      simulating: 'post',
      finished: 'finished',
    };
    const mid = 'matchId' in s ? s.matchId : (this.proj.currentMatch?.matchId ?? '');
    const sec = 'deadline' in s ? secs(s.deadline) : -1;
    return phaseLine(map[s.kind], mid, sec);
  }

  private bracketUpdate(): BridgeToMod[] {
    this.rev++;
    const live = this.stage.kind === 'live' ? this.stage.matchId : undefined;
    return [...bracketLines(this.proj, live, this.rev), ...standingsLines(this.proj, this.rev)];
  }

  private snapshot(): BridgeToMod[] {
    this.rev++;
    const cm = this.proj.currentMatch;
    const lines: BridgeToMod[] = [
      { t: 'welcome', pv: 1, rev: this.rev },
      { t: 'sync', st: 'begin', rev: this.rev },
      { t: 'title', name: wireName(this.proj.name) },
    ];
    if (cm) lines.push(...this.matchLinesFor(cm.matchId, cm.game, cm.entrants));
    lines.push(...aclLines(this.proj, this.access, cm?.entrants, this.rev, this.roleContext()));
    lines.push(...this.bracketUpdate());
    if (this.stage.kind === 'voting') {
      lines.push(
        ...voteLines(
          this.stage.matchId,
          this.voteOptions(),
          this.secondsUntil(this.stage.deadline),
        ),
      );
    }
    if (this.stage.kind === 'live' && this.stage.lost) {
      lines.push({ t: 'pause', on: true, why: `${this.name(this.stage.lost)} disconnected` });
    }
    if (this.stage.kind === 'readyCheck' || this.stage.kind === 'countdown') {
      lines.push(...this.treadyLines(this.stage));
    }
    lines.push(this.phase(), { t: 'sync', st: 'end', rev: this.rev });
    return lines;
  }

  private secondsUntil(deadline: number): number {
    return Math.max(1, Math.round((deadline - this.o.clock.now()) / 1000));
  }

  private voteOptions(): { id: string; title?: string }[] {
    const info = new Map((this.o.maps ?? []).map((m) => [m.id.toLowerCase(), m]));
    return this.pool.map((id) => {
      const title = info.get(id.toLowerCase())?.title;
      return title ? { id, title } : { id };
    });
  }

  // -------------------------------------------------------------------------------------------
  // Flow
  // -------------------------------------------------------------------------------------------

  private async resumeFromProjection(): Promise<void> {
    this.clearTimer();
    const p = this.proj;
    switch (p.phase) {
      case 'draft':
      case 'seeded':
      case 'aborted':
        this.stage = { kind: 'idle' };
        this.send(this.snapshot());
        return;
      case 'finished':
        this.stage = { kind: 'finished', deadline: this.o.clock.now() };
        this.send(this.snapshot());
        return;
      case 'checkIn':
        return this.enterCheckIn();
      case 'running':
      case 'paused': {
        const cm = p.currentMatch;
        if (!cm) return this.nextMatch();
        if (cm.status === 'called') return this.startGame(cm.matchId, cm.game);
        // mapSelected or live: (re)load the map; a game interrupted by a restart is replayed.
        if (cm.map) return this.travel(cm.matchId, cm.game, cm.map);
        return this.startGame(cm.matchId, cm.game);
      }
    }
  }

  private async enterCheckIn(): Promise<void> {
    const opened = [...this.events].reverse().find((e) => e.type === 'checkin.opened');
    const openedAt = opened ? Date.parse(opened.at) : this.o.clock.now();
    const deadline = openedAt + this.proj.settings.checkInWindowMin * 60_000;
    this.stage = { kind: 'checkIn', deadline };
    this.setTimer(Math.max(0, deadline - this.o.clock.now()), () => this.startTournament());
    this.send(this.snapshot());
    await this.maybeCompleteCheckIn();
  }

  /** Entrants with people: players in 1v1, teams with members in team games. */
  private humans(): string[] {
    return Object.values(this.proj.entrants)
      .filter((e) => !isBotEntrant(e))
      .map((e) => e.id);
  }

  /** Team games: members who have to be here before the check-in can finish early. */
  private checkInTarget(entrantId: string): number {
    const team = this.team(entrantId);
    return team ? Math.min(this.teamSize, team.members.length) : 1;
  }

  private checkedInCount(entrantId: string): number {
    const team = this.team(entrantId);
    if (!team) return this.proj.checkedIn.includes(entrantId) ? 1 : 0;
    return team.members.filter((m) => this.proj.checkedInUsers.includes(m.userId)).length;
  }

  private async maybeCompleteCheckIn(): Promise<void> {
    if (this.stage.kind !== 'checkIn') return;
    const missing = this.humans().filter((id) => this.checkedInCount(id) < this.checkInTarget(id));
    if (missing.length === 0) {
      await this.startTournament();
    } else if (this.teamMode) {
      const done = this.humans().length - missing.length;
      this.say(`Check-in: ${done}/${this.humans().length} teams complete`);
    } else {
      this.say(
        `Check-in: ${this.humans().length - missing.length}/${this.humans().length} players. Waiting for ${missing.map((m) => this.name(m)).join(', ')}`,
      );
    }
  }

  private async startTournament(): Promise<void> {
    if (this.stage.kind !== 'checkIn') return;
    this.clearTimer();
    // Team games: a team plays as long as one member is here; gaps are filled per game.
    const missing = this.humans().filter((id) => this.checkedInCount(id) === 0);
    const usedNames = new Set(
      Object.values(this.proj.entrants)
        .filter((e) => e.kind === 'bot')
        .map((e) => (e.kind === 'bot' ? e.bot.name : '')),
    );
    const replacements: EventDraft[] = missing.map((entrantId, i) => {
      const team = this.team(entrantId);
      if (team) {
        const bots = pickBots(team.bots, this.o.botPool, new Set(), this.teamSize);
        this.say(`Nobody of ${team.displayName} checked in: bots play for the team`);
        const replacement: TeamEntrant = {
          id: team.id,
          kind: 'team',
          displayName: team.displayName,
          ...(team.tag ? { tag: team.tag } : {}),
          members: [],
          bots,
        };
        return {
          type: 'entrant.replaced',
          data: { entrantId, replacement, reason: 'noShowCheckIn' },
        };
      }
      let spec = this.o.botPool.find((b) => !usedNames.has(b.name));
      if (!spec) {
        const base = this.o.botPool[i % this.o.botPool.length] as BotSpec;
        spec = { ...base, name: `${base.name}${i + 2}`.slice(0, 32) };
      }
      usedNames.add(spec.name);
      this.say(`${this.name(entrantId)} did not check in and is replaced by bot ${spec.name}`);
      return {
        type: 'entrant.replaced',
        data: { entrantId, replacement: botEntrant(spec, entrantId), reason: 'noShowCheckIn' },
      };
    });
    if (!(await this.append(...replacements, { type: 'tournament.started', data: {} }))) return;
    this.say('The tournament starts now!');
    // Roles changed for replaced players: refresh the access list on the server.
    this.send(this.aclFor(undefined));
    await this.nextMatch();
  }

  private async nextMatch(): Promise<void> {
    const bracket = this.proj.bracket;
    if (!bracket) throw new Error('no bracket');
    if (bracket.status === 'finished') return this.finish();
    const m = scheduleNextMatch(bracket, this.proj.results);
    if (!m) {
      this.o.log.error(
        `no playable match, but bracket not finished (issues: ${bracket.issues.length})`,
      );
      this.stage = { kind: 'between' };
      return;
    }
    const entrants = m.entrants as [string, string];
    if (!(await this.append({ type: 'match.called', data: { matchId: m.id, entrants } }))) return;
    this.calledAt.set(m.id, this.o.clock.now());
    this.lineup = undefined;
    this.resetGame();
    // Tell the server who plays next, so it can show vote/ready UI to the right players.
    this.send([...this.matchLinesFor(m.id, 1, entrants), ...this.aclFor(entrants)]);
    this.say(`Next match (${m.id}): ${this.name(entrants[0])} vs ${this.name(entrants[1])}`);
    if (
      this.isBot(entrants[0]) &&
      this.isBot(entrants[1]) &&
      this.proj.settings.botMatchMode === 'simulate'
    ) {
      return this.simulate(m.id, entrants, m.bestOf);
    }
    await this.startGame(m.id, 1);
  }

  private async startGame(matchId: string, game: number): Promise<void> {
    const { entrants } = this.current();
    if (game === 1) {
      if (this.rules.mapMode === 'vote') {
        return this.openVote(matchId, game, 'vote', this.votersOf(entrants));
      }
      const map = randomMap({
        pool: this.pool,
        entrants,
        history: this.proj.mapHistory,
        avoidRecentMaps: this.rules.avoidRecentMaps,
        rng: this.rng(matchId, game, 'random'),
      });
      return this.selectMap(matchId, game, map, 'random');
    }
    // Game 2+: the loser of the previous game picks.
    return this.openVote(matchId, game, 'loserPick', this.votersOf([this.lastLoser(matchId)]));
  }

  private lastLoser(matchId: string): string {
    const { entrants } = this.current();
    const games = this.proj.games[matchId] ?? [];
    const last = games[games.length - 1];
    return entrants.find((e) => e !== last?.winnerId) as string;
  }

  /**
   * Who votes for these entrants: the human entrants in 1v1, the members on the server in team
   * games (members who arrive during the vote are added).
   */
  private votersOf(entrants: readonly string[]): string[] {
    if (!this.teamMode) return entrants.filter((e) => !this.isBot(e));
    const out: string[] = [];
    for (const p of this.players.values()) {
      if (p.userId && p.entrantId && entrants.includes(p.entrantId) && !out.includes(p.userId))
        out.push(p.userId);
    }
    return out;
  }

  private async openVote(
    matchId: string,
    game: number,
    method: VoteMethod,
    voters: string[],
  ): Promise<void> {
    const deadline = this.o.clock.now() + this.rules.voteTimeoutSec * 1000;
    if (this.lineup) {
      // Back to voting: every team member is a match player (and votes) until the next line-up.
      this.lineup = undefined;
      this.send(this.aclFor(this.current().entrants));
    }
    this.stage = { kind: 'voting', matchId, game, method, voters, ballots: new Map(), deadline };
    if (voters.length === 0) return this.closeVote();
    this.send([...voteLines(matchId, this.voteOptions(), this.rules.voteTimeoutSec), this.phase()]);
    const who = this.teamMode
      ? (method === 'vote' ? this.current().entrants : [this.lastLoser(matchId)])
          .map((e) => this.name(e))
          .join(' and ')
      : voters.map((v) => this.name(v)).join(' and ');
    this.say(
      method === 'vote'
        ? `Map vote for ${who}: pick up to ${this.rules.picksPerPlayer} maps (!vote 3 1 5)`
        : `${who} lost the last game and picks the next map (!vote <number>)`,
    );
    this.setTimer(this.rules.voteTimeoutSec * 1000, () => this.closeVote());
    this.telemetry('voting', { deadline });
  }

  /** `key` is the entrant id in 1v1 and the user id in team games. */
  private async onVote(key: string, picks: string[]): Promise<void> {
    const s = this.stage;
    if (s.kind !== 'voting' || !s.voters.includes(key)) {
      this.o.log.info(`vote from ${this.voterName(key)} ignored (not a voter right now)`);
      return;
    }
    this.o.log.info(`vote from ${this.voterName(key)}: ${picks.join(', ') || '(empty)'}`);
    s.ballots.set(key, picks);
    if (s.voters.every((v) => s.ballots.has(v))) await this.closeVote();
  }

  /** Team games: the ballots of one team's players. */
  private memberBallots(s: Extract<Stage, { kind: 'voting' }>, entrantId: string): string[][] {
    const team = this.team(entrantId);
    return [...s.ballots].filter(([userId]) => isMember(team, userId)).map(([, picks]) => picks);
  }

  private async closeVote(): Promise<void> {
    const s = this.stage;
    if (s.kind !== 'voting') return;
    this.clearTimer();
    const { entrants } = this.current();
    const rng = this.rng(s.matchId, s.game, s.method);
    if (s.method === 'vote') {
      // Team games: one ballot per team, so a team weighs the same however many players vote.
      const ballots = this.teamMode
        ? entrants.map((entrantId) => ({
            entrantId,
            picks: teamBallot(
              this.memberBallots(s, entrantId),
              this.pool,
              this.rules.picksPerPlayer,
            ),
          }))
        : [...s.ballots].map(([entrantId, picks]) => ({ entrantId, picks }));
      const out = resolveMapVote({
        pool: this.pool,
        entrants,
        ballots,
        history: this.proj.mapHistory,
        picksPerPlayer: this.rules.picksPerPlayer,
        avoidRecentMaps: this.rules.avoidRecentMaps,
        rng,
      });
      return this.selectMap(s.matchId, s.game, out.map, 'vote', {
        ballots: out.ballots,
        scores: out.scores,
        tiedFor: out.tiedFor,
        ...(this.teamMode
          ? { players: [...s.ballots].map(([userId, picks]) => ({ userId, picks })) }
          : {}),
      });
    }
    const games = this.proj.games[s.matchId] ?? [];
    const loser = s.voters[0];
    const teamPicks = this.teamMode
      ? teamBallot(this.memberBallots(s, this.lastLoser(s.matchId)), this.pool, this.pool.length)
      : [];
    const picks =
      (this.teamMode
        ? teamPicks.length
          ? teamPicks
          : undefined
        : loser && s.ballots.get(loser)) || randomBallot(this.pool, 3, rng);
    const r = loserPickMap({
      pool: this.pool,
      loserPicks: picks,
      playedInSeries: games.map((g) => g.map),
      rng,
    });
    return this.selectMap(s.matchId, s.game, r.map, 'loserPick', { picks, random: r.random });
  }

  private async selectMap(
    matchId: string,
    game: number,
    map: string,
    method: 'vote' | 'random' | 'loserPick',
    details?: Record<string, unknown>,
  ): Promise<void> {
    const runOrder = this.raceMode ? this.runOrderFor(matchId, game) : undefined;
    if (
      !(await this.append({
        type: 'match.mapSelected',
        data: {
          matchId,
          game,
          map,
          method,
          ...(details ? { details } : {}),
          ...(runOrder ? { runOrder } : {}),
        },
      }))
    ) {
      return;
    }
    if (method !== 'random') this.send([{ t: 'vclose', map }]);
    this.say(
      runOrder
        ? `Map: ${map}. ${this.name(runOrder[0])} runs first, then ${this.name(runOrder[1])}`
        : `Map: ${map}`,
    );
    await this.travel(matchId, game, map);
  }

  /** Monster Hunt: game 1 starts by lot, then whoever ran second in the last game starts. */
  private runOrderFor(matchId: string, game: number): [string, string] {
    const { entrants } = this.current();
    const last = (this.proj.games[matchId] ?? []).at(-1);
    const first = firstRunner(
      entrants,
      last?.runs?.map((r) => r.entrantId),
      this.rng(matchId, game, 'order'),
    );
    return [first, entrants[0] === first ? entrants[1] : entrants[0]];
  }

  private async travel(matchId: string, game: number, map: string): Promise<void> {
    this.resetGame();
    this.fixLineup(matchId, game);
    this.stage = { kind: 'loading', matchId, game, map };
    const wait = this.cooldownUntil - this.o.clock.now();
    if (wait > 0) {
      this.send([this.phase()]);
      this.setTimer(wait, () => this.sendTravel());
      return;
    }
    this.sendTravel();
  }

  private sendTravel(): void {
    const s = this.stage;
    if (s.kind !== 'loading') return;
    const { entrants } = this.current();
    // The mod caches match and access list before travelling, so logins on the new level work
    // before the bridge connection is re-established.
    this.send([
      ...this.matchLinesFor(s.matchId, s.game, entrants),
      ...this.aclFor(entrants),
      this.phase(),
      travelLine(this.rules, s.map, s.matchId, s.game),
    ]);
    this.telemetry('loading');
    this.setTimer(this.timing.loadingTimeoutMs, () => {
      this.o.log.warn(`no mod connection on ${s.map} after travel, sending travel again`);
      this.sendTravel();
    });
  }

  /**
   * Team games: who plays the next game, decided before the map loads (see lineupFor). Players
   * of the line-up log in as players, everybody else as spectators.
   */
  private fixLineup(matchId: string, game: number): void {
    if (!this.teamMode) return;
    const run = this.raceMode ? this.raceRun() : 1;
    const l = this.lineup;
    if (l?.matchId === matchId && l.game === game && l.run === run) return;
    const { entrants } = this.current();
    const active = this.activeEntrants();
    const connected = this.connectedUsers();
    const benched = this.benched.get(matchId) ?? new Set<string>();
    const sides: Record<string, string[]> = {};
    for (const e of entrants) {
      const team = this.team(e);
      // Monster Hunt: the team that does not run watches its opponent.
      sides[e] =
        team && active.includes(e) ? lineupFor(team, connected, this.teamSize, benched) : [];
    }
    this.lineup = { matchId, game, run, sides };
    for (const e of active) {
      const names = (sides[e] ?? []).map((u) => this.userName(u));
      this.o.log.info(`line-up ${this.name(e)}: ${names.join(', ') || '(bots)'}`);
    }
  }

  private async onHello(hello: ModHello): Promise<void> {
    this.players.clear();
    const s = this.stage;
    const onMap = (map: string) => hello.lvl.toLowerCase() === map.toLowerCase();
    switch (s.kind) {
      case 'loading':
        if (onMap(s.map)) return this.enterReadyCheck(s.matchId, s.game, s.map);
        this.send(this.snapshot());
        this.sendTravel();
        return;
      case 'live':
        if (hello.gm && onMap(s.map)) {
          this.send(this.snapshot()); // only the bridge connection dropped, the game goes on
          return;
        }
        this.o.log.warn(
          `game ${s.matchId}#${s.game} was interrupted (level ${hello.lvl}), replaying it`,
        );
        return this.travel(s.matchId, s.game, s.map);
      case 'readyCheck':
      case 'countdown':
        if (onMap(s.map)) return this.enterReadyCheck(s.matchId, s.game, s.map);
        return this.travel(s.matchId, s.game, s.map);
      default:
        this.send(this.snapshot());
    }
  }

  /**
   * Ready check on a freshly loaded map. `keep` carries who is here and ready when a player left
   * the countdown (everybody else stays ready).
   */
  private async enterReadyCheck(
    matchId: string,
    game: number,
    map: string,
    keep?: ReadyState,
  ): Promise<void> {
    const now = this.o.clock.now();
    const deadline = now + this.proj.settings.noShowSec * 1000;
    this.stage = {
      kind: 'readyCheck',
      matchId,
      game,
      map,
      ready: keep?.ready ?? new Set(),
      present: keep?.present ?? new Set(),
      teamReady: keep?.teamReady ?? new Set(),
      since: keep?.since ?? now,
      deadline,
    };
    this.gameBots = {};
    this.send(this.snapshot());
    this.setTimer(this.proj.settings.noShowSec * 1000, () => this.onNoShow());
    this.telemetry('readyCheck', { deadline });
    this.armCaptainHint();
    await this.checkAllReady();
  }

  /** Team games: tells waiting captains when they may start with bots. */
  private armCaptainHint(): void {
    if (this.captainTimer) this.o.clock.clearTimeout(this.captainTimer);
    this.captainTimer = undefined;
    const s = this.stage;
    if (!this.teamMode || s.kind !== 'readyCheck') return;
    const wait = s.since + this.timing.captainStartMs - this.o.clock.now();
    if (wait <= 0) return;
    this.captainTimer = this.o.clock.setTimeout(() => {
      void this.enqueue(() => {
        const cur = this.stage;
        if (cur !== s) return;
        const connected = this.connectedUsers();
        for (const e of this.current().entrants) {
          const team = this.team(e);
          if (!team || this.teamIsReady(cur, e)) continue;
          const captain = actingCaptain(team, connected);
          const pid = captain ? this.pidOf(captain) : undefined;
          if (pid !== undefined)
            this.say(
              `Captain of ${team.displayName}: type !start to play now, bots fill missing places`,
              pid,
            );
        }
      });
    }, wait);
  }

  private async checkAllReady(): Promise<void> {
    const s = this.stage;
    if (s.kind !== 'readyCheck') return;
    const { entrants } = this.current();
    const ready = Object.fromEntries(
      entrants.map((e) => [
        e,
        this.teamMode ? this.teamIsReady(s, e) : this.isBot(e) || s.ready.has(e),
      ]),
    );
    this.telemetry('readyCheck', { ready, deadline: s.deadline });
    if (!entrants.every((e) => ready[e])) return;
    // Betting phase: bets on a match close when its first game starts. Everybody is ready (bots
    // at once), but the match has not taken bets long enough yet: wait for the rest.
    const hold = this.betHoldMs(s.matchId, s.game);
    if (hold > 0) {
      if (this.timer?.tag === `bets:${s.matchId}`) return; // already waiting
      this.clearTimer();
      this.say(
        `Bets on ${this.name(entrants[0]!)} vs ${this.name(entrants[1]!)} close in ${Math.ceil(hold / 1000)} s, then the countdown starts`,
      );
      this.telemetry('readyCheck', { ready, deadline: this.o.clock.now() + hold });
      this.setTimer(
        hold,
        async () => {
          if (this.stage !== s) return;
          this.calledAt.set(s.matchId, 0); // window over
          await this.checkAllReady();
          // Somebody left while waiting: the ready check goes on.
          if (this.stage === s && !this.timer)
            this.setTimer(this.proj.settings.noShowSec * 1000, () => this.onNoShow());
        },
        `bets:${s.matchId}`,
      );
      return;
    }
    this.clearTimer();
    if (this.captainTimer) this.o.clock.clearTimeout(this.captainTimer);
    this.captainTimer = undefined;
    this.stage = {
      kind: 'countdown',
      matchId: s.matchId,
      game: s.game,
      map: s.map,
      ready: s.ready,
      present: s.present,
      teamReady: s.teamReady,
      since: s.since,
    };
    const lines: BridgeToMod[] = [];
    if (this.teamMode) {
      this.fillWithBots(s);
      // The bots of this game go to the server with the countdown.
      lines.push(...this.matchLinesFor(s.matchId, s.game, entrants));
    }
    this.send([...lines, { t: 'cd', sec: this.rules.countdownSec }, this.phase()]);
    this.telemetry('countdown');
  }

  /** Team games: the players of the line-up who are here, bots for every other place. */
  private fillWithBots(s: ReadyState): void {
    const { entrants } = this.current();
    const used = new Set<string>();
    this.gameBots = {};
    this.startLineups = {};
    const active = this.activeEntrants();
    for (const e of entrants) {
      const team = this.team(e);
      if (!team || !active.includes(e)) continue;
      const humans = this.lineupOf(e).filter((u) => s.present.has(u));
      const bots = pickBots(team.bots, this.o.botPool, used, this.teamSize - humans.length);
      this.gameBots[e] = bots;
      this.startLineups[e] = [
        ...humans.map((userId) => ({ name: memberName(team, userId), userId })),
        ...bots.map((b) => ({ name: b.name, bot: true })),
      ];
    }
  }

  private async onNoShow(): Promise<void> {
    const s = this.stage;
    if (s.kind !== 'readyCheck') return;
    const { entrants } = this.current();
    if (this.teamMode) return this.onTeamTimeUp(s);
    const notReady = entrants.filter((e) => !this.isBot(e) && !s.ready.has(e));
    if (notReady.length === 0) return this.checkAllReady();
    let loser: string;
    if (notReady.length === 1) loser = notReady[0] as string;
    else {
      const absent = notReady.filter((e) => !s.present.has(e));
      const candidates = absent.length === 1 ? absent : notReady;
      loser = candidates[Math.floor(this.rng(s.matchId, 'noshow')() * candidates.length)] as string;
    }
    this.say(`${this.name(loser)} was not ready in time and forfeits ${s.matchId}`);
    await this.forfeit(s.matchId, loser);
  }

  /**
   * Team games, ready check over: a team with at least one member on the server plays (bots fill
   * the gaps, players who are not ready yet play anyway); a team with nobody here forfeits.
   */
  private async onTeamTimeUp(s: Extract<Stage, { kind: 'readyCheck' }>): Promise<void> {
    const entrants = this.activeEntrants();
    const connected = this.connectedUsers();
    const absent = entrants.filter((e) => {
      const team = this.team(e);
      return (
        !!team && team.members.length > 0 && !team.members.some((m) => connected.has(m.userId))
      );
    });
    if (absent.length === 0) {
      for (const e of entrants) s.teamReady.add(e);
      this.say(
        this.raceMode
          ? 'Time is up: the run starts, bots fill missing places'
          : 'Time is up: the game starts, bots fill missing places',
      );
      return this.checkAllReady();
    }
    const loser =
      absent.length === 1
        ? (absent[0] as string)
        : (absent[Math.floor(this.rng(s.matchId, 'noshow')() * absent.length)] as string);
    this.say(
      `Nobody of ${this.name(loser)} is on the server: ${this.name(loser)} forfeits ${s.matchId}`,
    );
    await this.forfeit(s.matchId, loser);
  }

  private async forfeit(matchId: string, loser: string): Promise<void> {
    this.clearTimer();
    this.resetGame();
    const { entrants } = this.current();
    const winnerId = entrants.find((e) => e !== loser) as string;
    const result: MatchResult = {
      matchId,
      entrants,
      winnerId,
      outcome: 'forfeit',
      games: (this.proj.games[matchId] ?? []).map((g) => ({
        map: g.map,
        scores: g.scores,
        winnerId: g.winnerId,
      })),
    };
    if (!(await this.append({ type: 'match.result', data: { result } }))) return;
    await this.afterResult();
  }

  private async afterResult(): Promise<void> {
    this.cooldownUntil = this.o.clock.now() + this.timing.postGameDelayMs;
    this.stage = { kind: 'between' };
    this.send([...this.bracketUpdate(), this.phase()]);
    this.telemetry('post');
    if (this.proj.bracket?.status === 'finished') return this.finish();
    await this.nextMatch();
  }

  private async finish(): Promise<void> {
    const champion = this.proj.bracket?.championId;
    // A league matchday (fixtures) has no champion: it is done when every pairing is decided.
    const fixtures = this.proj.bracket?.definition.format === 'fixtures';
    if (!champion && !(fixtures && this.proj.bracket?.status === 'finished')) return;
    if (this.proj.phase !== 'finished') {
      const data = champion ? { championId: champion } : {};
      if (!(await this.append({ type: 'tournament.finished', data }))) return;
    }
    const delayMs = this.proj.settings.postTournamentShutdownSec * 1000;
    this.stage = { kind: 'finished', deadline: this.o.clock.now() + delayMs };
    this.send([...this.bracketUpdate(), this.phase()]);
    this.say(champion ? `${this.name(champion)} wins the tournament!` : 'All matches are played!');
    this.say(`The server shuts down in ${delayMs / 1000} seconds.`);
    this.emit('finished', champion ?? '');
    const shutdown = () => {
      this.emit('shutdown');
    };
    if (delayMs > 10_000) {
      this.setTimer(delayMs - 10_000, () => {
        this.say('The server shuts down in 10 seconds.');
        this.setTimer(10_000, shutdown);
      });
    } else this.setTimer(delayMs, shutdown);
  }

  private async simulate(
    matchId: string,
    entrants: [string, string],
    bestOf: number,
  ): Promise<void> {
    this.stage = { kind: 'simulating', matchId };
    this.send([this.phase()]);
    this.setTimer(this.timing.simulateDelayMs, async () => {
      const skills = entrants.map((e) => botSkill(this.proj.entrants[e])) as [number, number];
      if (this.raceMode) return this.simulateRaceSeries(matchId, entrants, bestOf, skills);
      const series = simulateSeries({
        skills,
        bestOf,
        fragLimit: this.rules.fragLimit,
        rng: this.rng(matchId, 'simulate'),
      });
      const games = series.games.map((g) => ({
        map: '(simulated)',
        scores: { [entrants[0]]: g.scores[0], [entrants[1]]: g.scores[1] },
        winnerId: entrants[g.winner],
      }));
      const ok = await this.append(
        ...games.map((g, i) => ({
          type: 'match.gameFinished' as const,
          data: { matchId, game: i + 1, ...g, endReason: 'fragLimit' as const },
        })),
        {
          type: 'match.result',
          data: {
            result: {
              matchId,
              entrants,
              winnerId: entrants[series.winner],
              outcome: 'simulated' as const,
              games,
            },
          },
        },
      );
      if (!ok) return;
      this.say(`${matchId} simulated: ${this.name(entrants[series.winner])} wins`);
      await this.afterResult();
    });
  }

  private async simulateRaceSeries(
    matchId: string,
    entrants: [string, string],
    bestOf: number,
    skills: [number, number],
  ): Promise<void> {
    const series = simulateRace({
      entrants,
      skills,
      bestOf,
      timeLimitMin: this.rules.timeLimitMin,
      penaltySec: this.rules.penaltySec,
      rng: this.rng(matchId, 'simulate'),
    });
    const games = series.games.map((g) => ({
      map: '(simulated)',
      scores: Object.fromEntries(g.runs.map((r) => [r.entrantId, finalMs(r)])),
      winnerId: g.winnerId,
    }));
    const ok = await this.append(
      ...games.map((g, i) => ({
        type: 'match.gameFinished' as const,
        data: { matchId, game: i + 1, ...g, endReason: 'race' as const },
      })),
      {
        type: 'match.result',
        data: {
          result: {
            matchId,
            entrants,
            winnerId: series.winnerId,
            outcome: 'simulated' as const,
            games,
          },
        },
      },
    );
    if (!ok) return;
    this.say(`${matchId} simulated: ${this.name(series.winnerId)} wins`);
    await this.afterResult();
  }

  // -------------------------------------------------------------------------------------------
  // Mod input
  // -------------------------------------------------------------------------------------------

  private entrantFor(token: string): { entry?: AccessEntry; entrantId?: string } {
    const entry = this.access.find((a) => a.token === token);
    if (!entry?.entrantId) return entry ? { entry } : {};
    const ent = this.proj.entrants[entry.entrantId];
    const isTheirs =
      (ent?.kind === 'human' && ent.userId === entry.userId) || isMember(ent, entry.userId);
    return isTheirs ? { entry, entrantId: entry.entrantId } : { entry };
  }

  private sideOf(entrantId: string | undefined): Side | undefined {
    const cm = this.proj.currentMatch;
    if (!cm || !entrantId) return undefined;
    return cm.entrants[0] === entrantId ? 'a' : cm.entrants[1] === entrantId ? 'b' : undefined;
  }

  private async onMessage(msg: Exclude<ModToBridge, ModHello>): Promise<void> {
    switch (msg.t) {
      case 'join':
        return this.onJoin(msg.pid, msg.tk, msg.name);
      case 'leave':
        return this.onLeave(msg.pid);
      case 'reject':
        this.o.log.info(`server rejected ${msg.name}: ${msg.why}`);
        return;
      case 'ready': {
        const p = this.players.get(msg.pid);
        const s = this.stage;
        if (s.kind !== 'readyCheck' || !p?.entrantId || !this.sideOf(p.entrantId)) return;
        if (this.teamMode) {
          if (!p.userId || !this.lineupOf(p.entrantId).includes(p.userId)) return;
          const wasReady = this.teamIsReady(s, p.entrantId);
          s.ready.add(p.userId);
          if (!wasReady && this.teamIsReady(s, p.entrantId)) this.announceTeamReady(p.entrantId);
          return this.checkAllReady();
        }
        if (!s.ready.has(p.entrantId)) {
          s.ready.add(p.entrantId);
          this.say(`${this.name(p.entrantId)} is ready`);
        }
        return this.checkAllReady();
      }
      case 'vote': {
        const p = this.players.get(msg.pid);
        if (!p?.entrantId) return;
        const key = this.teamMode ? p.userId : p.entrantId;
        if (!key) return;
        return this.onVote(key, [msg.m1, msg.m2, msg.m3].filter(Boolean));
      }
      case 'cmd':
        if (msg.c === 'start') return this.captainStart(msg.pid);
        return;
      case 'live': {
        const s = this.stage;
        if (s.kind !== 'countdown' || s.matchId !== msg.mid) return;
        this.stage = { kind: 'live', matchId: s.matchId, game: s.game, map: s.map, scores: [0, 0] };
        this.board.reset();
        this.liveSince = this.o.clock.now();
        const lineups = this.startLineups;
        const runner = this.raceMode ? this.runner() : undefined;
        if (
          !(await this.append({
            type: 'match.started',
            data: {
              matchId: s.matchId,
              game: s.game,
              ...(runner ? { runner } : {}),
              ...(lineups ? { lineups } : {}),
            },
          }))
        )
          return;
        this.send([...this.bracketUpdate(), this.phase()]);
        this.telemetry('live');
        return;
      }
      case 'score': {
        const s = this.stage;
        if (this.raceMode || s.kind !== 'live' || s.matchId !== msg.mid) return;
        s.scores = [msg.sa, msg.sb];
        const { entrants } = this.current();
        this.telemetry('live', { scores: { [entrants[0]]: msg.sa, [entrants[1]]: msg.sb } });
        return;
      }
      case 'kf': {
        const s = this.stage;
        if (s.kind !== 'live' || s.matchId !== msg.mid) return;
        if (!this.proj.currentMatch) return;
        const ctx = this.liveCtx(s);
        this.emit('feed', {
          ...blankFeed({ ...ctx, game: msg.g }, this.o.clock.now()),
          kind: 'kill',
          humans: this.board.humans,
          killer: msg.k,
          killerSide: msg.k ? ctx.sideEntrant(msg.ks) : null,
          victim: msg.v,
          victimSide: ctx.sideEntrant(msg.vs),
          weapon: msg.w,
          headshot: (msg.f & 1) !== 0,
          firstBlood: (msg.f & 2) !== 0,
          suicide: (msg.f & 4) !== 0,
          teamKill: (msg.f & 8) !== 0,
          monster: (msg.f & 16) !== 0,
          spree: msg.sp,
          multi: msg.mk,
          ...(msg.kh !== undefined && msg.kh >= 0 ? { killerHealth: msg.kh } : {}),
          ...(msg.kd !== undefined && msg.k ? { distance: msg.kd } : {}),
          ...((msg.f & 32) !== 0 ? { amp: true } : {}),
        } satisfies KillFeedEntry);
        if ((msg.f & 16) !== 0 && msg.k) this.board.monsterKill(msg.k, msg.g);
        return;
      }
      case 'bs': {
        const s = this.stage;
        if (s.kind !== 'live' || s.matchId !== msg.mid) return;
        if (!this.proj.currentMatch) return;
        const ctx = this.liveCtx(s);
        this.emit('feed', {
          ...blankFeed({ ...ctx, game: msg.g }, this.o.clock.now()),
          kind: 'chat',
          humans: this.board.humans,
          killer: msg.n,
          killerSide: ctx.sideEntrant(msg.sd),
          chat: msg.x,
        } satisfies KillFeedEntry);
        return;
      }
      case 'lr':
      case 'st':
      case 'sx':
      case 'pk':
      case 'bt': {
        if (!this.isLiveGame(msg.mid, msg.g, msg.n)) return;
        const s = this.stage;
        if (s.kind === 'live') this.board.handle(msg, this.liveCtx(s));
        return;
      }
      case 'lost': {
        const s = this.stage;
        if (this.teamMode || s.kind !== 'live' || s.matchId !== msg.mid) return;
        const { entrants } = this.current();
        return this.onMatchPlayerLost(entrants[msg.s === 'a' ? 0 : 1]);
      }
      case 'end':
        // Monster Hunt ends a level per run (runend); the game is decided by the bridge.
        if (this.raceMode) return;
        return this.onGameEnd(msg);
      case 'rp': {
        const s = this.stage;
        const runner = this.runner();
        if (!this.raceMode || s.kind !== 'live' || s.matchId !== msg.mid || s.game !== msg.g)
          return;
        if (!runner || msg.n !== this.raceRun()) return;
        this.lastProgress = {
          matchId: msg.mid,
          game: msg.g,
          run: msg.n,
          ms: msg.ms,
          d: msg.d,
          pts: msg.pts,
        };
        if (msg.ml !== undefined)
          this.board.monsters(msg.ml, msg.mt ?? msg.ml, msg.bl ?? 0, msg.n, this.liveCtx(s));
        this.telemetry('live', {
          race: {
            runner,
            run: msg.n,
            timeMs: msg.ms,
            deaths: msg.d,
            penaltyMs: msg.d * this.rules.penaltySec * 1000,
            points: msg.pts,
          },
        });
        return;
      }
      case 'runend':
        return this.onRunEnd(msg);
      case 'ps':
      case 'px':
      case 'pw':
        this.collectStat(msg);
        return;
      case 'pse':
        return this.onStatsEnd(msg);
      case 'hb':
      case 'model': // bot class defaults: the website agent's ModelCatalog
        return;
      case 'err':
        this.o.log.warn(`mod error: ${msg.msg}`);
        return;
    }
  }

  private collectStat(msg: Extract<ModToBridge, { t: 'ps' | 'px' | 'pw' }>): void {
    const key = `${msg.mid}/${msg.g}/${msg.n}/${msg.i}`;
    const line = this.statLines.get(key) ?? { weapons: {} };
    if (msg.t === 'ps') line.ps = msg;
    else if (msg.t === 'px') line.px = msg;
    else line.weapons[msg.w] = (line.weapons[msg.w] ?? 0) + msg.c;
    this.statLines.set(key, line);
  }

  /**
   * All statistics lines of a game (run) are in: one `match.playerStats` event, before the
   * game's end (run end) is recorded. Lines of other games are dropped.
   */
  private async onStatsEnd(msg: Extract<ModToBridge, { t: 'pse' }>): Promise<void> {
    const prefix = `${msg.mid}/${msg.g}/${msg.n}/`;
    const lines = [...this.statLines.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .map(([, l]) => l);
    this.statLines.clear();
    const s = this.stage;
    if (s.kind !== 'live' || s.matchId !== msg.mid || s.game !== msg.g) return;
    if (this.raceMode ? msg.n !== this.raceRun() : msg.n !== 0) return;
    // Sent again after a reconnect (with the pending end): recorded once.
    const run = msg.n > 0 ? msg.n : undefined;
    if (
      this.events.some(
        (e) =>
          e.type === 'match.playerStats' &&
          e.data.matchId === msg.mid &&
          e.data.game === msg.g &&
          e.data.run === run,
      )
    )
      return;
    if (lines.length !== msg.c)
      this.o.log.warn(
        `player statistics of ${msg.mid} game ${msg.g}: ${lines.length} of ${msg.c} players arrived`,
      );
    const { entrants } = this.current();
    const players: PlayerGameStats[] = [];
    for (const l of lines) {
      if (!l.ps) continue;
      const p = l.ps;
      const x = l.px;
      let name = p.bn;
      let userId: string | undefined;
      let entrantId: string | undefined = entrants[p.s === 'a' ? 0 : 1];
      if (p.tk) {
        const { entry, entrantId: eid } = this.entrantFor(p.tk);
        if (!entry) continue; // unknown token: nothing to attribute
        name = entry.displayName;
        userId = entry.userId;
        entrantId = eid ?? entrantId;
      }
      if (!name) continue;
      players.push({
        name: name.slice(0, 32),
        ...(userId ? { userId } : { bot: true }),
        ...(entrantId ? { entrantId } : {}),
        kills: p.k,
        deaths: p.d,
        suicides: p.su,
        teamKills: p.tm,
        headshots: x?.hs ?? 0,
        firstBlood: x?.fb ?? false,
        bestSpree: x?.bs ?? 0,
        sprees: x?.sp ?? 0,
        multi2: x?.m2 ?? 0,
        multi3: x?.m3 ?? 0,
        multi4: x?.m4 ?? 0,
        multi5: x?.m5 ?? 0,
        timeSec: p.sec,
        monsters: x?.mk ?? 0,
        monsterPoints: x?.mp ?? 0,
        weapons: l.weapons,
        ...(x?.dd !== undefined ? { damageDealt: x.dd, damageTaken: x.dt ?? 0 } : {}),
        ...(x?.ua !== undefined
          ? { items: { amp: x.ua, belt: x.ub ?? 0, armor: x.ur ?? 0, keg: x.uk ?? 0 } }
          : {}),
      });
    }
    await this.append({
      type: 'match.playerStats',
      data: {
        matchId: s.matchId,
        game: s.game,
        ...(msg.n > 0 ? { run: msg.n } : {}),
        map: s.map,
        durationSec: msg.sec,
        players,
      },
    });
  }

  private async onJoin(pid: number, token: string, name: string): Promise<void> {
    const { entry, entrantId } = this.entrantFor(token);
    if (!entry) {
      this.o.log.warn(`unknown token joined as ${name} (pid ${pid})`);
      return;
    }
    this.o.log.info(
      `${entry.displayName} joined the server${entrantId ? ` (entrant ${entrantId})` : ' (spectator)'}`,
    );
    this.players.set(pid, {
      pid,
      token,
      name,
      userId: entry.userId,
      ...(entrantId ? { entrantId } : {}),
    });
    const s = this.stage;
    if (this.teamMode && entrantId) return this.onTeamJoin(pid, entry.userId, entrantId);
    if (s.kind === 'checkIn' && entrantId && !this.proj.checkedIn.includes(entrantId)) {
      if (!(await this.append({ type: 'entrant.checkedIn', data: { entrantId } }))) return;
      this.say(`${this.name(entrantId)} checked in`);
      return this.maybeCompleteCheckIn();
    }
    if (s.kind === 'readyCheck' && entrantId && this.sideOf(entrantId)) {
      s.present.add(entrantId);
      return;
    }
    if (s.kind === 'live' && s.lost && s.lost === entrantId) {
      s.lost = undefined;
      this.clearTimer();
      this.send([{ t: 'pause', on: false, why: '' }]);
      this.say(`${this.name(entrantId)} is back, the game continues`);
      const left = this.proj.settings.maxReconnects - this.disconnectCount(s.matchId, entrantId);
      if (left <= 0) {
        this.send([
          { t: 'warn', pid, msg: 'LAST WARNING: one more disconnect in this match is a FORFEIT' },
        ]);
      } else {
        this.say(`Reconnects left in this match: ${left}`, pid);
      }
      this.telemetry('live');
    }
  }

  private async onLeave(pid: number): Promise<void> {
    const p = this.players.get(pid);
    this.players.delete(pid);
    if (p) this.o.log.info(`${p.name} left the server`);
    if (!p?.entrantId) return;
    if (this.teamMode && p.userId) return this.onTeamLeave(p.userId, p.entrantId);
    const s = this.stage;
    if (s.kind === 'readyCheck') {
      s.present.delete(p.entrantId);
      s.ready.delete(p.entrantId);
    } else if (s.kind === 'countdown' && this.sideOf(p.entrantId)) {
      this.say(`${this.name(p.entrantId)} left during the countdown, back to the ready check`);
      s.ready.delete(p.entrantId);
      s.present.delete(p.entrantId);
      await this.enterReadyCheck(s.matchId, s.game, s.map, s);
    } else if (s.kind === 'live' && this.sideOf(p.entrantId)) {
      await this.onMatchPlayerLost(p.entrantId);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Team games: players joining and leaving, captains, stand-in bots
  // -------------------------------------------------------------------------------------------

  private async onTeamJoin(pid: number, userId: string, entrantId: string): Promise<void> {
    const s = this.stage;
    const team = this.team(entrantId);
    if (!team) return;
    switch (s.kind) {
      case 'checkIn':
        if (this.proj.checkedInUsers.includes(userId)) return;
        if (!(await this.append({ type: 'entrant.checkedIn', data: { entrantId, userId } })))
          return;
        this.say(`${memberName(team, userId)} (${team.displayName}) checked in`);
        return this.maybeCompleteCheckIn();
      case 'voting':
        // Late arrivals of the two teams vote too (game 1: both teams, later: the loser).
        if (
          !s.voters.includes(userId) &&
          (s.method === 'vote' ? !!this.sideOf(entrantId) : entrantId === this.lastLoser(s.matchId))
        ) {
          s.voters.push(userId);
        }
        return;
      case 'readyCheck':
        if (this.lineupOf(entrantId).includes(userId)) s.present.add(userId);
        return this.checkAllReady();
      case 'live': {
        if (!this.lineupOf(entrantId).includes(userId)) return;
        if (this.benchedIn(s.matchId).has(userId)) return;
        const timer = this.standInTimers.get(userId);
        if (timer) this.o.clock.clearTimeout(timer);
        this.standInTimers.delete(userId);
        const standIn = this.standIns.get(userId);
        if (standIn) {
          this.standIns.delete(userId);
          this.send([{ t: 'botdel', name: wireName(standIn.bot.name) }]);
          this.say(`${memberName(team, userId)} is back, ${standIn.bot.name} leaves the game`);
        } else this.say(`${memberName(team, userId)} is back`);
        const left = this.proj.settings.maxReconnects - this.disconnectCount(s.matchId, userId);
        if (left <= 0) {
          this.send([
            {
              t: 'warn',
              pid,
              msg: 'LAST WARNING: one more disconnect and you are out of this match (a bot takes over)',
            },
          ]);
        } else this.say(`Reconnects left in this match: ${left}`, pid);
        return;
      }
      default:
        return;
    }
  }

  private async onTeamLeave(userId: string, entrantId: string): Promise<void> {
    const s = this.stage;
    switch (s.kind) {
      case 'voting':
        // Do not wait for somebody who left without voting.
        if (!s.ballots.has(userId)) {
          s.voters = s.voters.filter((v) => v !== userId);
          if (s.voters.length && s.voters.every((v) => s.ballots.has(v))) await this.closeVote();
        }
        return;
      case 'readyCheck':
        s.present.delete(userId);
        s.ready.delete(userId);
        return;
      case 'countdown':
        if (!this.lineupOf(entrantId).includes(userId)) return;
        this.say(`${this.userName(userId)} left during the countdown, back to the ready check`);
        s.present.delete(userId);
        s.ready.delete(userId);
        return this.enterReadyCheck(s.matchId, s.game, s.map, s);
      case 'live':
        if (!this.lineupOf(entrantId).includes(userId)) return;
        if (this.benchedIn(s.matchId).has(userId) || this.standIns.has(userId)) return;
        return this.onTeamPlayerLost(userId, entrantId);
      default:
        return;
    }
  }

  /** A player of the line-up dropped during the game: a bot takes over after a short wait. */
  private onTeamPlayerLost(userId: string, entrantId: string): void {
    const s = this.stage;
    if (s.kind !== 'live') return;
    const count = this.countDisconnect(s.matchId, userId);
    const max = this.proj.settings.maxReconnects;
    const name = this.userName(userId);
    if (count > max) {
      this.benchedIn(s.matchId).add(userId);
      const entry = this.access.find((a) => a.userId === userId);
      if (entry) {
        this.send([{ t: 'acladd', tk: entry.token, name: wireName(entry.displayName), r: 's' }]);
      }
      this.say(
        `${name} disconnected ${count} times (max ${max} reconnects) and is out of this match`,
      );
      this.bringStandIn(userId, entrantId);
      return;
    }
    const delay = this.timing.standInDelayMs;
    this.say(
      `${name} disconnected. A bot takes over in ${Math.round(delay / 1000)}s unless they come back`,
    );
    const handle = this.o.clock.setTimeout(() => {
      void this.enqueue(() => {
        if (this.standInTimers.get(userId) !== handle) return;
        this.standInTimers.delete(userId);
        const cur = this.stage;
        if (cur.kind !== 'live' || cur.matchId !== s.matchId || cur.game !== s.game) return;
        if (this.connectedUsers().has(userId)) return;
        this.bringStandIn(userId, entrantId);
      });
    }, delay);
    this.standInTimers.set(userId, handle);
  }

  private bringStandIn(userId: string, entrantId: string): void {
    const team = this.team(entrantId);
    const side = this.sideOf(entrantId);
    if (!team || !side || this.standIns.has(userId)) return;
    const used = new Set<string>();
    for (const bots of Object.values(this.teamBots()))
      for (const b of bots) used.add(b.name.toLowerCase());
    const bot = pickBots(team.bots, this.o.botPool, used, 1)[0];
    if (!bot) return;
    this.standIns.set(userId, { entrantId, bot });
    this.send([
      ...botConfigLines(bot, this.personas),
      {
        t: 'botadd',
        s: side,
        name: wireName(bot.name),
        sk: Math.max(0, Math.min(7, Math.round(bot.skill))),
        cls: bot.botClass ?? '',
      },
    ]);
    this.say(`${bot.name} plays for ${this.userName(userId)} (${team.displayName})`);
  }

  private announceTeamReady(entrantId: string): void {
    const side = this.sideOf(entrantId);
    if (side) this.send([{ t: 'tready', s: side }]);
    this.say(`${this.name(entrantId)} is ready`);
  }

  /** "!start" from a captain: the team plays now, bots take the places of missing players. */
  private async captainStart(pid: number): Promise<void> {
    const p = this.players.get(pid);
    const s = this.stage;
    if (!this.teamMode || s.kind !== 'readyCheck' || !p?.userId) return;
    const team = this.team(p.entrantId);
    if (!team || !this.sideOf(team.id) || this.teamIsReady(s, team.id)) return;
    const captain = actingCaptain(team, this.connectedUsers());
    if (captain !== p.userId) {
      const who = captain ? memberName(team, captain) : 'the captain';
      this.say(`Only ${who} can start for ${team.displayName}`, pid);
      return;
    }
    const wait = s.since + this.timing.captainStartMs - this.o.clock.now();
    if (wait > 0) {
      this.say(
        `You can start with bots in ${Math.ceil(wait / 1000)} s (or when your team is ready)`,
        pid,
      );
      return;
    }
    s.teamReady.add(team.id);
    this.say(
      `${memberName(team, p.userId)} starts for ${team.displayName}: bots fill missing places`,
    );
    this.announceTeamReady(team.id);
    await this.checkAllReady();
  }

  private countDisconnect(matchId: string, key: string): number {
    const perMatch = this.disconnects.get(matchId) ?? new Map<string, number>();
    this.disconnects.set(matchId, perMatch);
    const count = (perMatch.get(key) ?? 0) + 1;
    perMatch.set(key, count);
    return count;
  }

  private disconnectCount(matchId: string, entrantId: string): number {
    return this.disconnects.get(matchId)?.get(entrantId) ?? 0;
  }

  private async onMatchPlayerLost(entrantId: string | undefined): Promise<void> {
    const s = this.stage;
    if (s.kind !== 'live' || !entrantId || s.lost || this.isBot(entrantId)) return;
    const perMatch = this.disconnects.get(s.matchId) ?? new Map<string, number>();
    this.disconnects.set(s.matchId, perMatch);
    const count = (perMatch.get(entrantId) ?? 0) + 1;
    perMatch.set(entrantId, count);
    const max = this.proj.settings.maxReconnects;
    if (count > max) {
      const winnerSide: Side = this.sideOf(entrantId) === 'a' ? 'b' : 'a';
      this.send([{ t: 'abort', mid: s.matchId, w: winnerSide, why: 'forfeit' }]);
      this.say(
        `${this.name(entrantId)} disconnected ${count} times (max ${max} reconnects) and forfeits`,
      );
      return this.forfeit(s.matchId, entrantId);
    }
    s.lost = entrantId;
    const grace = this.proj.settings.reconnectGraceSec;
    this.send([{ t: 'pause', on: true, why: `${this.name(entrantId)} disconnected` }]);
    this.say(`${this.name(entrantId)} disconnected. Game paused, ${grace}s to reconnect`);
    this.telemetry('paused', { deadline: this.o.clock.now() + grace * 1000 });
    this.setTimer(grace * 1000, async () => {
      const cur = this.stage;
      if (cur.kind !== 'live' || cur.lost !== entrantId) return;
      const winnerSide: Side = this.sideOf(entrantId) === 'a' ? 'b' : 'a';
      this.send([{ t: 'abort', mid: cur.matchId, w: winnerSide, why: 'forfeit' }]);
      this.say(`${this.name(entrantId)} did not come back and forfeits`);
      await this.forfeit(cur.matchId, entrantId);
    });
  }

  private async onGameEnd(msg: Extract<ModToBridge, { t: 'end' }>): Promise<void> {
    const s = this.stage;
    if (s.kind !== 'live' || s.matchId !== msg.mid || s.game !== msg.g) return;
    this.clearTimer();
    this.resetGame();
    const { entrants } = this.current();
    const winnerId = entrants[msg.w === 'a' ? 0 : 1];
    const endReason = (
      { frag: 'fragLimit', time: 'timeLimit', sd: 'suddenDeath', forfeit: 'forfeit' } as const
    )[msg.why];
    if (
      !(await this.append({
        type: 'match.gameFinished',
        data: {
          matchId: s.matchId,
          game: s.game,
          map: s.map,
          scores: { [entrants[0]]: msg.sa, [entrants[1]]: msg.sb },
          winnerId,
          endReason,
        },
      }))
    ) {
      return;
    }
    this.say(`${this.name(winnerId)} wins game ${s.game} (${msg.sa}:${msg.sb})`);
    await this.afterGame(s.matchId, s.game, winnerId);
  }

  /** A game of the series is recorded: next game, or the match result. */
  private async afterGame(matchId: string, game: number, winnerId: string): Promise<void> {
    const { entrants } = this.current();
    const bestOf = this.proj.bracket?.byId[matchId]?.bestOf ?? 1;
    const wins = seriesWins(this.proj, matchId, entrants);
    const needed = Math.ceil(bestOf / 2);
    if (wins[0] < needed && wins[1] < needed) {
      this.cooldownUntil = this.o.clock.now() + this.timing.postGameDelayMs;
      this.stage = { kind: 'between' };
      this.send([...this.bracketUpdate(), this.phase()]);
      return this.startGame(matchId, game + 1);
    }
    const result: MatchResult = {
      matchId,
      entrants,
      winnerId,
      outcome: 'played',
      games: (this.proj.games[matchId] ?? []).map((g) => ({
        map: g.map,
        scores: g.scores,
        winnerId: g.winnerId,
      })),
    };
    if (!(await this.append({ type: 'match.result', data: { result } }))) return;
    await this.afterResult();
  }

  /**
   * Monster Hunt: a run is over. After the first run the other team runs the same map; after the
   * second the game goes to the faster team (time plus penalty per death, see raceWinner).
   */
  private async onRunEnd(msg: Extract<ModToBridge, { t: 'runend' }>): Promise<void> {
    const s = this.stage;
    const runner = this.runner();
    if (!this.raceMode || s.kind !== 'live' || s.matchId !== msg.mid || s.game !== msg.g) return;
    if (!runner || msg.n !== this.raceRun()) return;
    await this.recordRun(s.matchId, s.game, s.map, runner, {
      ms: msg.ms,
      d: msg.d,
      pts: msg.pts,
      done: msg.done,
    });
  }

  /**
   * Organizer: the running team gives up its run (bots stuck, a broken map). It counts as not at
   * the exit with the time, deaths and points so far; then the other team runs, or the game is
   * decided. Works from the ready check on (a team that cannot start gives up with nothing).
   */
  forfeitRun(matchId: string): Promise<void> {
    return this.enqueueChecked(async () => {
      const cm = this.proj.currentMatch;
      const runner = this.runner();
      if (!this.raceMode) throw new Error('this is not a Monster Hunt tournament');
      if (!cm || cm.matchId !== matchId || !cm.map || !runner)
        throw new Error(`no run of ${matchId} is in progress`);
      if (this.proj.phase === 'paused')
        throw new Error('the tournament is paused, resume it first');
      const s = this.stage;
      const onServer = s.kind === 'readyCheck' || s.kind === 'countdown' || s.kind === 'live';
      if (!onServer || s.matchId !== matchId)
        throw new Error(`no run of ${matchId} is in progress on the server`);
      const p = this.lastProgress;
      const progress =
        s.kind === 'live' &&
        p?.matchId === matchId &&
        p.game === cm.game &&
        p.run === this.raceRun()
          ? p
          : { ms: 0, d: 0, pts: 0 };
      if (s.kind === 'live') {
        this.send([{ t: 'abort', mid: matchId, w: this.sideOf(runner) ?? 'a', why: 'runforfeit' }]);
      }
      this.say(`The organizer ends the run of ${this.name(runner)}: it counts as not finished`);
      this.o.log.info(`run of ${this.name(runner)} in ${matchId} given up (organizer)`);
      await this.recordRun(matchId, cm.game, cm.map, runner, { ...progress, done: false }, true);
    });
  }

  /**
   * Monster Hunt: a finished run that beats the map record (statistics) is the new record, if
   * this tournament counts. Same rule as the statistics page: final time incl. penalty, the
   * earlier run keeps a tie.
   */
  private checkMapRecord(map: string, finalTime: number, runner: string): void {
    const recs = this.mapRecords;
    if (!recs?.counts) return;
    const old = recordFor(recs, map);
    if (old && old.finalMs <= finalTime) return;
    const by = this.name(runner);
    const was = old ? ` (was ${formatRaceTime(old.finalMs)} by ${old.by})` : '';
    if (old) Object.assign(old, { finalMs: finalTime, by });
    else recs.maps.push({ map, finalMs: finalTime, by });
    this.say(`New map record on ${map}: ${formatRaceTime(finalTime)} by ${by}${was}`);
  }

  private async recordRun(
    matchId: string,
    game: number,
    map: string,
    runner: string,
    r: { ms: number; d: number; pts: number; done: boolean },
    forfeit = false,
  ): Promise<void> {
    const s = { matchId, game, map };
    this.clearTimer();
    this.resetGame();
    this.lastProgress = undefined;
    const penaltyMs = r.d * this.rules.penaltySec * 1000;
    if (
      !(await this.append({
        type: 'match.runFinished',
        data: {
          matchId,
          game,
          entrantId: runner,
          map,
          timeMs: r.ms,
          deaths: r.d,
          penaltyMs,
          points: r.pts,
          finished: r.done,
          ...(forfeit ? { forfeit: true } : {}),
        },
      }))
    ) {
      return;
    }
    const total = formatRaceTime(r.ms + penaltyMs);
    if (!forfeit)
      this.say(
        r.done
          ? `${this.name(runner)}: ${formatRaceTime(r.ms)} + ${r.d} deaths x ${this.rules.penaltySec}s = ${total}`
          : `${this.name(runner)} did not reach the exit (${r.pts} monster points, ${r.d} deaths)`,
      );
    if (!forfeit && r.done) this.checkMapRecord(map, r.ms + penaltyMs, runner);
    const cm = this.proj.currentMatch;
    const runs = cm?.runs ?? [];
    if (runs.length < 2) {
      // The other team runs the same map after the scoreboard time.
      this.cooldownUntil = this.o.clock.now() + this.timing.postGameDelayMs;
      this.send([...this.bracketUpdate()]);
      return this.travel(s.matchId, s.game, s.map);
    }
    const [r1, r2] = runs as [(typeof runs)[0], (typeof runs)[0]];
    const { winnerId, decidedBy } = raceWinner(r1, r2, this.rng(s.matchId, s.game, 'race'));
    if (
      !(await this.append({
        type: 'match.gameFinished',
        data: {
          matchId: s.matchId,
          game: s.game,
          map: s.map,
          scores: { [r1.entrantId]: finalMs(r1), [r2.entrantId]: finalMs(r2) },
          winnerId,
          endReason: 'race',
        },
      }))
    ) {
      return;
    }
    const how = {
      time: 'faster',
      finish: 'reached the exit',
      points: 'more monster points',
      deaths: 'fewer deaths',
      lot: 'by lot',
    }[decidedBy];
    this.say(`${this.name(winnerId)} wins game ${s.game} (${how})`);
    await this.afterGame(s.matchId, s.game, winnerId);
  }
}

function clampAi(level: number | undefined): number {
  return Math.max(0, Math.min(2, Math.round(level ?? 0)));
}
