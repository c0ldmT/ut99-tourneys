import net from 'node:net';
import { describe, expect, it } from 'vitest';
import { computeBracket, createRng } from '@tourney/bracket';
import { encodeModLine, MAX_LINE_BYTES, projectTournament } from '@tourney/protocol';
import { FakeClock } from '../src/clock.js';
import { LocalEventStore } from '../src/event-store.js';
import { memoryLogger } from '../src/log.js';
import { ModServer } from '../src/mod-server.js';
import { bracketLines, standingsLines } from '../src/snapshot.js';
import { bootstrapFromFile } from '../src/bootstrap.js';
import { tournamentFile } from './harness.js';

describe('FakeClock', () => {
  it('fires timers in order, including ones scheduled while advancing', () => {
    const c = new FakeClock(0);
    const out: string[] = [];
    c.setTimeout(() => {
      out.push('a');
      c.setTimeout(() => out.push('c'), 5);
    }, 10);
    c.setTimeout(() => out.push('b'), 12);
    const h = c.setTimeout(() => out.push('never'), 11);
    c.clearTimeout(h);
    c.advance(20);
    expect(out).toEqual(['a', 'b', 'c']);
    expect(c.now()).toBe(20);
  });
});

describe('ModServer', () => {
  const connect = (port: number) =>
    new Promise<net.Socket>((resolve) => {
      const s = net.connect(port, '127.0.0.1', () => resolve(s));
    });

  it('rejects a wrong shared key and accepts the right one', async () => {
    const log = memoryLogger();
    const server = new ModServer({ host: '127.0.0.1', port: 0, sharedKey: 'secret-key', log });
    await server.listen();
    const port = server.address!.port;
    const hello = (key: string) =>
      encodeModLine({ t: 'hello', key, pv: 1, mv: 't', eng: 469, lvl: 'DM-Deck16][', gm: false });

    const bad = await connect(port);
    const closed = new Promise((r) => bad.on('close', r));
    bad.write(hello('wrong'));
    await closed;
    expect(server.connected).toBe(false);

    const good = await connect(port);
    const gotHello = new Promise((r) => server.once('hello', r));
    good.write(hello('secret-key'));
    await gotHello;
    expect(server.connected).toBe(true);
    const gotMsg = new Promise((r) => server.once('message', r));
    good.write('garbage\n' + encodeModLine({ t: 'ready', pid: 2 }));
    expect(await gotMsg).toEqual({ t: 'ready', pid: 2 });
    expect(log.lines.some((l) => l.includes('bad line'))).toBe(true);
    good.destroy();
    await server.close();
  });
});

describe('snapshot lines', () => {
  it('a 32 player double elimination bracket with long unicode names fits the line limit', async () => {
    const store = new LocalEventStore(new FakeClock());
    const many = Array.from({ length: 32 }, (_, i) => ({
      userId: `u${i}`,
      displayName: `Ünïcødé Spieler Nummer ${i} mit sehr langem Namen`.slice(0, 32),
      token: `token-${i}-xxxx`,
    }));
    const file = tournamentFile({ players: many }, { size: 32, format: 'double' });
    await bootstrapFromFile(store, file);
    const proj = projectTournament(await store.load(file.tournamentId));
    // Play some random results so scores and winners are filled in.
    const rng = createRng(1);
    let state = proj.bracket!;
    for (let i = 0; i < 40; i++) {
      const m = state.matches.find((x) => x.status === 'ready');
      if (!m) break;
      const [a, b] = m.entrants as [string, string];
      proj.results.push({
        matchId: m.id,
        entrants: [a, b],
        winnerId: rng() < 0.5 ? a : b,
        outcome: 'played',
      });
      state = computeBracket(state.definition, proj.results);
    }
    proj.bracket = state;
    const lines = [...bracketLines(proj, 'W1-1', 1), ...standingsLines(proj, 1)];
    expect(lines).toHaveLength(1 + 63 + 1 + 32);
    for (const l of lines) expect(encodeModLine(l).length).toBeLessThanOrEqual(MAX_LINE_BYTES);
  });
});
