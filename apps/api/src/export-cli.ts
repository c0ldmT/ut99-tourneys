/**
 * Export for a season analysis (decision 247), shipped as `website/dist/export-cli.js`:
 *
 *   node dist/export-cli.js <tourney.db> <out-folder> [--bot-logs <bridge data>/bot-logs]
 *
 * Writes the anonymised database copy (with snapshots and survey answers), the feedback texts
 * and the bot logs into a new folder (see db/export.ts). The website may keep running (the
 * database is read through SQLite's backup). Exit code 1 when an original name would stay.
 */
import path from 'node:path';
import { exportForAnalysis } from './db/export.js';

const args = process.argv.slice(2);
const positional: string[] = [];
let botLogs: string | undefined;
let bad = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--bot-logs') {
    botLogs = args[++i];
    if (!botLogs) bad = true;
  } else positional.push(args[i]!);
}
const [src, out] = positional;
if (bad || !src || !out || positional.length > 2) {
  console.error('usage: export-cli <tourney.db> <out-folder> [--bot-logs <dir>]');
  process.exit(2);
}
try {
  const r = await exportForAnalysis(path.resolve(src), path.resolve(out), {
    ...(botLogs ? { botLogs: path.resolve(botLogs) } : {}),
  });
  for (const [k, n] of Object.entries(r.db.mapped)) console.log(`  ${k}: ${n}`);
  console.log(`  feedback: ${r.feedback.survey} survey answers, ${r.feedback.notes} messages`);
  if (botLogs)
    console.log(
      `  bot logs: ${r.botLogs.files} days, ${r.botLogs.lines} lines (${r.botLogs.skipped} skipped)`,
    );
  if (!r.written) {
    console.error(
      `\n${r.leftovers.length} original name(s) would stay in the export - nothing was written:`,
    );
    for (const l of r.leftovers.slice(0, 30))
      console.error(`  ${l.name} in ${l.where}: ${l.sample}`);
    process.exit(1);
  }
  console.log(`export: ${path.resolve(out)} (no original names left)`);
} catch (e) {
  console.error(`export failed: ${(e as Error).message}`);
  process.exit(1);
}
