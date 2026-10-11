import { EventEmitter } from 'node:events';
import {
  createRng,
  nextMatch as scheduleNextMatch,
  type MatchResult,
  type Rng,
} from '@tourney/bracket';
import {
  projectTournament,
  type AccessEntry,
  type BotSpec,
  type BridgeToMod,
  type MapInfo,
  type ModPhase,
  type ModToBridge,
  type NewTournamentEvent,
  type TournamentEvent,
  type TournamentProjection,
} from '@tourney/protocol';
import {
  loserPickMap,
  parseRules,
  randomBallot,
  randomMap,
  resolveMapVote,
  simulateSeries,
  type Ut99DmRules,
} from '@tourney/adapter-ut99';
import { botEntrant } from './bootstrap.js';
import type { Clock, TimerHandle } from './clock.js';
import type { EventStore } from './event-store.js';
import type { Logger } from './log.js';
import type { ModHello, ModLink } from './mod-server.js';
import {
  aclLines,
  bracketLines,
  entrantName,
  matchLines,
  phaseLine,
  seriesWins,
  standingsLines,
  travelLine,
  voteLines,
  type Side,
} from './snapshot.js';

export interface DirectorTiming {
  /** Minimum time between the end of a game and the next map change (scoreboard time). */
  postGameDelayMs: number;
  /** Delay before a simulated bot vs bot match is decided. */
  simulateDelayMs: number;
  /** Re-send the travel command if the mod has not come back on the new map after this long. */
  loadingTimeoutMs: number;
  /** While the tournament waits for someone, tell the server who and why this often (0 = off). */
  reminderIntervalMs: number;
}

const DEFAULT_TIMING: DirectorTiming = {
  postGameDelayMs: 10_000,
  simulateDelayMs: 3_000,
  loadingTimeoutMs: 90_000,
  reminderIntervalMs: 30_000,
};

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
  | {
      kind: 'readyCheck';
      matchId: string;
      game: number;
      map: string;
      ready: Set<string>;
      present: Set<string>;
      deadline: number;
    }
  | { kind: 'countdown'; matchId: string; game: number; map: string }
  | {
      kind: 'live';
      matchId: string;
      game: number;
      map: string;
      scores: [number, number];
      lost?: string;
    }
  | { kind: 'simulating'; matchId: string }
  | { kind: 'finished' };

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
  private timer?: { handle: TimerHandle; due: number; fn: () => Promise<void> | void };
  private suspended?: { remaining: number; fn: () => Promise<void> | void };
  private cooldownUntil = 0;
  private readonly timing: DirectorTiming;

  constructor(private readonly o: DirectorOptions) {
    super();
    this.timing = { ...DEFAULT_TIMING, ...o.timing };
  }

  // -------------------------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------------------------

  private readonly onHelloListener = (h: ModHello) => void this.enqueue(() => this.onHello(h));
  private readonly onMessageListener = (m: Exclude<ModToBridge, ModHello>) =>
    void this.enqueue(() => this.onMessage(m));
  private stopped = false;
  private reminder?: TimerHandle;

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
        const missing = this.humans().filter((id) => !this.proj.checkedIn.includes(id));
        if (!missing.length) return undefined;
        const total = this.humans().length;
        return `Waiting for check-in (${total - missing.length}/${total}): ${names(missing)}. Start in ${left(s.deadline)}, missing players are replaced by bots.`;
      }
      case 'voting': {
        const open = s.voters.filter((v) => !s.ballots.has(v));
        if (!open.length) return undefined;
        return `Map vote ${s.matchId}: waiting for ${names(open)}. Type !vote 2 1 3 (${left(s.deadline)} left).`;
      }
      case 'readyCheck': {
        const { entrants } = this.current();
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

  resume(): Promise<void> {
    return this.enqueue(async () => {
      if (this.proj.phase !== 'paused') return;
      if (!(await this.append({ type: 'tournament.resumed', data: {} }))) return;
      this.send([{ t: 'pause', on: false, why: '' }, this.phase()]);
      this.rearmTimer();
    });
  }

  // -------------------------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------------------------

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

  /** Appends events. On a concurrency conflict it reloads, re-plans and returns false. */
  private async append(...events: EventDraft[]): Promise<boolean> {
    const actor = { kind: 'bridge' as const, id: this.o.agentId };
    const full = events.map((e) => ({ ...e, actor })) as NewTournamentEvent[];
    const res = await this.o.store.append(this.o.tournamentId, this.proj.headSeq, full);
    if (res.accepted) {
      this.events.push(...res.events);
      this.proj = projectTournament(this.events);
      return true;
    }
    this.o.log.warn(`event append rejected (${res.reason}), re-planning`);
    await this.reload();
    await this.resumeFromProjection();
    return false;
  }

  private setTimer(ms: number, fn: () => Promise<void> | void): void {
    this.clearTimer();
    if (this.proj.phase === 'paused') {
      this.suspended = { remaining: ms, fn };
      return;
    }
    const handle = this.o.clock.setTimeout(() => {
      if (this.timer?.handle === handle) this.timer = undefined;
      void this.enqueue(fn);
    }, ms);
    this.timer = { handle, due: this.o.clock.now() + ms, fn };
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
    return this.proj.entrants[entrantId]?.kind === 'bot';
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
    ];
    if (cm) lines.push(...matchLines(this.proj, this.rules, cm.matchId, cm.game, cm.entrants));
    lines.push(...aclLines(this.proj, this.o.access, cm?.entrants, this.rev));
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
        this.stage = { kind: 'finished' };
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

  private humans(): string[] {
    return Object.values(this.proj.entrants)
      .filter((e) => e.kind === 'human')
      .map((e) => e.id);
  }

  private async maybeCompleteCheckIn(): Promise<void> {
    if (this.stage.kind !== 'checkIn') return;
    const missing = this.humans().filter((id) => !this.proj.checkedIn.includes(id));
    if (missing.length === 0) {
      await this.startTournament();
    } else {
      this.say(
        `Check-in: ${this.humans().length - missing.length}/${this.humans().length} players. Waiting for ${missing.map((m) => this.name(m)).join(', ')}`,
      );
    }
  }

  private async startTournament(): Promise<void> {
    if (this.stage.kind !== 'checkIn') return;
    this.clearTimer();
    const missing = this.humans().filter((id) => !this.proj.checkedIn.includes(id));
    const usedNames = new Set(
      Object.values(this.proj.entrants)
        .filter((e) => e.kind === 'bot')
        .map((e) => (e.kind === 'bot' ? e.bot.name : '')),
    );
    const replacements: EventDraft[] = missing.map((entrantId, i) => {
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
    this.send(aclLines(this.proj, this.o.access, undefined, ++this.rev));
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
    // Tell the server who plays next, so it can show vote/ready UI to the right players.
    this.send([
      ...matchLines(this.proj, this.rules, m.id, 1, entrants),
      ...aclLines(this.proj, this.o.access, entrants, ++this.rev),
    ]);
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
        return this.openVote(
          matchId,
          game,
          'vote',
          entrants.filter((e) => !this.isBot(e)),
        );
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
    const games = this.proj.games[matchId] ?? [];
    const last = games[games.length - 1];
    const loser = entrants.find((e) => e !== last?.winnerId) as string;
    return this.openVote(matchId, game, 'loserPick', this.isBot(loser) ? [] : [loser]);
  }

  private async openVote(
    matchId: string,
    game: number,
    method: VoteMethod,
    voters: string[],
  ): Promise<void> {
    const deadline = this.o.clock.now() + this.rules.voteTimeoutSec * 1000;
    this.stage = { kind: 'voting', matchId, game, method, voters, ballots: new Map(), deadline };
    if (voters.length === 0) return this.closeVote();
    this.send([...voteLines(matchId, this.voteOptions(), this.rules.voteTimeoutSec), this.phase()]);
    const who = voters.map((v) => this.name(v)).join(' and ');
    this.say(
      method === 'vote'
        ? `Map vote for ${who}: pick up to ${this.rules.picksPerPlayer} maps (!vote 3 1 5)`
        : `${who} lost the last game and picks the next map (!vote <number>)`,
    );
    this.setTimer(this.rules.voteTimeoutSec * 1000, () => this.closeVote());
    this.telemetry('voting', { deadline });
  }

  private async onVote(entrantId: string, picks: string[]): Promise<void> {
    const s = this.stage;
    if (s.kind !== 'voting' || !s.voters.includes(entrantId)) return;
    s.ballots.set(entrantId, picks);
    if (s.voters.every((v) => s.ballots.has(v))) await this.closeVote();
  }

  private async closeVote(): Promise<void> {
    const s = this.stage;
    if (s.kind !== 'voting') return;
    this.clearTimer();
    const { entrants } = this.current();
    const rng = this.rng(s.matchId, s.game, s.method);
    if (s.method === 'vote') {
      const out = resolveMapVote({
        pool: this.pool,
        entrants,
        ballots: [...s.ballots].map(([entrantId, picks]) => ({ entrantId, picks })),
        history: this.proj.mapHistory,
        picksPerPlayer: this.rules.picksPerPlayer,
        avoidRecentMaps: this.rules.avoidRecentMaps,
        rng,
      });
      return this.selectMap(s.matchId, s.game, out.map, 'vote', {
        ballots: out.ballots,
        scores: out.scores,
        tiedFor: out.tiedFor,
      });
    }
    const games = this.proj.games[s.matchId] ?? [];
    const loser = s.voters[0];
    const picks = (loser && s.ballots.get(loser)) || randomBallot(this.pool, 3, rng);
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
    if (
      !(await this.append({
        type: 'match.mapSelected',
        data: { matchId, game, map, method, ...(details ? { details } : {}) },
      }))
    ) {
      return;
    }
    if (method !== 'random') this.send([{ t: 'vclose', map }]);
    this.say(`Map: ${map}`);
    await this.travel(matchId, game, map);
  }

  private async travel(matchId: string, game: number, map: string): Promise<void> {
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
      ...matchLines(this.proj, this.rules, s.matchId, s.game, entrants),
      ...aclLines(this.proj, this.o.access, entrants, ++this.rev),
      this.phase(),
      travelLine(this.rules, s.map, s.matchId, s.game),
    ]);
    this.telemetry('loading');
    this.setTimer(this.timing.loadingTimeoutMs, () => {
      this.o.log.warn(`no mod connection on ${s.map} after travel, sending travel again`);
      this.sendTravel();
    });
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

  private async enterReadyCheck(matchId: string, game: number, map: string): Promise<void> {
    const deadline = this.o.clock.now() + this.proj.settings.noShowSec * 1000;
    this.stage = {
      kind: 'readyCheck',
      matchId,
      game,
      map,
      ready: new Set(),
      present: new Set(),
      deadline,
    };
    this.send(this.snapshot());
    this.setTimer(this.proj.settings.noShowSec * 1000, () => this.onNoShow());
    this.telemetry('readyCheck', { deadline });
    await this.checkAllReady();
  }

  private async checkAllReady(): Promise<void> {
    const s = this.stage;
    if (s.kind !== 'readyCheck') return;
    const { entrants } = this.current();
    const ready = Object.fromEntries(entrants.map((e) => [e, this.isBot(e) || s.ready.has(e)]));
    this.telemetry('readyCheck', { ready, deadline: s.deadline });
    if (!entrants.every((e) => ready[e])) return;
    this.clearTimer();
    this.stage = { kind: 'countdown', matchId: s.matchId, game: s.game, map: s.map };
    this.send([{ t: 'cd', sec: this.rules.countdownSec }, this.phase()]);
    this.telemetry('countdown');
  }

  private async onNoShow(): Promise<void> {
    const s = this.stage;
    if (s.kind !== 'readyCheck') return;
    const { entrants } = this.current();
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

  private async forfeit(matchId: string, loser: string): Promise<void> {
    this.clearTimer();
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
    if (!champion) return;
    if (this.proj.phase !== 'finished') {
      if (!(await this.append({ type: 'tournament.finished', data: { championId: champion } })))
        return;
    }
    this.stage = { kind: 'finished' };
    this.send([...this.bracketUpdate(), this.phase()]);
    this.say(`${this.name(champion)} wins the tournament!`);
    this.emit('finished', champion);
    this.setTimer(this.proj.settings.postTournamentShutdownMin * 60_000, () => {
      this.emit('shutdown');
    });
  }

  private async simulate(
    matchId: string,
    entrants: [string, string],
    bestOf: number,
  ): Promise<void> {
    this.stage = { kind: 'simulating', matchId };
    this.send([this.phase()]);
    this.setTimer(this.timing.simulateDelayMs, async () => {
      const skills = entrants.map((e) => {
        const ent = this.proj.entrants[e];
        return ent?.kind === 'bot' ? ent.bot.skill : 3;
      }) as [number, number];
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

  // -------------------------------------------------------------------------------------------
  // Mod input
  // -------------------------------------------------------------------------------------------

  private entrantFor(token: string): { entry?: AccessEntry; entrantId?: string } {
    const entry = this.o.access.find((a) => a.token === token);
    if (!entry?.entrantId) return entry ? { entry } : {};
    const ent = this.proj.entrants[entry.entrantId];
    const isTheirs = ent?.kind === 'human' && ent.userId === entry.userId;
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
        if (!s.ready.has(p.entrantId)) {
          s.ready.add(p.entrantId);
          this.say(`${this.name(p.entrantId)} is ready`);
        }
        return this.checkAllReady();
      }
      case 'vote': {
        const p = this.players.get(msg.pid);
        if (!p?.entrantId) return;
        return this.onVote(p.entrantId, [msg.m1, msg.m2, msg.m3].filter(Boolean));
      }
      case 'live': {
        const s = this.stage;
        if (s.kind !== 'countdown' || s.matchId !== msg.mid) return;
        this.stage = { kind: 'live', matchId: s.matchId, game: s.game, map: s.map, scores: [0, 0] };
        if (
          !(await this.append({
            type: 'match.started',
            data: { matchId: s.matchId, game: s.game },
          }))
        )
          return;
        this.send([...this.bracketUpdate(), this.phase()]);
        this.telemetry('live');
        return;
      }
      case 'score': {
        const s = this.stage;
        if (s.kind !== 'live' || s.matchId !== msg.mid) return;
        s.scores = [msg.sa, msg.sb];
        const { entrants } = this.current();
        this.telemetry('live', { scores: { [entrants[0]]: msg.sa, [entrants[1]]: msg.sb } });
        return;
      }
      case 'lost': {
        const s = this.stage;
        if (s.kind !== 'live' || s.matchId !== msg.mid) return;
        const { entrants } = this.current();
        return this.onMatchPlayerLost(entrants[msg.s === 'a' ? 0 : 1]);
      }
      case 'end':
        return this.onGameEnd(msg);
      case 'hb':
        return;
      case 'err':
        this.o.log.warn(`mod error: ${msg.msg}`);
        return;
    }
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
      this.telemetry('live');
    }
  }

  private async onLeave(pid: number): Promise<void> {
    const p = this.players.get(pid);
    this.players.delete(pid);
    if (p) this.o.log.info(`${p.name} left the server`);
    if (!p?.entrantId) return;
    const s = this.stage;
    if (s.kind === 'readyCheck') {
      s.present.delete(p.entrantId);
      s.ready.delete(p.entrantId);
    } else if (s.kind === 'countdown' && this.sideOf(p.entrantId)) {
      this.say(`${this.name(p.entrantId)} left during the countdown, back to the ready check`);
      await this.enterReadyCheck(s.matchId, s.game, s.map);
    } else if (s.kind === 'live' && this.sideOf(p.entrantId)) {
      await this.onMatchPlayerLost(p.entrantId);
    }
  }

  private async onMatchPlayerLost(entrantId: string | undefined): Promise<void> {
    const s = this.stage;
    if (s.kind !== 'live' || !entrantId || s.lost || this.isBot(entrantId)) return;
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
    const bestOf = this.proj.bracket?.byId[s.matchId]?.bestOf ?? 1;
    const wins = seriesWins(this.proj, s.matchId, entrants);
    const needed = Math.ceil(bestOf / 2);
    this.say(`${this.name(winnerId)} wins game ${s.game} (${msg.sa}:${msg.sb})`);
    if (wins[0] < needed && wins[1] < needed) {
      this.cooldownUntil = this.o.clock.now() + this.timing.postGameDelayMs;
      this.stage = { kind: 'between' };
      this.send([...this.bracketUpdate(), this.phase()]);
      return this.startGame(s.matchId, s.game + 1);
    }
    const result: MatchResult = {
      matchId: s.matchId,
      entrants,
      winnerId,
      outcome: 'played',
      games: (this.proj.games[s.matchId] ?? []).map((g) => ({
        map: g.map,
        scores: g.scores,
        winnerId: g.winnerId,
      })),
    };
    if (!(await this.append({ type: 'match.result', data: { result } }))) return;
    await this.afterResult();
  }
}
