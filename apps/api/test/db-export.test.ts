import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunningApi } from '../src/app.js';
import { exportForAnalysis } from '../src/db/export.js';
import { Client, startApi, startSeason, tournamentBody } from './helpers.js';

const dirs: string[] = [];
let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tempDir = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'export-'));
  dirs.push(d);
  return d;
};

describe('export for a season analysis (decision 247)', () => {
  it('writes the anonymised copy, feedback texts and bot logs with the same neutral names', async () => {
    const dir = tempDir();
    ({ api } = await startApi({ DATA_DIR: dir, TEST_MODE: 'true' }));
    const admin = await Client.login(api, 'Adminrich', true);
    const mario = await Client.login(api, 'Mariolus');
    await admin.post('/agents', { id: 'marios-pi', name: 'Wohnzimmerpi' });
    for (const name of ['Nachtwache', 'Rotfuchs', 'Eisbaer'])
      expect((await admin.post('/bots', { name, skill: 4 })).status).toBe(201);
    await admin.req('PUT', '/settings/udt', { enabled: true });
    await startSeason(admin);
    await mario.post('/udt/team', {
      name: 'Mariolus Marauders',
      tag: '[MM]',
      starter: { name: 'Starmario', skill: 3 },
    });
    await admin.post('/udt/test/market-day');
    const t = (
      await admin.post(
        '/tournaments',
        tournamentBody({ name: 'Nachtwache Cup', agentId: 'marios-pi' }, { size: 8 }),
      )
    ).body as { id: string };
    await admin.req('PUT', '/feedback/survey', { open: true });
    await mario.post('/feedback/survey', {
      answers: { fun: 4 },
      texts: { best: 'Gegen Nachtwache und Adminrich zu spielen' },
    });
    await mario.post('/feedback/notes', {
      area: 'other',
      text: 'Rotfuchs ist zu stark, sagt Mariolus',
    });
    await mario.post('/feedback/notes', {
      area: 'tournaments',
      text: `Siehe /tournaments/${t.id} auf marios-pi`,
    });
    await api.close();
    api = undefined;

    // Bot logs as the bridge writes them: one day gzipped, today plain.
    const logs = path.join(dir, 'bot-logs');
    mkdirSync(logs);
    const line = (o: Record<string, unknown>) =>
      JSON.stringify({
        at: 1,
        matchId: 'W1-1',
        game: 1,
        health: 100,
        armor: 0,
        weapon: 'Flak Cannon',
        ...o,
      });
    writeFileSync(
      path.join(logs, 'bot-thoughts-2026-11-18.jsonl.gz'),
      zlib.gzipSync(
        [
          line({ tournamentId: t.id, bot: 'Nachtwache', state: 'atk', target: '[MM]Starmario' }),
          line({ tournamentId: t.id, bot: 'Rotfuchs', state: 'item', target: 'Shield Belt' }),
        ].join('\n') + '\n',
      ),
    );
    writeFileSync(
      path.join(logs, 'bot-thoughts-2026-11-19.jsonl'),
      [
        line({
          tournamentId: 'gone-cup-of-sabine',
          bot: 'Eisbaer',
          state: 'hunt',
          target: 'Skaarj Warrior',
        }),
        'not json',
        line({ bot: 'Nachtwache', state: 'roam', target: '' }),
      ].join('\n') + '\n',
    );

    const out = path.join(tempDir(), 'season-export');
    const r = await exportForAnalysis(path.join(dir, 'tourney.db'), out, { botLogs: logs });
    expect(r.leftovers).toEqual([]);
    expect(r.written).toBe(true);
    expect(r.feedback).toEqual({ survey: 1, notes: 2 });
    expect(r.botLogs).toEqual({ files: 2, lines: 4, skipped: 1 });
    expect(readdirSync(out).sort()).toEqual([
      'bot-logs',
      'export.json',
      'feedback.json',
      'tourney-anon.db',
    ]);
    expect(readdirSync(path.join(out, 'bot-logs'))).toEqual([
      'bot-thoughts-2026-11-18.jsonl.gz',
      'bot-thoughts-2026-11-19.jsonl.gz',
    ]);

    // The bot logs use the copy's names and tournament ids.
    const copy = new Database(path.join(out, 'tourney-anon.db'), { readonly: true });
    const botNames = (copy.prepare('SELECT name FROM bots').all() as { name: string }[]).map(
      (b) => b.name,
    );
    const tid = (copy.prepare('SELECT id FROM tournaments').get() as { id: string }).id;
    const snapshots = (
      copy.prepare('SELECT COUNT(*) AS n FROM udt_bot_days').get() as { n: number }
    ).n;
    copy.close();
    expect(snapshots).toBeGreaterThan(0);
    const read = (f: string) =>
      zlib
        .gunzipSync(readFileSync(path.join(out, 'bot-logs', f)))
        .toString('utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as Record<string, string>);
    const day1 = read('bot-thoughts-2026-11-18.jsonl.gz');
    expect(day1.map((x) => x.tournamentId)).toEqual([tid, tid]);
    expect(botNames).toContain(day1[0]!.bot);
    expect(day1[0]!.target).toMatch(/^T\d+Bot\d+$|^\[T\d+\]Bot\d+$/);
    expect(day1[1]).toMatchObject({ state: 'item', target: 'Shield Belt', weapon: 'Flak Cannon' });
    const day2 = read('bot-thoughts-2026-11-19.jsonl.gz');
    expect(day2[0]).toMatchObject({ tournamentId: 'tx001', target: 'Skaarj Warrior' });
    expect(botNames).toContain(day2[0]!.bot);
    expect(day2[1]!.target).toBe('');

    // Feedback texts with the neutral names, managers numbered.
    const fb = JSON.parse(readFileSync(path.join(out, 'feedback.json'), 'utf8'));
    expect(fb.survey).toEqual([
      expect.objectContaining({ manager: 1, season: 1, answers: { fun: 4 } }),
    ]);
    expect(fb.survey[0].texts.best).toMatch(/^Gegen Bot\d+ und Spieler\d+ zu spielen$/);
    expect(fb.notes[0]).toMatchObject({ manager: 1, area: 'other' });
    expect(fb.notes[0].text).toMatch(/^Bot\d+ ist zu stark, sagt Spieler\d+$/);
    expect(fb.notes[1].text).toBe(`Siehe /tournaments/${tid} auf id`);

    const all = [
      readFileSync(path.join(out, 'feedback.json'), 'utf8'),
      readFileSync(path.join(out, 'export.json'), 'utf8'),
      ...day1.map((x) => JSON.stringify(x)),
      ...day2.map((x) => JSON.stringify(x)),
    ].join('\n');
    for (const name of [
      'Nachtwache',
      'Rotfuchs',
      'Eisbaer',
      'Mariolus',
      'Adminrich',
      'Starmario',
      'sabine',
    ])
      expect(all, name).not.toContain(name);

    // Never over an existing folder.
    await expect(exportForAnalysis(path.join(dir, 'tourney.db'), out)).rejects.toThrow(/exists/);
  });
});
