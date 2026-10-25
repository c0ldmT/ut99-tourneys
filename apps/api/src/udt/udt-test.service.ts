import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Entrant, NewTournamentEvent } from '@tourney/protocol';
import { botStrength, gameChance, valueScore } from '@tourney/udt';
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
import { UdtLeagueService } from './udt-league.service.js';
import { UdtMarketService } from './udt-market.service.js';
import { UdtAiService } from './udt-ai.service.js';
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
    @Inject(UdtAiService) private readonly ai: UdtAiService,
    @Inject(UdtLeagueService) private readonly league: UdtLeagueService,
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

  /** Moves the clock to `at` hour by hour (market days and the league on the way run). */
  private moveTo(at: number): void {
    while (this.clock.now() < at) {
      this.move(Math.min(HOUR, at - this.clock.now()));
      this.market.tick();
    }
    this.market.tick();
  }

  /**
   * The next league evening now (L11): the clock goes to its slot, the games on the server are
   * played by the simulator, the clock moves past the evening so every result is shown.
   * Returns the day played (null: no league running or nothing left).
   */
  private leagueEvening(by: User): string | null {
    const next = this.league.testNextEvening();
    if (!next) return null;
    this.moveTo(next.slot + 60_000);
    // Games made by the tick (also a final after the semi-finals) are played in turn.
    for (let i = 0; i < 4; i++) {
      const ids = this.league.testTournaments(next.day);
      if (!ids.length) break;
      for (const id of ids) this.simulate(id, by);
      this.market.tick();
    }
    this.moveTo(Math.max(this.clock.now() + HOUR, next.slot + 4 * HOUR));
    return next.day;
  }

  /** "Matchday now": the next league evening. */
  leagueDay(by: User) {
    this.assertTestMode();
    const day = this.leagueEvening(by);
    if (!day) throw conflict('no league is running');
    return { ...this.state(), leagueDay: day };
  }

  /** "League season end": every evening left, the relegation and the final four. */
  leagueEnd(by: User) {
    this.assertTestMode();
    if (this.league.testDone()) throw conflict('no league is running');
    const days: string[] = [];
    for (let i = 0; i < 80 && !this.league.testDone(); i++) {
      const day = this.leagueEvening(by);
      if (!day) break;
      days.push(day);
    }
    return { ...this.state(), leagueDays: days.length, leagueDone: this.league.testDone() };
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
    if (!t || t.kind !== 'udt') throw notFound('Dream Team tournament {id}', { id });
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
    if (p.phase !== 'running')
      throw conflict('cannot simulate in phase {phase}', { phase: p.phase });
    const lib = new Map(this.bots.list().map((b) => [b.id, b]));
    const strength = (e: Entrant | undefined) => {
      const specs = !e ? [] : e.kind === 'bot' ? [e.bot] : e.kind === 'team' ? e.bots : [];
      return specs.reduce((sum, b) => {
        const score = valueScore(b.traits ?? (b.id ? lib.get(b.id)?.traits : undefined));
        return (
          sum +
          botStrength(b.skill, score) *
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
      // The calibrated game model of the simulator (k = 3 in 1v1, 4.5 in teams).
      const pa = gameChance(strength(p.entrants[a]), strength(p.entrants[b]), p.settings.teamSize);
      const winnerId = Math.random() < pa ? a : b;
      last = winnerId;
      p = append([
        {
          type: 'match.result',
          actor,
          data: { result: { matchId: ready.id, entrants: [a, b], winnerId, outcome: 'simulated' } },
        },
      ]);
    }
    // A league matchday (fixtures) ends without a champion.
    const fixtures = p.bracket?.definition.format === 'fixtures';
    if (p.phase === 'running' && last && (!fixtures || p.bracket?.status === 'finished'))
      p = append([
        { type: 'tournament.finished', actor, data: fixtures ? {} : { championId: last } },
      ]);
    return { phase: p.phase, results: p.results.length, championId: p.championId ?? null };
  }

  /**
   * Test managers: dev users with a team and a starter bot each. `act` lets every test manager
   * buy an affordable offer, line up its best bots and enter the open tournaments.
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
        tag: `[T${n}]`,
        starter: { name: `Rookie${n}` },
      });
      made.push(name);
    }
    return { created: made };
  }

  act() {
    this.assertTestMode();
    const season = this.udt.season().number;
    const managers = this.users.list().filter((u) => u.discordId.startsWith('dev:test'));
    let bought = 0;
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
          .filter((o) => !o.sold && o.price <= budget * 0.6)
          .sort((x, y) => y.price - x.price)[0];
        if (pick) {
          this.market.buy(u, { botId: pick.botId });
          bought++;
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
            this.events.signUp(u, e.id);
            entries++;
          } catch {
            // bracket full
          }
    }
    // The AI managers (when switched on) act as after a market day.
    const ai = this.ai.daily(this.udt.season(), this.udt.today());
    return { managers: managers.length, bought, entries, trades: traded, ai };
  }
}
