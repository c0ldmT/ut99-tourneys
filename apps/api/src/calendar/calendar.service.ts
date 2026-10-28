import { Inject, Injectable } from '@nestjs/common';
import { and, gte, inArray, isNotNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { User } from '../auth/users.service.js';
import { badRequest } from '../common/http.js';
import { CLOCK, CONFIG, type ApiClock, type ApiConfig } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { registrations, tournaments, udtEntries } from '../db/schema.js';
import { SeasonsService } from '../seasons/seasons.service.js';
import { today, zonedMs } from '../seasons/season-time.js';
import { SeriesService } from '../series/series.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { estimateMs } from '../tournaments/server-calendar.js';
import { TournamentsService } from '../tournaments/tournaments.service.js';
import { UdtLeagueService } from '../udt/udt-league.service.js';

export const CalendarQuery = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

/** Days a calendar request may span. */
const MAX_DAYS = 92;
const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

export type CalendarKind =
  | 'seasonStart'
  | 'seasonEnd'
  | 'keepers'
  | 'tournament'
  | 'cup'
  | 'leagueEvening'
  | 'relegation'
  | 'finalFour'
  | 'payday';

export interface CalendarItem {
  id: string;
  kind: CalendarKind;
  /** The day in the season time zone. */
  day: string;
  /** Start (null: the whole day). */
  at: string | null;
  /** Estimated end (tournaments, league evenings). */
  until: string | null;
  title: string | null;
  state: 'projected' | 'planned' | 'open' | 'live' | 'done' | 'cancelled';
  mine: boolean;
  link: string | null;
  /** Per kind: season, series, game, teamSize, entrants, size, matchdays, games, myGame … */
  meta: Record<string, unknown>;
}

/**
 * The calendar (decision 231): what is on when, for every player - seasons (start, end, keeper
 * window), tournaments and cups with their state, the planned starts of the series, the league
 * (evenings, relegation, final four, Mondays with table money; before a start its plan). Nothing
 * is stored: the items are read from the tournaments, the series, the seasons and the league.
 */
@Injectable()
export class CalendarService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(SeasonsService) private readonly seasons: SeasonsService,
    @Inject(SeriesService) private readonly series: SeriesService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(TournamentsService) private readonly tournaments: TournamentsService,
    @Inject(UdtLeagueService) private readonly league: UdtLeagueService,
  ) {}

  private get tz(): string {
    return this.config.seasonTimeZone;
  }

  private dayOf(ms: number): string {
    return today(ms, this.tz);
  }

  view(user: User, q: z.infer<typeof CalendarQuery>) {
    const now = this.clock.now();
    const day = this.dayOf(now);
    const from = q.from ?? addDays(day, -7);
    const to = q.to ?? addDays(from, 42);
    if (to < from) throw badRequest('the calendar range ends before it starts');
    if (Date.parse(to) - Date.parse(from) > MAX_DAYS * DAY)
      throw badRequest('the calendar shows at most {n} days at once', { n: MAX_DAYS });
    const fromMs = zonedMs(from, '00:00', this.tz);
    const toMs = zonedMs(addDays(to, 1), '00:00', this.tz);
    const udt = this.settings.get().udt;
    const items: CalendarItem[] = [];

    // Seasons: start, end and the keeper window (Dream Team) of every season in the range.
    const seasons = this.seasons
      .overview()
      .seasons.filter((s) => s.startDate <= to && s.endDate >= from);
    for (const s of seasons) {
      const base = { at: null, until: null, mine: false, link: null, title: null };
      const st = (d: string) => (d < day ? 'done' : 'planned') as CalendarItem['state'];
      if (s.startDate >= from)
        items.push({
          ...base,
          id: `season:${s.number}:start`,
          kind: 'seasonStart',
          day: s.startDate,
          state: st(s.startDate),
          meta: { season: s.number, until: s.endDate },
        });
      if (s.endDate <= to)
        items.push({
          ...base,
          id: `season:${s.number}:end`,
          kind: 'seasonEnd',
          day: s.endDate,
          state: st(s.endDate),
          meta: { season: s.number },
        });
      const keep = addDays(s.endDate, 1 - udt.keepers.days);
      // The keeper window, also when it began before the range (the days are marked).
      if (udt.enabled && udt.keepers.max > 0 && keep <= to && s.endDate >= from)
        items.push({
          ...base,
          id: `season:${s.number}:keepers`,
          kind: 'keepers',
          day: keep,
          state: st(s.endDate),
          meta: { season: s.number, until: s.endDate, max: udt.keepers.max },
        });
    }

    // Tournaments with a start in the range (the league's games are its evenings).
    const rows = this.db
      .select()
      .from(tournaments)
      .where(
        and(
          isNotNull(tournaments.scheduledAt),
          gte(tournaments.scheduledAt, new Date(fromMs).toISOString()),
          lte(tournaments.scheduledAt, new Date(toMs).toISOString()),
        ),
      )
      .all()
      .filter((t) => !this.league.isLeagueTournament(t) && (t.kind !== 'udt' || udt.enabled));
    const ids = rows.map((t) => t.id);
    const entered = new Map<string, Set<string>>();
    const note = (tid: string, uid: string) => {
      const set = entered.get(tid) ?? new Set<string>();
      set.add(uid);
      entered.set(tid, set);
    };
    if (ids.length) {
      for (const r of this.db
        .select({ t: registrations.tournamentId, u: registrations.userId })
        .from(registrations)
        .where(inArray(registrations.tournamentId, ids))
        .all())
        note(r.t, r.u);
      for (const r of this.db
        .select({ t: udtEntries.tournamentId, u: udtEntries.userId })
        .from(udtEntries)
        .where(inArray(udtEntries.tournamentId, ids))
        .all())
        note(r.t, r.u);
    }
    for (const t of rows) {
      const set = this.tournaments.settings(t);
      const at = Date.parse(t.scheduledAt!);
      const who = entered.get(t.id) ?? new Set<string>();
      items.push({
        id: `t:${t.id}`,
        kind: t.kind === 'udt' ? 'cup' : 'tournament',
        day: this.dayOf(at),
        at: t.scheduledAt,
        until: new Date(at + estimateMs(set)).toISOString(),
        title: t.name,
        state: stateOf(t.phase, t.registrationOpen),
        mine: who.has(user.id),
        link: `/t/${t.id}`,
        meta: {
          series: t.seriesId,
          game: set.game.adapter === 'ut99-mh' ? 'mh' : 'dm',
          teamSize: set.teamSize,
          size: set.size,
          entrants: who.size,
        },
      });
    }

    // The planned starts of the series (not made yet).
    for (const p of this.series.projected(fromMs, toMs, udt.enabled))
      items.push({
        id: `sr:${p.seriesId}:${p.at}`,
        kind: p.kind === 'udt' ? 'cup' : 'tournament',
        day: this.dayOf(p.at),
        at: new Date(p.at).toISOString(),
        until: new Date(p.at + p.estimateMs).toISOString(),
        title: p.name,
        state: 'projected',
        mine: false,
        link: null,
        meta: { series: p.seriesId, game: p.game, teamSize: p.teamSize, size: p.size },
      });

    // The league.
    if (udt.enabled)
      for (const l of this.league.calendar(from, to, user.id))
        items.push({
          id: `lg:${l.season}:${l.kind}:${l.day}`,
          kind:
            l.kind === 'evening'
              ? 'leagueEvening'
              : l.kind === 'final'
                ? 'finalFour'
                : l.kind === 'relegation'
                  ? 'relegation'
                  : 'payday',
          day: l.day,
          at: l.at,
          until: l.until,
          title: null,
          state: l.state,
          mine: !!l.myGame,
          link:
            l.kind === 'payday'
              ? null
              : l.state === 'projected'
                ? '/udt/league'
                : '/udt/league/day',
          meta: {
            season: l.season,
            matchdays: l.matchdays,
            games: l.games,
            test: l.test,
            start: l.start,
            myGame: l.myGame,
          },
        });

    items.sort(
      (a, b) =>
        (a.at ?? `${a.day}T00`).localeCompare(b.at ?? `${b.day}T00`) || a.id.localeCompare(b.id),
    );
    return {
      timeZone: this.tz,
      today: day,
      now: new Date(now).toISOString(),
      from,
      to,
      seasons: seasons.map((s) => ({
        number: s.number,
        startDate: s.startDate,
        endDate: s.endDate,
        status: s.status,
      })),
      udt: udt.enabled,
      items,
    };
  }
}

function stateOf(phase: string, open: boolean): CalendarItem['state'] {
  if (phase === 'finished') return 'done';
  if (phase === 'aborted') return 'cancelled';
  if (phase === 'draft' || phase === 'seeded')
    return open && phase === 'draft' ? 'open' : 'planned';
  return 'live';
}
