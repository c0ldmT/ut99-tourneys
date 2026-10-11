import { afterEach, describe, expect, it } from 'vitest';
import { players, setup, tournamentFile } from './harness.js';

type Env = Awaited<ReturnType<typeof setup>>;
let env: Env | undefined;
afterEach(async () => {
  await env?.close();
  env = undefined;
});

const finished = (e: Env) => () => e.director.projection.phase === 'finished';
const events = (e: Env, type: string) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (e.director as any).events.filter((x: { type: string }) => x.type === type) as any[];

describe('end to end against the simulated UT server', () => {
  it('plays a full double elimination tournament (5 humans, 3 bots)', async () => {
    env = await setup({});
    const t0 = env.clock.now();
    await env.run(finished(env));
    const p = env.director.projection;
    expect(p.championId).toBeDefined();
    // ~20 s per match (vote, load, ready, countdown, 10 s game): no step waited for a timeout.
    expect(env.clock.now() - t0).toBeLessThan(15 * 25_000);
    expect(p.bracket?.status).toBe('finished');
    expect(p.bracket?.issues).toEqual([]);
    expect([14, 15]).toContain(p.results.length);
    // Every match was played on the server: one travel per game.
    const games = Object.values(p.games).flat();
    expect(env.sim.travels).toHaveLength(games.length);
    expect(p.mapHistory).toHaveLength(games.length);
    expect(p.results.every((r) => r.outcome === 'played')).toBe(true);
    // All humans checked in, every map comes from the pool.
    expect(p.checkedIn.sort()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    for (const g of games) expect(env.file.settings.game.rules['mapPool']).toContain(g.map);
    // Map votes were recorded with their method.
    expect(events(env, 'match.mapSelected').every((e) => e.data.method === 'vote')).toBe(true);
    // Humans voted themselves (no vote ran into the timeout and got filled randomly).
    for (const e of events(env, 'match.mapSelected')) {
      for (const b of e.data.details.ballots) {
        if (b.entrantId.startsWith('p'))
          expect(b.random, `${e.data.matchId} ${b.entrantId}`).toBe(false);
      }
    }
    // Happy path: no warnings, no errors, no re-sent travels.
    expect(env.log.lines.filter((l) => /^(warn|error):/.test(l))).toEqual([]);
    // Bracket and standings reach the server after every result.
    expect(env.sim.received.filter((m) => m.t === 'brh').length).toBeGreaterThan(p.results.length);
  });

  it('simulates bot vs bot matches when configured', async () => {
    const file = tournamentFile(
      { players: players.slice(0, 2) },
      { format: 'single', botMatchMode: 'simulate' },
    );
    env = await setup({ file });
    await env.run(finished(env));
    const outcomes = env.director.projection.results.map((r) => r.outcome);
    expect(outcomes).toContain('simulated');
    expect(env.director.projection.results).toHaveLength(7);
  });

  it('random map mode needs no vote', async () => {
    const file = tournamentFile(
      { players: players.slice(0, 3) },
      { format: 'single', rules: { mapMode: 'random' } },
    );
    env = await setup({ file });
    await env.run(finished(env));
    expect(events(env, 'match.mapSelected').every((e) => e.data.method === 'random')).toBe(true);
  });

  it('replaces players who do not check in with bots', async () => {
    env = await setup({ behaviour: { absent: ['tim-token'] } });
    await env.run(() => env!.director.projection.phase === 'running');
    const replaced = events(env, 'entrant.replaced');
    expect(replaced).toHaveLength(1);
    expect(replaced[0].data.entrantId).toBe('p5');
    expect(env.director.projection.entrants['p5']?.kind).toBe('bot');
    await env.run(finished(env));
  });

  it('a player who never readies up forfeits (twice in double elimination)', async () => {
    env = await setup({ behaviour: { neverReady: ['anna-token'] } });
    await env.run(finished(env));
    const forfeits = env.director.projection.results.filter((r) => r.outcome === 'forfeit');
    expect(forfeits).toHaveLength(2);
    expect(forfeits.every((r) => r.winnerId !== 'p2' && r.entrants.includes('p2'))).toBe(true);
    const anna = env.director.projection.bracket?.standings.find((s) => s.entrantId === 'p2');
    expect(anna?.losses).toBe(2);
  });

  it('a disconnected player who returns in time continues the game', async () => {
    env = await setup({
      behaviour: { dropDuringLive: { token: 'mario-token', returnAfterMs: 20_000 } },
    });
    await env.run(finished(env));
    expect(env.director.projection.results.every((r) => r.outcome === 'played')).toBe(true);
    expect(env.sim.received.some((m) => m.t === 'pause' && m.on)).toBe(true);
    expect(env.sim.received.some((m) => m.t === 'pause' && !m.on)).toBe(true);
  });

  it('a disconnected player who does not return forfeits', async () => {
    env = await setup({ behaviour: { dropDuringLive: { token: 'mario-token' } } });
    await env.run(() => env!.director.projection.results.some((r) => r.outcome === 'forfeit'));
    const f = env.director.projection.results.find((r) => r.outcome === 'forfeit');
    expect(f?.entrants).toContain('p1');
    expect(f?.winnerId).not.toBe('p1');
    expect(env.sim.received.some((m) => m.t === 'abort')).toBe(true);
  });

  it('plays a best-of-3 grand final where the loser picks the next map', async () => {
    const file = tournamentFile({}, { bestOf: { default: 1, grandFinal: 3 } });
    env = await setup({ file });
    await env.run(finished(env));
    const gf = env.director.projection.results.find((r) => r.matchId === 'GF1');
    expect(gf?.games?.length).toBeGreaterThanOrEqual(2);
    const methods = events(env, 'match.mapSelected')
      .filter((e) => e.data.matchId === 'GF1')
      .map((e) => e.data.method);
    expect(methods[0]).toBe('vote');
    expect(methods.slice(1).every((m: string) => m === 'loserPick')).toBe(true);
  });

  it('survives a bridge restart in the middle of a live game', async () => {
    env = await setup({});
    await env.run(
      () => env!.director.stageKind === 'live' && env!.director.projection.results.length >= 3,
    );
    const before = env.director.projection.results.length;
    await env.restartDirector();
    await env.run(finished(env));
    expect(env.director.projection.results.length).toBeGreaterThan(before);
    expect(env.director.projection.bracket?.issues).toEqual([]);
  });

  it('sends a consistent snapshot: access roles match the current match', async () => {
    env = await setup({});
    await env.run(() => env!.director.stageKind === 'readyCheck');
    const cm = env.director.projection.currentMatch!;
    const acl = env.sim.received.filter((m) => m.t === 'acle').slice(-6);
    const roles = Object.fromEntries(acl.map((m) => (m.t === 'acle' ? [m.tk, m.r] : [])));
    const tokenOf = (eid: string) => players[Number(eid.slice(1)) - 1]?.token;
    for (const [i, eid] of cm.entrants.entries()) {
      if (eid.startsWith('p')) expect(roles[tokenOf(eid)!]).toBe(i === 0 ? 'a' : 'b');
    }
    expect(roles['guest-token']).toBe('s');
  });

  it('reminds every 30 s who the tournament is waiting for', async () => {
    env = await setup({ behaviour: { absent: ['tim-token'], neverReady: ['anna-token'] } });
    const says = () => env!.sim.received.flatMap((m) => (m.t === 'say' ? [m.msg] : []));
    await env.run(() => says().some((m) => m.startsWith('Waiting for check-in')));
    const checkIn = says().find((m) => m.startsWith('Waiting for check-in'))!;
    expect(checkIn).toContain('(4/5): Tim');
    expect(checkIn).toMatch(/Start in 0:\d\d/);
    // After the check-in window Tim is replaced; Anna never readies up in her first match.
    await env.run(() => says().some((m) => m.includes('waits for READY: Anna')));
    expect(says().find((m) => m.includes('waits for READY'))).toMatch(
      /Anna \(press FIRE or !ready\)\. Forfeit in \d:\d\d/,
    );
  });

  it('says nothing while games run normally', async () => {
    env = await setup({});
    await env.run(() => env!.director.projection.results.length >= 3);
    const reminders = env.sim.received.filter(
      (m) =>
        m.t === 'say' && /^(Waiting|Map vote .*waiting|.* waits for READY|Game paused)/.test(m.msg),
    );
    expect(reminders).toEqual([]);
  });

  it('allows maxReconnects returns and warns before the last one', async () => {
    env = await setup({
      behaviour: { dropDuringLive: { token: 'mario-token', returnAfterMs: 3_000, times: 2 } },
    });
    await env.run(() => env!.sim.received.some((m) => m.t === 'warn'));
    const warn = env.sim.received.find((m) => m.t === 'warn');
    expect(warn).toMatchObject({ msg: expect.stringContaining('FORFEIT') });
    expect(
      env.sim.received.some((m) => m.t === 'say' && m.msg === 'Reconnects left in this match: 1'),
    ).toBe(true);
    await env.run(finished(env));
    expect(env.director.projection.results.every((r) => r.outcome === 'played')).toBe(true);
  });

  it('forfeits on the disconnect after the last allowed reconnect', async () => {
    env = await setup({
      behaviour: { dropDuringLive: { token: 'mario-token', returnAfterMs: 3_000, times: 3 } },
    });
    await env.run(() => env!.director.projection.results.some((r) => r.outcome === 'forfeit'));
    const f = env.director.projection.results.find((r) => r.outcome === 'forfeit')!;
    expect(f.entrants).toContain('p1');
    expect(f.winnerId).not.toBe('p1');
    expect(
      env.sim.received.some((m) => m.t === 'say' && /disconnected 3 times .* forfeits/.test(m.msg)),
    ).toBe(true);
  });
});
