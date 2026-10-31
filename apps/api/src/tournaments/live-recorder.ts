import zlib from 'node:zlib';
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { KillFeedEntry, LivePlayer, LiveState } from '@tourney/protocol';
import { and, eq, lt } from 'drizzle-orm';
import { LOGGER, type ApiLogger } from '../common/logger.js';
import { CLOCK, type ApiClock } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { gameReplays } from '../db/schema.js';
import { SettingsService } from '../settings/settings.service.js';
import { TournamentsService } from './tournaments.service.js';

/** Seconds between two timeline samples. */
export const SAMPLE_SEC = 5;
/** Feed entries kept per game (run); a long game drops the oldest thoughts first. */
export const REPLAY_FEED_MAX = 3000;
/** Lines of a game (run) that come in this long after its end are late, not a new game. */
export const LATE_MS = 60_000;

/** A feed entry as stored: without the ids the replay row already has. */
export type ReplayEntry = Omit<KillFeedEntry, 'tournamentId' | 'matchId' | 'game' | 'run'>;

/**
 * A game's (Monster Hunt: run's) replay: the whole feed, a timeline and the last live state.
 * Timeline samples: `[sec, scoreA, scoreB, damageA, damageB]` for the sides in `sides`; a race
 * run: `[sec, points, deaths, monstersAlive]`.
 */
export interface Replay {
  v: 1;
  game: number;
  run?: number;
  /** Entrant ids of the timeline's sides (a race: the running team). */
  sides: string[];
  samples: number[][];
  feed: ReplayEntry[];
  /** Players at the end (last live state); empty without live data (older mods). */
  players: LivePlayer[];
  monsters?: LiveState['monsters'];
}

interface Telemetry {
  matchId: string;
  game: number;
  scores?: Record<string, number>;
  race?: { runner: string; run: number; points: number; deaths: number };
}

interface Open {
  tournamentId: string;
  matchId: string;
  game: number;
  run?: number;
  feed: ReplayEntry[];
  samples: number[][];
  sides: string[];
  lastSample: number;
  state?: LiveState;
  scores?: Record<string, number>;
  race?: { points: number; deaths: number };
}

const keyOf = (matchId: string, game: number, run?: number) => `${matchId}/${game}/${run ?? 0}`;

/**
 * Records the feed and a timeline of the game (run) in progress from what the bridge sends, and
 * stores them as a replay when the game (run) ends. Replays older than the setting `replayDays`
 * are deleted once a day (and on start).
 */
@Injectable()
export class LiveRecorder implements OnModuleInit, OnModuleDestroy {
  private open = new Map<string, Open>();
  /** Games (runs) stored, by key, with the time: late lines must not start them again. */
  private closed = new Map<string, number>();
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(LOGGER) private readonly log: ApiLogger,
    @Inject(TournamentsService) private readonly tournaments: TournamentsService,
  ) {}

  onModuleInit(): void {
    this.tournaments.onRemove((t) => this.removeTournament(t.id));
    this.cleanup();
    this.timer = setInterval(() => this.cleanup(), 6 * 3600_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  feed(tournamentId: string, e: KillFeedEntry): void {
    const o = this.game(tournamentId, e.matchId, e.game, e.run);
    if (!o) return;
    const { tournamentId: _t, matchId: _m, game: _g, run: _r, ...rest } = e;
    o.feed.push(rest);
    if (o.feed.length > REPLAY_FEED_MAX) {
      // thoughts go first, then trait episodes (mod 0.17.0), kills last
      let i = o.feed.findIndex((x) => x.kind === 'thought');
      if (i < 0) i = o.feed.findIndex((x) => x.kind === 'trait');
      o.feed.splice(i >= 0 ? i : 0, 1);
    }
  }

  state(tournamentId: string, s: LiveState): void {
    const o = this.game(tournamentId, s.matchId, s.game, s.run);
    if (!o) return;
    // The game started again under its number (organizer restart): start over.
    if (o.state && s.sec + 10 < o.state.sec)
      Object.assign(o, { feed: [], samples: [], sides: [], lastSample: -SAMPLE_SEC });
    o.state = s;
    for (const p of s.players) if (p.side && !o.sides.includes(p.side)) o.sides.push(p.side);
    if (s.sec - o.lastSample >= SAMPLE_SEC || !o.samples.length) this.sample(o, s.sec);
  }

  /** Telemetry (`match.live`): frags per side; a race: points and deaths of the run. */
  telemetry(tournamentId: string, t: Telemetry): void {
    const o = this.current(tournamentId);
    if (!o || o.matchId !== t.matchId || o.game !== t.game) return;
    if (t.scores) o.scores = t.scores;
    if (t.race && t.race.run === (o.run ?? 0))
      o.race = { points: t.race.points, deaths: t.race.deaths };
  }

  /**
   * A game or a run of it ended: what is open of it is stored (nothing without any data). A run
   * end closes the first run still open (the event does not name the run).
   */
  finish(tournamentId: string, matchId: string, game: number, run = false): void {
    const mine = [...this.open.entries()]
      .filter(
        ([, o]) => o.tournamentId === tournamentId && o.matchId === matchId && o.game === game,
      )
      .sort((a, b) => (a[1].run ?? 0) - (b[1].run ?? 0));
    for (const [k, o] of run ? mine.slice(0, 1) : mine) this.close(k, o);
  }

  /** A match was decided (also by the organizer): whatever is still open of it is stored. */
  finishMatch(tournamentId: string, matchId: string): void {
    for (const [k, o] of [...this.open.entries()])
      if (o.tournamentId === tournamentId && o.matchId === matchId) this.close(k, o);
  }

  /** The tournament ended: everything open is stored. */
  finishAll(tournamentId: string): void {
    for (const [k, o] of [...this.open.entries()])
      if (o.tournamentId === tournamentId) this.close(k, o);
  }

  /** The replays of a match, oldest game (run) first. */
  replays(tournamentId: string, matchId: string): Replay[] {
    const rows = this.db
      .select()
      .from(gameReplays)
      .where(and(eq(gameReplays.tournamentId, tournamentId), eq(gameReplays.matchId, matchId)))
      .all();
    const out: Replay[] = [];
    for (const r of rows.sort((a, b) => a.game - b.game || a.run - b.run)) {
      try {
        out.push(JSON.parse(zlib.inflateSync(r.data).toString('utf8')) as Replay);
      } catch {
        this.log.warn(`replay of ${matchId} game ${r.game} run ${r.run} is broken`);
      }
    }
    return out;
  }

  /** Timeline of the game (run) in progress (no damage: it is not shown before the end). */
  progress(
    tournamentId: string,
  ):
    | { matchId: string; game: number; run?: number; sides: string[]; samples: number[][] }
    | undefined {
    const o = this.current(tournamentId);
    if (!o) return undefined;
    // Scores and race points and deaths only: damage and monsters come with the delayed state.
    return {
      matchId: o.matchId,
      game: o.game,
      ...(o.run ? { run: o.run } : {}),
      sides: o.sides,
      samples: o.samples.map((s) => s.slice(0, 3)),
    };
  }

  removeTournament(tournamentId: string): void {
    this.db.delete(gameReplays).where(eq(gameReplays.tournamentId, tournamentId)).run();
    for (const [k, o] of [...this.open.entries()])
      if (o.tournamentId === tournamentId) this.open.delete(k);
    for (const k of [...this.closed.keys()])
      if (k.startsWith(`${tournamentId}|`)) this.closed.delete(k);
  }

  /** Deletes replays older than the setting (0 = keep them). Returns the number deleted. */
  cleanup(): number {
    const days = this.settings.get().live.replayDays;
    if (!days) return 0;
    const before = new Date(this.clock.now() - days * 86_400_000).toISOString();
    const res = this.db.delete(gameReplays).where(lt(gameReplays.createdAt, before)).run();
    if (res.changes) this.log.debug(`${res.changes} replays older than ${days} days deleted`);
    return res.changes;
  }

  private current(tournamentId: string): Open | undefined {
    let last: Open | undefined;
    for (const o of this.open.values()) if (o.tournamentId === tournamentId) last = o;
    return last;
  }

  /**
   * The open game (run); a new one stores the tournament's previous one (its end was missed).
   * Lines of a game that ended shortly before are late and dropped; much later the match is
   * played again (an earlier result was corrected): its old replays go.
   */
  private game(
    tournamentId: string,
    matchId: string,
    game: number,
    run?: number,
  ): Open | undefined {
    const k = `${tournamentId}|${keyOf(matchId, game, run)}`;
    let o = this.open.get(k);
    if (o) return o;
    const closedAt = this.closed.get(k);
    if (closedAt !== undefined && this.clock.now() - closedAt < LATE_MS) return undefined;
    if (closedAt !== undefined || (game === 1 && (run ?? 1) === 1))
      this.forgetMatch(tournamentId, matchId);
    for (const [ok, x] of [...this.open.entries()])
      if (x.tournamentId === tournamentId) this.close(ok, x);
    o = {
      tournamentId,
      matchId,
      game,
      ...(run ? { run } : {}),
      feed: [],
      samples: [],
      sides: [],
      lastSample: -SAMPLE_SEC,
    };
    this.open.set(k, o);
    return o;
  }

  private close(key: string, o: Open): void {
    this.open.delete(key);
    this.closed.set(key, this.clock.now());
    this.save(o);
    // keep the list short: old entries cannot be late any more
    if (this.closed.size > 500)
      for (const [k, at] of [...this.closed.entries()])
        if (this.clock.now() - at > LATE_MS) this.closed.delete(k);
  }

  /** A match starts (again): its stored replays and closed games are gone. */
  private forgetMatch(tournamentId: string, matchId: string): void {
    this.db
      .delete(gameReplays)
      .where(and(eq(gameReplays.tournamentId, tournamentId), eq(gameReplays.matchId, matchId)))
      .run();
    for (const k of [...this.closed.keys()])
      if (k.startsWith(`${tournamentId}|${matchId}/`)) this.closed.delete(k);
  }

  private sample(o: Open, sec: number): void {
    o.lastSample = sec;
    const players = o.state?.players ?? [];
    if (o.run !== undefined) {
      o.samples.push([
        sec,
        o.race?.points ?? 0,
        o.race?.deaths ?? 0,
        o.state?.monsters?.alive ?? -1,
      ]);
      return;
    }
    const sides = o.sides.slice(0, 2);
    const kills = (side: string) =>
      players.filter((p) => p.side === side).reduce((a, p) => a + p.kills - p.suicides, 0);
    const dmg = (side: string) =>
      players.filter((p) => p.side === side).reduce((a, p) => a + p.damageDealt, 0);
    const score = (side: string | undefined) =>
      side === undefined ? 0 : (o.scores?.[side] ?? kills(side));
    o.samples.push([
      sec,
      score(sides[0]),
      score(sides[1]),
      sides[0] ? dmg(sides[0]) : 0,
      sides[1] ? dmg(sides[1]) : 0,
    ]);
  }

  private save(o: Open): void {
    if (!o.feed.length && !o.state) return;
    if (o.state) this.sample(o, Math.max(o.state.sec, o.lastSample));
    const replay: Replay = {
      v: 1,
      game: o.game,
      ...(o.run ? { run: o.run } : {}),
      sides: o.sides,
      samples: o.samples,
      feed: o.feed,
      players: o.state?.players ?? [],
      ...(o.state?.monsters ? { monsters: o.state.monsters } : {}),
    };
    const data = zlib.deflateSync(Buffer.from(JSON.stringify(replay), 'utf8'));
    this.db
      .insert(gameReplays)
      .values({
        tournamentId: o.tournamentId,
        matchId: o.matchId,
        game: o.game,
        run: o.run ?? 0,
        createdAt: new Date(this.clock.now()).toISOString(),
        data,
      })
      .onConflictDoUpdate({
        target: [gameReplays.tournamentId, gameReplays.matchId, gameReplays.game, gameReplays.run],
        set: { createdAt: new Date(this.clock.now()).toISOString(), data },
      })
      .run();
  }
}
