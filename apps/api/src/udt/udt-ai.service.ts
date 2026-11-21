import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { asc } from 'drizzle-orm';
import { createRng } from '@tourney/bracket';
import {
  BLUEPRINTS,
  buildCost,
  cannotBreakthrough,
  DEVELOP_COST,
  DEVELOP_VALUES,
  levelOf,
  RARITIES,
  STARTER_SKILL,
  TALENT_NAMES,
  traitDef,
  traitSlots,
  valueAtTop,
  valueReady,
  clubUpgradePrice,
  type ClubUpgrade,
  type PrestigeStat,
  type Rarity,
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
/** Bots an AI manager buys per market day at most, swaps included (humans have room). */
const MAX_BUYS = 2;
/**
 * A full roster swaps its weakest bought bot for an offer at least this many skill steps better
 * (decision 249: AI rosters stayed at skill 2-5 while skill 6-7 bots were for sale).
 */
const SWAP_GAIN = 1;
/** A swap may use savings: this many times the style's share of the spendable Neuro (≤ 0.9). */
const SWAP_SAVINGS = 2;
/** Packs an AI manager opens per market day at most when it has savings (decision 249). */
const MAX_PACKS = 3;
/** Prestige points an AI manager buys per market day at most (decision 263). */
const MAX_PRESTIGE_BUYS = 2;
/**
 * The prestige stats an AI manager prefers, by personality (decision 263): the tactician aims
 * and reacts, the gambler hits hard, the saver lasts, the breeder dodges; a gambler mixes the
 * order every day (worse decisions than a good human's).
 */
const PRESTIGE_ORDER: Readonly<Record<AiPersonality, readonly PrestigeStat[]>> = {
  tactician: ['aim', 'react', 'dodge', 'tough', 'fire', 'view', 'armour', 'sprint', 'ammo'],
  gambler: ['fire', 'aim', 'armour', 'tough', 'dodge', 'react', 'sprint', 'ammo', 'view'],
  saver: ['tough', 'armour', 'aim', 'dodge', 'react', 'ammo', 'fire', 'view', 'sprint'],
  breeder: ['aim', 'dodge', 'react', 'view', 'tough', 'fire', 'sprint', 'armour', 'ammo'],
};
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
      act('club', () => this.club(m.user, season.number, style.spend * strength, day));
      act('prestige', () =>
        this.prestige(m.user, season.number, style.spend * strength, m.personality, rng),
      );
      if (style.scout || rng() < 0.05) act('academy', () => this.scoutAndSign(m.user, rng));
      act('packs', () => (out.packs += this.openPacks(m.user, style.packs * strength, rng)));
      act('blueprints', () => this.buildBlueprint(m.user, season.number, style.spend * strength));
      act('traits', () => this.assignTraits(m.user, season.number, rng, m.n));
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

  /**
   * Buys the strongest offers it can afford while the roster has room; a full roster swaps its
   * weakest bought bot for an offer at least `SWAP_GAIN` skill steps better, paid from savings
   * (`SWAP_SAVINGS` × its share; decision 249). Bots the team made are never sold.
   */
  private buy(
    user: User,
    season: number,
    style: (typeof STYLE)[AiPersonality],
    strength: number,
  ): number {
    const m = this.market.view(user);
    let room = ROSTER_MAX - this.udt.roster(user.id, season).length;
    const spendable = this.spendable(user);
    const budget = spendable * style.spend * strength;
    const savings = spendable * Math.min(0.9, SWAP_SAVINGS * style.spend * strength);
    let spent = 0;
    let n = 0;
    const offers = m.offers
      .filter((o) => !o.sold)
      .sort((a, b) => b.skill - a.skill || a.price - b.price);
    for (const o of offers) {
      if (n >= MAX_BUYS) break;
      if (o.price > (room > 0 ? budget : savings) - spent) continue;
      if (room <= 0) {
        const weakest = this.weakestBought(user, season);
        if (!weakest || Math.round(o.skill) < Math.round(weakest.skill) + SWAP_GAIN) continue;
        try {
          this.market.sell(user, weakest.botId);
        } catch {
          continue; // it plays in a running tournament
        }
        room++;
      }
      this.market.buy(user, { botId: o.botId });
      spent += o.price;
      room--;
      n++;
    }
    return n;
  }

  /** The weakest bot it bought (never one it made): lowest skill, then the lowest value. */
  private weakestBought(user: User, season: number): RosterBot | undefined {
    return this.udt
      .roster(user.id, season)
      .filter((r) => !r.own && !r.starter)
      .sort((a, b) => a.skill - b.skill || a.value - b.value)[0];
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

  /**
   * Packs: one now and then by its style, more from savings (decision 249) - as many as the
   * style's share of the spendable Neuro pays for, at most `MAX_PACKS` a day.
   */
  private openPacks(user: User, share: number, rng: () => number): number {
    const price = this.packs.view(user).boxes.find((b) => b.box === 'standard')!.price;
    const savings = Math.floor((this.spendable(user) * share) / Math.max(1, price));
    const want = Math.min(MAX_PACKS, Math.max(rng() < share ? 1 : 0, savings));
    let n = 0;
    for (let i = 0; i < want; i++) {
      const opened = this.openPack(user);
      if (!opened) break;
      n += opened;
    }
    return n;
  }

  private openPack(user: User): number {
    let v = this.packs.view(user);
    // Over the blueprint limit: the AI scraps its lowest pack blueprints (a human chooses).
    const rank = (r: string) => RARITIES.indexOf(r as Rarity);
    for (const bp of v.blueprints
      .filter((b) => !b.gift)
      .sort((a, b) => rank(a.rarity) - rank(b.rarity))
      .slice(0, v.blueprintsOver))
      v = this.packs.scrapBlueprint(user, bp.id);
    const box = v.boxes.find((b) => b.box === 'premium' && v.spendable > b.price * 4)
      ? 'premium'
      : 'standard';
    const price = v.boxes.find((b) => b.box === box)!.price;
    if (v.spendable < price * 3) return 0;
    this.packs.open(user, { box });
    return 1;
  }

  /**
   * Trait cards from the inventory onto a random bot with a free slot (trait lab, decision 249:
   * the pack draws the trait, chance the bot - so the trait report compares traits without a
   * manager's choice; logged).
   */
  private assignTraits(user: User, season: number, rng: () => number, n: number) {
    const v = this.packs.view(user);
    for (const card of v.inventory) {
      const def = traitDef(card.code);
      const roster = this.udt
        .roster(user.id, season)
        .map((r) => ({ r, k: rng() }))
        .sort((a, b) => a.k - b.k)
        .map((x) => x.r);
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
          this.log.info(
            `udt AI ${n} trait lab: ${card.code}${weapon ? ` (${weapon})` : ''} on ${r.name} (skill ${r.skill})`,
          );
          break;
        } catch {
          // try the next bot
        }
      }
    }
  }

  /**
   * Development points: the breakthrough when possible, else skill up to the potential - the
   * points wait until a skill step (3) is paid (decision 249: spending every point at once put
   * them into the values and left the bots below their potential) - then accuracy, alertness,
   * strafing in turn.
   */
  private develop(user: User, season: number) {
    // The AI knows its bots' potential (a human sees it from level 5).
    let exact = this.udt.ownBots(season, user.id);
    for (const r of this.udt.roster(user.id, season)) {
      if (!r.own) continue;
      const potential = exact.get(r.botId)?.potential ?? r.own.potential[1];
      const bt = cannotBreakthrough(
        {
          skill: r.skill,
          potential,
          level: r.level,
          done: r.own.breakthrough,
          values: r.traits,
        },
        r.own.points,
      );
      if (bt === null)
        try {
          this.academy.breakthrough(user, r.botId);
          exact = this.udt.ownBots(season, user.id); // potential + 1
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
        const top = exact.get(r.botId)?.potential ?? now.own!.potential[1];
        const below = !skillClosed && Math.round(now.skill) < top;
        // Below the potential: save for the next skill step.
        if (below && now.own!.points < DEVELOP_COST.skill) break;
        const skill = below;
        const ahead =
          !now.own!.breakthrough && Math.round(now.skill) < 7 && Math.round(now.skill) >= top;
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

  /**
   * Club house (decisions 264, 266): the training ground and the physio level by level, the fan
   * shop in the first half of the season (it pays back per home game), a breeder also the
   * scouting office - one level a day, when it fits its share of the spendable Neuro.
   */
  private club(user: User, season: number, share: number, day: string) {
    const levels = this.udt.clubLevels(season, user.id);
    const breeder = this.managers().find((m) => m.user.id === user.id)?.personality === 'breeder';
    const s = this.udt.season();
    const early = !s.endDate || day <= midpoint(s.startDate, s.endDate);
    const kinds: ClubUpgrade[] = [
      ...(early ? (['fanshop'] as const) : []),
      'training',
      'physio',
      ...(breeder ? (['scouting'] as const) : []),
      'training',
      'physio',
    ];
    for (const kind of kinds) {
      const price = clubUpgradePrice(kind, levels[kind] ?? 0, this.udt.index(season));
      if (price === null) continue;
      if (price > this.spendable(user) * Math.min(0.9, share)) return;
      this.udt.buyClubUpgrade(user, kind);
      return; // one level a day
    }
  }

  /**
   * Prestige (decision 263, concept section 4): free points go on the stats its personality
   * prefers; points, the ascension and stars are bought from its share of the spendable Neuro
   * (at most `MAX_PRESTIGE_BUYS` points a day), the ascension and stars before more points.
   */
  private prestige(
    user: User,
    season: number,
    share: number,
    personality: AiPersonality,
    rng: () => number,
  ) {
    const order =
      personality === 'gambler'
        ? [...PRESTIGE_ORDER.gambler].sort(() => rng() - 0.5)
        : PRESTIGE_ORDER[personality];
    const now = (id: string) =>
      this.udt.roster(user.id, season).find((x) => x.botId === id)?.own?.prestige ?? null;
    const place = (id: string) => {
      for (let guard = 0; guard < 30; guard++) {
        const p = now(id);
        if (!p || p.free <= 0) return;
        const stat = order.find((k) => (p.alloc[k] ?? 0) < 3);
        if (!stat) return;
        this.academy.prestigeAllocate(user, id, stat);
      }
    };
    const budget = () => this.spendable(user) * Math.min(0.9, share);
    let bought = 0;
    const bots = this.udt
      .roster(user.id, season)
      .filter((r) => r.own?.prestige)
      .sort((a, b) => b.skill - a.skill);
    for (const r of bots) {
      place(r.botId);
      let p = now(r.botId);
      if (p && p.ascend === null && p.prices.ascend !== null && p.prices.ascend <= budget())
        this.academy.ascend(user, r.botId);
      p = now(r.botId);
      if (p && p.prices.star !== null && p.prices.star <= budget())
        this.academy.buyStar(user, r.botId);
      for (; bought < MAX_PRESTIGE_BUYS; bought++) {
        p = now(r.botId);
        if (!p || p.prices.point === null || p.prices.point > budget()) break;
        this.academy.prestigeBuy(user, r.botId);
      }
      place(r.botId);
    }
  }

  /**
   * Blueprints from packs (decision 249: they stayed unused): builds the best one when a licence
   * fits its budget share and the roster has room - a full roster first sells its weakest bought
   * bot when that is below the blueprint's skill or its potential range. The values lean on
   * accuracy (the strongest value in the season 2 games), the others stay average.
   */
  private buildBlueprint(user: User, season: number, share: number): number {
    const v = this.academy.view(user);
    const rank = (r: string) => RARITIES.indexOf(r as Rarity);
    const bp = [...v.blueprints].sort((a, b) => rank(b.rarity) - rank(a.rarity))[0];
    if (!bp) return 0;
    if (v.licence.nextPrice > this.spendable(user) * share) return 0;
    const rule = BLUEPRINTS[bp.rarity as Rarity];
    if (v.rosterFull) {
      const weakest = this.weakestBought(user, season);
      if (!weakest || Math.round(weakest.skill) >= rule.potential[0]) return 0;
      try {
        this.market.sell(user, weakest.botId);
      } catch {
        return 0;
      }
    }
    const traits = { accuracy: 0, alertness: 0, strafing: 0 };
    for (let a = 1; a >= -1; a -= 0.05) {
      traits.accuracy = Math.round(a * 100) / 100;
      if (buildCost(rule.skill, traits) <= rule.budget) break;
    }
    const library = new Set(this.bots.list().map((b) => b.name.toLowerCase()));
    const base = [...TALENT_NAMES].find((x) => !library.has(x.toLowerCase())) ?? 'Unit';
    let name = base;
    for (let i = 2; library.has(name.toLowerCase()); i++) name = `${base}${i}`;
    this.academy.build(user, { blueprintId: bp.id, name, traits });
    return 1;
  }

  /** Breeders (and now and then others) scout and sign the talent with the best potential. */
  private scoutAndSign(user: User, rng: () => number) {
    const v = this.academy.view(user);
    if (v.rosterFull) return;
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

  /**
   * Incoming offers: accepted when the AI gets at least `min` × what it gives. Never for bots a
   * team made: they cannot be sold, and an AI paying for them would buy them like the market.
   */
  private answerTrades(user: User, min: number): number {
    let n = 0;
    const season = this.udt.season().number;
    for (const t of this.trades.list(user).open.filter((x) => x.incoming)) {
      try {
        const made = t.give.some((b) => this.udt.isOwnBot(season, b.botId));
        if (!made && t.giveValue >= t.takeValue * min) this.trades.accept(user, t.id);
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
      // Not for bots a team made (see answerTrades).
      const want = p.roster.find(
        (b) =>
          !b.blocked &&
          !b.homemade &&
          b.value > 0 &&
          Math.abs(b.value - give.value) <= give.value * 0.2,
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

/** The day halfway between two days (YYYY-MM-DD). */
function midpoint(a: string, b: string): string {
  const t = (Date.parse(`${a}T00:00:00Z`) + Date.parse(`${b}T00:00:00Z`)) / 2;
  return new Date(t).toISOString().slice(0, 10);
}
