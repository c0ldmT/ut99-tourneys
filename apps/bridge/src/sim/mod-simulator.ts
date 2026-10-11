import net from 'node:net';
import { createRng, shuffle, type Rng } from '@tourney/bracket';
import {
  decodeBridgeToMod,
  encodeModLine,
  LineSplitter,
  MOD_PROTOCOL_VERSION,
  type BridgeToMod,
  type ModToBridge,
} from '@tourney/protocol';
import type { Clock, TimerHandle } from '../clock.js';
import type { Logger } from '../log.js';

/**
 * Simulates a UT99 server running the tournament mod, including the human players on it.
 * It speaks the real line protocol over TCP, so it exercises the bridge exactly like the mod.
 */

export interface SimPlayer {
  token: string;
  name: string;
}

export interface SimBehaviour {
  /** Players (tokens) that never connect. */
  absent: string[];
  /** Players that connect but never ready up. */
  neverReady: string[];
  /** One player that disconnects during its next live game; optionally returns after ms. */
  dropDuringLive?: { token: string; returnAfterMs?: number; times?: number };
  readyDelayMs: number;
  voteDelayMs: number;
  /** Players that skip voting (their ballot is filled randomly by the bridge). */
  noVote: string[];
  gameDurationMs: number;
  levelLoadMs: number;
  scoreIntervalMs: number;
  /** Chance that side a wins a game. */
  winChanceA: number;
}

export interface SimOptions {
  host: string;
  port: number;
  sharedKey: string;
  players: SimPlayer[];
  clock: Clock;
  log?: Logger;
  startLevel?: string;
  seed?: string;
  behaviour?: Partial<SimBehaviour>;
}

const DEFAULT_BEHAVIOUR: SimBehaviour = {
  absent: [],
  neverReady: [],
  readyDelayMs: 1_000,
  voteDelayMs: 500,
  noVote: [],
  gameDurationMs: 30_000,
  levelLoadMs: 1_000,
  scoreIntervalMs: 5_000,
  winChanceA: 0.5,
};

interface Joined {
  pid: number;
  token: string;
  role: 'a' | 'b' | 's';
}

export class ModSimulator {
  readonly b: SimBehaviour;
  private socket?: net.Socket;
  private level: string;
  private inGame = false;
  private paused = false;
  private nextPid = 1;
  private acl = new Map<string, { name: string; r: 'a' | 'b' | 's' }>();
  private joined = new Map<string, Joined>();
  private voteOptions: string[] = [];
  private match?: { mid: string; g: number };
  private phase = 'lobby';
  private inSync = false;
  private gameTimers: TimerHandle[] = [];
  private endTimer?: { handle: TimerHandle; due: number };
  private endRemaining?: number;
  private dropped = new Set<string>();
  private rng: Rng;
  private stopped = false;
  /** Every line received from the bridge (tests inspect it). */
  readonly received: BridgeToMod[] = [];
  readonly receivedAt: number[] = [];
  /** Travels performed, in order. */
  readonly travels: string[] = [];

  constructor(private readonly o: SimOptions) {
    this.b = { ...DEFAULT_BEHAVIOUR, ...o.behaviour };
    this.level = o.startLevel ?? 'DM-Lobby';
    this.rng = createRng(o.seed ?? 'sim');
  }

  start(): void {
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearGame();
    this.socket?.destroy();
  }

  get currentLevel(): string {
    return this.level;
  }

  private log(msg: string): void {
    this.o.log?.debug(`[sim] ${msg}`);
  }

  private connect(): void {
    if (this.stopped) return;
    const socket = net.connect(this.o.port, this.o.host);
    const splitter = new LineSplitter();
    this.socket = socket;
    socket.setEncoding('latin1');
    socket.setNoDelay(true); // small lines must not wait for Nagle
    socket.on('connect', () => {
      this.joined.clear();
      const beat = () => {
        if (this.socket !== socket || socket.destroyed) return;
        this.send({ t: 'hb', up: 0 });
        this.later(5_000, beat);
      };
      this.later(5_000, beat);
      this.send({
        t: 'hello',
        key: this.o.sharedKey,
        pv: MOD_PROTOCOL_VERSION,
        mv: 'sim',
        eng: 469,
        lvl: this.level,
        gm: this.inGame,
      });
    });
    socket.on('data', (chunk: string) => {
      for (const line of splitter.push(chunk)) {
        try {
          this.handle(decodeBridgeToMod(line));
        } catch (e) {
          this.o.log?.warn(`[sim] bad line from bridge: ${(e as Error).message}`);
        }
      }
    });
    socket.on('error', (e) => this.log(`socket error ${e.message}`));
    socket.on('close', () => {
      if (this.socket === socket) this.socket = undefined;
    });
  }

  private send(msg: ModToBridge): void {
    this.socket?.write(encodeModLine(msg), 'latin1');
  }

  private later(ms: number, fn: () => void): TimerHandle {
    return this.o.clock.setTimeout(() => {
      if (!this.stopped) fn();
    }, ms);
  }

  private handle(msg: BridgeToMod): void {
    this.received.push(msg);
    this.receivedAt.push(this.o.clock.now());
    switch (msg.t) {
      case 'acl':
        this.acl.clear();
        return;
      case 'acle':
      case 'acladd': {
        this.acl.set(msg.tk, { name: msg.name, r: msg.r });
        const j = this.joined.get(msg.tk);
        if (j) j.role = msg.r;
        return;
      }
      case 'acldel':
        this.acl.delete(msg.tk);
        return;
      case 'match':
        this.match = { mid: msg.mid, g: msg.g };
        return;
      case 'sync':
        this.inSync = msg.st === 'begin';
        if (msg.st === 'end') {
          this.joinPlayers();
          this.onPhase();
        }
        return;
      case 'vopen':
        this.voteOptions = [];
        return;
      case 'vmap':
        this.voteOptions.push(msg.map);
        return;
      case 'phase':
        this.phase = msg.p;
        if (!this.inSync) this.onPhase();
        return;
      case 'travel':
        this.travels.push(msg.map);
        this.clearGame();
        this.inGame = false;
        this.level = msg.map;
        this.socket?.destroy();
        this.socket = undefined;
        this.later(this.b.levelLoadMs, () => this.connect());
        return;
      case 'cd':
        this.later(msg.sec * 1000, () => this.startGame());
        return;
      case 'pause':
        this.setPaused(msg.on);
        return;
      case 'abort':
        this.clearGame();
        this.inGame = false;
        return;
      default:
        return;
    }
  }

  /** Players react to a phase like humans would: ready up, vote. */
  private onPhase(): void {
    if (this.phase === 'ready') this.scheduleReady();
    if (this.phase === 'vote') this.scheduleVotes();
  }

  private joinPlayers(): void {
    for (const p of this.o.players) {
      if (this.b.absent.includes(p.token) || this.dropped.has(p.token)) continue;
      const entry = this.acl.get(p.token);
      if (!entry) continue;
      const existing = this.joined.get(p.token);
      if (existing) {
        existing.role = entry.r;
        continue;
      }
      this.join(p, entry.r);
    }
  }

  private join(p: SimPlayer, role: 'a' | 'b' | 's'): void {
    const j: Joined = { pid: this.nextPid++, token: p.token, role };
    this.joined.set(p.token, j);
    this.send({ t: 'join', pid: j.pid, tk: p.token, name: p.name, role });
  }

  private matchPlayers(): Joined[] {
    return [...this.joined.values()].filter((j) => j.role !== 's');
  }

  private scheduleReady(): void {
    for (const j of this.matchPlayers()) {
      if (this.b.neverReady.includes(j.token)) continue;
      this.later(this.b.readyDelayMs, () => {
        if (this.joined.get(j.token) === j) this.send({ t: 'ready', pid: j.pid });
      });
    }
  }

  private scheduleVotes(): void {
    for (const j of this.matchPlayers()) {
      if (this.b.noVote.includes(j.token)) continue;
      this.later(this.b.voteDelayMs, () => {
        const picks = shuffle(this.voteOptions, this.rng).slice(0, 3);
        this.send({
          t: 'vote',
          pid: j.pid,
          m1: picks[0] ?? '',
          m2: picks[1] ?? '',
          m3: picks[2] ?? '',
        });
      });
    }
  }

  private startGame(): void {
    const m = this.match;
    if (!m) return;
    this.inGame = true;
    this.send({ t: 'live', mid: m.mid, g: m.g });
    let sa = 0;
    let sb = 0;
    const tick = () => {
      if (!this.inGame) return;
      if (!this.paused) {
        sa += Math.floor(this.rng() * 3);
        sb += Math.floor(this.rng() * 3);
        this.send({
          t: 'score',
          mid: m.mid,
          g: m.g,
          sa: Math.min(sa, 19),
          sb: Math.min(sb, 19),
          tl: -1,
          ot: false,
        });
      }
      this.gameTimers.push(this.later(this.b.scoreIntervalMs, tick));
    };
    this.gameTimers.push(this.later(this.b.scoreIntervalMs, tick));
    this.armEnd(this.b.gameDurationMs);

    this.scheduleDrop();
  }

  /** Disconnects the configured player during the running game (and brings them back). */
  private scheduleDrop(): void {
    const m = this.match;
    const drop = this.b.dropDuringLive;
    const dropper = drop && this.matchPlayers().find((j) => j.token === drop.token);
    if (!m || !drop || !dropper || this.dropped.has(drop.token)) return;
    this.gameTimers.push(
      this.later(this.b.gameDurationMs / 4, () => {
        if (!this.inGame) return;
        this.dropped.add(drop.token);
        this.joined.delete(drop.token);
        this.send({ t: 'leave', pid: dropper.pid });
        this.send({ t: 'lost', mid: m.mid, s: dropper.role === 'a' ? 'a' : 'b' });
        this.setPaused(true);
        if (drop.returnAfterMs === undefined) return;
        this.gameTimers.push(
          this.later(drop.returnAfterMs, () => {
            const p = this.o.players.find((x) => x.token === drop.token);
            this.dropped.delete(drop.token);
            const times = (drop.times ?? 1) - 1;
            this.b.dropDuringLive = times > 0 ? { ...drop, times } : undefined;
            if (p) this.join(p, dropper.role);
            if (times > 0) this.scheduleDrop();
          }),
        );
      }),
    );
  }

  private armEnd(ms: number): void {
    const m = this.match;
    if (!m) return;
    const handle = this.later(ms, () => {
      if (!this.inGame) return;
      this.inGame = false;
      this.clearGame();
      const w = this.rng() < this.b.winChanceA ? 'a' : 'b';
      const loserScore = Math.floor(this.rng() * 20);
      this.send({
        t: 'end',
        mid: m.mid,
        g: m.g,
        sa: w === 'a' ? 20 : loserScore,
        sb: w === 'b' ? 20 : loserScore,
        w,
        why: 'frag',
      });
    });
    this.endTimer = { handle, due: this.o.clock.now() + ms };
  }

  private setPaused(on: boolean): void {
    if (on === this.paused) return;
    this.paused = on;
    if (on && this.endTimer) {
      this.endRemaining = Math.max(0, this.endTimer.due - this.o.clock.now());
      this.o.clock.clearTimeout(this.endTimer.handle);
      this.endTimer = undefined;
    } else if (!on && this.inGame && this.endRemaining !== undefined) {
      this.armEnd(this.endRemaining);
      this.endRemaining = undefined;
    }
  }

  private clearGame(): void {
    for (const t of this.gameTimers) this.o.clock.clearTimeout(t);
    this.gameTimers = [];
    if (this.endTimer) this.o.clock.clearTimeout(this.endTimer.handle);
    this.endTimer = undefined;
    this.endRemaining = undefined;
    this.paused = false;
  }
}
