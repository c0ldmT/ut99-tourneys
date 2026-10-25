/**
 * Dream Team: what licences and salaries for blueprint bots change (academy model of the season
 * simulator, synthetic bets as in the calibration of 162/192: about half lost, wins 1.5-2.2x).
 *
 *   pnpm --filter @tourney/api udt:academy-sim            (Daily Cups 1 and 3, boxes x1 and x2)
 *   CUPS=1 BOX=5,10 pnpm --filter @tourney/api udt:academy-sim
 *
 * Scenarios: today's three licences without salary, unlimited licences with rising prices and
 * 100 / 75 / 50 % of a bought bot's salary for blueprint bots. 40 seeds, managers saver,
 * casual x3, gambler, shark.
 */
import {
  simulateSeason,
  type SimAcademy,
  type SimBot,
  type Strategy,
  baseValue,
  weeklySalary,
} from '@tourney/udt';

const library: SimBot[] = Array.from({ length: 60 }, (_, i) => ({
  id: `b${i}`,
  name: `Lib${i}`,
  skill: 1 + (i % 7),
  score: ((i * 7) % 11) / 10,
}));
const betMultiples = [0, 0, 0, 0, 0, 1.5, 1.7, 1.9, 2.0, 2.2];
const topMultiples = [0, 0, 0, 0, 1.5, 1.7, 1.9, 2.0, 2.2, 2.2];
const winCaps = [150, 300, 500, 800, 1500];
const managers: Strategy[] = ['saver', 'casual', 'casual', 'casual', 'gambler', 'shark'];
const today = (n: number) => [0, 2000, 4000, 8000][n] ?? null;
const SC: Record<string, SimAcademy | undefined> = {
  'A heute (3 Lizenzen, kein Gehalt)': { licence: today, blueprintSalary: 0 },
  'B unbegrenzt x2, Gehalt 100 %': { licence: (n) => 2000 * 2 ** (n - 1), blueprintSalary: 1 },
  'C unbegrenzt x2, Gehalt 75 %': { licence: (n) => 2000 * 2 ** (n - 1), blueprintSalary: 0.75 },
  'D unbegrenzt x2, Gehalt 50 %': { licence: (n) => 2000 * 2 ** (n - 1), blueprintSalary: 0.5 },
  'E unbegrenzt x1.5, Gehalt 75 %': {
    licence: (n) => Math.round(2000 * 1.5 ** (n - 1)),
    blueprintSalary: 0.75,
  },
  'F unbegrenzt +2000, Gehalt 75 %': { licence: (n) => 2000 * n, blueprintSalary: 0.75 },
  'G unbegrenzt x2, kein Gehalt': { licence: (n) => 2000 * 2 ** (n - 1), blueprintSalary: 0 },
};
const SEEDS = 40;
const avg = (l: number[]) => l.reduce((a, b) => a + b, 0) / Math.max(1, l.length);
const r0 = (x: number) => Math.round(x);
for (const cups of (process.env.CUPS ?? '1,3').split(',').map(Number))
  for (const boxMul of (process.env.BOX ?? '1,2').split(',').map(Number)) {
    console.log(
      `\n=== Daily Cups ${cups}/Tag, Boxen ×${boxMul} (Basis saver 1 / casual 2 / gambler 4 / shark 3 pro Woche) ===`,
    );
    console.log(
      [
        'Szenario',
        'Index Ende',
        'Index max',
        'gebaut/Mgr',
        'eigene Ende',
        'bester eig. Skill',
        'Lizenzen €',
        'Gehalt eig. €',
        'Gehalt ges. €',
        'gekauft €',
        'Boxen €',
        'Streik-Wo.',
        'Netto median',
        'Titel Zocker+Hai %',
        'gebaut Zocker',
        'gebaut Sparer',
        'max gebaut',
        'Lizenz-Anteil an Ausgaben %',
      ].join(' | '),
    );
    for (const [name, academy] of Object.entries(SC)) {
      const rows = Array.from({ length: SEEDS }, (_, s) =>
        simulateSeason({
          managers,
          library,
          betMultiples,
          topMultiples,
          winCaps,
          seed: s + 1,
          dailyCups: cups,
          ...(academy
            ? {
                academy: {
                  ...academy,
                  boxesPerWeek: {
                    saver: 1 * boxMul,
                    casual: 2 * boxMul,
                    gambler: 4 * boxMul,
                    shark: 3 * boxMul,
                  },
                },
              }
            : {}),
        }),
      );
      const T = rows.flatMap((r) => r.totals);
      const by = (st: Strategy) => T.filter((t) => t.strategy === st);
      const titles = avg(
        rows.map((r) => {
          const all = r.totals.reduce((a, t) => a + t.titles, 0);
          return all
            ? r.totals
                .filter((t) => t.strategy === 'gambler' || t.strategy === 'shark')
                .reduce((a, t) => a + t.titles, 0) / all
            : 0;
        }),
      );
      const nets = T.map((t) => t.finalNet).sort((a, b) => a - b);
      console.log(
        [
          name,
          avg(rows.map((r) => r.days.at(-1)!.index)).toFixed(2),
          Math.max(...rows.map((r) => r.days.at(-1)!.index)).toFixed(2),
          avg(T.map((t) => t.built)).toFixed(1),
          avg(T.map((t) => t.ownAtEnd)).toFixed(1),
          avg(T.filter((t) => t.ownAtEnd).map((t) => t.ownBestSkill)).toFixed(1),
          r0(avg(T.map((t) => t.licences))),
          r0(avg(T.map((t) => t.ownSalaries))),
          r0(avg(T.map((t) => t.salaries))),
          r0(avg(T.map((t) => t.bought))),
          r0(avg(T.map((t) => t.boxSpend))),
          avg(T.map((t) => t.strikes)).toFixed(1),
          r0(nets[nets.length >> 1]!),
          (titles * 100).toFixed(0),
          avg(by('gambler').map((t) => t.built)).toFixed(1),
          avg(by('saver').map((t) => t.built)).toFixed(1),
          Math.max(...T.map((t) => t.built)),
          (
            (100 * avg(T.map((t) => t.licences))) /
            Math.max(1, avg(T.map((t) => t.licences + t.boxSpend + t.bought + t.salaries)))
          ).toFixed(1),
        ].join(' | '),
      );
    }
  }
// Salary of a built bot vs a bought one of the same skill (index 1, average values).
console.log('\n=== Wochengehalt bei Index 1 (Werte Mitte) ===');
for (const sk of [3, 4, 5, 6, 7]) {
  const v = baseValue(sk, 0.5);
  const full = weeklySalary(v, sk);
  console.log(
    `Skill ${sk}: Wert ${Math.round(v)} €, Gehalt gekauft ${full} €/Woche, 75 %: ${Math.round(full * 0.75)}, 50 %: ${Math.round(full * 0.5)}`,
  );
}
