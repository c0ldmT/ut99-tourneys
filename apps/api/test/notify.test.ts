import { describe, expect, it } from 'vitest';
import { FakeClock } from '@tourney/bridge';
import { DB, type Db } from '../src/db/database.js';
import { users } from '../src/db/schema.js';
import { discordOut, isWebhookUrl, type DiscordOut } from '../src/notify/discord-out.js';
import * as M from '../src/notify/messages.js';
import { NotificationsService } from '../src/notify/notifications.service.js';
import { Client, memoryLogger, startApi, startSeason, tournamentBody } from './helpers.js';
import { BetsService } from '../src/bets/bets.service.js';
import { EventLogService } from '../src/tournaments/event-log.service.js';
import { eq } from 'drizzle-orm';

const HOOK = 'https://discord.com/api/webhooks/123456/abc-DEF_1';

function fakeFetch(answers: Record<string, (n: number) => { status: number; body?: unknown }>) {
  const calls: { url: string; body: any; auth?: string }[] = [];
  const counts: Record<string, number> = {};
  const fn = async (url: string, init: RequestInit) => {
    const key = Object.keys(answers).find((k) => url.includes(k)) ?? '';
    counts[key] = (counts[key] ?? 0) + 1;
    calls.push({
      url,
      body: JSON.parse(String(init.body)),
      auth: (init.headers as Record<string, string>)['Authorization'],
    });
    const a = answers[key]?.(counts[key]!) ?? { status: 204 };
    return new Response(a.body === undefined ? null : JSON.stringify(a.body), { status: a.status });
  };
  return { fn, calls };
}

describe('discord out', () => {
  it('posts to real webhooks only and retries after a rate limit', async () => {
    const log = memoryLogger();
    const f = fakeFetch({
      webhooks: (n) => (n === 1 ? { status: 429, body: { retry_after: 0 } } : { status: 204 }),
    });
    const out = discordOut({ botToken: '', log, fetchFn: f.fn, gapMs: 0 });
    out.webhook('https://evil.example/api/webhooks/1/x', 'no');
    out.webhook(HOOK, 'hello *world*');
    await out.idle();
    expect(f.calls.map((c) => c.url)).toEqual([`${HOOK}?wait=false`, `${HOOK}?wait=false`]);
    expect(f.calls[1]!.body).toEqual({ content: 'hello *world*', allowed_mentions: { parse: [] } });
    expect(log.lines.some((l) => l.includes('not a Discord webhook'))).toBe(true);
    expect(isWebhookUrl('https://discordapp.com/api/v10/webhooks/1/abc')).toBe(true);
  });

  it('opens a DM channel once, and stops after a rejected token', async () => {
    const log = memoryLogger();
    const f = fakeFetch({
      '@me/channels': () => ({ status: 200, body: { id: '777' } }),
      '/channels/777/messages': () => ({ status: 200, body: {} }),
    });
    const out = discordOut({ botToken: 'tok', log, fetchFn: f.fn, gapMs: 0 });
    out.dm('300000000000000001', 'one');
    out.dm('300000000000000001', 'two');
    out.dm('dev:mario', 'never');
    await out.idle();
    expect(f.calls.map((c) => c.url.replace(/^.*api\/v10/, ''))).toEqual([
      '/users/@me/channels',
      '/channels/777/messages',
      '/channels/777/messages',
    ]);
    expect(f.calls[0]!.auth).toBe('Bot tok');

    const bad = fakeFetch({ '@me/channels': () => ({ status: 401 }) });
    const out2 = discordOut({ botToken: 'wrong', log, fetchFn: bad.fn, gapMs: 0 });
    out2.dm('300000000000000001', 'a');
    out2.dm('300000000000000002', 'b');
    await out2.idle();
    expect(bad.calls).toHaveLength(1);
    expect(log.lines.some((l) => l.includes('bot token was rejected'))).toBe(true);
  });

  it('survives a network error', async () => {
    const log = memoryLogger();
    const out = discordOut({
      botToken: '',
      log,
      fetchFn: async () => {
        throw new Error('ECONNREFUSED');
      },
      gapMs: 0,
    });
    out.webhook(HOOK, 'x');
    await out.idle();
    expect(log.lines.some((l) => l.includes('ECONNREFUSED'))).toBe(true);
  });
});

describe('messages', () => {
  const settings: any = { teamSize: 2, size: 8, format: 'double', game: { adapter: 'ut99-mh' } };
  it('describes results, races and decisions', () => {
    const p: any = {
      settings,
      name: 'Cup',
      entrants: { a: { displayName: 'Red*' }, b: { displayName: 'Blue' } },
    };
    const r = (over: any) => ({ matchId: 'W1-1', entrants: ['a', 'b'], winnerId: 'a', ...over });
    expect(
      M.matchResult(
        'en',
        p,
        r({ outcome: 'played', games: [{ winnerId: 'a', scores: { a: 310_000, b: 315_400 } }] }),
      ),
    ).toBe('`W1-1` **Red\\*** beats Blue – 5:10.0 / 5:15.4');
    expect(M.matchResult('de', p, r({ outcome: 'forfeit' }))).toBe(
      '`W1-1` **Red\\*** gewinnt kampflos gegen Blue',
    );
    expect(M.matchResult('en', p, r({ outcome: 'override', winnerId: 'b' }))).toContain(
      '(set by the organizer)',
    );
    expect(M.modeText('de', settings)).toBe('2on2 Monster Hunt (Zeitrennen)');
    const a = M.announce('en', {
      name: 'Cup',
      link: 'http://x/t/cup',
      settings,
      scheduledAt: '2026-10-13T18:00:00.000Z',
    });
    expect(a).toContain('<t:1791914400:F>');
    expect(M.dmPlacement('de', { name: 'Cup', link: '', settings }, 3, 'Red')).toBe(
      '**Cup**: **Red** ist ausgeschieden – Platz 3. Danke fürs Mitspielen!',
    );
    const t = { name: 'Cup', link: '', settings };
    expect(M.dmPlacement('de', t, 1)).toBe('🏆 Glückwunsch! Du hast **Cup** gewonnen.');
    expect(M.dmPlacement('de', t, 2)).toBe(
      '**Cup**: Du bist ausgeschieden – Platz 2. Danke fürs Mitspielen!',
    );
    expect(M.dmPlacement('en', t, 1)).toBe('🏆 Congratulations! You won **Cup**.');
    expect(M.dmPlacement('de', t, 1, 'Red')).toBe('🏆 Glückwunsch! **Red** hat **Cup** gewonnen.');
  });
});

describe('reminders', () => {
  it('reminds registered players once before the scheduled start', async () => {
    const clock = new FakeClock();
    const dms: string[] = [];
    const out: DiscordOut = {
      webhook: () => {},
      dm: (to) => void dms.push(to),
      idle: async () => {},
    };
    const { api } = await startApi({ DISCORD_BOT_TOKEN: 't' }, { clock, discordOut: out });
    try {
      const admin = await Client.login(api, 'Boss', true);
      await admin.post('/agents', { id: 'pi', name: 'Pi' });
      const mario = await Client.login(api, 'Mario');
      api.app
        .get<Db>(DB)
        .update(users)
        .set({ discordId: '300000000000000001' })
        .where(eq(users.displayName, 'Mario'))
        .run();
      const start = new Date(clock.now() + 60 * 60_000).toISOString();
      const { body } = await admin.post('/tournaments', tournamentBody({ scheduledAt: start }));
      await mario.post(`/tournaments/${body.id}/registration`);
      const svc = api.app.get(NotificationsService);
      svc.remindTick();
      expect(dms).toEqual([]); // an hour ahead: too early
      clock.advance(35 * 60_000);
      svc.remindTick();
      svc.remindTick();
      expect(dms).toEqual(['300000000000000001']);
    } finally {
      await api.close();
    }
  });
});

describe('bets in the channel', () => {
  it('posts bets open, closed with pools, payout and the summary', async () => {
    const posts: string[] = [];
    const out: DiscordOut = {
      webhook: (_url, text) => void posts.push(text),
      dm: () => {},
      idle: async () => {},
    };
    const { api } = await startApi(
      { DISCORD_WEBHOOK_URL: HOOK, NOTIFY_LANG: 'de' },
      { discordOut: out },
    );
    try {
      const admin = await Client.login(api, 'Boss', true);
      const carl = await Client.login(api, 'Carl');
      await admin.post('/agents', { id: 'pi', name: 'Pi' });
      await startSeason(admin);
      const t = await admin.post(
        '/tournaments',
        tournamentBody({ name: 'Bet Cup' }, { size: 4, format: 'single' }),
      );
      const id = t.body.id as string;
      const dave = await Client.login(api, 'Dave');
      const eve = await Client.login(api, 'Eve');
      await dave.post(`/tournaments/${id}/registration`);
      await eve.post(`/tournaments/${id}/registration`);
      const seeded = await admin.post(`/tournaments/${id}/seed`, {
        mode: 'auto',
        humanOrder: 'seeded',
        botPlacement: 'byes',
        rngSeed: 's',
      });
      expect(seeded.status, JSON.stringify(seeded.body)).toBe(200);
      const view = (await carl.get(`/bets/tournaments/${id}`)).body;
      const m = view.matches[0] as { matchId: string; entrants: [string, string] };
      const [a, b] = m.entrants;
      const put = (c: Client, pick: string, amount: number) =>
        c.req('PUT', `/bets/tournaments/${id}/${m.matchId}`, { pick, amount });
      expect((await put(admin, a, 600)).status).toBe(200);
      expect((await put(carl, b, 300)).status).toBe(200);
      const proj = (await admin.get(`/tournaments/${id}`)).body.projection;
      const name = (e: string) => proj.entrants[e].displayName as string;
      const log = api.app.get(EventLogService);
      const append = (events: Record<string, unknown>[]) => {
        const r = log.append(
          id,
          log.load(id).length,
          events.map((e) => ({ actor: { kind: 'bridge' }, ...e })),
        );
        if (!r.accepted) throw new Error(r.reason);
      };
      posts.length = 0;
      append([
        { type: 'checkin.opened', data: { serverProfileId: 'local' } },
        { type: 'tournament.started', data: {} },
        { type: 'match.called', data: { matchId: m.matchId, entrants: m.entrants } },
      ]);
      const open = posts.find((p) => p.startsWith('🎲'));
      expect(open).toContain(`noch mindestens 20 s: `);
      expect(open).toContain(`/t/${id}/m/${m.matchId}`);
      append([{ type: 'match.started', data: { matchId: m.matchId, game: 1 } }]);
      expect(posts.at(-1)).toBe(
        `🔒 Wetten geschlossen: **${name(a)}** vs **${name(b)}** – Pool 900 € · ` +
          `${name(a)} 1,5x (1 Wette) / ${name(b)} 3x (1 Wette) · größte Wette: Boss 600 € auf ${name(a)}`,
      );
      append([{ type: 'match.started', data: { matchId: m.matchId, game: 2 } }]);
      expect(posts.filter((p) => p.startsWith('🔒'))).toHaveLength(1); // only the first game
      append([
        {
          type: 'match.gameFinished',
          data: {
            matchId: m.matchId,
            game: 1,
            map: 'DM-Deck16][',
            scores: { [a]: 5, [b]: 20 },
            winnerId: b,
            endReason: 'fragLimit',
          },
        },
        {
          type: 'match.result',
          data: {
            result: { matchId: m.matchId, entrants: m.entrants, winnerId: b, outcome: 'played' },
          },
        },
      ]);
      const result = posts.find((p) => p.includes('💰'))!;
      expect(result.split('\n')[1]).toBe(
        `💰 Überraschung! 1 Wette auf **${name(b)}**: +600 € – größter Gewinn: Carl +600 € (3x)`,
      );
      const svc = api.app.get(BetsService);
      const names = { entrant: name, bettor: svc.bettorNames() };
      expect(M.betsTournament('de', svc.discordTournament(id)!, names)).toBe(
        '📊 Wetten: größter Gewinner Carl +600 € · größter Verlierer Boss −600 €',
      );

      // Switched off in the season's betting settings: nothing about bets.
      expect((await admin.req('PUT', '/settings/betting', { discord: false })).status).toBe(200);
      expect(svc.discordMatch(id, m.matchId)).toBeNull();
      expect(svc.discordTournament(id)).toBeNull();
    } finally {
      await api.close();
    }
  });
});

describe('bet texts', () => {
  const names: M.BetNames = { entrant: (e) => e.toUpperCase(), bettor: (k) => k };
  it('formats Neuro, odds and refunds in both languages', () => {
    const s = {
      entrants: ['a', 'b'] as [string, string],
      bettors: 2,
      total: 1240,
      sides: {
        a: { amount: 1000, bettors: 1, odds: 1.24 },
        b: { amount: 240, bettors: 1, odds: null },
      },
      biggest: null,
      outcome: { kind: 'refunded' as const, reason: 'oneSided' as const },
    };
    expect(M.betsClosed('en', s, names)).toBe(
      '🔒 Bets closed: **A** vs **B** – pool 1,240 € · A 1.24x (1 bet) / B – (1 bet)',
    );
    expect(M.betsPayout('de', s, names)).toBe(
      '↩️ Wetten zurückgezahlt (nur auf eine Seite gewettet)',
    );
    expect(M.neuro('de', 12345)).toBe('12.345 €');
    expect(
      M.betsTournament('en', { top: null, flop: null, versus: { humans: 210, bots: -215 } }, names),
    ).toBe('📊 Bets: man vs. machine: players +210 € / bots −215 €');
  });
});
