import { afterEach, describe, expect, it } from 'vitest';
import type { RunningApi } from '../src/app.js';
import { Client, startApi, tournamentBody } from './helpers.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

describe('seeding at random', () => {
  it('mixes players and bots; registration order keeps the bots on the lowest seeds', async () => {
    ({ api } = await startApi());
    const admin = await Client.login(api, 'Boss', true);
    const mario = await Client.login(api, 'Mario');
    const anna = await Client.login(api, 'Anna');
    await admin.post('/agents', { id: 'pi', name: 'Pi' });
    const id = (
      await admin.post(
        '/tournaments',
        tournamentBody({ name: 'Mix' }, { size: 8, format: 'single' }),
      )
    ).body.id as string;
    await mario.post(`/tournaments/${id}/registration`);
    await anna.post(`/tournaments/${id}/registration`);
    const humanSlots = async (humanOrder: string, rngSeed: string) => {
      const r = await admin.post(`/tournaments/${id}/seed`, { mode: 'auto', humanOrder, rngSeed });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const slots = r.body.projection.bracketDefinition.slots as string[];
      return slots.flatMap((s, i) => (s.startsWith('u-') ? [i] : []));
    };
    const random = new Set<string>();
    let together = 0;
    for (let i = 0; i < 30; i++) {
      const pos = await humanSlots('random', `r${i}`);
      random.add(pos.join(','));
      if (Math.floor(pos[0]! / 2) === Math.floor(pos[1]! / 2)) together++;
    }
    // Anywhere in the bracket, sometimes even against each other in round one.
    expect(random.size).toBeGreaterThan(10);
    expect(together).toBeGreaterThan(0);
    // Registration order: the players take the top seeds (one per half).
    for (let i = 0; i < 5; i++) expect(await humanSlots('seeded', `s${i}`)).toEqual([0, 4]);
  });
});
