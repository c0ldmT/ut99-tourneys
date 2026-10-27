import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { ADAPTER_MH } from '@tourney/adapter-ut99';
import {
  botEntrant,
  TournamentSettingsSchema,
  udtEntrantId,
  type BotSpec,
  type Entrant,
  type TournamentSettings,
} from '@tourney/protocol';
import {
  bracketOf,
  effectiveValues,
  modCodes,
  FORM_EFFECT,
  PHASE_EFFECT,
  roundNeuro,
  tiredPenalty,
  type Career,
} from '@tourney/udt';
import { UsersService, type User } from '../auth/users.service.js';
import { BotsService, type LibraryBot } from '../bots/bots.service.js';
import { conflict, notFound } from '../common/http.js';
import { randomId } from '../common/ids.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { CLOCK, type ApiClock } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { tournaments, udtEntries } from '../db/schema.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  TournamentsService,
  type DrawDrop,
  type TournamentRow,
  type UdtEventRules,
} from '../tournaments/tournaments.service.js';
import { UdtCareerService } from './udt-career.service.js';
import { gameName, UdtService, type RosterBot } from './udt.service.js';
import { pickTeamNames } from '../common/names.js';
import { EventLogService } from '../tournaments/event-log.service.js';
import { botsOf, lockedTournaments, playingIn, type LockedTournament } from './udt-playing.js';

/** Bots below this stamina are tired: they play worse and the bench comes first. */
const TIRED = 40;

export interface Lineup {
  bots: RosterBot[];
  /** Value of the lineup against the cap (`capValue`: own bots now, the starter above default). */
  value: number;
  /** Why the team cannot play (empty: it can). */
  problems: string[];
}

/**
 * Dream Team tournaments (kind "udt"): managers enter their team, the seeding takes each
 * team's lineup (deathmatch or Monster Hunt slots, the bench for strikers and tired bots, within
 * the team value cap and the star limit) and fills the bracket with free library bots of a
 * similar strength.
 */
@Injectable()
export class UdtEventsService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(BotsService) private readonly bots: BotsService,
    @Inject(TournamentsService) private readonly tournaments: TournamentsService,
    @Inject(UdtService) private readonly udt: UdtService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(UdtCareerService) private readonly career: UdtCareerService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(EventLogService) private readonly log: EventLogService,
  ) {}

  onModuleInit(): void {
    this.tournaments.registerLineupProvider('udt', (t, s, rng) => this.provide(t, s, rng));
    // Deleted before it finished (draft or seeded): every ticket goes back.
    this.tournaments.onRemove((t) => {
      if (t.kind === 'udt' && t.phase !== 'finished') this.refundTickets(t.id);
    });
    this.tournaments.onResetAll(() => this.udt.wipeAll());
    // Sign-ups of a season that is over close by themselves (tickets back).
    this.timer = setInterval(() => {
      try {
        this.closeStale();
      } catch {
        // tried again in a minute
      }
    }, 60_000);
    this.timer.unref();
    // AI managers enter as soon as a Dream Team tournament opens its sign-up.
    this.tournaments.onSaved((t) => {
      if (t.kind === 'udt' && t.phase === 'draft' && t.registrationOpen && !this.rules(t).finale) {
        this.autoFill(t.id);
        this.aiFill(t.id);
      }
    });
    // The tournament page signs up through the Dream Team: the manager enters the team.
    this.tournaments.registerSignupProvider('udt', {
      enter: (t, user) => this.signUp(user, t.id),
      leave: (t, userId) => this.withdraw(t.id, userId),
      entries: (id) => this.labelledEntries(id),
      info: (t, user) => {
        const cfg = this.settings.get().udt;
        return {
          aiOn: this.udt.aiOn(),
          aiCount: cfg.aiEnabled ? cfg.aiCount : 0,
          busyIn: user && t.phase === 'draft' ? this.busyIn(user, t.id) : [],
        };
      },
    });
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Whether the tournament belongs to the running season (its sign-up and seeding need it). */
  private inSeason(t: TournamentRow): boolean {
    const s = this.tournaments.udtSeason(t);
    return s !== null && s === this.udt.seasonNumber();
  }

  /**
   * Dream Team tournaments of a season that is over (or made out of season) and not seeded: the
   * tickets go back into the season they were paid in, the entries go, the sign-up and the
   * autostart close (the organizer deletes it or leaves it). Runs every minute.
   */
  closeStale(): number {
    let n = 0;
    for (const t of this.db
      .select()
      .from(tournaments)
      .where(and(eq(tournaments.kind, 'udt'), eq(tournaments.phase, 'draft')))
      .all()) {
      if (this.inSeason(t)) continue;
      const entered = this.entries(t.id).length;
      if (!entered && !t.registrationOpen && !t.autoStart) continue;
      this.refundTickets(t.id);
      this.db.delete(udtEntries).where(eq(udtEntries.tournamentId, t.id)).run();
      this.db
        .update(tournaments)
        .set({ registrationOpen: false, autoStart: false })
        .where(eq(tournaments.id, t.id))
        .run();
      this.tournaments.changed(t.id);
      n++;
    }
    return n;
  }

  private row(id: string): TournamentRow {
    const t = this.db.select().from(tournaments).where(eq(tournaments.id, id)).get();
    if (!t || t.kind !== 'udt') throw notFound('Dream Team tournament {id}', { id });
    return t;
  }

  private settingsOf(t: TournamentRow): TournamentSettings {
    return TournamentSettingsSchema.parse(JSON.parse(t.settingsJson));
  }

  private rules(t: TournamentRow): UdtEventRules {
    return (
      this.tournaments.udtRules(t) ?? {
        valueCap: null,
        starLimit: null,
        ticket: null,
        ticketIndexed: true,
        minTeams: 4,
        finale: false,
        league: null,
      }
    );
  }

  /**
   * League games (rules.league) are seeded by the league (set by UdtLeagueService): the two
   * clubs in their fixed slots.
   */
  leagueLineup: (
    t: TournamentRow,
    settings: TournamentSettings,
  ) => { entrants: Entrant[]; fill: Entrant[]; slots: string[] } = () => {
    throw conflict('the league is not running');
  };

  /**
   * A manager's club in a league game: the deathmatch lineup (bench for tired and striking
   * bots; no value cap or star limit), weak base bots in the places it cannot fill (L-E18);
   * bots playing in another drawn or running Dream Team tournament stay out (one at a time).
   */
  leagueTeam(userId: string, settings: TournamentSettings, entrantId: string): Entrant | null {
    const season = this.udt.season().number;
    const team = this.udt.team(userId, season);
    if (!team) return null;
    const rules = { ...this.rules({ kind: 'standard' } as TournamentRow), valueCap: null };
    // The manager's other league games run one after another on the same server: their bots
    // are free for this one (cups in the league slot are kept out by the server calendar).
    const busy = botsOf(
      lockedTournaments(this.db, this.log)
        .map((l) => l.projection)
        .filter((p) => p.settings.format !== 'fixtures'),
      userId,
    );
    const l = this.lineup(userId, settings, rules, busy);
    const lib = new Map(this.bots.list().map((b) => [b.id, b]));
    const careers = this.career.careers();
    const named = uniqueNames();
    const specs: BotSpec[] = l.bots
      .map((r) => this.spec(r, team.tag, lib, careers))
      .map((s) => ({ ...s, name: named(s.name) }));
    for (let i = specs.length; i < settings.teamSize; i++)
      specs.push({ name: named(gameName(team.tag, `Rookie${i + 1}`)), skill: 1 });
    return {
      id: entrantId,
      kind: 'team',
      displayName: team.name,
      tag: team.tag,
      members: [],
      bots: specs,
    };
  }

  /**
   * The season table (set by the rewards service, which owns it): the finale takes its top.
   * AI managers count when they play along.
   */
  tableOf: (season: number) => { userId: string; points: number; ai: boolean }[] = () => [];

  /**
   * Managers with the switch "enter automatically" enter open Dream Team tournaments where they
   * can: open sign-up, no high stakes ticket, a lineup that fits the rules (enough bots that
   * can play, value cap, star limit). A full bracket with AI teams makes room for them.
   */
  autoFill(tournamentId?: string, onlyUser?: string): number {
    const season = this.udt.seasonNumber();
    if (season === null || !this.udt.enabled()) return 0;
    let n = 0;
    let locked: LockedTournament[] | undefined;
    for (const id of this.udt.autoEntrants(season)) {
      if (onlyUser && id !== onlyUser) continue;
      const user = this.users.byId(id);
      if (!user) continue;
      // Read once for all managers (each entry changes no drawn tournament).
      locked ??= lockedTournaments(this.db, this.log);
      for (const e of this.events(user, tournamentId, locked)) {
        if (!e.open || e.entered || e.ticketNow > 0 || !e.lineup || e.lineup.problems.length)
          continue;
        // Its bots play elsewhere: it would drop out at the draw (decision 200).
        if (e.lineup.busyIn.length) continue;
        try {
          this.signUp(user, e.id);
          n++;
        } catch {
          // full of humans, or changed meanwhile
        }
      }
    }
    return n;
  }

  /** The event log (the AI service reads the drawn tournaments through it). */
  get eventLog(): EventLogService {
    return this.log;
  }

  /** AI managers enter the tournament where they can (set by the AI service). */
  aiFill: (tournamentId: string) => void = () => {};

  /** Finale: the top `size` teams of the season table that can play. */
  qualified(t: TournamentRow, settings: TournamentSettings): string[] {
    const season = this.udt.season().number;
    const aiOn = this.udt.aiOn();
    return this.tableOf(season)
      .filter((r) => r.points > 0 && (aiOn || !r.ai))
      .map((r) => r.userId)
      .filter((u) => !this.lineup(u, settings, this.rules(t)).problems.length)
      .slice(0, settings.size);
  }

  /** The entry ticket now (high stakes), 0 without one. */
  ticketNow(rules: UdtEventRules): number {
    if (!rules.ticket) return 0;
    return rules.ticketIndexed
      ? Math.max(10, roundNeuro(rules.ticket * this.udt.index(this.udt.season().number)))
      : rules.ticket;
  }

  /** Gives a manager's ticket back and takes the entry out. */
  private dropEntry(tournamentId: string, userId: string): void {
    const e = this.db
      .select()
      .from(udtEntries)
      .where(and(eq(udtEntries.tournamentId, tournamentId), eq(udtEntries.userId, userId)))
      .get();
    if (!e) return;
    if (e.ticket > 0 && e.ticketRef) {
      const season = this.ticketSeason(e.ticketRef, tournamentId);
      if (season !== null)
        this.ledger.book({
          season,
          userId,
          kind: 'udt_ticket',
          amount: e.ticket,
          ref: `${e.ticketRef}:back`,
          meta: { tournamentId },
        });
    }
    this.db
      .delete(udtEntries)
      .where(and(eq(udtEntries.tournamentId, tournamentId), eq(udtEntries.userId, userId)))
      .run();
  }

  /**
   * The season a ticket goes back into: the one it was paid in (also when another one runs now,
   * or none), else the tournament's.
   */
  private ticketSeason(ticketRef: string, tournamentId: string): number | null {
    const paid = this.ledger.seasonOfRef(ticketRef);
    if (paid !== null) return paid;
    const t = this.db.select().from(tournaments).where(eq(tournaments.id, tournamentId)).get();
    return t ? this.tournaments.udtSeason(t) : null;
  }

  /** All tickets of a tournament back (called off, deleted, too few teams, season over). */
  refundTickets(tournamentId: string): void {
    for (const e of this.db
      .select()
      .from(udtEntries)
      .where(eq(udtEntries.tournamentId, tournamentId))
      .all()) {
      const season =
        e.ticket > 0 && e.ticketRef ? this.ticketSeason(e.ticketRef, tournamentId) : null;
      if (season !== null)
        this.ledger.book({
          season,
          userId: e.userId,
          kind: 'udt_ticket',
          amount: e.ticket,
          ref: `${e.ticketRef}:back`,
          meta: { tournamentId },
        });
    }
  }

  /**
   * Cups for the Dream Team hub: one running, the next coming up (entered or not), how many
   * take sign-ups. League games do not count.
   */
  hubCups(userId: string, season: number) {
    const rows = this.db
      .select({
        id: tournaments.id,
        name: tournaments.name,
        phase: tournaments.phase,
        scheduledAt: tournaments.scheduledAt,
        registrationOpen: tournaments.registrationOpen,
        udtJson: tournaments.udtJson,
      })
      .from(tournaments)
      .where(
        and(
          eq(tournaments.kind, 'udt'),
          eq(tournaments.udtSeason, season),
          inArray(tournaments.phase, ['draft', 'seeded', 'checkIn', 'running', 'paused']),
        ),
      )
      .all()
      .filter((t) => !t.udtJson?.includes('"league":{'));
    const mine = new Set(
      rows.length
        ? this.db
            .select({ id: udtEntries.tournamentId })
            .from(udtEntries)
            .where(
              and(
                eq(udtEntries.userId, userId),
                inArray(
                  udtEntries.tournamentId,
                  rows.map((t) => t.id),
                ),
              ),
            )
            .all()
            .map((e) => e.id)
        : [],
    );
    const coming = rows
      .filter((t) => t.phase !== 'running' && t.phase !== 'paused')
      .sort((a, b) => (a.scheduledAt ?? '~').localeCompare(b.scheduledAt ?? '~'));
    const next = coming[0];
    return {
      live: rows.some((t) => t.phase === 'running' || t.phase === 'paused'),
      open: coming.filter((t) => t.phase === 'draft' && t.registrationOpen).length,
      entered: coming.filter((t) => mine.has(t.id)).length,
      next: next
        ? { id: next.id, name: next.name, at: next.scheduledAt, entered: mine.has(next.id) }
        : null,
    };
  }

  private entries(tournamentId: string): string[] {
    return this.db
      .select()
      .from(udtEntries)
      .where(eq(udtEntries.tournamentId, tournamentId))
      .orderBy(asc(udtEntries.createdAt))
      .all()
      .map((e) => e.userId);
  }

  /**
   * The bots a manager's team plays with: the lineup slots in order, the bench before tired
   * players, strikers never; at most `starLimit` bots of skill 6-7 and a total market value up
   * to the cap × index.
   */
  lineup(
    userId: string,
    settings: TournamentSettings,
    rules: UdtEventRules,
    /**
     * Bots playing in another drawn or running Dream Team tournament (one at a time): only the
     * seeding leaves them out; sign-ups stay possible (they may be free by then).
     */
    busy: ReadonlySet<string> = new Set(),
    /** The manager's roster of the running season, when the caller has it already. */
    roster: readonly RosterBot[] = this.udt.roster(userId, this.udt.season().number),
  ): Lineup {
    const season = this.udt.season().number;
    const mh = settings.game.adapter === ADAPTER_MH;
    const slot = (r: RosterBot) => (mh ? r.mhSlot : r.dmSlot);
    const slotted = roster.filter((r) => slot(r) !== null).sort((a, b) => slot(a)! - slot(b)!);
    const bench = roster
      .filter((r) => r.bench !== null && slot(r) === null)
      .sort((a, b) => a.bench! - b.bench!);
    const playable = (r: RosterBot) => !r.striking && !busy.has(r.botId);
    const fit = (r: RosterBot) => r.stamina >= TIRED;
    const order = [
      ...slotted.filter((r) => playable(r) && fit(r)),
      ...bench.filter((r) => playable(r) && fit(r)),
      ...slotted.filter((r) => playable(r) && !fit(r)),
      ...bench.filter((r) => playable(r) && !fit(r)),
    ];
    const cap = rules.valueCap === null ? Infinity : rules.valueCap * this.udt.index(season);
    const picked: RosterBot[] = [];
    let value = 0;
    let stars = 0;
    let capped = false;
    let starred = false;
    for (const r of order) {
      if (picked.length >= settings.teamSize) break;
      const star = bracketOf(r.effective.skill) === 'strong';
      if (star && rules.starLimit !== null && stars >= rules.starLimit) {
        starred = true;
        continue;
      }
      if (value + r.capValue > cap) {
        capped = true;
        continue;
      }
      picked.push(r);
      value += r.capValue;
      if (star) stars++;
    }
    const problems: string[] = [];
    if (picked.length < settings.teamSize) {
      problems.push(
        `${picked.length} of ${settings.teamSize} bots can play (lineup and bench${roster.some((r) => r.striking) ? ', strikers left out' : ''}${roster.some((r) => busy.has(r.botId)) ? ', bots in another tournament left out' : ''})`,
      );
      if (capped) problems.push(`team value cap ${Math.round(cap)} Neuro`);
      if (starred) problems.push(`at most ${rules.starLimit} bots of skill 6-7`);
    }
    return { bots: picked, value, problems };
  }

  private spec(
    r: RosterBot,
    tag: string,
    lib: Map<string, LibraryBot>,
    careers: Map<string, Career>,
  ): BotSpec {
    const b = lib.get(r.botId);
    const base = this.bots.resolveSpec({ id: r.botId, name: r.name, skill: r.skill }, lib);
    const tired = tiredPenalty(r.stamina);
    // Values traits (category A) raise the skill and the play-style values the game gets.
    const eff = effectiveValues(base.skill, { ...(base.traits ?? b?.traits ?? {}) }, r.udtTraits);
    const traits = eff.values;
    if (tired) traits.accuracy = Math.max(-1, (traits.accuracy ?? 0) - 0.2);
    withCareer(traits, careers.get(r.botId));
    // Body traits (category B) are played by the mod.
    const codes = modCodes(r.udtTraits);
    return {
      ...base,
      skill: eff.skill,
      name: gameName(tag, r.name),
      traits,
      ...(codes.length ? { gameTraits: codes } : {}),
    };
  }

  /** Lineup provider for the seeding (TournamentsService). */
  private provide(t: TournamentRow, settings: TournamentSettings, rng: () => number) {
    this.udt.assertOn();
    if (settings.botMatchMode === 'simulate')
      throw conflict('Dream Team matches are played, not simulated (bot matches: watch)');
    // Rosters, index and table are the season's: only the season it belongs to can seed it.
    if (!this.inSeason(t)) {
      const season = this.tournaments.udtSeason(t) ?? '–';
      if (t.phase !== 'draft')
        throw conflict(
          'this Dream Team tournament belongs to season {season}, which is not running',
          {
            season,
          },
        );
      this.closeStale();
      throw conflict(
        'this Dream Team tournament belongs to season {season}, which is not running: the tickets went back',
        { season: this.tournaments.udtSeason(t) ?? '–' },
      );
    }
    const rules = this.rules(t);
    if (rules.league) return this.leagueLineup(t, settings);
    const season = this.udt.season().number;
    // Career phases change the accuracy of every bot in Dream Team games.
    const careers = this.career.careers();
    const main: Entrant[] = [];
    const skills: number[] = [];
    // The finale: no sign-up, the top of the season table plays.
    // Free places: AI managers that can play enter first (humans already have theirs).
    if (!rules.finale) {
      this.autoFill(t.id);
      this.aiFill(t.id);
    }
    // After the sign-ups: a new AI team brings its starter bot.
    const lib = new Map(this.bots.list().map((b) => [b.id, b]));
    const entered = rules.finale ? this.qualified(t, settings) : this.entries(t.id);
    const ai = this.udt.aiIds();
    const aiOn = this.udt.aiOn();
    // The game knows bots by name: one name twice ("[T]Xan" bought, "[T]Xan" made, or a fill
    // bot whose clan tag is a team tag) would put only one of them into the game.
    const named = uniqueNames();
    let humans = 0;
    // One tournament at a time (decision 200); the finale goes first and takes them anyway.
    const locked = rules.finale ? [] : lockedTournaments(this.db, this.log, t.id);
    const lockedProj = locked.map((l) => l.projection);
    // Human teams left out, for the organizer (AI teams are not reported).
    const dropped: DrawDrop[] = [];
    for (const userId of entered) {
      if (ai.has(userId) && !aiOn) {
        this.dropEntry(t.id, userId);
        continue;
      }
      const team = this.udt.team(userId, season);
      const busy = rules.finale ? undefined : botsOf(lockedProj, userId);
      const l = team ? this.lineup(userId, settings, rules, busy) : null;
      if (!team || !l || l.problems.length || main.length >= settings.size) {
        // Cannot play (any more) or no room: left out, the ticket goes back.
        this.dropEntry(t.id, userId);
        if (!ai.has(userId)) {
          const name = team
            ? `${team.tag} ${team.name}`
            : (this.users.byId(userId)?.displayName ?? userId);
          // Short only because of bots playing elsewhere?
          const onlyBusy =
            !!l?.problems.length &&
            !!busy?.size &&
            !this.lineup(userId, settings, rules).problems.length;
          dropped.push(
            onlyBusy
              ? { name, reason: 'busy', busyIn: playingIn(locked, userId) }
              : { name, reason: l && !l.problems.length ? 'full' : 'lineup' },
          );
        }
        continue;
      }
      const specs = l.bots
        .map((r) => this.spec(r, team.tag, lib, careers))
        .map((s) => ({ ...s, name: named(s.name) }));
      skills.push(...l.bots.map((r) => r.effective.skill));
      main.push(
        settings.teamSize > 1
          ? {
              id: udtEntrantId(userId),
              kind: 'team',
              displayName: team.name,
              tag: team.tag,
              members: [],
              bots: specs,
            }
          : { id: udtEntrantId(userId), kind: 'bot', displayName: team.name, bot: specs[0]! },
      );
      if (!ai.has(userId)) humans++;
    }
    // High stakes: too few human teams, everybody gets the ticket back.
    if (rules.ticket && humans < rules.minTeams) {
      this.refundTickets(t.id);
      this.db.delete(udtEntries).where(eq(udtEntries.tournamentId, t.id)).run();
      throw conflict(
        'high stakes needs {minTeams} human teams, {humans} can play: the tickets went back',
        { minTeams: rules.minTeams, humans },
      );
    }
    // Free library bots, closest to the managers' average skill first (ties at random).
    const owners = this.udt.owners(season);
    const avg = skills.length ? skills.reduce((a, b) => a + b, 0) / skills.length : 4;
    const free = [...lib.values()]
      .filter((b) => b.active && !b.udtOwner && !owners.has(b.id))
      .map((b) => ({ b, k: Math.abs(b.skill - avg) + rng() * 0.9 }))
      .sort((x, y) => x.k - y.k)
      .map((x) => x.b);
    const need = Math.max(0, settings.size - main.length);
    const fill: Entrant[] = [];
    // Bot teams get random names of the list, never one of a Dream Team (AI teams take theirs
    // from the same list) or of another entrant.
    const taken = new Set([
      ...this.udt.teams(season).map((x) => x.name.toLowerCase()),
      ...main.map((e) => e.displayName.toLowerCase()),
    ]);
    const names =
      settings.teamSize > 1
        ? pickTeamNames(this.settings.get().teamNames, need, taken, rng, (i) => `Bots ${i + 1}`)
        : [];
    const spec = (b: LibraryBot): BotSpec => {
      const s = this.bots.resolveSpec({ id: b.id, name: b.gameName, skill: b.skill }, lib);
      const traits = { ...(s.traits ?? b.traits ?? {}) };
      withCareer(traits, careers.get(b.id));
      return { ...s, name: named(s.name), traits };
    };
    for (let n = 0; n < need; n++) {
      if (settings.teamSize > 1) {
        const group = free.splice(0, settings.teamSize);
        if (group.length < settings.teamSize) break;
        fill.push({
          id: `udtbots-${n + 1}`,
          kind: 'team',
          displayName: names[n] ?? `Bots ${n + 1}`,
          members: [],
          bots: group.map(spec),
        });
      } else {
        const b = free.shift();
        if (!b) break;
        fill.push(botEntrant(spec(b)));
      }
    }
    if (main.length + fill.length < 2)
      throw conflict('not enough teams and free library bots for a bracket');
    return { entrants: main, fill, dropped };
  }

  /**
   * Dream Team tournaments: upcoming and running ones, the last finished ones (`only`: just
   * that one of them, for the sign-ups of the AI and of automatic entries).
   */
  events(
    user: User,
    only?: string,
    /** The locked tournaments, when the caller reads them once for many managers. */
    lockedNow?: readonly LockedTournament[],
  ) {
    this.udt.assertOn();
    const rows = this.db
      .select()
      .from(tournaments)
      .where(eq(tournaments.kind, 'udt'))
      .orderBy(desc(tournaments.createdAt))
      .all()
      // League games show on the league's pages, not among the cups.
      .filter((t) => !this.rules(t).league);
    const open = rows.filter((t) => t.phase !== 'finished' && t.phase !== 'aborted');
    const done = rows.filter((t) => t.phase === 'finished').slice(0, 5);
    const ai = this.udt.aiIds();
    const entries = new Map<string, string[]>();
    for (const e of this.db
      .select()
      .from(udtEntries)
      .where(inArray(udtEntries.tournamentId, [...open, ...done].map((t) => t.id).concat(['-'])))
      .all())
      entries.set(e.tournamentId, [...(entries.get(e.tournamentId) ?? []), e.userId]);
    const hasTeam = !!this.udt.team(user.id, this.udt.season().number);
    const listed = [...open, ...done].filter((t) => only === undefined || t.id === only);
    // The roster is the same for every tournament: read once.
    const roster =
      hasTeam && listed.length ? this.udt.roster(user.id, this.udt.season().number) : [];
    const locked =
      hasTeam && listed.some((t) => t.phase === 'draft')
        ? (lockedNow ?? lockedTournaments(this.db, this.log))
        : [];
    return listed.map((t) => {
      const s = this.settingsOf(t);
      const rules = this.rules(t);
      const who = entries.get(t.id) ?? [];
      const mine = hasTeam ? this.lineup(user.id, s, rules, undefined, roster) : null;
      const busyIn =
        mine && t.phase === 'draft' ? this.busyLineup(user.id, t, s, rules, roster, locked) : [];
      return {
        id: t.id,
        name: t.name,
        phase: t.phase,
        scheduledAt: t.scheduledAt,
        teamSize: s.teamSize,
        size: s.size,
        game: s.game.adapter === ADAPTER_MH ? ('mh' as const) : ('dm' as const),
        rules,
        ticketNow: this.ticketNow(rules),
        pot: this.pot(t.id),
        valueCapNow:
          rules.valueCap === null
            ? null
            : Math.round(rules.valueCap * this.udt.index(this.udt.season().number)),
        entries: who.length,
        /** AI teams among them (a human takes the place of the last one when it is full). */
        aiEntries: who.filter((u) => ai.has(u)).length,
        entered: who.includes(user.id),
        open: t.phase === 'draft' && t.registrationOpen && !rules.finale && this.inSeason(t),
        /** Finale: the teams that would play now (top of the table). */
        qualified: rules.finale && t.phase === 'draft' ? this.qualified(t, s) : null,
        lineup: mine
          ? {
              bots: mine.bots.map((b) => b.name),
              value: mine.value,
              problems: mine.problems,
              /**
               * Tournaments the team's bots play in: drawn now, it would drop out (decision 200);
               * automatic sign-ups wait.
               */
              busyIn,
            }
          : null,
      };
    });
  }

  /**
   * Names of the drawn or running Dream Team tournaments whose bots the manager's lineup for
   * `t` would miss at a draw now (empty: it can play, or it could not play anyway, or finale).
   */
  private busyLineup(
    userId: string,
    t: TournamentRow,
    s: TournamentSettings,
    rules: UdtEventRules,
    roster: readonly RosterBot[],
    locked: readonly LockedTournament[],
  ): string[] {
    if (rules.finale) return [];
    const others = locked.filter((l) => l.id !== t.id);
    const busy = botsOf(
      others.map((l) => l.projection),
      userId,
    );
    if (!busy.size) return [];
    if (this.lineup(userId, s, rules, undefined, roster).problems.length) return [];
    if (!this.lineup(userId, s, rules, busy, roster).problems.length) return [];
    return playingIn(others, userId);
  }

  /** `busyLineup` for one tournament (the tournament page's sign-up). */
  busyIn(user: User, tournamentId: string): string[] {
    try {
      return this.events(user, tournamentId)[0]?.lineup?.busyIn ?? [];
    } catch {
      return []; // Dream Team off, no season
    }
  }

  /** Tickets paid into a tournament (high stakes). */
  pot(tournamentId: string): number {
    return this.db
      .select()
      .from(udtEntries)
      .where(eq(udtEntries.tournamentId, tournamentId))
      .all()
      .reduce((n, e) => n + e.ticket, 0);
  }

  /** Entries with their paid tickets (for the payout). */
  tickets(tournamentId: string) {
    return this.db
      .select()
      .from(udtEntries)
      .where(eq(udtEntries.tournamentId, tournamentId))
      .all()
      .map((e) => ({ userId: e.userId, ticket: e.ticket }));
  }

  /** Signs the manager's team up (draft, registration open, the lineup can play). */
  enter(user: User, id: string) {
    this.signUp(user, id);
    return this.events(user);
  }

  /** `enter` without the answer (the list of tournaments): automatic and AI sign-ups. */
  signUp(user: User, id: string): void {
    this.udt.assertOn();
    const t = this.row(id);
    if (t.phase !== 'draft' || !t.registrationOpen || !this.inSeason(t))
      throw conflict('the sign-up is closed');
    if (this.rules(t).finale)
      throw conflict('the finale has no sign-up: the top of the season table plays');
    const season = this.udt.season().number;
    if (!this.udt.team(user.id, season)) throw conflict('found your team first');
    const s = this.settingsOf(t);
    const l = this.lineup(user.id, s, this.rules(t));
    if (l.problems.length)
      throw conflict('your team cannot play: {list}', { list: l.problems.join('; ') });
    const who = this.entries(id);
    if (who.includes(user.id)) return;
    const ai = this.udt.aiIds();
    if (who.length >= s.size) {
      // Humans first: the AI team that entered last makes room.
      const last = [...who].reverse().find((u) => ai.has(u));
      if (ai.has(user.id) || !last) throw conflict('the bracket is full');
      this.dropEntry(id, last);
    }
    // High stakes: the ticket is paid on entering (back on leaving or when it is called off).
    const ticket = this.ticketNow(this.rules(t));
    const ticketRef = ticket ? `ticket:${id}:${user.id}:${randomId(6)}` : null;
    if (ticket)
      this.ledger.charge({
        userId: user.id,
        kind: 'udt_ticket',
        amount: ticket,
        ref: ticketRef!,
        meta: { tournamentId: id },
      });
    this.db
      .insert(udtEntries)
      .values({
        tournamentId: id,
        userId: user.id,
        createdAt: new Date(this.clock.now()).toISOString(),
        ticket,
        ticketRef,
      })
      .run();
    this.tournaments.changed(id);
  }

  /** Takes the team out again (until the seeding). */
  leave(user: User, id: string) {
    this.udt.assertOn();
    this.withdraw(id, user.id);
    return this.events(user);
  }

  /** A team out of a tournament in draft (its manager or an admin), the ticket back. */
  withdraw(id: string, userId: string): void {
    const t = this.row(id);
    if (t.phase !== 'draft') throw conflict('the bracket is seeded: ask an organizer');
    this.dropEntry(id, userId);
    this.tournaments.changed(id);
  }

  /** The entries as the tournament page shows them: tag and team name. */
  private labelledEntries(id: string): { userId: string; label: string; ai: boolean }[] {
    const season = this.udt.seasonNumber();
    const ai = this.udt.aiIds();
    return this.entries(id).map((userId) => {
      const team = season === null ? null : this.udt.team(userId, season);
      return { userId, label: team ? `${team.tag} ${team.name}` : userId, ai: ai.has(userId) };
    });
  }
}

/**
 * Unique game names (case-insensitive, as long as the game keeps them): a taken one gets a
 * number at the end ("[T]Xan" -> "[T]Xan2").
 */
export function uniqueNames(max = 24): (name: string) => string {
  const used = new Set<string>();
  return (name) => {
    let out = name.slice(0, max);
    for (let i = 2; used.has(out.toLowerCase()); i++)
      out = `${name.slice(0, max - String(i).length)}${i}`;
    used.add(out.toLowerCase());
    return out;
  };
}

/**
 * The accuracy change (0..100 scale) of the career phase and the form of the day (the day of
 * the seeding) on the values sent to the game.
 */
function withCareer(traits: { accuracy?: number }, c: Career | undefined): void {
  if (!c) return;
  const d = (PHASE_EFFECT[c.phase].accuracy + FORM_EFFECT[c.form]) / 50;
  if (d)
    traits.accuracy = Math.max(
      -1,
      Math.min(1, Math.round(((traits.accuracy ?? 0) + d) * 1000) / 1000),
    );
}
