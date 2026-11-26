#!/usr/bin/env node
/* global console, fetch, document, localStorage */
// Screenshots of every page for UI reviews (before/after a change), with demo data.
//
//   1. Build the web app (pnpm -r --filter "./packages/*" build; cd apps/web && npx ng build).
//   2. Start the API with test mode and dev login on an empty data folder, e.g.
//        cd apps/api && PORT=8099 DATA_DIR=/tmp/ui-data DEV_LOGIN=true TEST_MODE=true \
//          WEB_DIST=$PWD/../web/dist PUBLIC_URL=http://localhost:8099 \
//          node --conditions=@tourney/source --import tsx src/main.ts
//   3. node scripts/ui-snapshots.mjs seed                 (once per data folder)
//      node scripts/ui-snapshots.mjs shoot <out-folder>   (needs Playwright: require('playwright'))
//
// Options of "shoot": --widths 1280,390  --lang de|en  --only name,name  --base http://localhost:8099
// Writes <name>-<width>.png and report.json (page height, horizontal overflow, page errors).
import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: 'string', default: 'http://localhost:8099' },
    widths: { type: 'string', default: '1280,390' },
    lang: { type: 'string', default: 'de' },
    only: { type: 'string' },
  },
});
const BASE = values.base;
const [command, outDir] = positionals;

class Client {
  cookie = '';
  async req(method, url, body) {
    const res = await fetch(`${BASE}/api${url}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'x-tourney': '1' } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      if (pair.startsWith('tsid=')) this.cookie = pair;
    }
    const text = await res.text();
    let parsed = text;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      // not JSON
    }
    if (res.status >= 400) console.log(`  ${method} ${url} -> ${res.status} ${text.slice(0, 160)}`);
    return parsed;
  }
  get(url) {
    return this.req('GET', url);
  }
  post(url, body = {}) {
    return this.req('POST', url, body);
  }
  put(url, body) {
    return this.req('PUT', url, body);
  }
  static async login(name, admin = false) {
    const c = new Client();
    await c.post('/auth/dev-login', { name, admin });
    if (!c.cookie) throw new Error(`dev login failed for ${name} (DEV_LOGIN=true?)`);
    return c;
  }
}

const RULES = {
  mapPool: ['DM-Deck16][', 'DM-Morpheus', 'DM-Phobos', 'DM-Codex'],
  voteTimeoutSec: 15,
};
const BOTS = [
  'Xan',
  'Loque',
  'Malcolm',
  'Brock',
  'Lauren',
  'Visse',
  'Tamika',
  'Dominator',
  'Rankin',
];
const tournament = (over, settings) => ({
  name: 'Cup',
  agentId: 'pi',
  profileId: 'local',
  botPool: BOTS.map((name, i) => ({ name, skill: 7 - (i % 7) })),
  settings: {
    format: 'double',
    size: 8,
    checkInWindowMin: 1,
    noShowSec: 60,
    reconnectGraceSec: 60,
    postTournamentShutdownSec: 30,
    ...settings,
    game: { adapter: 'ut99-dm', rules: RULES },
  },
  ...over,
});

/** Demo data: a season, Dream Team with AI managers, four simulated cups, four league evenings. */
async function seed() {
  const admin = await Client.login('Mario', true);
  const players = {};
  for (const n of ['Anna', 'Tim', 'Lena', 'Kai', 'Jonas']) players[n] = await Client.login(n);
  await admin.post('/agents', { id: 'pi', name: 'Main server' });
  await admin.post('/agents', { id: 'vps2', name: 'Server 2' });
  const names = [...BOTS, 'Raven', 'Cryss', 'Kragoth', 'Barktooth', 'Othello', 'Grail', 'Arkon'];
  for (let i = 0; i < names.length; i++)
    await admin.post('/bots', { name: names[i], skill: 1 + (i % 7) });
  await admin.put('/settings/udt', { enabled: true });
  const { today } = await admin.get('/seasons');
  const [y, m, d] = today.split('-').map(Number);
  const end = new Date(Date.UTC(y, m - 1, d + 30)).toISOString().slice(0, 10);
  await admin.post('/seasons', { startDate: today, endDate: end });
  await admin.post('/udt/test/managers', { count: 8 });
  await admin.post('/udt/test/market-day');
  const teams = [
    [admin, 'Nexus Gaming', 'NX', 'Nova'],
    [players.Anna, 'Iron Guard', 'IG', 'Blitz'],
    [players.Tim, 'Aces High', 'AC', 'Vex'],
    [players.Lena, 'Frag Factory', 'FF', 'Pyro'],
  ];
  for (const [c, name, tag, starter] of teams)
    await c.post('/udt/team', { name, tag, starter: { name: starter, skill: 3 } });
  await admin.put('/settings/udt', {
    league: {
      enabled: true,
      tiers: 2,
      size: 8,
      slotDays: [0, 1, 2, 3, 4, 5, 6],
      agentId: 'pi',
      profileId: 'local',
      mapPool: ['DM-Deck16][', 'DM-Morpheus'],
    },
  });
  const open = await admin.post('/tournaments', tournament({ name: 'Friday Night Cup' }, {}));
  for (const n of ['Anna', 'Tim', 'Kai', 'Jonas'])
    await players[n].post(`/tournaments/${open.id}/registration`);
  await admin.post(
    '/tournaments',
    tournament({ name: 'Monster Hunt Night' }, { size: 4, format: 'single' }),
  );
  for (let i = 1; i <= 4; i++) {
    const cup = await admin.post(
      '/tournaments',
      tournament({ name: `Dream Team Cup #${i}`, botPool: [], kind: 'udt' }, { format: 'single' }),
    );
    for (const [c] of teams) await c.post(`/udt/events/${cup.id}/enter`);
    await admin.post('/udt/test/managers/act');
    await admin.post(`/udt/test/simulate/${cup.id}`);
    await admin.post('/udt/test/advance', { hours: 24 });
  }
  await admin.post('/udt/test/signatures');
  await admin.post('/udt/test/advance', { hours: 48 });
  for (let i = 0; i < 4; i++) await admin.post('/udt/test/league/day');
  const offers = (await admin.get('/udt/market')).offers ?? [];
  for (const o of [...offers].sort((a, b) => a.price - b.price).slice(0, 1))
    await admin.post('/udt/market/buy', { botId: o.botId });
  await admin.post(
    '/tournaments',
    tournament({ name: 'Dream Team Cup #5', botPool: [], kind: 'udt' }, { format: 'single' }),
  );
  console.log('seeded');
}

async function routes(admin) {
  const list = await admin.get('/tournaments');
  const udt = await admin.get('/udt');
  const league = list.find((t) => t.format === 'fixtures');
  const cup = list.find((t) => t.kind === 'udt' && t.phase === 'finished');
  const open = list.find((t) => t.phase === 'draft' && t.kind !== 'udt');
  const bot = udt?.roster?.[0]?.botId;
  return [
    ['home', '/'],
    ['calendar', '/calendar'],
    ['stats', '/stats'],
    ['shop', '/shop'],
    ['profile', '/profile'],
    ['udt-hub', '/udt'],
    ['udt-team', '/udt/team'],
    ...(bot ? [['udt-bot', `/udt/bot/${bot}`]] : []),
    ['udt-league', '/udt/league'],
    ['udt-market', '/udt/market'],
    ['udt-packs', '/udt/packs'],
    ['udt-trades', '/udt/trades'],
    ['udt-club', '/udt/club'],
    ['udt-academy', '/udt/academy'],
    ['udt-yearbook', '/udt/yearbook'],
    ['udt-events', '/udt/events'],
    ['udt-squads', '/udt/squads'],
    ['udt-table', '/udt/table'],
    ...(open ? [['t-open', `/t/${open.id}`]] : []),
    ...(cup ? [['t-cup', `/t/${cup.id}`]] : []),
    ...(league ? [['t-league', `/t/${league.id}`]] : []),
    ['new', '/new'],
    ['agents', '/admin/agents'],
    ['bots', '/admin/bots'],
    ['settings', '/admin/settings'],
    ...['bets', 'bots', 'udt', 'league', 'system'].map((t) => [
      `settings-${t}`,
      `/admin/settings?tab=${t}`,
    ]),
    ['series', '/admin/series'],
    ['moderation', '/moderation'],
    ['users', '/admin/users'],
  ];
}

async function shoot(out) {
  if (!out) throw new Error('usage: ui-snapshots.mjs shoot <out-folder>');
  let playwright;
  try {
    // require() honours NODE_PATH, so a global Playwright works too.
    playwright = createRequire(import.meta.url)('playwright');
  } catch {
    throw new Error('Playwright is missing (npm i -g playwright, then NODE_PATH=$(npm root -g))');
  }
  const admin = await Client.login('Mario', true);
  // The "what's new" dialog would cover every page: mark all notes as read.
  const notes = await admin.get('/patch-notes');
  if (notes?.latest) await admin.post('/me/patch-notes/seen', { id: notes.latest });
  const only = values.only?.split(',');
  const pages = (await routes(admin)).filter(([name]) => !only || only.includes(name));
  const tsid = admin.cookie.split('=')[1];
  fs.mkdirSync(out, { recursive: true });
  const browser = await playwright.chromium.launch();
  const report = [];
  for (const width of values.widths.split(',').map(Number)) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    await ctx.addCookies([{ name: 'tsid', value: tsid, url: BASE }]);
    await ctx.addInitScript((lang) => {
      localStorage.setItem('tourney.lang', lang);
    }, values.lang);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const [name, url] of pages) {
      await page.goto(BASE + url, { waitUntil: 'networkidle' }).catch(() => {});
      await page.waitForTimeout(800);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      await page.screenshot({ path: path.join(out, `${name}-${width}.png`), fullPage: true });
      report.push({ name, width, overflow: sw > width, scrollWidth: sw, errors: errors.splice(0) });
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  const bad = report.filter((r) => r.overflow || r.errors.length);
  for (const r of bad)
    console.log(`${r.name}-${r.width}: overflow ${r.overflow}, errors ${r.errors.join(' | ')}`);
  console.log(`${report.length} screenshots in ${out}, ${bad.length} with problems`);
}

if (command === 'seed') await seed();
else if (command === 'shoot') await shoot(outDir);
else
  console.log('usage: ui-snapshots.mjs seed | shoot <out-folder> [--widths 1280,390] [--lang de]');
