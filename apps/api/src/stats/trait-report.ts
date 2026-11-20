import { traitByMod, traitLogKind, type TraitLogKind } from '@tourney/udt';
import type { TournamentFacts } from './facts.js';

/**
 * Trait report (pure, decision 237): what the Dream Team traits did in the games of a season,
 * from the trait log of mod 0.17.0 in the player statistics. One row per bot, game (run) and
 * trait for the review, and a summary per trait with the games of the bots without it as the
 * baseline.
 */

export interface TraitReportRow {
  tournamentId: string;
  tournament: string;
  matchId: string;
  game: number;
  run: number;
  map: string;
  at: string;
  bot: string;
  /** The skill (0 Novice … 7 Godlike) the bot played with: the strongest confounder. */
  skill: number | null;
  /** The bot's traits in this game (all of them: traits come in combinations). */
  with: string;
  /** Website trait code (mod code when unknown). */
  trait: string;
  rarity: string;
  kind: TraitLogKind | 'unknown';
  uses: number;
  sec: number;
  kills: number;
  deaths: number;
  value: number;
  value2: number;
  episodes: number;
  /** Episodes that ended with the bot's death, with at least one kill, with neither. */
  episodesDied: number;
  episodesKill: number;
  episodesQuiet: number;
  /** The bot in the whole game (run). */
  botKills: number;
  botDeaths: number;
  won: boolean;
  /**
   * Trait lab (decision 251): an AI manager's or AI club's bot - its traits were drawn at
   * random, not chosen (from season 3; compare these rows on their own).
   */
  lab: boolean;
}

export interface TraitSummary {
  trait: string;
  rarity: string;
  kind: TraitLogKind | 'unknown';
  bots: number;
  games: number;
  uses: number;
  sec: number;
  kills: number;
  deaths: number;
  value: number;
  value2: number;
  episodes: number;
  episodesDied: number;
  episodesKill: number;
  episodesQuiet: number;
  /** Bots with the trait: games won, frags and deaths in those games. */
  won: number;
  botKills: number;
  botDeaths: number;
  /** Average skill of the bots in those games (null: unknown). */
  avgSkill: number | null;
  /** Of `games`: bot games of the trait lab (AI managers and AI clubs). */
  labGames: number;
}

/**
 * Measures of every bot (mod 0.19.0, decision 257) summed per skill: weapon switches, the time
 * from a switch in a fight to the next shot, the enforcer in fights, retreats by the health at
 * their start and their end, power items and how long they had waited, suicides.
 */
export interface MeasureSkillRow {
  skill: number | null;
  /** Bot games (runs) with measures, their minutes, deaths and suicides. */
  games: number;
  minutes: number;
  deaths: number;
  suicides: number;
  switches: number;
  fightSwitches: number;
  shotAfter: number;
  /** Mean seconds from a switch in a fight to the next shot (null: none). */
  shotAfterSec: number | null;
  fightSec: number;
  enforcerSec: number;
  retreatHighKill: number;
  retreatHighDeath: number;
  retreatHighNone: number;
  retreatMidKill: number;
  retreatMidDeath: number;
  retreatMidNone: number;
  retreatLowKill: number;
  retreatLowDeath: number;
  retreatLowNone: number;
  itemsTaken: number;
  itemsWaitSec: number;
  itemsQuick: number;
}

/** Suicides by map and damage type (falls, kill zones, own weapons), with the bots' deaths. */
export interface MeasureMapRow {
  map: string;
  damageType: string;
  count: number;
  /** All deaths of the bots with measures on that map. */
  deaths: number;
}

export interface MeasureReport {
  bySkill: MeasureSkillRow[];
  byMap: MeasureMapRow[];
}

export interface TraitReport {
  /** Bot games (runs) with a trait log. */
  games: number;
  /** All bot games of these tournaments with a trait log: the baseline. */
  baseline: { games: number; won: number; kills: number; deaths: number };
  summary: TraitSummary[];
  rows: TraitReportRow[];
  /** Mod 0.19.0: measures of every bot (decision 257). */
  measures: MeasureReport;
}

export function traitReport(
  all: readonly TournamentFacts[],
  /** Entrants of the trait lab (AI managers, AI clubs). */
  lab: (entrantId: string) => boolean = () => false,
): TraitReport {
  const rows: TraitReportRow[] = [];
  const baseline = { games: 0, won: 0, kills: 0, deaths: 0 };
  for (const t of all)
    for (const p of t.players) {
      const s = p.stats;
      if (!p.bot || !s?.traits?.length) continue;
      baseline.games++;
      if (p.won) baseline.won++;
      const kills = t.mode === 'mh' ? s.monsters : s.kills;
      baseline.kills += kills;
      baseline.deaths += s.deaths;
      const names = s.traits.map((x) => traitByMod(x.code)?.code ?? x.code);
      for (const x of s.traits) {
        const def = traitByMod(x.code);
        const eps = x.episodes ?? [];
        rows.push({
          tournamentId: t.tournamentId,
          tournament: t.name,
          matchId: p.matchId,
          game: p.game,
          run: p.run,
          map: p.map,
          at: p.at,
          bot: p.name,
          skill: p.skill ?? null,
          with: names.join(' + '),
          trait: def?.code ?? x.code,
          rarity: def?.rarity ?? '',
          kind: def ? traitLogKind(def.code) : 'unknown',
          uses: x.uses,
          sec: x.sec,
          kills: x.kills,
          deaths: x.deaths,
          value: x.value,
          value2: x.value2,
          episodes: eps.length,
          episodesDied: eps.filter((e) => e.died).length,
          episodesKill: eps.filter((e) => !e.died && e.kills > 0).length,
          episodesQuiet: eps.filter((e) => !e.died && !e.kills).length,
          botKills: kills,
          botDeaths: s.deaths,
          won: p.won,
          lab: lab(p.entrantId),
        });
      }
    }
  const by = new Map<string, { s: TraitSummary; bots: Set<string>; skills: number[] }>();
  for (const r of rows) {
    let x = by.get(r.trait);
    if (!x) {
      x = {
        bots: new Set(),
        skills: [],
        s: {
          trait: r.trait,
          rarity: r.rarity,
          kind: r.kind,
          bots: 0,
          games: 0,
          uses: 0,
          sec: 0,
          kills: 0,
          deaths: 0,
          value: 0,
          value2: 0,
          episodes: 0,
          episodesDied: 0,
          episodesKill: 0,
          episodesQuiet: 0,
          won: 0,
          botKills: 0,
          botDeaths: 0,
          avgSkill: null,
          labGames: 0,
        },
      };
      by.set(r.trait, x);
    }
    const s = x.s;
    x.bots.add(r.bot.toLowerCase());
    if (r.skill !== null) x.skills.push(r.skill);
    s.games++;
    s.uses += r.uses;
    s.sec += r.sec;
    s.kills += r.kills;
    s.deaths += r.deaths;
    s.value += r.value;
    s.value2 += r.value2;
    s.episodes += r.episodes;
    s.episodesDied += r.episodesDied;
    s.episodesKill += r.episodesKill;
    s.episodesQuiet += r.episodesQuiet;
    if (r.won) s.won++;
    if (r.lab) s.labGames++;
    s.botKills += r.botKills;
    s.botDeaths += r.botDeaths;
  }
  const summary = [...by.values()]
    .map(({ s, bots, skills }) => ({
      ...s,
      bots: bots.size,
      avgSkill: skills.length
        ? Math.round((skills.reduce((a, b) => a + b, 0) / skills.length) * 10) / 10
        : null,
    }))
    .sort((a, b) => b.games - a.games || a.trait.localeCompare(b.trait));
  return { games: baseline.games, baseline, summary, rows, measures: measureReport(all) };
}

/** The measures of every bot (mod 0.19.0) per skill, and suicides per map and damage type. */
export function measureReport(all: readonly TournamentFacts[]): MeasureReport {
  const skills = new Map<number | null, MeasureSkillRow & { ds: number }>();
  const deathsOn = new Map<string, number>();
  const selfKills = new Map<string, number>();
  for (const t of all)
    for (const p of t.players) {
      const m = p.stats?.measures;
      if (!p.bot || !m || !p.stats) continue;
      const key = p.skill ?? null;
      let r = skills.get(key);
      if (!r) {
        r = {
          skill: key,
          games: 0,
          minutes: 0,
          deaths: 0,
          suicides: 0,
          switches: 0,
          fightSwitches: 0,
          shotAfter: 0,
          shotAfterSec: null,
          fightSec: 0,
          enforcerSec: 0,
          retreatHighKill: 0,
          retreatHighDeath: 0,
          retreatHighNone: 0,
          retreatMidKill: 0,
          retreatMidDeath: 0,
          retreatMidNone: 0,
          retreatLowKill: 0,
          retreatLowDeath: 0,
          retreatLowNone: 0,
          itemsTaken: 0,
          itemsWaitSec: 0,
          itemsQuick: 0,
          ds: 0,
        };
        skills.set(key, r);
      }
      r.games++;
      r.minutes += p.stats.timeSec / 60;
      r.deaths += p.stats.deaths;
      r.suicides += p.stats.suicides;
      r.switches += m.switches;
      r.fightSwitches += m.fightSwitches;
      r.shotAfter += m.shotAfter;
      r.ds += m.shotAfterDs;
      r.fightSec += m.fightSec;
      r.enforcerSec += m.enforcerSec;
      r.retreatHighKill += m.retreats.high.kill;
      r.retreatHighDeath += m.retreats.high.death;
      r.retreatHighNone += m.retreats.high.none;
      r.retreatMidKill += m.retreats.mid.kill;
      r.retreatMidDeath += m.retreats.mid.death;
      r.retreatMidNone += m.retreats.mid.none;
      r.retreatLowKill += m.retreats.low.kill;
      r.retreatLowDeath += m.retreats.low.death;
      r.retreatLowNone += m.retreats.low.none;
      r.itemsTaken += m.items.taken;
      r.itemsWaitSec += m.items.waitSec;
      r.itemsQuick += m.items.quick;
      deathsOn.set(p.map, (deathsOn.get(p.map) ?? 0) + p.stats.deaths);
      for (const [d, n] of Object.entries(p.stats.selfKills ?? {}))
        selfKills.set(`${p.map}\n${d}`, (selfKills.get(`${p.map}\n${d}`) ?? 0) + n);
    }
  const bySkill = [...skills.values()]
    .map(({ ds, ...r }) => ({
      ...r,
      minutes: Math.round(r.minutes * 10) / 10,
      shotAfterSec: r.shotAfter ? Math.round(ds / r.shotAfter) / 10 : null,
    }))
    .sort((a, b) => (a.skill ?? -1) - (b.skill ?? -1));
  const byMap = [...selfKills.entries()]
    .map(([k, count]) => {
      const [map, damageType] = k.split('\n') as [string, string];
      return { map, damageType, count, deaths: deathsOn.get(map) ?? 0 };
    })
    .sort((a, b) => a.map.localeCompare(b.map) || b.count - a.count);
  return { bySkill, byMap };
}
