/**
 * Anonymised copy of the website database (players, bots, clans, teams, tournaments, servers get
 * neutral names; secrets and free texts go), e.g. for `udt:sim` or analyses outside the Pi:
 *
 *   pnpm --filter @tourney/api db:anonymize <tourney.db> [out.db]
 *
 * The source stays untouched (read through SQLite's backup, so a running website is fine). The
 * copy defaults to `<name>-anon.db` next to the source. When an original name would stay in the
 * copy, nothing is written and the script lists them (exit code 1).
 */
import path from 'node:path';
import { anonymizeDatabase } from '../src/db/anonymize.js';

const [src, outArg] = process.argv.slice(2);
if (!src) {
  console.error('usage: db-anonymize <tourney.db> [out.db]');
  process.exit(2);
}
const out =
  outArg ?? path.join(path.dirname(src), `${path.basename(src, path.extname(src))}-anon.db`);
const report = await anonymizeDatabase(path.resolve(src), path.resolve(out));
for (const [k, n] of Object.entries(report.mapped)) console.log(`  ${k}: ${n}`);
for (const [k, n] of Object.entries(report.removed)) console.log(`  removed ${k}: ${n} rows`);
if (!report.written) {
  console.error(
    `\n${report.leftovers.length} original name(s) would stay in the copy - nothing was written:`,
  );
  for (const l of report.leftovers.slice(0, 30))
    console.error(`  ${l.name} in ${l.where}: ${l.sample}`);
  process.exit(1);
}
console.log(`anonymised copy: ${out} (no original names left)`);
