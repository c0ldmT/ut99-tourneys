/**
 * Bot duel simulator: the mod's skill curve and the Dream Team traits in 1v1 meetings
 * (calibration of the skill levels against the bots' own values).
 *
 *   pnpm --filter @tourney/api bot:sim [--curve scripts/bot-curves/my-try.json]
 *     [--base other.json] [--duels 300] [--seed 1] [--out bot-sim-report.html]
 *
 * "Ist" is the curve in mods/ut99-tournament/Classes/TourneySkillCurve.uc (or --base, rows on top
 * of it); --curve gives the rows of a proposal (on top of Ist; without it the report shows Ist
 * only). `bot-curves/proposal-v1.json` is the curve of mod 0.14.0. Rows a file leaves out stay as
 * they are. The report compares both: guard rails, level matrix, accuracy heat map, what each
 * building block adds to a level, reaction from an ambush, hit rates, traits, a model check.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  COMPONENTS,
  CURRENT_CURVE,
  CURVE_PROPS,
  LEVEL_NAMES,
  TRAITS,
  WEAPONS,
  accuracyToMatch,
  curveFromUc,
  duelSeries,
  fromPct,
  withCurve,
  type Component,
  type CurveKey,
  type DuelBotSpec,
  type DuelOptions,
  type DuelSeries,
  type SkillCurve,
  type TraitCode,
} from '@tourney/udt';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: {
    curve: { type: 'string' },
    base: { type: 'string' },
    duels: { type: 'string', default: '400' },
    seed: { type: 'string', default: '1' },
    out: { type: 'string', default: 'bot-sim-report.html' },
  },
});
const duels = Math.max(20, Number(values.duels));
const seed = Number(values.seed) || 1;

// --- Curves ------------------------------------------------------------------------------------
const ucFile = path.resolve(here, '../../../mods/ut99-tournament/Classes/TourneySkillCurve.uc');
let ist = existsSync(ucFile) ? curveFromUc(readFileSync(ucFile, 'utf8')) : CURRENT_CURVE;
if (values.base) ist = withCurve(ist, readJson(values.base));
const proposal = values.curve ? withCurve(ist, readJson(values.curve)) : ist;
const curves: { key: string; name: string; curve: SkillCurve }[] = [
  { key: 'ist', name: 'Ist (Mod)', curve: ist },
];
if (values.curve)
  curves.push({ key: 'vgl', name: `Kurve ${path.basename(values.curve)}`, curve: proposal });

const started = Date.now();
const bot = (level: number, acc = 50, more: Partial<DuelBotSpec> = {}): DuelBotSpec => ({
  level,
  accuracy: fromPct(acc),
  ...more,
});
const opts = (curve: SkillCurve, more: DuelOptions = {}): DuelOptions => ({
  curve,
  duels,
  seed,
  ...more,
});
/** Share of the decided meetings bot A wins (draws after 60 s left out). */
const win = (a: DuelBotSpec, b: DuelBotSpec, o: DuelOptions) => duelSeries(a, b, o).winDecided;

// --- Runs ----------------------------------------------------------------------------------------
const LV = [0, 1, 2, 3, 4, 5, 6, 7];
const STEPS = LV.slice(0, 7);
const ACCS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

interface CurveRun {
  g1: DuelSeries[];
  g2: number[];
  equiv: (number | null)[];
  matrix: number[][];
  heat: number[][];
  parts: Record<Component, number>[];
  ambush: DuelSeries[];
  mirror: DuelSeries[];
  weaponHits: Record<string, number>[];
  mario: DuelSeries;
  robust: { g1: number[]; g2: number[] };
  traits: { label: string; win: number; ambush: number }[];
}

const runs = curves.map(({ curve }) => {
  const o = opts(curve);
  const g1 = STEPS.map((L) => duelSeries(bot(L + 1), bot(L), o));
  const g2 = STEPS.map((L) => win(bot(L, 100), bot(L + 1, 0), o));
  const equiv = STEPS.map((L) =>
    accuracyToMatch(bot(L), bot(L + 1), opts(curve, { duels: Math.ceil(duels / 2) })),
  );
  const matrix = LV.map((a) =>
    LV.map((b) => (a === b ? 0.5 : a < b ? NaN : win(bot(a), bot(b), o))),
  );
  for (const a of LV) for (const b of LV) if (a < b) matrix[a]![b] = 1 - matrix[b]![a]!;
  const heat = LV.map((L) => ACCS.map((p) => win(bot(L, p), bot(4), o)));
  const parts = STEPS.map((L, i) => {
    const base = g1[i]!.winDecided;
    return Object.fromEntries(
      COMPONENTS.map((c) => [c, base - win(bot(L + 1), bot(L), opts(curve, { neutral: [c] }))]),
    ) as Record<Component, number>;
  });
  const ambush = LV.map((L) => duelSeries(bot(4), bot(L), opts(curve, { setup: 'ambush' })));
  const mirror = LV.map((L) => duelSeries(bot(L), bot(L), o));
  const weaponHits = LV.map((L) =>
    Object.fromEntries(
      WEAPONS.map((w) => {
        const s = duelSeries(
          bot(L),
          bot(4),
          opts(curve, { weapons: [w.code], duels: Math.ceil(duels / 3) }),
        );
        return [w.code, s.a.shots ? s.a.hits / s.a.shots : 0];
      }),
    ),
  );
  const mario = duelSeries(bot(3, 80), bot(5, 45), o);
  const half = opts(curve, { aimModel: 0.5 });
  const robust = {
    g1: STEPS.map((L) => win(bot(L + 1), bot(L), half)),
    g2: STEPS.map((L) => win(bot(L, 100), bot(L + 1, 0), half)),
  };
  const ref = bot(3);
  const amb = opts(curve, { setup: 'ambush' });
  const survives = (b: DuelBotSpec) => 1 - win(bot(4), b, amb);
  const ambRef = survives(ref);
  const traits: { label: string; win: number; ambush: number }[] = [];
  const state = (label: string, more: Partial<DuelBotSpec>) => {
    const b = bot(3, 50, more);
    traits.push({ label, win: win(b, ref, o), ambush: survives(b) - ambRef });
  };
  for (const t of TRAITS.filter((x) => x.category === 'values' || x.category === 'body')) {
    if (t.code === 'gun-nut') continue;
    state(t.code, { traits: [{ code: t.code as TraitCode }] });
  }
  state('müde (Ausdauer)', { tired: true });
  for (const ph of ['rookie', 'peak', 'decline'] as const) state(`Karriere: ${ph}`, { phase: ph });
  state('eigenes Modell (Skaarj, NaliCow …)', { stock: false });
  state('zum Vergleich: eine Stufe mehr', { level: 4 });
  const run: CurveRun = {
    g1,
    g2,
    equiv,
    matrix,
    heat,
    parts,
    ambush,
    mirror,
    weaponHits,
    mario,
    robust,
    traits,
  };
  return run;
});
const seconds = Math.round((Date.now() - started) / 1000);

// --- Console summary -----------------------------------------------------------------------------
for (const [i, c] of curves.entries()) {
  const r = runs[i]!;
  console.log(
    `${c.name.padEnd(36)} G1 ${r.g1.map((s) => pct(s.winDecided)).join(' ')} | G2 ${r.g2.map((x) => pct(x)).join(' ')} | Skill 3/80 vs 5/45 ${pct(r.mario.winDecided)}`,
  );
}

// --- Report --------------------------------------------------------------------------------------
const G1_LO = 0.6;
const G1_HI = 0.72;
const G2_MAX = 0.58;
const step = (L: number) => `${LEVEL_NAMES[L + 1]} > ${LEVEL_NAMES[L]}`;
const g1ok = (s: DuelSeries) => s.winDecided >= G1_LO && s.winDecided <= G1_HI;
const ok = (b: boolean) => `<span class="${b ? 'ok' : 'bad'}">${b ? '✓' : '✗'}</span>`;
const both = (f: (r: CurveRun) => string) => runs.map((r) => `<td>${f(r)}</td>`).join('');
/** One finished cell per curve (f returns the <td>). */
const cells = (f: (r: CurveRun) => string) => runs.map(f).join('');

const guard = STEPS.map(
  (L, i) =>
    `<tr><td>${step(L)}</td>${both((r) => `${pct(r.g1[i]!.winDecided)} ${ok(g1ok(r.g1[i]!))} <small>${pct(r.g1[i]!.draws)} unentsch.</small>`)}${both(
      (r) => `${pct(r.g2[i]!)} ${ok(r.g2[i]! <= G2_MAX)}`,
    )}${both((r) => equivLabel(r.equiv[i]!))}</tr>`,
).join('');

const summary = curves
  .map((c, i) => {
    const r = runs[i]!;
    const p1 = r.g1.filter(g1ok).length;
    const p2 = r.g2.filter((x) => x <= G2_MAX).length;
    return `<div class="stat"><b>${c.name}</b><span>G1 ${p1}/7 · G2 ${p2}/7</span><span>Skill 3 (Acc 80) gegen Skill 5 (Acc 45): <b>${pct(r.mario.winDecided)}</b> für Skill 3</span><span>Godlike gegen Novice: ${pct(r.matrix[7]![0]!)}</span></div>`;
  })
  .join('');

const matrixHtml = (r: CurveRun) =>
  `<table class="heat"><tr><th>A \\ B</th>${LV.map((b) => `<th>${short(b)}</th>`).join('')}</tr>${LV.map(
    (a) => `<tr><th>${LEVEL_NAMES[a]}</th>${LV.map((b) => cell(r.matrix[a]![b]!)).join('')}</tr>`,
  ).join('')}</table>`;

const heatHtml = (r: CurveRun) =>
  `<table class="heat"><tr><th>Stufe \\ Acc</th>${ACCS.map((p) => `<th>${p}</th>`).join('')}</tr>${LV.map(
    (L) =>
      `<tr><th>${LEVEL_NAMES[L]}</th>${ACCS.map((_, j) => cell(r.heat[L]![j]!)).join('')}</tr>`,
  ).join('')}</table>`;

const PART_NAMES: Record<Component, string> = {
  aim: 'Zielen',
  turn: 'Drehen',
  view: 'Sicht/Gehör',
  react: 'Reaktion/Feuerpausen',
  dodge: 'Ausweichen',
  speed: 'Tempo',
  flinch: 'Treffer-Anim.',
};
const partsHtml = (r: CurveRun) =>
  `<table><tr><th>Schritt</th><th>Vorteil (Punkte)</th>${COMPONENTS.map((c) => `<th>${PART_NAMES[c]}</th>`).join('')}</tr>${STEPS.map(
    (L, i) =>
      `<tr><td>${step(L)}</td><td>${pct(r.g1[i]!.winDecided - 0.5, true)}</td>${COMPONENTS.map((c) => `<td>${pct(r.parts[i]![c], true)}</td>`).join('')}</tr>`,
  ).join('')}</table>`;

const reactRows = LV.map(
  (L) =>
    `<tr><td>${LEVEL_NAMES[L]}</td>${both((r) => sec(r.ambush[L]!.b.firstShot))}${both((r) => pct(1 - r.ambush[L]!.winDecided))}${both((r) => pct(r.mirror[L]!.winDecided))}${both((r) => sec(r.mirror[L]!.time))}${both((r) => pct(r.mirror[L]!.a.hits / Math.max(1, r.mirror[L]!.a.shots)))}</tr>`,
).join('');

const weaponHtml = (r: CurveRun) =>
  `<table><tr><th>Stufe</th>${WEAPONS.map((w) => `<th>${w.name}</th>`).join('')}</tr>${LV.map(
    (L) =>
      `<tr><td>${LEVEL_NAMES[L]}</td>${WEAPONS.map((w) => `<td>${pct(r.weaponHits[L]![w.code]!, false, 1)}</td>`).join('')}</tr>`,
  ).join('')}</table>`;

const traitRows = runs[0]!.traits
  .map(
    (t, i) =>
      `<tr><td>${t.label}</td>${cells((r) => cell(r.traits[i]!.win, true))}${both((r) => pct(r.traits[i]!.ambush, true))}</tr>`,
  )
  .join('');

const marioWeapons = WEAPONS.map(
  (w) => `<tr><td>${w.name}</td>${both((r) => pct(r.mario.perWeapon[w.code] ?? NaN))}</tr>`,
).join('');

const robustRows = STEPS.map(
  (L, i) =>
    `<tr><td>${step(L)}</td>${both((r) => pct(r.robust.g1[i]!))}${both((r) => pct(r.robust.g2[i]!))}</tr>`,
).join('');

const KEYS = Object.keys(CURRENT_CURVE) as CurveKey[];
const curveRows = KEYS.map((k) => {
  const changed = proposal[k].some((v, i) => v !== ist[k][i]);
  const mod = CURVE_PROPS[k] ?? '<i>neu, fehlt im Mod</i>';
  return `<tr class="${changed ? 'chg' : ''}"><td>${k}</td><td>${mod}</td>${LV.map(
    (L) =>
      `<td>${num(ist[k][L]!)}${proposal[k][L] !== ist[k][L] ? ` → <b>${num(proposal[k][L]!)}</b>` : ''}</td>`,
  ).join('')}</tr>`;
}).join('');

const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Bot-Duell-Simulation</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;background:#07080c;color:#eef2f8;font:15px/1.45 system-ui,sans-serif}
main{max-width:1200px;margin:0 auto;padding:32px 16px}
h1,h2{font-family:'Barlow Condensed',system-ui,sans-serif;text-transform:uppercase;letter-spacing:.04em;margin:0 0 8px}
h1{font-size:40px;font-style:italic}h2{font-size:22px;margin-top:36px}h3{margin:16px 0 6px;font-size:15px;color:#a3adbf}
.muted{color:#a3adbf}.card{background:#0e1118;border:1px solid #1d2330;border-radius:12px;padding:16px;margin-top:12px;overflow-x:auto}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}td,th{padding:5px 8px;border-bottom:1px solid #1d2330;text-align:right;white-space:nowrap}
th:first-child,td:first-child{text-align:left}th{color:#a3adbf;font-weight:600}
.heat td{text-align:center;border:1px solid #07080c;padding:4px 5px;font-size:13px}small{color:#a3adbf}
.ok{color:#4fd18b;font-weight:700}.bad{color:#f0468c;font-weight:700}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}
.stat{background:#0e1118;border:1px solid #1d2330;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:4px}
tr.chg td{background:#1a1424}.curve td,.curve th{font-size:13px;padding:4px 6px}.two{display:grid;grid-template-columns:repeat(auto-fit,minmax(460px,1fr));gap:12px}
ul{margin:6px 0;padding-left:20px}
</style></head><body><main>
<h1>Bot-Duell-Simulation</h1>
<p class="muted">1v1-Begegnungen nach UT-Bot-Code und Skill-Kurve, ${duels} Begegnungen je Paarung (jede zweimal mit getauschten Seiten), Seed ${seed}, ${seconds} s Rechenzeit. Siegquote = Anteil der entschiedenen Duelle (ohne Sieger nach 60 s zählt nicht). Zufallsrauschen etwa ±3 Prozentpunkte (mehr Begegnungen mit --duels). Werte auf der Dream-Team-Skala 0–100 (50 = neutral). Bots ohne Angabe: alle Werte 50, Standardklasse.</p>
<div class="stats">${summary}</div>

<h2>Leitplanken</h2>
<div class="card"><p class="muted">G1: +1 Stufe bei gleichen Werten gewinnt ${pct(G1_LO)}–${pct(G1_HI)} der entschiedenen Duelle (Ziel ≈ 65 %; daneben der Anteil ohne Sieger nach 60 s). G2: Stufe L mit Acc 100 gegen L+1 mit Acc 0 gewinnt höchstens ${pct(G2_MAX)} der entschiedenen Duelle (volle Accuracy ≤ 1 Stufe). Acc-Äquivalent: welche Accuracy Stufe L braucht, um L+1 (Acc 50) auszugleichen (– = schafft es nicht einmal mit 100).</p>
<table><tr><th>Schritt</th>${curves.map((c) => `<th>G1 ${c.key}</th>`).join('')}${curves.map((c) => `<th>G2 ${c.key}</th>`).join('')}${curves.map((c) => `<th>Acc-Äquiv. ${c.key}</th>`).join('')}</tr>${guard}</table></div>

<h2>Stufe gegen Stufe (alle Werte 50)</h2>
<div class="two">${curves.map((c, i) => `<div class="card"><h3>${c.name}</h3>${matrixHtml(runs[i]!)}</div>`).join('')}</div>

<h2>Stufe × Accuracy gegen Adept/50</h2>
<div class="two">${curves.map((c, i) => `<div class="card"><h3>${c.name}</h3>${heatHtml(runs[i]!)}</div>`).join('')}</div>

<h2>Woraus besteht ein Level?</h2>
<p class="muted">Vorteil von L+1 über 50 % und wie viel davon wegfällt, wenn ein Baustein für beide auf Adept gesetzt wird (Prozentpunkte; Summe ≠ Vorteil, die Bausteine wirken zusammen).</p>
${curves.map((c, i) => `<div class="card"><h3>${c.name}</h3>${partsHtml(runs[i]!)}</div>`).join('')}

<h2>Reaktion und Kennzahlen je Stufe</h2>
<div class="card"><p class="muted">Überfall: ein Adept zielt schon, der Bot schaut 90–180° weg und hat ihn nicht bemerkt. Gegenwehr = Sekunden bis zu seinem ersten Schuss (Median). Spiegel: zwei Bots derselben Stufe.</p>
<table><tr><th>Stufe</th>${curves.map((c) => `<th>Gegenwehr ${c.key}</th>`).join('')}${curves.map((c) => `<th>überlebt ${c.key}</th>`).join('')}${curves.map((c) => `<th>Spiegel ${c.key} (soll 50 %)</th>`).join('')}${curves.map((c) => `<th>Zeit bis Kill ${c.key}</th>`).join('')}${curves.map((c) => `<th>Trefferquote ${c.key}</th>`).join('')}</tr>${reactRows}</table></div>

<h2>Trefferquote je Waffe (gegen Adept/50)</h2>
<div class="two">${curves.map((c, i) => `<div class="card"><h3>${c.name}</h3>${weaponHtml(runs[i]!)}</div>`).join('')}</div>

<h2>Traits und Zustände (Skilled/50 mit gegen ohne)</h2>
<div class="card"><p class="muted">Werte-Traits über die Website-Regeln (effectiveValues), Körper-Traits wie im Mod. Nicht im Duell: Adrenaline (erst nach einem Kill), Verhaltens-Traits (Entscheidungen auf der Map), Lieblingswaffe. Phoenix wirkt im Spiel nur einmal pro Match, im Duell daher überschätzt. Werte-Traits wirken seit Mod 0.14.0 als Vorteile auf der Kurve (Zielfehler, Reaktion, Sicht, Drehen, Ausweichen). Spalten: Siegquote im offenen Duell gegen denselben Bot ohne Trait, und Punkte mehr Überleben beim Überfall (wo Wahrnehmung zählt).</p>
<table><tr><th>Trait / Zustand</th>${curves.map((c) => `<th>Duell ${c.key}</th>`).join('')}${curves.map((c) => `<th>Überfall ${c.key}</th>`).join('')}</tr>${traitRows}</table></div>

<h2>Marios Fall je Waffe: Skill 3/Acc 80 gegen Skill 5/Acc 45</h2>
<div class="card"><table><tr><th>Waffe</th>${curves.map((c) => `<th>${c.name}</th>`).join('')}</tr>${marioWeapons}</table></div>

<h2>Modell-Check: Bots treffen doppelt so gut</h2>
<div class="card"><p class="muted">Alle Zielfehler × 0,5 (kein Kurvenwert, nur Prüfung, ob die Schlüsse am Modell hängen). Kürzere Kämpfe machen Reaktion und Drehen wichtiger.</p>
<table><tr><th>Schritt</th>${curves.map((c) => `<th>G1 ${c.key}</th>`).join('')}${curves.map((c) => `<th>G2 ${c.key}</th>`).join('')}</tr>${robustRows}</table></div>

<h2>Kurve: Ist → Vergleich</h2>
<div class="card"><table class="curve"><tr><th>Zeile</th><th>Mod</th>${LV.map((L) => `<th>${short(L)}</th>`).join('')}</tr>${curveRows}</table></div>

<h2>Modell und Annahmen</h2>
<div class="card"><ul>
<li>Begegnung: gleiche Waffe (${WEAPONS.map((w) => `${w.name} ${w.range[0]}–${w.range[1]} uu`).join(', ')}), gegenseitige Sicht ab Start, Blickrichtung zufällig, keine Map, Items, Deckung, Höhe, Waffenwechsel.</li>
<li>Zielen nach AdjustAim/AimSpread: AimError × Relativbewegung (11 − 10·dot) × Hitscan (0,5 + 0,19·S) × (1,7 − 0,4·(S+½)) × 1,2 nach Treffer/in der Luft × 2 erster Schuss auf ein neues Ziel (nur bis Skill-intern 2) × (1 − Acc); Acc = TAcc + accGain × eigener Wert. Standardklassen driften (TDriftHz, TLag), eigene Modelle würfeln pro Schuss. Treffer: seitlicher Versatz &lt; 17 uu; Projektile fliegen mit Vorhalten 0,7–1,0; Rocket mit Splash an den Füßen, Flak 8 Splitter.</li>
<li>Reaktion: Sicht im Sichtfeld (cos(Fov/2) − Wachsamkeit), Hören bei Schüssen (Annahme 30 % je Schuss × THear), Treffer von hinten: nach Treffer-Animation oder mit Chance S/3 sofort, sonst nach TReact (mit 1 − TRight erst falsch herum); nach Sicht/Gehör sightReact, Drehen mit TYaw, 0,2 s Tween; Feuern nur ≤ 22° zum Ziel; fireDelay verlängert die Pausen zwischen Schüssen.</li>
<li>Bewegung: Kampfmanöver alle 0,8–1,6 s (Anteil 50 % + 40 % × Strafing), Tempo 400 × TSpeed in zufälliger Richtung, Ausweichsprung im Kampfmanöver (unter Masterful TTact, darüber und mit Jumpy UTs eigene 35 %-Regel – TTact ab Masterful wirkt im Mod nicht; nie mit Rocket), Projektil-Ausweichen (TDuck-Fenster, dann 0,33 + 0,22·S, Schütze im Blick ≤ 37°).</li>
<li>Treffer-Animation nach Bot.PlayHit (0,4 s ohne Feuern), Anteil TFlinch für die optionalen.</li>
<li>Absolute Zahlen (Trefferquoten, Zeit bis Kill) sind grob; zum Abstimmen zählen die Vergleiche. Abgleich mit echten Logs steht aus.</li>
</ul></div>
</main></body></html>`;
writeFileSync(values.out, html);
console.log(`report: ${path.resolve(values.out)} (${seconds} s)`);

// --- helpers -------------------------------------------------------------------------------------
function readJson(file: string): Record<string, unknown> {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('$')));
}

function pct(v: number, signed = false, digits = 0): string {
  if (!isFinite(v)) return '–';
  const s = (v * 100).toFixed(digits);
  return `${signed && v > 0 ? '+' : ''}${s} %`;
}

function sec(v: number): string {
  return isFinite(v) ? `${v.toFixed(2)} s` : '–';
}

function num(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
}

function short(L: number): string {
  return LEVEL_NAMES[L]!.slice(0, 3);
}

function equivLabel(v: number | null): string {
  if (v === null) return '–';
  if (v < 0) return 'schon bei 0';
  return String(v);
}

/** A share as a coloured cell: red below 50 %, green above. */
function cell(v: number, delta = false): string {
  if (!isFinite(v)) return '<td>–</td>';
  const d = Math.max(-1, Math.min(1, (v - 0.5) * 2.2));
  const bg =
    d >= 0
      ? `rgba(79,209,139,${(d * 0.7).toFixed(2)})`
      : `rgba(240,70,140,${(-d * 0.7).toFixed(2)})`;
  return `<td style="background:${bg}">${delta ? pct(v - 0.5, true) : pct(v)}</td>`;
}
