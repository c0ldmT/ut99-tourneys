import { afterEach, describe, expect, it } from 'vitest';
import type { RunningApi } from '../src/app.js';
import { lookView } from '../src/shop/catalog.js';
import { Client, startApi, startSeason } from './helpers.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

describe('Neuro shop', () => {
  it('sells looks above the rescue floor, wears them, refunds rejected dedications', async () => {
    ({ api } = await startApi());
    const admin = await Client.login(api, 'Boss', true);
    const mario = await Client.login(api, 'Mario');
    // No season: nothing to spend.
    expect((await mario.post('/shop/buy', { item: 'badge.crown' })).status).toBe(409);
    await startSeason(admin);
    const v = (await mario.get('/shop')).body;
    expect(v.wallet).toMatchObject({ balance: 1000, floor: 100, spendable: 900 });
    expect(v.items.find((i: any) => i.id === 'title.godlike')).toMatchObject({ price: 5000 });
    // Above the floor only.
    expect((await mario.post('/shop/buy', { item: 'title.neuro-baron' })).status).toBe(409);
    const bought = await mario.post('/shop/buy', { item: 'title.frag-machine' });
    expect(bought.status, JSON.stringify(bought.body)).toBe(200);
    expect(bought.body.wallet).toMatchObject({ balance: 400, spendable: 300 });
    expect(bought.body.look).toEqual({ title: 'title.frag-machine' });
    expect((await mario.post('/shop/buy', { item: 'title.frag-machine' })).status).toBe(409);
    expect((await mario.post('/shop/buy', { item: 'color.teal' })).status).toBe(409);
    expect((await mario.post('/shop/buy', { item: 'badge.crown' })).status).toBe(200);
    const marioId = (await mario.get('/me')).body.id;
    // The bets wallet knows the spending.
    expect((await mario.get(`/bets/users/${marioId}`)).body.wallet).toMatchObject({
      balance: 150,
      spent: 850,
    });
    // Wear and take off; only owned items.
    expect((await mario.put('/shop/look', { slot: 'title', item: null })).body.look).toEqual({
      badge: 'badge.crown',
    });
    expect((await mario.put('/shop/look', { slot: 'color', item: 'color.gold' })).status).toBe(403);
    await mario.put('/shop/look', { slot: 'title', item: 'title.frag-machine' });
    const looks = (await mario.get('/shop/looks')).body;
    expect(looks).toEqual([
      { userId: marioId, name: 'Mario', look: { title: 'Frag Machine', badge: 'crown' } },
    ]);

    // Admin: prices, items taken out.
    expect(
      (
        await admin.req('PUT', '/settings/shop', {
          prices: { dedication: 50 },
          hidden: ['badge.skull'],
        })
      ).status,
    ).toBe(200);
    const v2 = (await mario.get('/shop')).body;
    expect(v2.items.some((i: any) => i.id === 'badge.skull')).toBe(false);
    expect(v2.items.find((i: any) => i.id === 'dedication').price).toBe(50);
    // Dedication: lines needed, waits for an admin, a rejection refunds.
    expect((await mario.post('/shop/buy', { item: 'dedication' })).status).toBe(400);
    const ded = await mario.post('/shop/buy', {
      item: 'dedication',
      dedication: { kill: '{killer}: nicht schon wieder du, {victim}!', death: '' },
    });
    expect(ded.status, JSON.stringify(ded.body)).toBe(200);
    expect(ded.body.dedication).toMatchObject({ status: 'pending' });
    expect(ded.body.wallet.balance).toBe(100);
    const log = (await admin.get('/shop/admin')).body.log;
    const p = log.find((x: any) => x.item === 'dedication');
    await admin.post(`/shop/admin/dedications/${p.id}`, { approve: false });
    const after = (await mario.get('/shop')).body;
    expect(after.dedication.status).toBe('rejected');
    expect(after.wallet.balance).toBe(150);
    // Bought again and approved.
    await mario.post('/shop/buy', { item: 'dedication', dedication: { kill: 'GG {victim}' } });
    const p2 = (await admin.get('/shop/admin')).body.log.find((x: any) => x.item === 'dedication');
    await admin.post(`/shop/admin/dedications/${p2.id}`, { approve: true });
    expect((await mario.get('/shop')).body.dedication).toMatchObject({ status: 'approved' });
    // Players cannot open the admin view.
    expect((await mario.get('/shop/admin')).status).toBe(403);
    // A reset takes the purchases with the seasons.
    expect((await admin.post('/settings/reset', { confirm: 'RESET' })).status).toBe(200);
    expect((await mario.get('/shop/looks')).body).toEqual([]);
  });

  it('draws only valid slots of a look', () => {
    expect(lookView({ title: 'color.neon', color: 'color.neon', fanfare: 'fanfare' })).toEqual({
      color: 'linear-gradient(90deg,#22d3ee,#f0468c)',
      fanfare: true,
    });
  });
});
