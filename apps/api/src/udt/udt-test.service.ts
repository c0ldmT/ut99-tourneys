import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Entrant, NewTournamentEvent } from '@tourney/protocol';
import { valueScore } from '@tourney/udt';
import { z } from 'zod';
import type { User } from '../auth/users.service.js';
import { UsersService } from '../auth/users.service.js';
import { BotsService } from '../bots/bots.service.js';
import { conflict, notFound } from '../common/http.js';
import { CLOCK, CONFIG, ShiftClock, type ApiClock, type ApiConfig } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { tournaments } from '../db/schema.js';
import { nextDay, zonedMs } from '../seasons/season-time.js';
import { SeasonsService } from '../seasons/seasons.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { EventLogService } from '../tournaments/event-log.service.js';
import { TournamentsService } from '../tournaments/tournaments.service.js';
import { UdtEventsService } from './udt-events.service.js';
import { UdtMarketService } from './udt-market.service.js';
import { UdtTradesService } from './udt-trades.service.js';
import { UdtService } from './udt.service.js';

export const AdvanceBody = z.object({
  hours: z
    .number()
    .int()
    .min(1)
    .max(24 * 42),
});
export const ManagersBody = z.object({ count: z.number().int().min(1).max(16) });

/** Strength per skill (the owner's brackets), as in the season simulator. */
const STRENGTH = [1, 1.25, 1.6, 2.1, 3.4, 4.6, 7.2, 9.5];
const HOUR = 3_600_000;

/**
 * Dream Team test mode (TEST_MODE=1, a local instance): moves the clock (the market day runs on
 * the way), forces market days and season ends, plays Dream Team tournaments without a game
 * server (results by strength), creates test managers that buy and enter by themselves.
 */
@Injectable()
export class UdtTestService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(SeasonsService) private readonly seasons: SeasonsService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(BotsService) private readonly bots: BotsService,
    @Inject(EventLogService) private readonly log: EventLogService,
    @Inject(TournamentsService) private readonly tournaments: TournamentsService,
    @Inject(UdtService) private readonly udt: UdtService,
    @Inject(UdtMarketService) private readonly market: UdtMarketService,
    @Inject(UdtEventsService) private readonly events: UdtEventsService,
    @Inject(UdtTradesService) private readonly trades: UdtTradesService,
  ) {}

  /** 404 outside the test mode (the endpoints do not exist then). */
  assertTestMode(): void {
    if (!this.config.testMode) throw notFound('test mode');
  }

  state() {
    this.assertTestMode();
    const season = this.seasons.current();
    return {
      testMode: true,
      now: new Date(this.clock.now()).toISOString(),
      offsetHours: this.clock instanceof ShiftClock ? Math.round(this.clock.offsetMs / HOUR) : 0,
      today: this.udt.today(),
      season: season?.number ?? null,
      udt: this.settings.get().udt.enabled,
    };
  }

  private move(ms: number): void {
    const c = this.clock as ApiClock & { advance?: (ms: number) => void };
    if (c instanceof ShiftClock) c.offsetMs += ms;
    else if (typeof c.advance === 'function') c.advance(ms);
    else throw conflict('this clock cannot be moved');
  }

  /** Moves the clock forward hour by hour; market days and timers due on the way run. */
  advance(hours: number) {
    this.assertTestMode();
    for (let h = 0; h < hours; h++) {
      this.move(HOUR);
      this.market.tick();
    }
    return this.state();
  }

  /** The market day now: today's if it did not run yet, else the next one. */
  marketDay() {
    this.assertTestMode();
    if (!this.market.tick()) {
      const at = zonedMs(
        nextDay(this.udt.today()),
        this.settings.get().udt.marketTime,
        this.seasons.timeZone,
      );
      this.move(Math.max(0, at - this.clock.now()) + 60_000);
      this.market.tick();
    }
    return this.state();
  }

  /** Ends the running season now (Dream Team rosters start anew with the next one). */
  endSeason() {
    this.assertTestMode();
    const s = this.seasons.current();
    if (!s) throw conflict('no season is running');
    this.seasons.endNow(s.number);
    return this.state();
  }

  /**
   * Plays a Dream Team tournament without a game server: seeds it if needed, starts it and
   * decides every match by the bots' strength (simulated results), then finishes it.
   */
  simulate(id: string, by: User) {
    this.assertTestMode();
    const t = this.db.select().from(tournaments).where(eq(tournaments.id, id)).get();
    if (!t || t.kind !== 'udt') throw notFound(`Dream Team tournament ${id}`);
    if (t.phase === 'draft') this.tournaments.seed(id, { mode: 'auto', humanOrder: 'random' }, by);
    const actor = { kind: 'system' as const };
    const append = (batch: NewTournamentEvent[]) => {
      const head = this.log.load(id).length;
      const res = this.log.append(id, head, batch);
      if (!res.accepted) throw conflict(res.reason);
      return res.projection;
    };
    let p = this.log.projection(id)!;
    if (p.phase === 'seeded')
      p = append([
        { type: 'checkin.opened', actor, data: { serverProfileId: t.profileId } },
        { type: 'tournament.started', actor, data: {} },
      ]);
    else if (p.phase === 'checkIn') p = append([{ type: 'tournament.started', actor, data: {} }]);
    if (p.phase !== 'running') throw conflict(`cannot simulate in phase ${p.phase}`);
    const lib = new Map(this.bots.list().map((b) => [b.id, b]));
    const strength = (e: Entrant | undefined) => {
      const specs = !e ? [] : e.kind === 'bot' ? [e.bot] : e.kind === 'team' ? e.bots : [];
      return specs.reduce((sum, b) => {
        const score = valueScore(b.traits ?? (b.id ? lib.get(b.id)?.traits : undefined));
        return (
          sum +
          STRENGTH[Math.round(Math.min(7, Math.max(0, b.skill)))]! *
            (0.85 + 0.3 * score) *
            // Body traits (played by the mod): a little stronger each.
            (1 + 0.06 * (b.gameTraits?.length ?? 0))
        );
      }, 0.5);
    };
    let last: string | undefined;
    for (let guard = 0; guard < 200; guard++) {
      const ready = (p.bracket?.matches ?? []).find(
        (m) => m.status === 'ready' && m.entrants[0] && m.entrants[1],
      );
      if (!ready) break;
      const [a, b] = ready.entrants as [string, string];
      const sa = strength(p.entrants[a]) ** 2;
      const sb = strength(p.entrants[b]) ** 2;
      const winnerId = Math.random() < sa / (sa + sb) ? a : b;
      last = winnerId;
      p = append([
        {
          type: 'match.result',
          actor,
          data: { result: { matchId: ready.id, entrants: [a, b], winnerId, outcome: 'simulated' } },
        },
      ]);
    }
    if (p.phase === 'running' && last)
      p = append([{ type: 'tournament.finished', actor, data: { championId: last } }]);
    return { phase: p.phase, results: p.results.length, championId: p.championId ?? null };
  }

  /**
   * Test managers: dev users with a team and a starter bot each. `act` lets every test manager
   * bid on an affordable offer, line up its best bots and enter the open tournaments.
   */
  createManagers(count: number) {
    this.assertTestMode();
    const season = this.udt.season().number;
    const made: string[] = [];
    for (let i = 0; i < count; i++) {
      const n = this.users.list().filter((u) => u.discordId.startsWith('dev:test')).length + 1;
      const name = `Test${n}`;
      const user = this.users.login({
        discordId: `dev:test${n}`,
        username: name,
        displayName: name,
      });
      if (this.udt.team(user.id, season)) continue;
      this.udt.createTeam(user, {
        name: `Test Team ${n}`,
        tag: `T${n}`,
        starter: { name: `Rookie${n}`, skill: 2 + (n % 2) },
      });
      made.push(name);
    }
    return { created: made };
  }

  act() {
    this.assertTestMode();
    const season = this.udt.season().number;
    const managers = this.users.list().filter((u) => u.discordId.startsWith('dev:test'));
    let bids = 0;
    let entries = 0;
    let traded = 0;
    for (const u of managers) {
      if (!this.udt.team(u.id, season)) continue;
      // Trade offers: accepted when the test manager gets at least as much as it gives.
      try {
        for (const t of this.trades.list(u).open.filter((x) => x.incoming)) {
          try {
            if (t.giveValue >= t.takeValue) this.trades.accept(u, t.id);
            else this.trades.decline(u, t.id);
            traded++;
          } catch {
            this.trades.decline(u, t.id);
            traded++;
          }
        }
      } catch {
        // trading switched off
      }
      try {
        const m = this.market.view(u);
        const budget = this.udt.view(u).wallet?.spendable ?? 0;
        const pick = m.offers
          .filter((o) => !o.sold && o.myBid === null && o.minPrice <= budget * 0.6)
          .sort((x, y) => y.minPrice - x.minPrice)[0];
        if (pick) {
          this.market.bid(u, { botId: pick.botId, amount: pick.minPrice });
          bids++;
        }
      } catch {
        // full roster, no market day yet: skip
      }
      const roster = this.udt.roster(u.id, season).sort((a, b) => b.skill - a.skill);
      const ids = roster.map((r) => r.botId);
      this.udt.setLineup(u, { dm: ids.slice(0, 5), mh: ids.slice(0, 5), bench: ids.slice(5, 7) });
      for (const e of this.events.events(u))
        if (e.open && !e.entered && !e.lineup?.problems.length)
          try {
            this.events.enter(u, e.id);
            entries++;
          } catch {
            // bracket full
          }
    }
    return { managers: managers.length, bids, entries, trades: traded };
  }
}
