/**
 * Dream Team league: several seasons with the league and keepers in the season simulator
 * (league plan L2, guard rails of `Plan-Liga-Technik`).
 *
 *   pnpm --filter @tourney/api udt:league-sim [export.db] [--seeds 30] [--seasons 5] [--cups 1]
 *
 * With an export (a copy of the website database, anonymised is fine) the bets come from its
 * settled bets and the library from its bot control center; without one the synthetic bets of
 * the calibrations (about half lost, wins 1.5-2.2x) and a library of 60 bots. Six managers
 * (saver, casual ×3, gambler, shark), every second one starts in the Pro Series.
 *
 * Variants: today (no league, no keepers), the league with two keepers (skill −1, no salary,
 * decision L-E7) and the league without keepers. Printed per variant: index at the season's
 * end, seasons at the index limit, money at the end, keepers' skill at the start of seasons 2
 * and 5, strike weeks, how often the cup king repeats, league wins of the managers against AI
 * clubs per half, human final four champions, table money and cup bonus.
 */
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  keeperSkill,
  pickKeepers,
  simulateSeason,
  valueScore,
  type SimBot,
  type SimResult,
  type Strategy,
} from '@tourney/udt';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    seeds: { type: 'string', default: '30' },
    seasons: { type: 'string', default: '5' },
    cups: { type: 'string', default: '1' },
  },
});
const seeds = Math.max(1, Number(values.seeds));
const seasons = Math.max(2, Number(values.seasons));
const cups = Math.max(1, Number(values.cups));

interface Data {
  multiples: number[];
  topMultiples: number[];
  winCaps: number[];
  library: SimBot[];
  source: string;
}

async function fromExport(file: string): Promise<Data> {
  const { createApi } = await import('../src/app.js');
  const { BetsService } = await import('../src/bets/bets.service.js');
  const { BotsService } = await import('../src/bots/bots.service.js');
  const { loadConfig } = await import('../src/config.js');
  const { SeasonsService } = await import('../src/seasons/seasons.service.js');
  type Settled = {
    userId: string;
    amount: number;
    payout: number;
    status: string;
    tournamentId: string;
    matchId: string;
    kind: string;
  };
  const dir = mkdtempSync(path.join(tmpdir(), 'udt-league-sim-'));
  copyFileSync(file, path.join(dir, 'tourney.db'));
  const quiet = { debug() {}, info() {}, warn() {}, error() {} };
  const api = await createApi(loadConfig({ PORT: '0', HOST: '127.0.0.1', DATA_DIR: dir }), {
    logger: quiet,
  });
  const bets = api.app.get(BetsService) as unknown as { settledSeason(n: number): Settled[] };
  const settled = api.app
    .get(SeasonsService)
    .list()
    .flatMap((s) => bets.settledSeason(s.number));
  const library = api.app
    .get(BotsService)
    .list()
    .filter((b) => !b.udtOwner)
    .map((b) => ({ id: b.id, name: b.gameName, skill: b.skill, score: valueScore(b.traits) }));
  await api.close();
  rmSync(dir, { recursive: true, force: true });
  const decided = settled.filter((b) => b.status === 'won' || b.status === 'lost');
  const by = new Map<string, Settled[]>();
  for (const b of decided) by.set(b.userId, [...(by.get(b.userId) ?? []), b]);
  const roi = [...by.values()]
    .filter((l) => l.length >= 10)
    .map((l) => ({
      l,
      r: l.reduce((a, b) => a + b.payout, 0) / l.reduce((a, b) => a + b.amount, 0),
    }))
    .sort((a, b) => a.r - b.r);
  const top = roi.slice(Math.floor(roi.length * 0.75)).flatMap((x) => x.l);
  const lost = new Map<string, number>();
  for (const b of decided)
    if (b.status === 'lost') {
      const k = `${b.tournamentId}/${b.matchId}/${b.kind}`;
      lost.set(k, (lost.get(k) ?? 0) + b.amount);
    }
  if (!decided.length || !library.length) throw new Error('the export has no settled bets or bots');
  return {
    multiples: decided.map((b) => b.payout / b.amount),
    topMultiples: (top.length ? top : decided).map((b) => b.payout / b.amount),
    winCaps: [...lost.values()],
    library,
    source: `${path.basename(file)} (${decided.length} bets, ${library.length} bots)`,
  };
}

function synthetic(): Data {
  return {
    multiples: [0, 0, 0, 0, 0, 1.5, 1.7, 1.9, 2.0, 2.2],
    topMultiples: [0, 0, 0, 0, 1.5, 1.7, 1.9, 2.0, 2.2, 2.2],
    winCaps: [150, 300, 500, 800, 1500],
    library: Array.from({ length: 60 }, (_, i) => ({
      id: `b${i}`,
      name: `Lib${i}`,
      skill: 1 + (i % 7),
      score: ((i * 7) % 11) / 10,
    })),
    source: 'synthetic bets, 60 bots',
  };
}

const data = positionals[0] ? await fromExport(positionals[0]) : synthetic();
const SIX: Strategy[] = ['saver', 'casual', 'casual', 'casual', 'gambler', 'shark'];

interface Variant {
  name: string;
  league: boolean;
  keepers: number;
}
const VARIANTS: Variant[] = [
  { name: 'today (no league, no keepers)', league: false, keepers: 0 },
  { name: 'league + 2 keepers (L-E7)', league: true, keepers: 2 },
  { name: 'league, no keepers', league: true, keepers: 0 },
];

const avg = (l: number[]) => l.reduce((a, b) => a + b, 0) / Math.max(1, l.length);
const median = (l: number[]) => {
  const a = [...l].sort((x, y) => x - y);
  return a.length ? a[a.length >> 1]! : 0;
};
const pct = (x: number) => `${Math.round(x * 100)} %`;

console.log(
  `Dream Team league: ${seeds} seeds × ${seasons} seasons, ${SIX.length} managers, ${cups} Daily Cup(s), ${data.source}`,
);
console.log(
  [
    'variant',
    'index end S1 / S2+',
    'at limit 5 (S2+)',
    'money end median',
    'keeper skill S2 / last',
    'strike weeks/mgr',
    'cup king repeats',
    'league wins vs AI 1st / 2nd half',
    'human champion',
    'league money/mgr',
    'cup bonus/mgr',
    'short league games/mgr',
  ].join(' | '),
);
for (const v of VARIANTS) {
  const idx1: number[] = [];
  const idx: number[] = [];
  let atLimit = 0;
  let runs = 0;
  const money: number[] = [];
  const keepFirst: number[] = [];
  const keepLast: number[] = [];
  const strikes: number[] = [];
  let kingRepeat = 0;
  let kingCases = 0;
  const firstHalf: [number, number] = [0, 0];
  const secondHalf: [number, number] = [0, 0];
  let humanChamp = 0;
  let champCases = 0;
  const leagueMoney: number[] = [];
  const cupBonus: number[] = [];
  const short: number[] = [];
  for (let s = 1; s <= seeds; s++) {
    let tierOf: number[] = SIX.map((_, i) => (i % 2 ? 0 : 1));
    let keepers: { skill: number; score: number; potential: number }[][] = SIX.map(() => []);
    let lastKing = -1;
    for (let season = 0; season < seasons; season++) {
      const r: SimResult = simulateSeason({
        managers: SIX,
        library: data.library,
        betMultiples: data.multiples,
        topMultiples: data.topMultiples,
        winCaps: data.winCaps,
        seed: s * 100 + season,
        dailyCups: cups,
        academy: { licence: (n) => 2000 * 2 ** (n - 1), blueprintSalary: 0.75 },
        keepers,
        ...(v.league
          ? {
              rosterTarget: (d: number) => (d < 17 ? 5 : 7),
              league: { tierOf, tiers: 2, size: 16 },
            }
          : {}),
      });
      const end = r.days.at(-1)!.index;
      if (season === 0) idx1.push(end);
      else {
        idx.push(end);
        runs++;
        if (end >= 4.99) atLimit++;
        money.push(...r.days.at(-1)!.managers.map((m) => m.cash));
        strikes.push(...r.totals.map((t) => t.strikes));
        const ks = keepers.flat().map((k) => k.skill);
        if (season === 1) keepFirst.push(ks.length ? avg(ks) : 0);
        if (season === seasons - 1) keepLast.push(ks.length ? avg(ks) : 0);
      }
      const points = r.totals.map((t) => t.cupPoints);
      const king = points.indexOf(Math.max(...points));
      if (lastKing >= 0) {
        kingCases++;
        if (king === lastKing) kingRepeat++;
      }
      lastKing = king;
      leagueMoney.push(...r.totals.map((t) => t.leagueMoney));
      cupBonus.push(...r.totals.map((t) => t.cupBonus));
      short.push(...r.totals.map((t) => t.shortGames));
      if (r.league) {
        for (const h of r.league.halves) {
          firstHalf[0] += h.first[0];
          firstHalf[1] += h.first[1];
          secondHalf[0] += h.second[0];
          secondHalf[1] += h.second[1];
        }
        champCases++;
        if (r.league.clubs.some((c) => c.final === 1 && c.manager)) humanChamp++;
        tierOf = SIX.map(
          (_, i) => r.league!.clubs.find((c) => c.manager === `${SIX[i]} ${i + 1}`)!.nextTier,
        );
      }
      keepers = (r.ownEnd ?? SIX.map(() => [])).map((own) =>
        pickKeepers(own, v.keepers).map((k) => ({ ...k, skill: keeperSkill(Math.round(k.skill)) })),
      );
    }
  }
  console.log(
    [
      v.name,
      `${avg(idx1).toFixed(2)} / ${avg(idx).toFixed(2)}`,
      `${atLimit}/${runs}`,
      Math.round(median(money)).toLocaleString('en'),
      v.keepers ? `${avg(keepFirst).toFixed(1)} / ${avg(keepLast).toFixed(1)}` : '-',
      avg(strikes).toFixed(2),
      pct(kingRepeat / Math.max(1, kingCases)),
      v.league
        ? `${pct(firstHalf[0] / Math.max(1, firstHalf[1]))} / ${pct(secondHalf[0] / Math.max(1, secondHalf[1]))}`
        : '-',
      v.league ? pct(humanChamp / Math.max(1, champCases)) : '-',
      Math.round(avg(leagueMoney)).toLocaleString('en'),
      Math.round(avg(cupBonus)).toLocaleString('en'),
      v.league ? avg(short).toFixed(1) : '-',
    ].join(' | '),
  );
}
