/**
 * Season simulator for calibrating the Dream Team economy: managers with different habits bet,
 * buy bots on the daily market (first come, first served), pay salaries and play the season's events. Betting outcomes
 * are drawn from real settled bets (payout / stake), so the wealth curves follow the website's
 * betting. Deterministic for a seed.
 */
import {
  DEFAULT_ECONOMY,
  baseValue,
  bracketOf,
  buyPrice,
  demandFactor,
  economyIndex,
  formFactor,
  marketValue,
  matchReward,
  placeReward,
  sellPrice,
  staminaAfterGames,
  staminaRecovered,
  packPrice,
  rollBox,
  weeklySalary,
  type EconomyConfig,
  type Pity,
  type Rarity,
} from './economy.js';
import {
  BLUEPRINT_CHANCE,
  BLUEPRINTS,
  BLUEPRINTS_MAX,
  blueprintPotential,
  blueprintRarity,
  developPoints,
} from './academy.js';
import { levelOf } from './traits.js';
import { SKILL_STRENGTH as STRENGTH, gameChance } from './model.js';

export interface SimBot {
  id: string;
  name: string;
  skill: number;
  /** Value score 0..1 (see valueScore). */
  score: number;
}

export type Strategy = 'saver' | 'casual' | 'gambler' | 'shark';

interface StrategyParams {
  betsPerDay: number;
  /** Share of the balance staked per bet. */
  stake: number;
  /** Bets drawn from all bettors or from the best quarter. */
  sample: 'all' | 'top';
  /** Share of the money above the reserve spent on one bot. */
  spend: number;
}

export const STRATEGIES: Readonly<Record<Strategy, StrategyParams>> = {
  saver: { betsPerDay: 0, stake: 0, sample: 'all', spend: 0.6 },
  casual: { betsPerDay: 4, stake: 0.08, sample: 'all', spend: 0.5 },
  gambler: { betsPerDay: 18, stake: 0.25, sample: 'all', spend: 0.8 },
  shark: { betsPerDay: 18, stake: 0.15, sample: 'top', spend: 0.7 },
};

export interface SimOptions {
  days?: number;
  managers: readonly Strategy[];
  library: readonly SimBot[];
  /** Payout / stake of real decided bets (0 = lost). */
  betMultiples: readonly number[];
  /** The same for the best quarter of the bettors. */
  topMultiples: readonly number[];
  /**
   * What the losing side of real matches had staked: a win cannot bring more than the others
   * lost (pari-mutuel). Missing = no limit.
   */
  winCaps?: readonly number[];
  seed?: number;
  cfg?: EconomyConfig;
  startBalance?: number;
  floor?: number;
  offersPerDay?: number;
  /** Strength of the starter bot (the creation budget reaches about this skill). */
  starterSkill?: number;
  /** Daily Cups (1v1) per day; more make stamina (and rest) matter. Default 1. */
  dailyCups?: number;
  /**
   * Own bots from blueprints (off without): managers open standard boxes, a box brings a
   * blueprint by `BLUEPRINT_CHANCE`, a build needs a licence; own bots (and the starter) gain
   * experience and develop up to their potential.
   */
  academy?: SimAcademy;
}

export interface SimAcademy {
  /**
   * Reference price (index 1) of the licence for the `made`-th own bot of the season (the
   * starter is the first, so `made` starts at 1); null: no more licences.
   */
  licence: (made: number) => number | null;
  /** Blueprint bots draw this share of a bought bot's salary (0: none, as today). */
  blueprintSalary: number;
  /** Standard boxes per week by habit (default saver 1, casual 2, gambler 4, shark 3). */
  boxesPerWeek?: Partial<Record<Strategy, number>>;
}

export interface ManagerDay {
  strategy: Strategy;
  cash: number;
  rosterValue: number;
  roster: number;
  bestSkill: number;
}

export interface SimDay {
  day: number;
  index: number;
  medianNet: number;
  topNet: number;
  managers: ManagerDay[];
}

export interface SimEvent {
  day: number;
  name: string;
  teamSize: number;
  humans: number;
  winner: string;
}

export interface SimResult {
  days: SimDay[];
  events: SimEvent[];
  /** Neuro created by rescues (balance below the floor). */
  rescued: number;
  /** Totals per manager over the season. */
  totals: {
    strategy: Strategy;
    betProfit: number;
    rewards: number;
    salaries: number;
    bought: number;
    titles: number;
    /** Neuro spent on rest (stamina bought before events). */
    rested: number;
    /** Bot-weeks on strike (salary not paid). */
    strikes: number;
    /** Academy: boxes bought, blueprints found, bots built, Neuro on boxes / licences / own salaries. */
    boxes: number;
    blueprints: number;
    built: number;
    boxSpend: number;
    licences: number;
    ownSalaries: number;
    /** Own bots (built, not the starter) in the roster at the season's end and their best skill. */
    ownAtEnd: number;
    ownBestSkill: number;
    finalNet: number;
    firstStrong: number | null;
    first5v5: number | null;
  }[];
}

function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Owned {
  bot: SimBot;
  price: number;
  stamina: number;
  starter: boolean;
  striking: boolean;
  /** Made by the team (academy): no market sale, develops with experience. */
  own?: { xp: number; spent: number; potential: number };
}

interface Manager {
  name: string;
  strategy: Strategy;
  p: StrategyParams;
  cash: number;
  roster: Owned[];
  t: SimResult['totals'][number];
  blueprints: Rarity[];
  pity: Pity;
  made: number;
}

interface Team {
  name: string;
  manager?: Manager;
  bots: Owned[];
  strength: number;
}

const EVENTS: {
  name: string;
  teamSize: number;
  days: readonly number[];
  cap?: number;
  stars?: number;
}[] = [
  { name: 'Daily Cup', teamSize: 1, days: [0, 1, 2, 3, 4, 5, 6], cap: 3000, stars: 0 },
  { name: 'Mid Cup', teamSize: 2, days: [0, 2, 4], stars: 1 },
  { name: 'Weekend Open', teamSize: 5, days: [5] },
];

export function simulateSeason(o: SimOptions): SimResult {
  const cfg = o.cfg ?? DEFAULT_ECONOMY;
  const days = o.days ?? 42;
  const floor = o.floor ?? 100;
  const rng = rngOf(o.seed ?? 1);
  const pick = <T>(l: readonly T[]): T => l[Math.floor(rng() * l.length)]!;
  const owner = new Map<string, Manager>();
  const games = new Map<string, { games: number; wins: number }>();
  /** Market sales per bracket on the last market day (the demand). */
  let sales = new Map<string, number>();
  const unsold = new Map<string, number>();
  let index = economyIndex([], undefined, cfg);
  let rescued = 0;

  const value = (b: SimBot) => {
    const g = games.get(b.id) ?? { games: 0, wins: 0 };
    return marketValue(
      baseValue(b.skill, b.score, cfg),
      formFactor(g, cfg),
      demandFactor(sales.get(bracketOf(b.skill)) ?? 0, unsold.get(b.id) ?? 0, cfg),
      index,
    );
  };
  const strength = (x: Owned) =>
    STRENGTH[Math.round(Math.min(7, Math.max(0, x.bot.skill)))]! *
    (0.85 + 0.3 * x.bot.score) *
    (x.stamina < cfg.stamina.tiredBelow ? 0.85 : 1);
  const rosterValue = (m: Manager) =>
    m.roster.reduce((s, x) => s + (x.starter ? 0 : value(x.bot)), 0);
  const net = (m: Manager) => m.cash + rosterValue(m);
  // The index uses what the roster cost (book value): with today's market values the index
  // would push itself up (higher index -> higher values -> higher net worth -> higher index).
  const bookNet = (m: Manager) => m.cash + m.roster.reduce((s, x) => s + x.price, 0);
  const rescue = (m: Manager) => {
    if (m.cash < floor) {
      rescued += floor - m.cash;
      m.cash = floor;
    }
  };

  const managers: Manager[] = o.managers.map((strategy, i) => ({
    name: `${strategy} ${i + 1}`,
    strategy,
    p: STRATEGIES[strategy],
    cash: o.startBalance ?? 1000,
    roster: [
      {
        bot: {
          id: `starter-${i}`,
          name: `Starter ${i + 1}`,
          skill: o.starterSkill ?? 3,
          score: 0.5,
        },
        price: 0,
        stamina: 100,
        starter: true,
        striking: false,
        ...(o.academy
          ? { own: { xp: 0, spent: 0, potential: Math.min(7, (o.starterSkill ?? 3) + 2) } }
          : {}),
      },
    ],
    blueprints: [],
    pity: { sinceEpic: 0, sinceLegendary: 0 },
    made: 1,
    t: {
      strategy,
      betProfit: 0,
      rewards: 0,
      salaries: 0,
      bought: 0,
      titles: 0,
      rested: 0,
      strikes: 0,
      boxes: 0,
      blueprints: 0,
      built: 0,
      boxSpend: 0,
      licences: 0,
      ownSalaries: 0,
      ownAtEnd: 0,
      ownBestSkill: 0,
      finalNet: 0,
      firstStrong: null,
      first5v5: null,
    },
  }));

  const out: SimResult = { days: [], events: [], rescued: 0, totals: [] };
  let offers: SimBot[] = [];

  for (let day = 0; day < days; day++) {
    const weekday = day % 7; // 0 = Monday

    // --- Market day (04:00): index, values, salaries, new offers at fixed prices.
    index = economyIndex(managers.map(bookNet), day === 0 ? undefined : index, cfg);
    if (day > 0) {
      for (const b of offers) if (!owner.has(b.id)) unsold.set(b.id, (unsold.get(b.id) ?? 0) + 1);
      if (weekday === 0) {
        for (const m of managers) {
          for (const x of m.roster) {
            if (x.starter) continue;
            const s = salaryOf(x);
            if (s <= 0) continue;
            if (m.cash - s >= floor) {
              m.cash -= s;
              m.t.salaries += s;
              if (x.own) m.t.ownSalaries += s;
              x.striking = false;
            } else {
              x.striking = true;
              m.t.strikes++;
            }
          }
        }
      }
    }
    const free = o.library.filter((b) => !owner.has(b.id));
    offers = [];
    const pool = [...free];
    for (let i = 0; i < (o.offersPerDay ?? 8) && pool.length; i++)
      offers.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!);
    const prices = new Map(offers.map((b) => [b.id, buyPrice(value(b), b.skill, cfg)]));

    // --- Buying during the day: the managers come in a random order, the first one gets it.
    const sold = new Map<string, number>();
    for (const m of shuffle(managers)) {
      for (const b of [...offers].sort((x, y) => strengthOf(y) - strengthOf(x))) {
        if (owner.has(b.id)) continue;
        const price = prices.get(b.id)!;
        if (!wants(m, day, b, price)) continue;
        m.cash -= price;
        m.t.bought += price;
        m.roster.push({ bot: b, price, stamina: 100, starter: false, striking: false });
        owner.set(b.id, m);
        unsold.delete(b.id);
        sold.set(bracketOf(b.skill), (sold.get(bracketOf(b.skill)) ?? 0) + 1);
        upgrade(m);
      }
    }
    sales = sold;
    if (o.academy) for (const m of shuffle(managers)) academyDay(m, day, o.academy);

    // --- Betting during the day.
    for (const m of managers) {
      for (let i = 0; i < m.p.betsPerDay; i++) {
        const stake = Math.floor(m.cash * m.p.stake);
        if (stake < 10) break;
        const mult = pick(m.p.sample === 'top' ? o.topMultiples : o.betMultiples);
        let payout = Math.floor(stake * mult);
        if (payout > stake && o.winCaps?.length) payout = Math.min(payout, stake + pick(o.winCaps));
        m.cash += payout - stake;
        m.t.betProfit += payout - stake;
        rescue(m);
      }
    }

    // --- Events.
    for (const ev of EVENTS) {
      if (!ev.days.includes(weekday)) continue;
      const times = ev.teamSize === 1 ? Math.max(1, o.dailyCups ?? 1) : 1;
      for (let i = 0; i < times; i++) playEvent(ev, day);
    }

    // --- Rest.
    for (const m of managers)
      for (const x of m.roster) x.stamina = staminaRecovered(x.stamina, 1, cfg);

    const nets = managers.map(net).sort((a, b) => a - b);
    out.days.push({
      day,
      index,
      medianNet: nets[nets.length >> 1] ?? 0,
      topNet: nets[nets.length - 1] ?? 0,
      managers: managers.map((m) => ({
        strategy: m.strategy,
        cash: m.cash,
        rosterValue: rosterValue(m),
        roster: m.roster.length,
        bestSkill: Math.max(...m.roster.map((x) => x.bot.skill)),
      })),
    });
    for (const m of managers) {
      if (m.t.firstStrong === null && m.roster.some((x) => bracketOf(x.bot.skill) === 'strong'))
        m.t.firstStrong = day;
    }
  }

  out.rescued = rescued;
  out.totals = managers.map((m) => {
    const own = m.roster.filter((x) => x.own && !x.starter);
    return {
      ...m.t,
      ownAtEnd: own.length,
      ownBestSkill: own.length ? Math.max(...own.map((x) => x.bot.skill)) : 0,
      finalNet: net(m),
    };
  });
  return out;

  /** Weekly salary of a roster bot: bought ones in full, blueprint bots by the share. */
  function salaryOf(x: Owned): number {
    if (x.starter) return 0;
    const full = weeklySalary(value(x.bot), x.bot.skill, cfg);
    return x.own ? Math.round(full * (o.academy?.blueprintSalary ?? 0)) : full;
  }

  /** Boxes (blueprints) and builds of a manager on a day. */
  function academyDay(m: Manager, day: number, a: SimAcademy) {
    const per = { saver: 1, casual: 2, gambler: 4, shark: 3, ...a.boxesPerWeek }[m.strategy];
    // Boxes spread over the week (deterministic share of the weekly number).
    const boxes = Math.floor((((day % 7) + 1) * per) / 7) - Math.floor(((day % 7) * per) / 7);
    const salaries = m.roster.reduce((s, x) => s + salaryOf(x), 0);
    for (let i = 0; i < boxes; i++) {
      const price = packPrice('standard', index, false, cfg);
      if ((m.cash - floor - 2 * salaries) * m.p.spend < price) break;
      m.cash -= price;
      m.t.boxSpend += price;
      m.t.boxes++;
      const r = rollBox('standard', m.pity, rng, cfg);
      m.pity = r.pity;
      if (rng() < BLUEPRINT_CHANCE && m.blueprints.length < BLUEPRINTS_MAX) {
        m.blueprints.push(blueprintRarity(r.rarity));
        m.t.blueprints++;
      }
    }
    // Build the best blueprint when a licence is affordable and there is room (a full roster
    // sells its weakest bought bot when the new one will be stronger at its potential).
    m.blueprints.sort((x, y) => BLUEPRINTS[y].extra - BLUEPRINTS[x].extra);
    const rarity = m.blueprints[0];
    if (!rarity) return;
    const ref = a.licence(m.made);
    if (ref === null) return;
    const licence = Math.round(ref * index);
    const rule = BLUEPRINTS[rarity];
    const potential = blueprintPotential(rarity, rng);
    const score = scoreFor(rule.skill, rule.budget);
    const bot: SimBot = { id: `own-${m.name}-${m.made}`, name: 'own', skill: rule.skill, score };
    const future = STRENGTH[potential]! * (0.85 + 0.3 * score);
    const newSalary = Math.round(
      weeklySalary(baseValue(rule.skill, score, cfg) * index, rule.skill, cfg) * a.blueprintSalary,
    );
    if ((m.cash - floor - 2 * (salaries + newSalary)) * m.p.spend < licence) return;
    if (m.roster.length >= 7) {
      const sellable = m.roster.filter((x) => !x.starter && !x.own);
      if (!sellable.length) return;
      const worst = sellable.reduce((w, x) => (strength(x) < strength(w) ? x : w), sellable[0]!);
      if (strength(worst) * 1.2 > future) return;
      m.cash += Math.min(sellPrice(value(worst.bot), cfg), worst.price);
      m.roster = m.roster.filter((x) => x !== worst);
      owner.delete(worst.bot.id);
    }
    m.blueprints.shift();
    m.cash -= licence;
    m.t.licences += licence;
    m.t.built++;
    m.made++;
    m.roster.push({
      bot,
      price: licence,
      stamina: 100,
      starter: false,
      striking: false,
      own: { xp: 0, spent: 0, potential },
    });
  }

  /** The value score a build reaches with the blueprint's points at its skill. */
  function scoreFor(skill: number, budget: number): number {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (baseValue(skill, mid, cfg) <= budget) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** Experience after a game; points go into the skill (3) up to the potential, else accuracy. */
  function gainXp(x: Owned, won: boolean) {
    if (!x.own) return;
    x.own.xp += 10 + (won ? 15 : 0);
    let points = developPoints(levelOf(x.own.xp), x.own.spent);
    while (points >= 3 && Math.round(x.bot.skill) < x.own.potential) {
      x.bot = { ...x.bot, skill: x.bot.skill + 1 };
      x.own.spent += 3;
      points -= 3;
    }
    // At the potential the points go into the values (accuracy weighs most).
    if (Math.round(x.bot.skill) >= x.own.potential)
      while (points >= 1 && x.bot.score < 1) {
        x.bot = { ...x.bot, score: Math.min(1, x.bot.score + 0.0275) };
        x.own.spent += 1;
        points -= 1;
      }
  }

  // Whether a manager buys an offer at its price: fills the roster towards its target size,
  // keeps a reserve of two weeks of salaries.
  function wants(m: Manager, day: number, b: SimBot, price: number): boolean {
    const target = day < 3 ? 2 : day < 10 ? 3 : day < 17 ? 5 : 7;
    const salaries = m.roster.reduce(
      (s, x) => s + (x.starter ? 0 : weeklySalary(value(x.bot), x.bot.skill, cfg)),
      0,
    );
    const reserve = floor + 2 * (salaries + weeklySalary(price, b.skill, cfg));
    const budget = (m.cash - reserve) * m.p.spend;
    const weakest = Math.min(...m.roster.map((x) => strength(x)));
    const fits =
      m.roster.length < target || (m.roster.length >= 7 && strengthOf(b) > weakest * 1.3);
    return fits && price <= budget;
  }

  function strengthOf(b: SimBot) {
    return STRENGTH[Math.round(b.skill)]! * (0.85 + 0.3 * b.score);
  }

  // Roster above 7: the weakest non-starter bot is sold to the market.
  function upgrade(m: Manager) {
    while (m.roster.length > 7) {
      const sellable = m.roster.filter((x) => !x.starter);
      const worst = sellable.reduce((w, x) => (strength(x) < strength(w) ? x : w), sellable[0]!);
      // 85 % of the value, at most what it cost (decision 195).
      m.cash += Math.min(sellPrice(value(worst.bot), cfg), worst.price);
      m.roster = m.roster.filter((x) => x !== worst);
      owner.delete(worst.bot.id);
    }
  }

  function lineup(m: Manager, ev: (typeof EVENTS)[number]): Owned[] | null {
    const cap = ev.cap === undefined ? Infinity : ev.cap * index;
    const fit = m.roster
      .filter((x) => !x.striking && x.stamina > 0)
      .sort((a, b) => strength(b) - strength(a));
    const team: Owned[] = [];
    let stars = 0;
    let total = 0;
    for (const x of fit) {
      if (team.length >= ev.teamSize) break;
      const v = x.starter ? 0 : value(x.bot);
      const star = bracketOf(x.bot.skill) === 'strong';
      if (ev.stars !== undefined && star && stars >= ev.stars) continue;
      if (total + v > cap) continue;
      team.push(x);
      total += v;
      if (star) stars++;
    }
    return team.length === ev.teamSize ? team : null;
  }

  // Before an event: tired bots of the lineup are rested with Neuro when it is cheap for the
  // manager (at most a tenth of the money above the reserve per bot); savers never pay for it.
  function rest(m: Manager, team: readonly Owned[]) {
    if (m.strategy === 'saver') return;
    for (const x of team) {
      if (x.stamina >= cfg.stamina.tiredBelow) continue;
      const cost = (100 - x.stamina) * cfg.restPrice;
      if (cost > (m.cash - floor) * 0.1) continue;
      m.cash -= cost;
      m.t.rested += cost;
      x.stamina = 100;
    }
  }

  function playEvent(ev: (typeof EVENTS)[number], day: number) {
    const teams: Team[] = [];
    for (const m of managers) {
      const bots = lineup(m, ev);
      if (bots) rest(m, bots);
      if (!bots) continue;
      teams.push({
        name: m.name,
        manager: m,
        bots,
        strength: bots.reduce((s, x) => s + strength(x), 0),
      });
      if (ev.teamSize === 5 && m.t.first5v5 === null) m.t.first5v5 = day;
    }
    const humans = teams.length;
    if (!humans) return;
    // Base bots: free library bots, a random mix.
    const free = o.library.filter((b) => !owner.has(b.id));
    let n = 0;
    while (teams.length < 8 && free.length >= ev.teamSize) {
      const bots: Owned[] = [];
      for (let i = 0; i < ev.teamSize; i++) {
        const b = free.splice(Math.floor(rng() * free.length), 1)[0]!;
        bots.push({ bot: b, price: 0, stamina: 100, starter: false, striking: false });
      }
      teams.push({
        name: `Bots ${++n}`,
        bots,
        strength: bots.reduce((s, x) => s + strength(x), 0),
      });
    }
    const onlyBase = humans === 1;
    let round = shuffle(teams);
    const placeOf = new Map<Team, number>();
    while (round.length > 1) {
      const next: Team[] = [];
      for (let i = 0; i < round.length; i += 2) {
        const a = round[i]!;
        const b = round[i + 1];
        if (!b) {
          next.push(a);
          continue;
        }
        // The calibrated game model (model.ts): k = 3 in 1v1, 4.5 in teams.
        const pa = gameChance(a.strength, b.strength, ev.teamSize);
        const [w, l] = rng() < pa ? [a, b] : [b, a];
        for (const t of [w, l]) {
          for (const x of t.bots) {
            const g = games.get(x.bot.id) ?? { games: 0, wins: 0 };
            g.games++;
            if (t === w) g.wins++;
            games.set(x.bot.id, g);
            x.stamina = staminaAfterGames(x.stamina, 1, cfg);
            gainXp(x, t === w);
          }
          if (t.manager) {
            const other = t === w ? l : w;
            const r = matchReward(
              {
                won: t === w,
                mvp: t === w && rng() < 0.7,
                teamSize: ev.teamSize,
                vsBaseBots: !other.manager,
              },
              index,
              cfg,
            );
            t.manager.cash += r;
            t.manager.t.rewards += r;
          }
        }
        placeOf.set(l, round.length <= 2 ? 2 : round.length <= 4 ? 3 : 5);
        next.push(w);
      }
      round = next;
    }
    const champ = round[0]!;
    placeOf.set(champ, 1);
    for (const [t, place] of placeOf) {
      if (!t.manager) continue;
      const r = placeReward(place, ev.teamSize, index, onlyBase, cfg);
      t.manager.cash += r;
      t.manager.t.rewards += r;
      if (place === 1) t.manager.t.titles++;
    }
    out.events.push({ day, name: ev.name, teamSize: ev.teamSize, humans, winner: champ.name });
  }

  function shuffle<T>(l: readonly T[]): T[] {
    const a = [...l];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }
}
