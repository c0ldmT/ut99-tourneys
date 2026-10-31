import type { KillFeedEntry, LivePlayer, LiveState, ModToBridge } from '@tourney/protocol';
import type { Clock, TimerHandle } from './clock.js';

/** The mod's live data lines (mod 0.16.0). */
export type LiveLine = Extract<ModToBridge, { t: 'lr' | 'st' | 'sx' | 'pk' | 'bt' | 'tv' }>;

/** What the board needs to know about the game the lines belong to. */
export interface LiveContext {
  tournamentId: string;
  matchId: string;
  game: number;
  /** Monster Hunt: the run. */
  run?: number;
  /** Entrant id of side 0 (a) or 1 (b); a race: the running team for both. */
  sideEntrant(side: number): string | null;
  /** A player by join token: user id and display name (unknown tokens: undefined). */
  player(token: string): { userId?: string; name: string } | undefined;
  /** Seconds since the game (run) went live; undefined when not known. */
  sec(): number | undefined;
}

/** What a bot was doing, for the bridge's bot log (calibration of the skill curve). */
export interface BotThought {
  at: number;
  matchId: string;
  game: number;
  run?: number;
  sec?: number;
  bot: string;
  state: string;
  target: string;
  health: number;
  armor: number;
  weapon: string;
}

/** At most one `match.state` per this many ms. */
export const LIVE_STATE_INTERVAL_MS = 1000;

/** A feed entry with nothing set yet: kills, chat lines, items and thoughts fill in their part. */
export function blankFeed(
  ctx: Pick<LiveContext, 'tournamentId' | 'matchId' | 'game' | 'run' | 'sec'>,
  at: number,
): KillFeedEntry {
  const sec = ctx.sec();
  return {
    tournamentId: ctx.tournamentId,
    matchId: ctx.matchId,
    game: ctx.game,
    ...(ctx.run ? { run: ctx.run } : {}),
    at,
    ...(sec !== undefined ? { sec } : {}),
    killer: '',
    killerSide: null,
    victim: '',
    victimSide: null,
    weapon: '',
    headshot: false,
    firstBlood: false,
    suicide: false,
    teamKill: false,
    monster: false,
    spree: 0,
    multi: 0,
  };
}

/**
 * Live state of the game (Monster Hunt: run) in progress, built from the mod's live lines: the
 * roster (lr), every player's state (st) and counters (sx), items taken (pk) and what the bots
 * are up to (bt). Sends one `match.state` per second at most; items and thoughts go to the feed
 * right away.
 */
export class LiveBoard {
  private key = '';
  private slots = new Map<number, LivePlayer>();
  /** Per slot: the name the mod uses (kill feed lines name the killer) and monster kills. */
  private modNames = new Map<number, string>();
  private monsterKf = new Map<number, number>();
  /** Slots whose counters line carries the monster kills (mod 0.17.0): the feed count is off. */
  private monsterSx = new Set<number>();
  private monsterInfo?: LiveState['monsters'];
  private objectiveList: NonNullable<LiveState['objectives']> = [];
  private ctx?: LiveContext;
  private lastEmit = 0;
  private timer?: TimerHandle;

  constructor(
    private readonly clock: Clock,
    private readonly emitState: (state: LiveState) => void,
    private readonly emitFeed: (entry: KillFeedEntry) => void,
    private readonly onThought?: (t: BotThought) => void,
  ) {}

  /** A new game (run) went live, or none is live any more. */
  reset(): void {
    this.key = '';
    this.slots.clear();
    this.modNames.clear();
    this.monsterKf.clear();
    this.monsterSx.clear();
    this.monsterInfo = undefined;
    this.objectiveList = [];
    this.ctx = undefined;
    if (this.timer) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** A human plays in the game (the website delays what could help a player). */
  get humans(): boolean {
    for (const p of this.slots.values()) if (!p.bot) return true;
    return false;
  }

  handle(msg: LiveLine, ctx: LiveContext): void {
    if (!this.use(`${msg.mid}/${msg.g}/${msg.n}`, ctx)) return;
    if (msg.t === 'lr') {
      const known = msg.tk ? ctx.player(msg.tk) : undefined;
      const prev = this.slots.get(msg.i);
      this.modNames.set(msg.i, msg.nm.toLowerCase());
      this.slots.set(msg.i, {
        ...(prev ?? emptyPlayer()),
        name: (known?.name ?? msg.nm).slice(0, 64),
        side: ctx.sideEntrant(msg.sd),
        bot: msg.b,
        ...(known?.userId ? { userId: known.userId } : {}),
      });
      return this.changed();
    }
    const p = this.slots.get(msg.i);
    if (!p) return; // a slot without its roster line (it comes first)
    switch (msg.t) {
      case 'st':
        Object.assign(p, {
          alive: msg.al,
          health: msg.h,
          armor: msg.a,
          weapon: msg.w,
          powerups: msg.pu,
          ampSec: msg.ut,
        });
        return this.changed();
      case 'sx':
        Object.assign(p, {
          kills: msg.k,
          deaths: msg.d,
          suicides: msg.su,
          damageDealt: msg.dd,
          damageTaken: msg.dt,
        });
        if (!p.bot) Object.assign(p, { ping: msg.pg, loss: msg.pl });
        if (msg.mk !== undefined) {
          this.monsterSx.add(msg.i);
          p.monsters = msg.mk;
        }
        return this.changed();
      case 'pk': {
        if (msg.it === 'amp' || msg.it === 'belt' || msg.it === 'armor' || msg.it === 'keg')
          p.items[msg.it]++;
        this.emitFeed({
          ...blankFeed(ctx, this.clock.now()),
          kind: 'item',
          humans: this.humans,
          killer: p.name,
          killerSide: p.side,
          item: msg.it,
        });
        return this.changed();
      }
      case 'tv':
        // Mod 0.17.0: an episode of a trait ended (the statistics keep it too).
        this.emitFeed({
          ...blankFeed(ctx, this.clock.now()),
          kind: 'trait',
          humans: this.humans,
          killer: p.name,
          killerSide: p.side,
          trait: { code: msg.c, dur: msg.d, kills: msg.k, died: msg.x === 1 },
        });
        return;
      case 'bt': {
        const at = this.clock.now();
        const sec = ctx.sec();
        this.emitFeed({
          ...blankFeed(ctx, at),
          kind: 'thought',
          humans: this.humans,
          killer: p.name,
          killerSide: p.side,
          thought: { state: msg.s, target: msg.tg },
        });
        this.onThought?.({
          at,
          matchId: ctx.matchId,
          game: ctx.game,
          ...(ctx.run ? { run: ctx.run } : {}),
          ...(sec !== undefined ? { sec } : {}),
          bot: p.name,
          state: msg.s,
          target: msg.tg,
          health: p.health,
          armor: p.armor,
          weapon: p.weapon,
        });
        return;
      }
    }
  }

  /**
   * Monster Hunt: a monster kill from the kill feed (mods before 0.17.0 count no monsters in
   * the counters line). The feed names the killer as the mod does; game must be the board's.
   */
  monsterKill(killer: string, game: number): void {
    if (!this.key || Number(this.key.split('/')[1]) !== game) return;
    const name = killer.toLowerCase();
    for (const [i, n] of this.modNames)
      if (n === name && !this.monsterSx.has(i)) {
        const k = (this.monsterKf.get(i) ?? 0) + 1;
        this.monsterKf.set(i, k);
        const p = this.slots.get(i);
        if (p) p.monsters = k;
        return this.changed();
      }
  }

  /** Monster Hunt (mod 0.17.0): an objective of the map changed its state. */
  objective(msg: Extract<ModToBridge, { t: 'ob' }>, ctx: LiveContext): void {
    const head = this.key.split('/');
    if (this.key && (head[0] !== msg.mid || Number(head[1]) !== msg.g || Number(head[2]) !== msg.n))
      return;
    this.ctx = ctx;
    const list = this.objectiveList.slice(0, msg.of);
    while (list.length < msg.of) list.push({ text: '', state: 0 });
    list[msg.j] = { text: msg.m, state: msg.st };
    this.objectiveList = list;
    this.changed();
  }

  /** Monster Hunt: monsters alive, at the start and bosses alive (from the progress line). */
  monsters(alive: number, total: number, bosses: number, run: number, ctx: LiveContext): void {
    const head = this.key.split('/');
    // the progress line has no slot: it belongs to the board's game when the run matches
    if (this.key && Number(head[2]) !== run) return;
    this.ctx = ctx;
    this.monsterInfo = { alive, total: Math.max(total, alive), bosses };
    this.changed();
  }

  private use(key: string, ctx: LiveContext): boolean {
    if (key !== this.key) {
      this.reset();
      this.key = key;
    }
    this.ctx = ctx;
    return true;
  }

  private changed(): void {
    if (this.timer) return;
    const wait = this.lastEmit + LIVE_STATE_INTERVAL_MS - this.clock.now();
    if (wait <= 0) return this.flush();
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, wait);
  }

  private flush(): void {
    const ctx = this.ctx;
    if (!ctx || !this.slots.size) return;
    this.lastEmit = this.clock.now();
    const players = [...this.slots.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, p]) => ({ ...p, items: { ...p.items } }));
    this.emitState({
      tournamentId: ctx.tournamentId,
      matchId: ctx.matchId,
      game: ctx.game,
      ...(ctx.run ? { run: ctx.run } : {}),
      at: this.lastEmit,
      sec: ctx.sec() ?? 0,
      humans: this.humans,
      players,
      ...(this.monsterInfo ? { monsters: { ...this.monsterInfo } } : {}),
      ...(this.objectiveList.length
        ? { objectives: this.objectiveList.map((o) => ({ ...o })) }
        : {}),
    });
  }
}

function emptyPlayer(): LivePlayer {
  return {
    name: '',
    side: null,
    bot: true,
    alive: true,
    health: 100,
    armor: 0,
    weapon: '',
    powerups: 0,
    ampSec: 0,
    kills: 0,
    deaths: 0,
    suicides: 0,
    damageDealt: 0,
    damageTaken: 0,
    items: { amp: 0, belt: 0, armor: 0, keg: 0 },
  };
}
