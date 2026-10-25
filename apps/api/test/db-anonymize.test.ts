import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunningApi } from '../src/app.js';
import { BetsService } from '../src/bets/bets.service.js';
import { BotsService } from '../src/bots/bots.service.js';
import { anonymizeDatabase } from '../src/db/anonymize.js';
import { LedgerService } from '../src/ledger/ledger.service.js';
import { SeasonsService } from '../src/seasons/seasons.service.js';
import { UdtRewardsService } from '../src/udt/udt-rewards.service.js';
import { Client, startApi, startSeason, tournamentBody } from './helpers.js';

const dirs: string[] = [];
let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tempDir = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'anon-'));
  dirs.push(d);
  return d;
};

/** Every string of the database, for checks. */
function allText(file: string): string {
  const db = new Database(file, { readonly: true });
  const out: string[] = [];
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
    name: string;
  }[];
  for (const { name } of tables)
    for (const r of db.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[])
      for (const v of Object.values(r)) if (typeof v === 'string') out.push(v);
  db.close();
  return out.join('\n');
}

/** What the website computes from a database: by ids, which stay. */
async function books(dataDir: string) {
  const { api: a } = await startApi({ TEST_MODE: 'true', DATA_DIR: dataDir });
  try {
    const season = a.app.get(SeasonsService).list()[0]!;
    const db = new Database(path.join(dataDir, 'tourney.db'), { readonly: true });
    const users = (db.prepare('SELECT id FROM users ORDER BY id').all() as { id: string }[]).map(
      (u) => u.id,
    );
    const tournaments = (
      db.prepare('SELECT id FROM tournaments ORDER BY created_at').all() as { id: string }[]
    ).map((t) => t.id);
    db.close();
    const admin = await Client.login(a, 'Spieler01x', true);
    const bets = a.app.get(BetsService);
    const ledger = a.app.get(LedgerService);
    return {
      wallets: users.map((id) => ({
        id,
        balance: bets.wallet(id, season).balance,
        ledger: ledger.spendable(id).balance,
      })),
      table: a.app
        .get(UdtRewardsService)
        .table(season.number)
        .map((r) => ({ user: r.userId, points: r.points })),
      // Every tournament page still loads (the event log projects).
      pages: await Promise.all(
        tournaments.map(async (id) => {
          const r = await admin.get(`/tournaments/${id}`);
          return { status: r.status, phase: (r.body as { phase?: string }).phase };
        }),
      ),
      // Lists sorted by name keep their order.
      bots: a.app
        .get(BotsService)
        .list()
        .map((b) => b.id),
      // Betting leaderboard (ties between players and bots are ordered by name, which changes).
      leaderboard: (
        (await admin.get('/bets/leaderboard')).body as {
          rows: { id: string; balance: number; profit: number }[];
        }
      ).rows
        .map((r) => `${r.id}:${r.balance}:${r.profit}`)
        .sort(),
    };
  } finally {
    await a.close();
  }
}

describe('anonymised database copy', () => {
  it('replaces every name and keeps what the website computes', async () => {
    const dir = tempDir();
    ({ api } = await startApi({ TEST_MODE: 'true', DATA_DIR: dir }));
    const admin = await Client.login(api, 'Adminrich', true);
    const mario = await Client.login(api, 'Mariolus');
    const tim = await Client.login(api, 'Timbuktu');
    // A player named like a state of the event log.
    const plain = await Client.login(api, 'admin');
    await admin.post('/agents', { id: 'marios-pi', name: 'Wohnzimmerpi' });
    const clan = (await admin.post('/bot-clans', { name: 'Nachtwache', tag: 'NW' })).body as {
      id: string;
    };
    const libs = ['Xanadu', 'Loquat', 'Malcolmo', 'Brocki', 'Laurenz', 'Vissel', 'Gorgo', 'Zed'];
    const ids: string[] = [];
    for (const [i, name] of libs.entries())
      ids.push(
        (
          (
            await admin.post('/bots', {
              name,
              skill: 1 + (i % 7),
              ...(i % 2 ? { clanId: clan.id } : {}),
              bio: `${name} kommt aus Mariolus' Keller`,
              personality: {
                talk: 50,
                lines: [{ kind: 'kill', text: `Gruss an Timbuktu von ${name}` }],
              },
            })
          ).body as { id: string }
        ).id,
      );
    await admin.put('/settings/team-names', {
      names: ['Rote Socken', 'Blaue Bohnen', 'Gelbe Gefahr', 'Gruene Hoelle'],
    });
    await admin.req('PUT', '/settings/udt', { enabled: true });
    await startSeason(admin);
    await mario.post('/udt/team', {
      name: 'Mariolus Marauders',
      tag: 'MM',
      starter: { name: 'Starmario', skill: 3 },
    });
    await tim.post('/udt/team', {
      name: 'Timbuktu Titans',
      tag: '[TT]',
      starter: { name: 'Timbot', skill: 3 },
    });
    await admin.post('/udt/test/managers', { count: 2 });
    await admin.post('/udt/test/market-day');
    await mario.post('/udt/academy/scout', {});
    const cup = async (name: string) => {
      const made = await admin.post(
        '/tournaments',
        tournamentBody(
          { name, agentId: 'marios-pi', botPool: [], kind: 'udt' },
          { size: 8, format: 'single' },
        ),
      );
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      const t = made.body as { id: string };
      for (const c of [mario, tim]) await c.post(`/udt/events/${t.id}/enter`);
      await admin.post('/udt/test/managers/act');
      const sim = await admin.post(`/udt/test/simulate/${t.id}`);
      expect(sim.status, JSON.stringify(sim.body)).toBe(200);
      return t.id;
    };
    await cup('Mariolus Geburtstagscup');
    // A deleted cup leaves its id (a slug of the name) in the ledger.
    const gone = await cup('Sabines Abschiedscup');
    expect((await admin.del(`/tournaments/${gone}`)).status).toBeLessThan(300);
    // A renamed and a deleted library bot: their old names stay in the event log.
    await admin.patch(`/bots/${ids[0]}`, { name: 'Umbenannt' });
    await admin.del(`/bots/${ids[7]}`);
    // Bots by name (no library id): their entrant ids carry the names, also in the bracket.
    const open = (
      await admin.post(
        '/tournaments',
        tournamentBody(
          {
            name: 'Timbuktu Open',
            agentId: 'marios-pi',
            connectAddress: '192.168.1.50:7777',
            webhookUrl: 'https://discord.com/api/webhooks/1/secret',
            botPool: ['Mr. Pink', 'Bo', 'Sgt.Kane', 'Loque', 'Malcolm', 'Xan'].map((name, i) => ({
              name,
              skill: 3 + (i % 4),
            })),
          },
          { size: 8, format: 'single' },
        ),
      )
    ).body as { id: string };
    for (const c of [mario, tim, plain]) await c.post(`/tournaments/${open.id}/registration`, {});
    expect((await admin.post(`/tournaments/${open.id}/seed`, { mode: 'auto' })).status).toBe(200);
    await api.close();
    api = undefined;

    const out = tempDir();
    const report = await anonymizeDatabase(
      path.join(dir, 'tourney.db'),
      path.join(out, 'tourney.db'),
    );
    expect(report.leftovers).toEqual([]);
    expect(report.written).toBe(true);
    expect(report.removed.sessions).toBe(4);
    expect(readdirSync(out)).toEqual(['tourney.db']);
    const text = allText(path.join(out, 'tourney.db'));
    for (const name of [
      'Adminrich',
      'Mariolus',
      'mariolus',
      'Timbuktu',
      'Wohnzimmerpi',
      'marios-pi',
      'Nachtwache',
      'Starmario',
      'Timbot',
      'Rote Socken',
      'Marauders',
      'Geburtstagscup',
      'Sabine',
      'sabine',
      'Umbenannt',
      'Mr. Pink',
      'Mr__Pink',
      'Sgt',
      'Loque',
      '192.168',
      'discord.com',
      'Keller',
      'dev:a',
      'dev:m',
      ...libs,
    ])
      expect(text, name).not.toContain(name);
    expect(text).toMatch(/Spieler\d{2}/);
    expect(text).toContain('Dream Team Cup 1');
    // The test managers stay test managers.
    expect(text).toContain('dev:test1');

    const before = await books(dir);
    const after = await books(out);
    expect(after).toEqual(before);
    expect(before.pages.every((p) => p.status === 200)).toBe(true);
    expect(before.wallets.some((w) => w.balance !== 1000)).toBe(true);
  });

  it('keeps names, entrant ids and refs consistent inside the event log', async () => {
    const dir = tempDir();
    const file = path.join(dir, 'in.db');
    const db = new Database(file);
    db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, discord_id TEXT NOT NULL, username TEXT,
        display_name TEXT, display_key TEXT UNIQUE, avatar TEXT, join_token TEXT, created_at TEXT);
      CREATE TABLE bots (id TEXT PRIMARY KEY, name TEXT, name_key TEXT UNIQUE, bio TEXT,
        created_at TEXT);
      CREATE TABLE udt_teams (season INTEGER, user_id TEXT, name TEXT, name_key TEXT, tag TEXT,
        tag_key TEXT, created_at TEXT, UNIQUE (season, name_key));
      CREATE TABLE tournaments (id TEXT PRIMARY KEY, name TEXT, kind TEXT, connect_address TEXT,
        webhook_url TEXT, bot_pool_json TEXT, created_at TEXT);
      CREATE TABLE events (tournament_id TEXT, seq INTEGER, type TEXT, json TEXT);
      CREATE TABLE bets (tournament_id TEXT, match_id TEXT, pick TEXT, amount INTEGER);
      CREATE TABLE neuro_ledger (ref TEXT, meta_json TEXT);
    `);
    const user = db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    user.run('u1', '123456789', 'mario_t', 'Mario', 'mario', 'abc', 'zzzzzzzzzz', '1');
    // A Discord user name that is somebody else's display name.
    user.run('u2', 'ai:1', 'Mario', 'Luigi', 'luigi', null, 'yyyyyyyyyy', '2');
    db.prepare('INSERT INTO bots VALUES (?, ?, ?, ?, ?)').run('b1', 'Starbot', 'starbot', 'x', '1');
    db.prepare('INSERT INTO udt_teams VALUES (1, ?, ?, ?, ?, ?, ?)').run(
      'u1',
      'Marios Team',
      'marios team',
      'MT',
      'mt',
      '1',
    );
    // A team named like a player.
    db.prepare('INSERT INTO udt_teams VALUES (1, ?, ?, ?, ?, ?, ?)').run(
      'u2',
      'Luigi',
      'luigi',
      'LU',
      'lu',
      '2',
    );
    db.prepare('INSERT INTO tournaments VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      'marios-cup',
      'Marios Cup',
      'standard',
      'mario.example.org:7777',
      'https://discord.com/api/webhooks/1/x',
      JSON.stringify([{ name: 'Loque', skill: 5 }]),
      '1',
    );
    const ev = (seq: number, type: string, data: unknown, actor = { kind: 'admin', id: 'u1' }) =>
      db
        .prepare('INSERT INTO events VALUES (?, ?, ?, ?)')
        .run('marios-cup', seq, type, JSON.stringify({ type, seq, actor, data }));
    ev(1, 'tournament.created', { tournamentId: 'marios-cup', name: 'Marios Cup' });
    ev(2, 'seeding.set', {
      rngSeed: 'marios-cup-1761400000000',
      entrants: [
        { id: 'u1', kind: 'human', displayName: 'Mario', userId: 'u1' },
        { id: 'bot-Loque', kind: 'bot', displayName: 'Loque', bot: { name: 'Loque', skill: 5 } },
        {
          id: 'udt-u1',
          kind: 'bot',
          displayName: 'Marios Team',
          bot: { name: 'MTStarbot2', skill: 3, id: 'b1', skin: 'Starbot.Skin' },
        },
      ],
      bracket: { slots: ['u1', 'bot-Loque', 'udt-u1', null] },
    });
    ev(3, 'match.result', {
      result: {
        matchId: 'W1-1',
        entrants: ['u1', 'bot-Loque'],
        winnerId: 'bot-Loque',
        games: [
          {
            map: 'DM-Deck16][',
            scores: { u1: 3, 'bot-Loque': 10 },
            winnerId: 'bot-Loque',
            stats: [
              { name: 'xX_mario_Xx', userId: 'u1', kills: 3 },
              { name: 'Loque', bot: true, entrantId: 'bot-Loque', kills: 10 },
            ],
          },
        ],
      },
    });
    ev(4, 'tournament.aborted', { reason: 'Mario hatte keine Lust' }, { kind: 'bridge', id: 'pi' });
    db.prepare('INSERT INTO bets VALUES (?, ?, ?, ?)').run('marios-cup', 'W1-1', 'bot-Loque', 50);
    const ledger = db.prepare('INSERT INTO neuro_ledger VALUES (?, ?)');
    ledger.run(
      'udt-match:marios-cup:W1-1:u1',
      JSON.stringify({ tournamentId: 'marios-cup', matchId: 'W1-1' }),
    );
    // A deleted tournament: only the ledger knows its id.
    ledger.run('udt-place:lisas-abschied:u1', JSON.stringify({ tournamentId: 'lisas-abschied' }));
    db.close();

    const out = path.join(dir, 'out.db');
    const report = await anonymizeDatabase(file, out);
    expect(report.leftovers).toEqual([]);
    const a = new Database(out, { readonly: true });
    const users = a.prepare('SELECT * FROM users ORDER BY id').all() as Record<string, unknown>[];
    expect(users[0]).toMatchObject({
      display_name: 'Spieler02',
      display_key: 'spieler02',
      username: 'spieler02',
      discord_id: 'anon:1',
      avatar: null,
    });
    expect(users[0]!.join_token).not.toBe('zzzzzzzzzz');
    // Sorted like the originals (Luigi < Mario); the AI manager keeps its id.
    expect(users[1]).toMatchObject({ display_name: 'Spieler01', discord_id: 'ai:1' });
    expect(a.prepare('SELECT name, bio FROM bots').get()).toEqual({ name: 'Bot01', bio: null });
    const teams = a.prepare('SELECT name, tag FROM udt_teams ORDER BY user_id').all() as {
      name: string;
      tag: string;
    }[];
    expect(teams.map((t) => t.name)).toEqual(['Team01', 'Spieler01']);
    expect(a.prepare('SELECT * FROM tournaments').get()).toMatchObject({
      id: 't001',
      name: 'Turnier 1',
      connect_address: null,
      webhook_url: null,
    });
    const events = (
      a.prepare('SELECT tournament_id, json FROM events ORDER BY seq').all() as {
        tournament_id: string;
        json: string;
      }[]
    ).map((r) => {
      expect(r.tournament_id).toBe('t001');
      return JSON.parse(r.json) as { actor: { kind: string; id: string }; data: any };
    });
    expect(events[0]!.actor).toEqual({ kind: 'admin', id: 'u1' });
    expect(events[0]!.data).toEqual({ tournamentId: 't001', name: 'Turnier 1' });
    const seeding = events[1]!.data;
    expect(seeding.rngSeed).toBe('t001-1761400000000');
    const loque = seeding.entrants[1];
    expect(loque.displayName).toMatch(/^Bot\d+$/);
    expect(loque.id).toBe(`bot-${loque.displayName}`);
    expect(seeding.bracket.slots).toEqual(['u1', loque.id, 'udt-u1', null]);
    expect(seeding.entrants[0].displayName).toBe('Spieler02');
    // In-game name: team tag + bot name + the number the website appended; the asset stays.
    expect(seeding.entrants[2].bot).toMatchObject({
      name: `${teams[0]!.tag}Bot01_2`,
      skin: 'Starbot.Skin',
    });
    const game = events[2]!.data.result.games[0];
    expect(events[2]!.data.result.winnerId).toBe(loque.id);
    expect(Object.keys(game.scores).sort()).toEqual([loque.id, 'u1'].sort());
    expect(game.stats[0].name).toBe('Spieler02');
    expect(game.stats[1]).toMatchObject({ name: loque.displayName, entrantId: loque.id });
    expect(events[3]!.data.reason).toBe('anonymized');
    expect(events[3]!.actor).toEqual({ kind: 'bridge', id: 'pi' });
    expect(a.prepare('SELECT * FROM bets').get()).toMatchObject({
      tournament_id: 't001',
      pick: loque.id,
    });
    expect(a.prepare('SELECT * FROM neuro_ledger').all()).toEqual([
      {
        ref: 'udt-match:t001:W1-1:u1',
        meta_json: JSON.stringify({ tournamentId: 't001', matchId: 'W1-1' }),
      },
      { ref: 'udt-place:t002:u1', meta_json: JSON.stringify({ tournamentId: 't002' }) },
    ]);
    a.close();
  });

  it('does not take random ids, assets or a user name of a team for names', async () => {
    const dir = tempDir();
    const file = path.join(dir, 'in.db');
    const db = new Database(file);
    db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, discord_id TEXT, username TEXT, display_name TEXT,
        display_key TEXT UNIQUE, created_at TEXT);
      CREATE TABLE bots (id TEXT PRIMARY KEY, name TEXT, name_key TEXT UNIQUE, created_at TEXT);
      CREATE TABLE udt_teams (season INTEGER, user_id TEXT, name TEXT, name_key TEXT, tag TEXT,
        tag_key TEXT, created_at TEXT, UNIQUE (season, name_key));
      CREATE TABLE udt_traits (id TEXT, weapon TEXT);
      CREATE TABLE neuro_ledger (id TEXT, ref TEXT);
    `);
    db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)').run(
      'u1',
      '1',
      'mario_t',
      'Mariolus',
      'mariolus',
      '1',
    );
    db.prepare('INSERT INTO bots VALUES (?, ?, ?, ?)').run('b1', 'Luna', 'luna', '1');
    db.prepare('INSERT INTO bots VALUES (?, ?, ?, ?)').run('b2', 'Shock', 'shock', '2');
    // Two teams: one named like the player, one like the player's Discord user name.
    db.prepare('INSERT INTO udt_teams VALUES (1, ?, ?, ?, ?, ?, ?)').run(
      'u1',
      'Mariolus',
      'mariolus',
      'MA',
      'ma',
      '1',
    );
    db.prepare('INSERT INTO udt_teams VALUES (1, ?, ?, ?, ?, ?, ?)').run(
      'u2',
      'mario_t',
      'mario_t',
      'MT',
      'mt',
      '2',
    );
    db.prepare('INSERT INTO udt_traits VALUES (?, ?)').run('t1', 'Botpack.ShockRifle');
    db.prepare('INSERT INTO neuro_ledger VALUES (?, ?)').run(
      'l03LunaXzitg1',
      'scout:1:u1:soIILuna',
    );
    db.close();
    const out = path.join(dir, 'out.db');
    const report = await anonymizeDatabase(file, out);
    expect(report.leftovers).toEqual([]);
    const a = new Database(out, { readonly: true });
    expect(a.prepare('SELECT * FROM udt_traits').get()).toEqual({
      id: 't1',
      weapon: 'Botpack.ShockRifle',
    });
    expect(a.prepare('SELECT * FROM neuro_ledger').get()).toEqual({
      id: 'l03LunaXzitg1',
      ref: 'scout:1:u1:soIILuna',
    });
    const teams = a.prepare('SELECT name FROM udt_teams ORDER BY user_id').all() as {
      name: string;
    }[];
    expect(new Set(teams.map((t) => t.name)).size).toBe(2);
    a.close();
  });

  it('writes nothing when an original is left or the copy fails', async () => {
    const dir = tempDir();
    const file = path.join(dir, 'in.db');
    const db = new Database(file);
    db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, discord_id TEXT, username TEXT, display_name TEXT,
        display_key TEXT, created_at TEXT);
      CREATE TABLE notes (body TEXT);
    `);
    db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)').run(
      'u1',
      'x',
      'm',
      'Mariolus',
      'm',
      '1',
    );
    // A table the tool does not know, with a name in it.
    db.prepare('INSERT INTO notes VALUES (?)').run('Mariolus war hier');
    db.close();
    const out = path.join(dir, 'out.db');
    const report = await anonymizeDatabase(file, out);
    expect(report.written).toBe(false);
    expect(report.leftovers).toMatchObject([{ name: 'Mariolus', where: 'notes.body' }]);
    expect(existsSync(out)).toBe(false);
    expect(readdirSync(dir)).toEqual(['in.db']);
    await expect(anonymizeDatabase(file, file)).rejects.toThrow(/exists already/);
  });
});
