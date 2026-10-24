import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { asc } from 'drizzle-orm';
import { createRng } from '@tourney/bracket';
import {
  buildCost,
  cannotBreakthrough,
  DEVELOP_VALUES,
  levelOf,
  STARTER_SKILL,
  TALENT_NAMES,
  traitDef,
  traitSlots,
  valueAtTop,
  valueReady,
} from '@tourney/udt';
import type { User } from '../auth/users.service.js';
import { UsersService } from '../auth/users.service.js';
import { BotsService } from '../bots/bots.service.js';
import { LOGGER, type ApiLogger } from '../common/logger.js';
import { CLOCK, type ApiClock } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { udtAi } from '../db/schema.js';
import { LedgerService } from '../ledger/ledger.service.js';
import type { Season } from '../seasons/seasons.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { UdtAcademyService } from './udt-academy.service.js';
import { UdtEventsService } from './udt-events.service.js';
import { lockedTournaments } from './udt-playing.js';
import { ROSTER_MAX, UdtMarketService } from './udt-market.service.js';
import { UdtPacksService } from './udt-packs.service.js';
import { UdtTradesService } from './udt-trades.service.js';
import { UdtService, type RosterBot } from './udt.service.js';
import { pickTeamNames } from '../common/names.js';

export type AiPersonality = 'saver' | 'gambler' | 'tactician' | 'breeder';
const PERSONALITIES: AiPersonality[] = ['tactician', 'gambler', 'saver', 'breeder'];

/** How a personality plays: share of the free Neuro it spends on the market, packs, trades. */
const STYLE: Readonly<
  Record<AiPersonality, { spend: number; packs: number; tradeMin: number; scout: boolean }>
> = {
  saver: { spend: 0.25, packs: 0.05, tradeMin: 1.1, scout: false },
  gambler: { spend: 0.6, packs: 0.5, tradeMin: 0.9, scout: false },
  tactician: { spend: 0.4, packs: 0.15, tradeMin: 1, scout: false },
  breeder: { spend: 0.3, packs: 0.1, tradeMin: 1, scout: true },
};
const STRENGTH = { calm: 0.6, normal: 1, ambitious: 1.4 } as const;
/** Bots an AI manager buys per market day at most (humans have room). */
const MAX_BUYS = 2;
/**
 * AI managers do not bet: a sponsor pays them this much per market day (× index × style) so
 * that they can keep up with managers who win bets.
 */
const SPONSOR = 150;

/**
 * Dream Team AI managers (setting "AI managers", off by default): website users ("ai:<n>")
 * with a team from the bot team names and a personality. At the market's closing time they buy
 * what the humans left of the day's offers (at most two bots); after every market day they line
 * up, open packs, put traits
 * on their bots, scout and develop own bots, enter open Dream Team tournaments without a
 * ticket and answer or make trade offers. They do not bet: they earn Neuro from Dream Team match
 * rewards and a daily sponsor; they are not in the betting rankings, the economy index, high
 * stakes or the place rewards. Switched off they do nothing and leave open sign-ups.
 */
@Injectable()
export class UdtAiService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(LOGGER) private readonly log: ApiLogger,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(BotsService) private readonly bots: BotsService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(UdtService) private readonly udt: UdtService,
    @Inject(UdtMarketService) private readonly market: UdtMarketService,
    @Inject(UdtEventsService) private readonly events: UdtEventsService,
    @Inject(UdtPacksService) private readonly packs: UdtPacksService,
    @Inject(UdtAcademyService) private readonly academy: UdtAcademyService,
    @Inject(UdtTradesService) private readonly trades: UdtTradesService,
  ) {}

  onModuleInit(): void {
    // After a market day (rested bots, new buys) the humans' automatic sign-ups come first.
    this.market.afterDay(() => void this.events.autoFill());
    this.market.afterDay((season, day) => this.daily(season, day));
    this.market.atClosing((season, day) => this.closing(season, day));
    this.events.aiFill = (id) => this.fill(id);
  }

  /**
   * A Dream Team tournament opened its sign-up or is seeded: the AI managers (while switched on)
   * enter it where their lineup can play, as on a market day (no high stakes; calm ones by
   * chance). Humans keep priority: a human entering a full bracket takes an AI team's place.
   */
  fill(tournamentId: string): number {
    const cfg = this.cfg();
    const n0 = this.udt.seasonNumber();
    if (!cfg.enabled || !cfg.aiEnabled || n0 === null) return 0;
    const season = { number: n0 };
    this.ensure(season.number);
    let n = 0;
    // The drawn tournaments (one at a time, decision 200): read once for all managers.
    const locked = lockedTournaments(this.db, this.events.eventLog);
    for (const m of this.managers().slice(0, cfg.aiCount)) {
      if (!this.udt.team(m.user.id, season.number)) continue;
      const [e] = this.events.events(m.user, tournamentId, locked);
      if (!e || !e.open || e.entered || e.ticketNow > 0 || e.lineup?.problems.length) continue;
      if (e.lineup?.busyIn.length) continue; // its bots play elsewhere (decision 200)
      if (cfg.aiStrength === 'calm' && createRng(`ai-fill-${tournamentId}-${m.n}`)() > 0.5)
        continue;
      try {
        this.events.signUp(m.user, tournamentId);
        n++;
      } catch {
        break; // the bracket is full
      }
    }
    if (n) this.log.info(`udt AI managers: ${n} entered ${tournamentId}`);
    return n;
  }

  private cfg() {
    return this.settings.get().udt;
  }

  /** The AI managers with their user and personality, oldest first. */
  managers(): { user: User; personality: AiPersonality; n: number }[] {
    return this.db
      .select()
      .from(udtAi)
      .orderBy(asc(udtAi.n))
      .all()
      .flatMap((a) => {
        const user = this.users.byId(a.userId);
        return user ? [{ user, personality: a.personality as AiPersonality, n: a.n }] : [];
      });
  }

  /** Makes sure the set number of AI managers has a team this season. */
  ensure(season: number): string[] {
    const made: string[] = [];
    const cfg = this.cfg();
    if (!cfg.enabled || !cfg.aiEnabled) return made;
    let all = this.managers();
    // Missing AI users up to the count.
    for (let n = all.length + 1; n <= cfg.aiCount; n++) {
      const user = this.users.login({
        discordId: `ai:${n}`,
        username: `AI ${n}`,
        displayName: `AI ${n}`,
      });
      this.db
        .insert(udtAi)
        .values({
          userId: user.id,
          n,
          personality: PERSONALITIES[(n - 1) % PERSONALITIES.length]!,
          createdAt: new Date(this.clock.now()).toISOString(),
        })
        .onConflictDoNothing()
        .run();
    }
    all = this.managers().slice(0, cfg.aiCount);
    const names = this.settings.get().teamNames;
    for (const m of all) {
      if (this.udt.team(m.user.id, season)) continue;
      const taken = new Set(this.udt.teams(season).map((t) => t.name.toLowerCase()));
      const rng = createRng(`ai-starter-${season}-${m.n}`);
      // A random free name of the list (not the first one).
      // Own rng for the name: the starter below stays the same whatever the list holds.
      const nameRng = createRng(`ai-name-${season}-${m.n}`);
      const [name] = pickTeamNames(names, 1, taken, nameRng, (i) => `AI Team ${m.n}${i || ''}`);
      const tags = new Set(this.udt.teams(season).map((t) => t.tag.toLowerCase()));
      const tag = this.tagFor(name!, tags, m.n);
      const library = new Set(this.bots.list().map((b) => b.name.toLowerCase()));
      const botName =
        [...TALENT_NAMES].find((x) => !library.has(x.toLowerCase())) ?? `Unit${m.n}${season}`;
      // A starter within the budget: skill 3 (every starter), values around average.
      const skill = STARTER_SKILL;
      const v = () => Math.round((rng() * 0.6 - 0.3) * 100) / 100;
      let traits = { accuracy: v(), alertness: v(), strafing: v() };
      if (buildCost(skill, traits) > cfg.starterBudget)
        traits = { accuracy: 0, alertness: 0, strafing: 0 };
      try {
        this.udt.createTeam(m.user, {
          name: name!,
          tag,
          starter: { name: botName, skill, traits },
        });
        made.push(name!);
      } catch (e) {
        this.log.warn(`AI manager ${m.n}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return made;
  }

  private tagFor(name: string, taken: Set<string>, n: number): string {
    const words = name
      .replace(/[^A-Za-z ]/g, '')
      .split(/\s+/)
      .filter(Boolean);
    const cands = [
      words
        .map((w) => w[0])
        .join('')
        .slice(0, 3),
      name.replace(/[^A-Za-z]/g, '').slice(0, 3),
      `A${n}`,
    ];
    for (const c of cands) {
      const t = `[${c.toUpperCase()}]`;
      if (c.length >= 2 && !taken.has(t.toLowerCase())) return t;
    }
    return `[AI${n}]`;
  }

  /** After a market day (and in the test mode on "managers act"): every AI manager acts once. */
  daily(season: Season, day: string) {
    const cfg = this.cfg();
    const out = { managers: 0, entries: 0, packs: 0, trades: 0, made: [] as string[] };
    if (!cfg.enabled || !cfg.aiEnabled) {
      this.leaveAll();
      return out;
    }
    out.made = this.ensure(season.number);
    const strength = STRENGTH[cfg.aiStrength];
    for (const m of this.managers().slice(0, cfg.aiCount)) {
      if (!this.udt.team(m.user.id, season.number)) continue;
      out.managers++;
      this.ledger.book({
        season: season.number,
        userId: m.user.id,
        kind: 'udt_sponsor',
        amount: Math.round((SPONSOR * this.udt.index(season.number) * strength) / 10) * 10,
        ref: `ai-sponsor:${season.number}:${day}:${m.user.id}`,
      });
      const rng = createRng(`ai-${day}-${m.n}`);
      const style = STYLE[m.personality];
      const act = (what: string, fn: () => void) => {
        try {
          fn();
        } catch (e) {
          this.log.debug(`AI ${m.n} ${what}: ${e instanceof Error ? e.message : String(e)}`);
        }
      };
      act('trades', () => (out.trades += this.answerTrades(m.user, style.tradeMin)));
      act('develop', () => this.develop(m.user, season.number));
      if (style.scout || rng() < 0.05) act('academy', () => this.scoutAndSign(m.user, rng));
      if (rng() < style.packs * strength) act('packs', () => (out.packs += this.openPack(m.user)));
      act('traits', () => this.assignTraits(m.user, season.number, rng));
      act('lineup', () => this.lineup(m.user, season.number, m.personality === 'tactician'));
      act(
        'events',
        () => (out.entries += this.enter(m.user, cfg.aiStrength === 'calm' ? 0.5 : 1, rng)),
      );
      if (rng() < 0.15) act('offer', () => (out.trades += this.offerTrade(m.user, rng)));
    }
    this.log.info(
      `udt AI managers ${day}: ${out.managers} acted, ${out.entries} sign-ups, ${out.packs} packs, ${out.trades} trades`,
    );
    return out;
  }

  /** Switched off: AI managers leave the open sign-ups. */
  private leaveAll() {
    for (const m of this.managers())
      try {
        for (const e of this.events.events(m.user))
          if (e.entered && e.open) this.events.leave(m.user, e.id);
      } catch {
        // Dream Team off or no season
      }
  }

  private spendable(user: User) {
    return this.ledger.spendable(user.id).spendable;
  }

  /**
   * Closing time of a market day's offers (before the next market day): every AI manager buys
   * up to two of the bots the humans left, the strongest it can afford. Returns the purchases.
   */
  closing(season: Season, day: string): number {
    const cfg = this.cfg();
    if (!cfg.enabled || !cfg.aiEnabled) return 0;
    const strength = STRENGTH[cfg.aiStrength];
    let n = 0;
    for (const m of this.managers().slice(0, cfg.aiCount)) {
      if (!this.udt.team(m.user.id, season.number)) continue;
      try {
        n += this.buy(m.user, season.number, STYLE[m.personality], strength);
      } catch (e) {
        this.log.debug(`AI ${m.n} market: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (n) this.log.info(`udt AI managers bought ${n} bots at the closing of ${day}`);
    return n;
  }

  private buy(
    user: User,
    season: number,
    style: (typeof STYLE)[AiPersonality],
    strength: number,
  ): number {
    const m = this.market.view(user);
    let room = Math.min(MAX_BUYS, ROSTER_MAX - this.udt.roster(user.id, season).length);
    let budget = this.spendable(user) * style.spend * strength;
    let n = 0;
    const offers = m.offers
      .filter((o) => !o.sold)
      .sort((a, b) => b.skill - a.skill || a.price - b.price);
    for (const o of offers) {
      if (room <= 0) break;
      if (o.price > budget) continue;
      this.market.buy(user, { botId: o.botId });
      budget -= o.price;
      room--;
      n++;
    }
    return n;
  }

  /** Lineups: the strongest fit bots play, tired ones to the bench (the tactician rests them). */
  lineup(user: User, season: number, restTired: boolean) {
    const score = (r: RosterBot) =>
      r.effective.skill * 10 + (r.effective.traits.accuracy ?? 0) * 3 - (r.striking ? 100 : 0);
    const roster = this.udt.roster(user.id, season);
    const fit = roster.filter((r) => !restTired || r.stamina >= 40);
    const tired = roster.filter((r) => restTired && r.stamina < 40);
    const order = [
      ...fit.sort((a, b) => score(b) - score(a)),
      ...tired.sort((a, b) => score(b) - score(a)),
    ];
    const ids = order.map((r) => r.botId);
    this.udt.setLineup(user, { dm: ids.slice(0, 5), mh: ids.slice(0, 5), bench: ids.slice(5, 7) });
  }

  private enter(user: User, chance: number, rng: () => number): number {
    let n = 0;
    for (const e of this.events.events(user)) {
      if (!e.open || e.entered || e.ticketNow > 0 || e.lineup?.problems.length) continue;
      if (e.lineup?.busyIn.length) continue; // its bots play elsewhere (decision 200)
      if (rng() > chance) continue;
      try {
        this.events.signUp(user, e.id);
        n++;
      } catch {
        // bracket full
      }
    }
    return n;
  }

  private openPack(user: User): number {
    const v = this.packs.view(user);
    const box = v.boxes.find((b) => b.box === 'premium' && v.spendable > b.price * 4)
      ? 'premium'
      : 'standard';
    const price = v.boxes.find((b) => b.box === box)!.price;
    if (v.spendable < price * 3) return 0;
    this.packs.open(user, { box });
    return 1;
  }

  /** Trait cards from the inventory onto the best bots with a free slot. */
  private assignTraits(user: User, season: number, rng: () => number) {
    const v = this.packs.view(user);
    for (const card of v.inventory) {
      const def = traitDef(card.code);
      const roster = this.udt
        .roster(user.id, season)
        .sort((a, b) => b.effective.skill - a.effective.skill);
      for (const r of roster) {
        const codes: string[] = r.udtTraits.map((t) => t.code);
        if (codes.includes(card.code) || codes.length >= traitSlots(levelOf(r.xp))) continue;
        if (def?.rarity === 'legendary' && r.udtTraits.some((t) => t.rarity === 'legendary'))
          continue;
        if (
          def?.category === 'body' &&
          r.udtTraits.some((t) => traitDef(t.code)?.category === 'body')
        )
          continue;
        const weapon = card.needsWeapon
          ? v.weapons[Math.floor(rng() * v.weapons.length)]?.name
          : undefined;
        try {
          this.packs.assign(user, card.id, { botId: r.botId, ...(weapon ? { weapon } : {}) });
          break;
        } catch {
          // try the next bot
        }
      }
    }
  }

  /**
   * Development points: the breakthrough when possible, else skill when possible, else accuracy,
   * alertness, strafing in turn.
   */
  private develop(user: User, season: number) {
    for (const r of this.udt.roster(user.id, season)) {
      if (!r.own) continue;
      const bt = cannotBreakthrough(
        {
          skill: r.skill,
          potential: r.own.potential[1],
          level: r.level,
          done: r.own.breakthrough,
          values: r.traits,
        },
        r.own.points,
      );
      if (bt === null)
        try {
          this.academy.breakthrough(user, r.botId);
        } catch {
          // checked above; the next round tries again
        }
      // Skill while it can grow (the potential may be lower than the range's top), else the
      // lowest value below 100 - with a breakthrough ahead only up to its 60, then the points
      // wait for it (decision 197); nothing left: the points wait.
      let skillClosed = false;
      for (
        let guard = 0;
        guard < 10 &&
        (this.udt.roster(user.id, season).find((x) => x.botId === r.botId)?.own?.points ?? 0) > 0;
        guard++
      ) {
        const now = this.udt.roster(user.id, season).find((x) => x.botId === r.botId)!;
        const skill =
          !skillClosed && now.own!.points >= 3 && Math.round(now.skill) < now.own!.potential[1];
        const ahead =
          !now.own!.breakthrough &&
          Math.round(now.skill) < 7 &&
          Math.round(now.skill) >= now.own!.potential[1];
        const value = DEVELOP_VALUES.filter((k) =>
          ahead ? !valueReady(now.traits[k]) : !valueAtTop(now.traits[k]),
        ).sort((a, b) => (now.traits[a] ?? 0) - (now.traits[b] ?? 0))[0];
        const stat = skill ? 'skill' : value;
        if (!stat) break;
        try {
          this.academy.develop(user, r.botId, stat);
        } catch {
          if (stat === 'skill') skillClosed = true;
          else break;
        }
      }
    }
  }

  /** Breeders (and now and then others) scout and sign the talent with the best potential. */
  private scoutAndSign(user: User, rng: () => number) {
    const v = this.academy.view(user);
    if (v.rosterFull || v.licence.nextPrice === null) return;
    const need = v.scoutPrice + v.licence.nextPrice;
    if (this.spendable(user) < need * 2) return;
    const r = (v.report ?? this.academy.scoutNow(user).report)!;
    const best = r
      .map((t, i) => ({ t, i }))
      .sort((a, b) => b.t.potential[1] - a.t.potential[1] || b.t.skill - a.t.skill)[0];
    if (!best) return;
    const library = new Set(this.bots.list().map((b) => b.name.toLowerCase()));
    const name = library.has(best.t.name.toLowerCase())
      ? `${best.t.name}${Math.floor(rng() * 90) + 10}`
      : best.t.name;
    this.academy.sign(user, { pick: best.i, name });
  }

  /** Incoming offers: accepted when the AI gets at least `min` × what it gives. */
  private answerTrades(user: User, min: number): number {
    let n = 0;
    for (const t of this.trades.list(user).open.filter((x) => x.incoming)) {
      try {
        if (t.giveValue >= t.takeValue * min) this.trades.accept(user, t.id);
        else this.trades.decline(user, t.id);
        n++;
      } catch {
        try {
          this.trades.decline(user, t.id);
        } catch {
          // decided meanwhile
        }
      }
    }
    return n;
  }

  /** Now and then a 1:1 offer to a human manager: a bot of about the same value. */
  private offerTrade(user: User, rng: () => number): number {
    const ai = this.udt.aiIds();
    const mine = this.trades.rosterFor(user.id).filter((b) => !b.blocked && b.value > 0);
    if (!mine.length) return 0;
    const humans = this.trades.partners(user).filter((p) => !ai.has(p.userId));
    if (!humans.length) return 0;
    const p = humans[Math.floor(rng() * humans.length)]!;
    for (const give of mine.sort(() => rng() - 0.5)) {
      const want = p.roster.find(
        (b) => !b.blocked && b.value > 0 && Math.abs(b.value - give.value) <= give.value * 0.2,
      );
      if (!want) continue;
      try {
        this.trades.propose(user, {
          to: p.userId,
          give: [give.botId],
          take: [want.botId],
          giveNeuro: 0,
          takeNeuro: 0,
          message: 'Fair swap?',
        });
        return 1;
      } catch {
        return 0;
      }
    }
    return 0;
  }
}
