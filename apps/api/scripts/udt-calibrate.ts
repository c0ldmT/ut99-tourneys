/**
 * Checks the game model of the simulations against real games and fits the rating setting
 * `levelPoints` (see src/udt/calibrate.ts). Read-only; best on an anonymised export:
 *
 *   pnpm --filter @tourney/api udt:calibrate <tourney.db>
 */
import Database from 'better-sqlite3';
import { calibrate, readCalibrationGames } from '../src/udt/calibrate.js';

const [file] = process.argv.slice(2);
if (!file) {
  console.error('usage: udt-calibrate <tourney.db>');
  process.exit(2);
}
const db = new Database(file, { readonly: true, fileMustExist: true });
const report = calibrate(readCalibrationGames(db));
db.close();
const pct = (x: number) => `${Math.round(x * 100)} %`;
console.log(`bot-against-bot deathmatch games: ${report.games} (a coin toss has log loss 0.693)`);
for (const g of report.groups) {
  if (!g.n) continue;
  console.log(
    `\n${g.label === 'duel' ? '1v1' : 'teams'}: n=${g.n}, log loss with k=${g.k} (code) ${g.logLoss.toFixed(3)}, ` +
      `with k=2 (old) ${g.logLossK2.toFixed(3)}, best k=${g.best.k} -> ${g.best.logLoss.toFixed(3)}`,
  );
  for (const b of g.buckets)
    console.log(
      `  skill gap ${b.gap}: n=${b.n}, favourite won ${pct(b.won)}, model ${pct(b.model)}`,
    );
}
console.log(
  `\nrating setting levelPoints that fits these games best: ${report.levelPoints.levelPoints} ` +
    `(log loss ${report.levelPoints.logLoss.toFixed(3)})`,
);
