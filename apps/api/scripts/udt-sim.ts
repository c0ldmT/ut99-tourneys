/**
 * Unreal Dream Team: season simulator on real betting data (calibration of the economy).
 *
 *   pnpm --filter @tourney/api udt:sim <export.db> [--out report.html] [--seeds 30] [--days 42]
 *     [--managers saver,casual,casual,gambler,gambler,shark,shark,casual]
 *
 * The export is a copy of the website database (anonymised is fine). It is copied to a temporary
 * folder first (the API migrates the copy, the file given stays untouched). The settled bets of
 * all seasons give the payout / stake samples, the bot control center the library of bots.
 */
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  DEFAULT_ECONOMY,
  baseValue,
  simulateSeason,
  valueScore,
  type SimBot,
  type SimResult,
  type Strategy,
} from '@tourney/udt';
import { createApi } from '../src/app.js';
import { BetsService } from '../src/bets/bets.service.js';
import type { SettledBet } from '../src/bets/betting.js';
import { BotsService } from '../src/bots/bots.service.js';
import { loadConfig } from '../src/config.js';
import { SeasonsService } from '../src/seasons/seasons.service.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', default: 'udt-sim-report.html' },
    seeds: { type: 'string', default: '30' },
    days: { type: 'string', default: '42' },
    managers: { type: 'string', default: 'saver,casual,casual,casual,gambler,gambler,shark,shark' },
  },
});
const file = positionals[0];
if (!file) {
  console.error(
    'usage: udt-sim <export.db> [--out report.html] [--seeds 30] [--days 42] [--managers ...]',
  );
  process.exit(2);
}
const managers = values.managers.split(',').map((s) => s.trim()) as Strategy[];
const seeds = Math.max(1, Number(values.seeds));
const days = Math.max(7, Number(values.days));

// --- Real data -------------------------------------------------------------------------------
const dir = mkdtempSync(path.join(tmpdir(), 'udt-sim-'));
copyFileSync(file, path.join(dir, 'tourney.db'));
const quiet = { debug() {}, info() {}, warn() {}, error() {} };
const api = await createApi(loadConfig({ PORT: '0', HOST: '127.0.0.1', DATA_DIR: dir }), {
  logger: quiet,
});
const bets = api.app.get(BetsService) as unknown as { settledSeason(n: number): SettledBet[] };
const seasons = api.app.get(SeasonsService).list();
const settled = seasons.flatMap((s) => bets.settledSeason(s.number));
const library: SimBot[] = api.app
  .get(BotsService)
  .list()
  .map((b) => ({ id: b.id, name: b.gameName, skill: b.skill, score: valueScore(b.traits) }));
await api.close();
rmSync(dir, { recursive: true, force: true });

const decided = settled.filter((b) => b.status === 'won' || b.status === 'lost');
const byBettor = new Map<string, SettledBet[]>();
for (const b of decided) {
  const k = b.userId; // users and `bot:<id>`
  byBettor.set(k, [...(byBettor.get(k) ?? []), b]);
}
const roi = [...byBettor.values()]
  .filter((l) => l.length >= 10)
  .map((l) => ({ l, roi: sum(l.map((b) => b.payout)) / sum(l.map((b) => b.amount)) }))
  .sort((a, b) => a.roi - b.roi);
const top = roi.slice(Math.floor(roi.length * 0.75)).flatMap((r) => r.l);
const multiples = decided.map((b) => b.payout / b.amount);
// Per match: what the losing bets had staked (the most a winner can take).
const lostPools = new Map<string, number>();
for (const b of decided)
  if (b.status === 'lost') {
    const k = `${b.tournamentId}/${b.matchId}/${b.kind}`;
    lostPools.set(k, (lostPools.get(k) ?? 0) + b.amount);
  }
const winCaps = [...lostPools.values()];
const topMultiples = (top.length ? top : decided).map((b) => b.payout / b.amount);
if (!multiples.length) {
  console.error('no settled bets in the export');
  process.exit(1);
}
if (!library.length) {
  console.error('no bots in the control center of the export');
  process.exit(1);
}

// --- Simulation -------------------------------------------------------------------------------
const runs: SimResult[] = [];
for (let s = 1; s <= seeds; s++)
  runs.push(
    simulateSeason({
      days,
      managers,
      library,
      betMultiples: multiples,
      topMultiples,
      winCaps,
      seed: s,
    }),
  );

const strategies = [...new Set(managers)];
const q = (l: number[], p: number) => {
  const a = [...l].sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))]! : 0;
};
const perDay = (f: (r: SimResult, d: number) => number[]) =>
  Array.from({ length: days }, (_, d) => runs.flatMap((r) => f(r, d)));
const indexDays = perDay((r, d) => [r.days[d]!.index]);
const netBy = (st: Strategy) =>
  perDay((r, d) =>
    r.days[d]!.managers.filter((m) => m.strategy === st).map((m) => m.cash + m.rosterValue),
  );
const rosterBy = (st: Strategy) =>
  perDay((r, d) => r.days[d]!.managers.filter((m) => m.strategy === st).map((m) => m.roster));

const totals = strategies.map((st) => {
  const t = runs.flatMap((r) => r.totals.filter((x) => x.strategy === st));
  const days = (l: (number | null)[]) => {
    const got = l.filter((x): x is number => x !== null);
    return { share: got.length / Math.max(1, l.length), median: got.length ? q(got, 0.5) : null };
  };
  return {
    st,
    finalNet: q(
      t.map((x) => x.finalNet),
      0.5,
    ),
    finalNetP90: q(
      t.map((x) => x.finalNet),
      0.9,
    ),
    betProfit: q(
      t.map((x) => x.betProfit),
      0.5,
    ),
    rewards: q(
      t.map((x) => x.rewards),
      0.5,
    ),
    salaries: q(
      t.map((x) => x.salaries),
      0.5,
    ),
    bought: q(
      t.map((x) => x.bought),
      0.5,
    ),
    titles: t.reduce((s, x) => s + x.titles, 0) / runs.length,
    strong: days(t.map((x) => x.firstStrong)),
    five: days(t.map((x) => x.first5v5)),
  };
});

// --- Console summary --------------------------------------------------------------------------
const fmt = (n: number) => Math.round(n).toLocaleString('de-DE');
console.log(
  `Losing pools per match: median ${fmt(q(winCaps, 0.5))}, p90 ${fmt(q(winCaps, 0.9))}, max ${fmt(Math.max(...winCaps))}`,
);
console.log(
  `Real data: ${decided.length} decided bets of ${byBettor.size} bettors, mean payout/stake ${(sum(multiples) / multiples.length).toFixed(3)}, top quarter ${(sum(topMultiples) / topMultiples.length).toFixed(3)}; ${library.length} bots`,
);
console.log(
  `Index: day 7 ${q(indexDays[6] ?? [], 0.5)}, day 21 ${q(indexDays[20] ?? [], 0.5)}, last day ${q(indexDays.at(-1)!, 0.5)} (median of ${seeds} seasons)`,
);
for (const t of totals)
  console.log(
    `${t.st.padEnd(8)} net ${fmt(t.finalNet)} (p90 ${fmt(t.finalNetP90)}) · bets ${fmt(t.betProfit)} · rewards ${fmt(t.rewards)} · salaries ${fmt(t.salaries)} · titles/season ${t.titles.toFixed(1)} · strong bot ${pct(t.strong.share)} (day ${t.strong.median ?? '–'}) · 5v5 ${pct(t.five.share)} (day ${t.five.median ?? '–'})`,
  );

// --- Report -----------------------------------------------------------------------------------
const COLORS: Record<Strategy, string> = {
  saver: '#9aa4b6',
  casual: '#4fd18b',
  gambler: '#f0468c',
  shark: '#22d3ee',
};
const NAMES: Record<Strategy, string> = {
  saver: 'Sparer (keine Wetten)',
  casual: 'Gelegenheit (4 Wetten/Tag, 8 %)',
  gambler: 'Zocker (18 Wetten/Tag, 25 %)',
  shark: 'Wettkönig (18/Tag, 15 %, beste Quartil-Quoten)',
};
const priceRows = DEFAULT_ECONOMY.skillValue
  .map(
    (_, s) =>
      `<tr><td>${s}</td><td>${fmt(baseValue(s, 0))}–${fmt(baseValue(s, 1))}</td>${[0.3, 1, 2, 3]
        .map((i) => `<td>${fmt(baseValue(s, 0.5) * i)}</td>`)
        .join('')}</tr>`,
  )
  .join('');

const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>UDT Ökonomie-Simulation</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;background:#07080c;color:#eef2f8;font:15px/1.45 system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:32px 16px}
h1,h2{font-family:'Barlow Condensed',system-ui,sans-serif;text-transform:uppercase;letter-spacing:.04em;margin:0 0 8px}
h1{font-size:40px;font-style:italic}h2{font-size:22px;margin-top:32px}
.muted{color:#a3adbf}.card{background:#0e1118;border:1px solid #1d2330;border-radius:12px;padding:16px;margin-top:12px;overflow-x:auto}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}td,th{padding:6px 10px;border-bottom:1px solid #1d2330;text-align:right;white-space:nowrap}
th:first-child,td:first-child{text-align:left}.legend span{display:inline-flex;align-items:center;gap:6px;margin-right:16px;font-size:13px}
.legend i{width:12px;height:3px;display:inline-block}
</style></head><body><main>
<h1>UDT · Ökonomie-Simulation</h1>
<p class="muted">${seeds} simulierte Seasons à ${days} Tage, ${managers.length} Manager (${strategies.map((s) => `${managers.filter((m) => m === s).length}× ${NAMES[s]}`).join(', ')}). Wett-Ergebnisse aus ${decided.length} echten, entschiedenen Wetten (Ø Auszahlung/Einsatz ${(sum(multiples) / multiples.length).toFixed(2)}, bestes Quartil ${(sum(topMultiples) / topMultiples.length).toFixed(2)}). ${library.length} Bots aus dem Kontrollzentrum. Linien = Median, Band = 10.–90. Perzentil.</p>
<h2>Wirtschaftsindex</h2><div class="card">${chart([{ color: '#b26bff', days: indexDays }], 'Index', (v) => v.toFixed(2))}</div>
<h2>Netto-Vermögen je Typ (Konto + Kaderwert)</h2><div class="card">${legend()}${chart(
  strategies.map((s) => ({ color: COLORS[s], days: netBy(s) })),
  'Neuro',
  (v) => fmt(v),
  true,
)}</div>
<h2>Kadergröße je Typ</h2><div class="card">${legend()}${chart(
  strategies.map((s) => ({ color: COLORS[s], days: rosterBy(s) })),
  'Bots',
  (v) => v.toFixed(0),
)}</div>
<h2>Bilanz einer Season (Median je Manager)</h2><div class="card"><table>
<tr><th>Typ</th><th>Netto am Ende</th><th>p90</th><th>Wettgewinn</th><th>Prämien</th><th>Gehälter</th><th>Bot-Käufe</th><th>Titel/Season</th><th>Starker Bot (6–7)</th><th>5v5 ab Tag</th></tr>
${totals
  .map(
    (t) =>
      `<tr><td>${NAMES[t.st]}</td><td>${fmt(t.finalNet)}</td><td>${fmt(t.finalNetP90)}</td><td>${fmt(t.betProfit)}</td><td>${fmt(t.rewards)}</td><td>${fmt(t.salaries)}</td><td>${fmt(t.bought)}</td><td>${t.titles.toFixed(1)}</td><td>${pct(t.strong.share)} · Tag ${t.strong.median ?? '–'}</td><td>${pct(t.five.share)} · Tag ${t.five.median ?? '–'}</td></tr>`,
  )
  .join('')}
</table></div>
<h2>Grundwerte (Referenz) und Preise bei Index</h2><div class="card"><table><tr><th>Skill</th><th>Spanne bei 1,0</th><th>0,3</th><th>1,0</th><th>2,0</th><th>3,0</th></tr>${priceRows}</table></div>
<p class="muted">Rettungen (Konto unter der Grenze aufgefüllt): Ø ${fmt(sum(runs.map((r) => r.rescued)) / runs.length)} € pro Season.</p>
</main></body></html>`;
writeFileSync(values.out, html);
console.log(`report: ${path.resolve(values.out)}`);

function legend() {
  return `<div class="legend">${strategies.map((s) => `<span><i style="background:${COLORS[s]}"></i>${NAMES[s]}</span>`).join('')}</div>`;
}

function chart(
  series: { color: string; days: number[][] }[],
  unit: string,
  label: (v: number) => string,
  log = false,
): string {
  const W = 1000;
  const H = 300;
  const L = 70;
  const B = 28;
  const all = series.flatMap((s) => s.days.flatMap((d) => [q(d, 0.1), q(d, 0.9)]));
  const lo = log ? Math.max(1, Math.min(...all)) : 0;
  const hi = Math.max(...all, lo + 1);
  const y = (v: number) => {
    const t = log
      ? (Math.log(Math.max(v, lo)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))
      : (v - lo) / (hi - lo);
    return H - B - t * (H - B - 10);
  };
  const x = (d: number) => L + (d / Math.max(1, days - 1)) * (W - L - 10);
  const ticks = log ? [lo, Math.sqrt(lo * hi), hi] : [lo, (lo + hi) / 2, hi];
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${unit} über die Season">`;
  for (const t of ticks)
    svg += `<line x1="${L}" x2="${W - 10}" y1="${y(t)}" y2="${y(t)}" stroke="#1d2330"/><text x="${L - 8}" y="${y(t) + 4}" fill="#a3adbf" font-size="12" text-anchor="end">${label(t)}</text>`;
  for (let w = 0; w * 7 < days; w++)
    svg += `<text x="${x(w * 7)}" y="${H - 8}" fill="#a3adbf" font-size="12" text-anchor="middle">Woche ${w + 1}</text>`;
  for (const s of series) {
    const band =
      s.days.map((d, i) => `${x(i)},${y(q(d, 0.9))}`).join(' ') +
      ' ' +
      s.days
        .map((d, i) => `${x(i)},${y(q(d, 0.1))}`)
        .reverse()
        .join(' ');
    svg += `<polygon points="${band}" fill="${s.color}" opacity=".12"/>`;
    svg += `<polyline points="${s.days.map((d, i) => `${x(i)},${y(q(d, 0.5))}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2.5"/>`;
  }
  return svg + '</svg>';
}

function sum(l: number[]) {
  return l.reduce((s, v) => s + v, 0);
}

function pct(v: number) {
  return `${Math.round(v * 100)} %`;
}
