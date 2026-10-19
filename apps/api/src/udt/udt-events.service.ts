import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
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
  PHASE_EFFECT,
  roundNeuro,
  tiredPenalty,
  type Career,
} from '@tourney/udt';
import type { User } from '../auth/users.service.js';
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
  type TournamentRow,
  type UdtEventRules,
} from '../tournaments/tournaments.service.js';
import { UdtCareerService } from './udt-career.service.js';
import { gameName, UdtService, type RosterBot } from './udt.service.js';

/** Bots below this stamina are tired: they play worse and the bench comes first. */
const TIRED = 40;

export interface Lineup {
  bots: RosterBot[];
  /** Market value of the lineup (the starter bot counts 0). */
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
export class UdtEventsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(BotsService) private readonly bots: BotsService,
    @Inject(TournamentsService) private readonly tournaments: TournamentsService,
    @Inject(UdtService) private readonly udt: UdtService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(UdtCareerService) private readonly career: UdtCareerService,
  ) {}

  onModuleInit(): void {
    this.tournaments.registerLineupProvider('udt', (t, s, rng) => this.provide(t, s, rng));
    this.tournaments.onRemove((t) => {
      if (t.kind === 'udt' && t.phase === 'draft') this.refundTickets(t.id);
    });
  }

  private row(id: string): TournamentRow {
    const t = this.db.select().from(tournaments).where(eq(tournaments.id, id)).get();
    if (!t || t.kind !== 'udt') throw notFound(`Dream Team tournament ${id}`);
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
      }
    );
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
      const season = this.udt.season().number;
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

  /** All tickets of a tournament back (called off, deleted, too few teams). */
  refundTickets(tournamentId: string): void {
    for (const e of this.db
      .select()
      .from(udtEntries)
      .where(eq(udtEntries.tournamentId, tournamentId))
      .all())
      if (e.ticket > 0 && e.ticketRef)
        this.ledger.book({
          season: this.udt.season().number,
          userId: e.userId,
          kind: 'udt_ticket',
          amount: e.ticket,
          ref: `${e.ticketRef}:back`,
          meta: { tournamentId },
        });
  }

  private entries(tournamentId: string): string[] {
    return this.db
      .select()
      .from(udtEntries)
      .where(eq(udtEntries.tournamentId, tournamentId))
      .all()
      .map((e) => e.userId);
  }

  /**
   * The bots a manager's team plays with: the lineup slots in order, the bench before tired
   * players, strikers never; at most `starLimit` bots of skill 6-7 and a total market value up
   * to the cap × index.
   */
  lineup(userId: string, settings: TournamentSettings, rules: UdtEventRules): Lineup {
    const season = this.udt.season().number;
    const mh = settings.game.adapter === ADAPTER_MH;
    const roster = this.udt.roster(userId, season);
    const slot = (r: RosterBot) => (mh ? r.mhSlot : r.dmSlot);
    const slotted = roster.filter((r) => slot(r) !== null).sort((a, b) => slot(a)! - slot(b)!);
    const bench = roster
      .filter((r) => r.bench !== null && slot(r) === null)
      .sort((a, b) => a.bench! - b.bench!);
    const playable = (r: RosterBot) => !r.striking;
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
      if (value + r.value > cap) {
        capped = true;
        continue;
      }
      picked.push(r);
      value += r.value;
      if (star) stars++;
    }
    const problems: string[] = [];
    if (picked.length < settings.teamSize) {
      problems.push(
        `${picked.length} of ${settings.teamSize} bots can play (lineup and bench${roster.some((r) => r.striking) ? ', strikers left out' : ''})`,
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
    const base = this.bots.resolveSpec({ id: r.botId, name: r.name, skill: r.skill });
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
    const rules = this.rules(t);
    const season = this.udt.season().number;
    const lib = new Map(this.bots.list().map((b) => [b.id, b]));
    // Career phases change the accuracy of every bot in Dream Team games.
    const careers = this.career.careers();
    const main: Entrant[] = [];
    const skills: number[] = [];
    const entered = this.entries(t.id);
    for (const userId of entered) {
      const team = this.udt.team(userId, season);
      const l = team ? this.lineup(userId, settings, rules) : null;
      if (!team || !l || l.problems.length || main.length >= settings.size) {
        // Cannot play (any more) or no room: left out, the ticket goes back.
        this.dropEntry(t.id, userId);
        continue;
      }
      const specs = l.bots.map((r) => this.spec(r, team.tag, lib, careers));
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
    }
    // High stakes: too few human teams, everybody gets the ticket back.
    if (rules.ticket && main.length < rules.minTeams) {
      this.refundTickets(t.id);
      this.db.delete(udtEntries).where(eq(udtEntries.tournamentId, t.id)).run();
      throw conflict(
        `high stakes needs ${rules.minTeams} teams, ${main.length} can play: the tickets went back`,
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
    const names = this.settings.get().teamNames;
    const spec = (b: LibraryBot): BotSpec => {
      const s = this.bots.resolveSpec({ id: b.id, name: b.gameName, skill: b.skill });
      const traits = { ...(s.traits ?? b.traits ?? {}) };
      withCareer(traits, careers.get(b.id));
      return { ...s, traits };
    };
    for (let n = 0; n < need; n++) {
      if (settings.teamSize > 1) {
        const group = free.splice(0, settings.teamSize);
        if (group.length < settings.teamSize) break;
        fill.push({
          id: `udtbots-${n + 1}`,
          kind: 'team',
          displayName: names[n % names.length] ?? `Bots ${n + 1}`,
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
    return { entrants: main, fill };
  }

  /** Dream Team tournaments: upcoming and running ones, the last finished ones. */
  events(user: User) {
    this.udt.assertOn();
    const rows = this.db
      .select()
      .from(tournaments)
      .where(eq(tournaments.kind, 'udt'))
      .orderBy(desc(tournaments.createdAt))
      .all();
    const open = rows.filter((t) => t.phase !== 'finished' && t.phase !== 'aborted');
    const done = rows.filter((t) => t.phase === 'finished').slice(0, 5);
    const entries = new Map<string, string[]>();
    for (const e of this.db
      .select()
      .from(udtEntries)
      .where(inArray(udtEntries.tournamentId, [...open, ...done].map((t) => t.id).concat(['-'])))
      .all())
      entries.set(e.tournamentId, [...(entries.get(e.tournamentId) ?? []), e.userId]);
    const hasTeam = !!this.udt.team(user.id, this.udt.season().number);
    return [...open, ...done].map((t) => {
      const s = this.settingsOf(t);
      const rules = this.rules(t);
      const who = entries.get(t.id) ?? [];
      const mine = hasTeam ? this.lineup(user.id, s, rules) : null;
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
        entered: who.includes(user.id),
        open: t.phase === 'draft' && t.registrationOpen,
        lineup: mine
          ? { bots: mine.bots.map((b) => b.name), value: mine.value, problems: mine.problems }
          : null,
      };
    });
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
    this.udt.assertOn();
    const t = this.row(id);
    if (t.phase !== 'draft' || !t.registrationOpen) throw conflict('the sign-up is closed');
    const season = this.udt.season().number;
    if (!this.udt.team(user.id, season)) throw conflict('found your team first');
    const s = this.settingsOf(t);
    const l = this.lineup(user.id, s, this.rules(t));
    if (l.problems.length) throw conflict(`your team cannot play: ${l.problems.join('; ')}`);
    const who = this.entries(id);
    if (who.includes(user.id)) return this.events(user);
    if (who.length >= s.size) throw conflict('the bracket is full');
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
    return this.events(user);
  }

  /** Takes the team out again (until the seeding). */
  leave(user: User, id: string) {
    this.udt.assertOn();
    const t = this.row(id);
    if (t.phase !== 'draft') throw conflict('the bracket is seeded: ask an organizer');
    this.dropEntry(id, user.id);
    return this.events(user);
  }
}

/** The career phase's accuracy change (0..100 scale) on the values sent to the game. */
function withCareer(traits: { accuracy?: number }, c: Career | undefined): void {
  if (!c) return;
  const d = PHASE_EFFECT[c.phase].accuracy / 50;
  if (d)
    traits.accuracy = Math.max(
      -1,
      Math.min(1, Math.round(((traits.accuracy ?? 0) + d) * 1000) / 1000),
    );
}
