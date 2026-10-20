import { afterEach, describe, expect, it } from 'vitest';
import type { RunningApi } from '../src/app.js';
import { LedgerService } from '../src/ledger/ledger.service.js';
import { NeuroHub } from '../src/ledger/neuro-hub.js';
import { Client, startApi, startSeason } from './helpers.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

describe('Neuro ledger', () => {
  it('books into the wallet once per ref, charges only above the floor, goes with a reset', async () => {
    ({ api } = await startApi());
    const admin = await Client.login(api, 'Boss', true);
    const mario = await Client.login(api, 'Mario');
    const id = (await mario.get('/me')).body.id as string;
    const ledger = api.app.get(LedgerService);
    expect(ledger.spendable(id)).toMatchObject({ season: null, spendable: 0 });
    expect(() => ledger.charge({ userId: id, kind: 'udt_purchase', amount: 10, ref: 'x' })).toThrow(
      /no season/,
    );
    await startSeason(admin);
    expect(ledger.book({ season: 1, userId: id, kind: 'udt_reward', amount: 250, ref: 'r1' })).toBe(
      true,
    );
    expect(ledger.book({ season: 1, userId: id, kind: 'udt_reward', amount: 250, ref: 'r1' })).toBe(
      false,
    );
    const wallet = (await mario.get(`/bets/users/${id}`)).body.wallet;
    expect(wallet).toMatchObject({ balance: 1250, ledger: 250 });
    expect(ledger.spendable(id)).toMatchObject({ season: 1, spendable: 1150, floor: 100 });
    expect(() =>
      ledger.charge({ userId: id, kind: 'udt_purchase', amount: 1200, ref: 'buy1' }),
    ).toThrow(/not enough Neuro/);
    expect(ledger.charge({ userId: id, kind: 'udt_purchase', amount: 1150, ref: 'buy1' })).toBe(1);
    expect(ledger.spendable(id)).toMatchObject({ balance: 100, spendable: 0 });
    expect(ledger.entries(id, 1).map((e) => [e.kind, e.amount])).toEqual([
      ['udt_purchase', -1150],
      ['udt_reward', 250],
    ]);
    // The leaderboard sees the bookings.
    const lb = (await mario.get('/bets/leaderboard')).body;
    expect(lb.rows.find((r: { userId: string }) => r.userId === id)?.balance).toBe(100);
    expect((await admin.post('/settings/reset', { confirm: 'RESET' })).status).toBe(200);
    expect(ledger.has('r1')).toBe(false);
  });

  it('one wallet snapshot for every display, a push when it changes', async () => {
    ({ api } = await startApi());
    const admin = await Client.login(api, 'Boss', true);
    const mario = await Client.login(api, 'Mario');
    const id = (await mario.get('/me')).body.id as string;
    expect((await mario.get('/me/neuro')).body).toMatchObject({ season: null, spendable: 0 });
    await startSeason(admin);
    const hub = api.app.get(NeuroHub);
    let pushes = 0;
    const off = hub.subscribe(id, () => pushes++);
    api.app
      .get(LedgerService)
      .book({ season: 1, userId: id, kind: 'udt_reward', amount: 300, ref: 'r1' });
    expect(pushes).toBe(1);
    // Booked once: no second push.
    api.app
      .get(LedgerService)
      .book({ season: 1, userId: id, kind: 'udt_reward', amount: 300, ref: 'r1' });
    expect(pushes).toBe(1);
    off();
    expect((await mario.get('/me/neuro')).body).toEqual({
      season: 1,
      running: true,
      balance: 1300,
      staked: 0,
      free: 1300,
      floor: 100,
      spendable: 1200,
    });
  });
});
