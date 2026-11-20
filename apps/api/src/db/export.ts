/**
 * Everything for a season analysis in one folder (decision 247), anonymised with one set of
 * neutral names:
 *
 * - `tourney-anon.db`: the anonymised copy of the website database (see anonymize.ts), with the
 *   daily snapshots (244) and the survey answers (245, texts emptied);
 * - `feedback.json`: survey answers with their free texts and the feedback messages, managers
 *   numbered, known names in the texts replaced by their neutral names;
 * - `bot-logs/`: the bridge's bot logs (what the bots were up to in every game), bot names,
 *   targets and tournament ids mapped like in the copy, gzipped;
 * - `export.json`: what is inside.
 *
 * The folder is built as `<out>.part` and renamed only when no original name or id is left in
 * any file; otherwise nothing stays and the leftovers are reported.
 */
import { createReadStream, createWriteStream, existsSync, readdirSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import zlib from 'node:zlib';
import Database from 'better-sqlite3';
import { anonymizeDatabase, type AnonymizeReport, type NameMapper } from './anonymize.js';

const LOG_FILE = /^bot-thoughts-(\d{4}-\d{2}-\d{2})\.jsonl(\.gz)?$/;

export interface ExportReport {
  written: boolean;
  db: AnonymizeReport;
  botLogs: { files: number; lines: number; skipped: number };
  feedback: { survey: number; notes: number };
  leftovers: AnonymizeReport['leftovers'];
}

type Leftovers = AnonymizeReport['leftovers'];

export async function exportForAnalysis(
  src: string,
  outDir: string,
  o: { botLogs?: string } = {},
): Promise<ExportReport> {
  if (existsSync(outDir)) throw new Error(`${outDir} exists already`);
  if (o.botLogs && !existsSync(o.botLogs)) throw new Error(`no bot logs at ${o.botLogs}`);
  const part = `${outDir}.part`;
  await rm(part, { recursive: true, force: true });
  await mkdir(part, { recursive: true });
  const result: Omit<ExportReport, 'db' | 'written' | 'leftovers'> = {
    botLogs: { files: 0, lines: 0, skipped: 0 },
    feedback: { survey: 0, notes: 0 },
  };
  let written = false;
  try {
    const db = await anonymizeDatabase(src, path.join(part, 'tourney-anon.db'), async (m) => {
      const left: Leftovers = [];
      result.feedback = await writeFeedback(src, path.join(part, 'feedback.json'), m, left);
      if (o.botLogs)
        result.botLogs = await writeBotLogs(o.botLogs, path.join(part, 'bot-logs'), m, left);
      return left;
    });
    if (db.written) {
      await writeFile(
        path.join(part, 'export.json'),
        JSON.stringify(
          {
            createdAt: new Date().toISOString(),
            database: 'tourney-anon.db',
            mapped: db.mapped,
            removed: db.removed,
            ...result,
          },
          null,
          2,
        ) + '\n',
      );
      await rename(part, outDir);
      written = true;
    }
    return { written, db, ...result, leftovers: db.leftovers };
  } finally {
    if (!written) await rm(part, { recursive: true, force: true });
  }
}

/** Survey answers and messages with their texts, managers numbered (no user ids). */
async function writeFeedback(
  src: string,
  file: string,
  m: NameMapper,
  left: Leftovers,
): Promise<{ survey: number; notes: number }> {
  const db = new Database(src, { readonly: true, fileMustExist: true });
  let rows: {
    user_id: string;
    season: number | null;
    kind: string;
    area: string | null;
    answers_json: string;
    texts_json: string;
    created_at: string;
    updated_at: string;
  }[] = [];
  try {
    const has = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'feedback'")
      .get();
    if (has)
      rows = db
        .prepare(
          'SELECT user_id, season, kind, area, answers_json, texts_json, created_at, updated_at FROM feedback ORDER BY created_at, id',
        )
        .all() as typeof rows;
  } finally {
    db.close();
  }
  const who = new Map<string, number>();
  const n = (id: string) => {
    if (!who.has(id)) who.set(id, who.size + 1);
    return who.get(id)!;
  };
  const texts = (json: string, where: string): Record<string, string> => {
    let t: Record<string, unknown> = {};
    try {
      t = JSON.parse(json) as Record<string, unknown>;
    } catch {
      // broken: none
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(t)) {
      if (typeof v !== 'string') continue;
      out[k] = m.text(v);
      for (const name of m.leftovers(out[k]))
        left.push({ name, where, sample: out[k].slice(0, 80) });
    }
    return out;
  };
  const answers = (json: string) => {
    try {
      return JSON.parse(json) as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  const survey = rows
    .filter((r) => r.kind === 'survey')
    .map((r) => ({
      manager: n(r.user_id),
      season: r.season,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      answers: answers(r.answers_json),
      texts: texts(r.texts_json, 'feedback.json survey'),
    }));
  const notes = rows
    .filter((r) => r.kind === 'note')
    .map((r) => ({
      manager: n(r.user_id),
      season: r.season,
      createdAt: r.created_at,
      area: r.area,
      text: texts(r.texts_json, 'feedback.json notes').text ?? '',
    }));
  await writeFile(file, JSON.stringify({ survey, notes }, null, 2) + '\n');
  return { survey: survey.length, notes: notes.length };
}

/** Every day of the bot logs, names and tournaments mapped, gzipped. */
async function writeBotLogs(
  dir: string,
  outDir: string,
  m: NameMapper,
  left: Leftovers,
): Promise<ExportReport['botLogs']> {
  await mkdir(outDir, { recursive: true });
  const out = { files: 0, lines: 0, skipped: 0 };
  for (const f of readdirSync(dir).sort()) {
    const match = LOG_FILE.exec(f);
    if (!match) continue;
    const input: Readable = match[2]
      ? createReadStream(path.join(dir, f)).pipe(zlib.createGunzip())
      : createReadStream(path.join(dir, f));
    const gzip = zlib.createGzip();
    const sink = createWriteStream(path.join(outDir, `bot-thoughts-${match[1]}.jsonl.gz`));
    gzip.pipe(sink);
    for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) {
      if (!line.trim()) continue;
      let t: Record<string, unknown>;
      try {
        t = JSON.parse(line) as Record<string, unknown>;
      } catch {
        out.skipped++;
        continue;
      }
      if (typeof t.tournamentId === 'string') t.tournamentId = m.tournament(t.tournamentId);
      if (typeof t.bot === 'string') t.bot = m.player(t.bot);
      if (typeof t.target === 'string' && t.target) t.target = m.known(t.target);
      for (const k of ['bot', 'target'] as const) {
        const v = t[k];
        if (typeof v === 'string' && left.length < 200)
          for (const name of m.leftovers(v))
            left.push({ name, where: `bot-logs/${f} ${k}`, sample: v.slice(0, 80) });
      }
      if (!gzip.write(`${JSON.stringify(t)}\n`)) await new Promise((r) => gzip.once('drain', r));
      out.lines++;
    }
    gzip.end();
    await finished(sink);
    out.files++;
  }
  return out;
}
