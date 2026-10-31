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
}

export interface TraitReport {
  /** Bot games (runs) with a trait log. */
  games: number;
  /** All bot games of these tournaments with a trait log: the baseline. */
  baseline: { games: number; won: number; kills: number; deaths: number };
  summary: TraitSummary[];
  rows: TraitReportRow[];
}

export function traitReport(all: readonly TournamentFacts[]): TraitReport {
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
  return { games: baseline.games, baseline, summary, rows };
}
