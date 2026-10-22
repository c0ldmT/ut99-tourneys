import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addFakeLodMesh,
  addFakeTexture,
  BridgeConfigSchema,
  FakeClock,
  FakePackageBuilder,
  memoryLogger,
  ModServer,
  WebsiteAgent,
} from '@tourney/bridge';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentsService } from '../src/agents/agents.service.js';
import type { RunningApi } from '../src/app.js';
import { lookSlots } from '../src/bots/models.js';
import { Client, startApi } from './helpers.js';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function until(cond: () => boolean | Promise<boolean>, ms = 10_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timeout');
}

function tmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanups.push(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

/** A UT installation with a custom model (RoboPack.RoboBot, mesh Robo) and its skins. */
function installation(): string {
  const root = tmp('look-ut-');
  fs.mkdirSync(path.join(root, 'System'));
  fs.mkdirSync(path.join(root, 'Textures'));
  const model = new FakePackageBuilder();
  const tri: [number, number, number][] = [
    [0, 0, 0],
    [10, 0, 0],
    [0, 10, 0],
  ];
  addFakeLodMesh(model, 'Robo', {
    frames: [tri, tri],
    wedges: [
      [0, 0, 0],
      [1, 255, 0],
      [2, 0, 255],
    ],
    faces: [[0, 1, 2, 0]],
    materials: [{ slot: 1, flags: 0 }],
    sequences: [['Breath2', 0, 2, 7]],
  });
  fs.writeFileSync(path.join(root, 'System', 'RoboPack.u'), model.build());
  fs.writeFileSync(
    path.join(root, 'System', 'RoboPack.int'),
    '[Public]\r\nObject=(Name=RoboPack.RoboBot,Class=Class,MetaClass=Botpack.Bot,Description="Robo")\r\n',
  );
  const skins = new FakePackageBuilder();
  for (const n of ['robo1', 'robo2', 'robo2Zed', 'robo5Zed', 'robo3', 'robo3T_0', 'robo4'])
    addFakeTexture(
      skins,
      n,
      2,
      2,
      [0, 1, 1, 0],
      [
        [1, 2, 3],
        [4, 5, 6],
      ],
    );
  fs.writeFileSync(path.join(root, 'Textures', 'RoboSkins.utx'), skins.build());
  return root;
}

async function setup(dataDir = ':memory:') {
  const clock = new FakeClock();
  const { api } = await startApi({ DATA_DIR: dataDir }, { clock });
  cleanups.push(() => api.close());
  const admin = await Client.login(api, 'Boss', true);
  const player = await Client.login(api, 'Mario');
  const { token } = (await admin.post('/agents', { id: 'pi', name: 'Raspberry' })).body;
  const log = memoryLogger();
  const mod = new ModServer({ host: '127.0.0.1', port: 0, sharedKey: 'test-shared-key', log });
  await mod.listen();
  cleanups.push(() => mod.close());
  const config = BridgeConfigSchema.parse({
    agentId: 'pi',
    mod: { host: '127.0.0.1', port: 7790, sharedKey: 'test-shared-key' },
    server: {
      id: 'local',
      name: 'Test server',
      os: 'linux',
      installDir: installation(),
      lobbyMap: 'DM-Deck16][',
      manage: false,
    },
    website: { url: `${api.url.replace('http', 'ws')}/api/agent`, token },
  });
  const agent = new WebsiteAgent({
    config: { ...config, website: config.website! },
    baseDir: '.',
    mod,
    clock,
    log,
    memoryOnly: true,
  });
  agent.start();
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await agent.stop();
  };
  cleanups.push(stop);
  await until(async () => (await admin.get('/agents')).body[0]?.online === true);
  expect((await admin.post('/agents/pi/profiles/local/rescan')).status).toBe(204);
  // The mod reports the class defaults (decision 173).
  api.app.get(AgentsService).saveClassDefaults('pi', 'local', [
    {
      name: 'RoboPack.RoboBot',
      mesh: 'Robo',
      multi: true,
      voiceMeta: '',
      voice: '',
      skin: 'RoboSkins.robo',
    },
  ]);
  return { api, admin, player, stop };
}

async function raw(api: RunningApi, c: Client, p: string) {
  return fetch(`${api.url}/api${p}`, { headers: { Cookie: c.cookie } });
}

describe('3D look previews (decision 176)', () => {
  it('puts skin, face and team textures on the skin slots as UT does', () => {
    const known = new Set(
      ['robo1', 'robo2', 'robo2Zed', 'robo5Zed', 'robo3', 'robo3T_0', 'robo4', 'robo4T_1'].map(
        (n) => `roboskins.${n}`.toLowerCase(),
      ),
    );
    const listed = new Set(['roboskins']);
    const base = { multi: true, defaultSkin: 'RoboSkins.robo', meshTextures: [], known, listed };
    expect(lookSlots({ ...base, skin: '', face: '', team: null })).toEqual({
      slots: [
        'RoboSkins.robo1',
        'RoboSkins.robo2',
        'RoboSkins.robo3',
        'RoboSkins.robo4',
        '',
        '',
        '',
        '',
      ],
      portrait: null,
      teams: true,
    });
    expect(
      lookSlots({ ...base, skin: 'RoboSkins.robo', face: 'RoboSkins.Zed', team: 0 }).slots.slice(
        0,
        4,
      ),
    ).toEqual(['RoboSkins.robo1', 'RoboSkins.robo2Zed', 'RoboSkins.robo3T_0', 'RoboSkins.robo4']);
    expect(lookSlots({ ...base, skin: '', face: 'RoboSkins.Zed', team: 1 }).portrait).toBe(
      'RoboSkins.robo5Zed',
    );
    expect(lookSlots({ ...base, skin: '', face: '', team: 1 }).slots[3]).toBe('RoboSkins.robo4T_1');
    // A package the servers did not list: the plain skin textures.
    expect(lookSlots({ ...base, skin: 'OtherSkins.oth', face: 'OtherSkins.Ann', team: 0 })).toEqual(
      {
        slots: [
          'OtherSkins.oth1',
          'OtherSkins.oth2',
          'OtherSkins.oth3',
          'OtherSkins.oth4',
          '',
          '',
          '',
          '',
        ],
        portrait: null,
        teams: false,
      },
    );
    // Faces of a package known from the .int files only (no team colours, no portrait).
    const fromInt = lookSlots({
      ...base,
      known: new Set(['soldierskins.blkt1', 'soldierskins.blkt4malcom']),
      listed: new Set(),
      skin: 'SoldierSkins.blkt',
      face: 'SoldierSkins.Malcom',
      team: 1,
    });
    expect(fromInt.slots.slice(0, 4)).toEqual([
      'SoldierSkins.blkt1',
      'SoldierSkins.blkt2',
      'SoldierSkins.blkt3',
      'SoldierSkins.blkt4Malcom',
    ]);
    expect([fromInt.portrait, fromInt.teams]).toEqual([null, false]);
    // Old skin format: the skin is the actor's Skin (slot 0 and slots without an own texture).
    expect(
      lookSlots({
        multi: false,
        defaultSkin: null,
        meshTextures: ['Nali.Body', 'Nali.Eyes'],
        skin: 'NaliSkins.Blue',
        face: '',
        team: null,
        known,
        listed,
      }).slots.slice(0, 3),
    ).toEqual(['NaliSkins.Blue', 'Nali.Eyes', 'NaliSkins.Blue']);
  });

  it('serves the mesh, the skin slots and the textures of a server model, cached', async () => {
    const dataDir = tmp('look-data-');
    const { api, admin, player, stop } = await setup(dataDir);
    const look = await player.get(
      '/looks/preview?cls=RoboPack.RoboBot&skin=RoboSkins.robo&face=RoboSkins.Zed&team=0',
    );
    expect(look.status).toBe(200);
    expect(look.body).toMatchObject({
      slots: [
        'RoboSkins.robo1',
        'RoboSkins.robo2Zed',
        'RoboSkins.robo3T_0',
        'RoboSkins.robo4',
        '',
        '',
        '',
        '',
      ],
      portrait: 'RoboSkins.robo5Zed',
      teams: true,
    });
    const stamp: string = look.body.stamp;
    expect(stamp).toMatch(/^[0-9a-f]{16}$/);

    const mesh = await raw(api, player, `/looks/mesh?cls=RoboPack.RoboBot&v=${stamp}`);
    expect(mesh.status).toBe(200);
    expect(mesh.headers.get('cache-control')).toContain('immutable');
    expect(await mesh.json()).toMatchObject({
      name: 'Robo',
      seq: 'Breath2',
      frames: 2,
      modelVerts: 3,
    });
    const stale = await raw(api, player, '/looks/mesh?cls=RoboPack.RoboBot&v=old');
    expect(stale.headers.get('cache-control')).toContain('no-cache');

    const tex = await raw(api, player, `/looks/texture/RoboSkins.robo2Zed?v=${stamp}`);
    expect(tex.status).toBe(200);
    expect(tex.headers.get('content-type')).toBe('image/png');
    const png = Buffer.from(await tex.arrayBuffer());
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(fs.readdirSync(path.join(dataDir, 'look-previews', 'pi', stamp)).length).toBe(2);
    expect((await player.get('/looks/texture/..%2F..%2Fetc')).status).toBe(400);

    // What the server does not have, and models without a known mesh.
    expect((await player.get('/looks/texture/RoboSkins.nope')).status).toBe(404);
    const unknown = await player.get('/looks/preview?cls=Foo.BarBot');
    expect(unknown.status).toBe(404);
    expect(unknown.body.key).toBe('3D preview of {name} not found');
    expect((await player.get('/looks/preview?cls=RoboPack.RoboBot&team=9')).status).toBe(400);
    // Logged out: nothing.
    expect((await new Client(api).get('/looks/preview?cls=RoboPack.RoboBot')).status).toBe(401);

    // The server goes offline: what was seen stays, the rest is not there.
    await stop();
    await until(async () => (await admin.get('/agents')).body[0]?.online === false);
    expect((await raw(api, player, `/looks/texture/RoboSkins.robo2Zed?v=${stamp}`)).status).toBe(
      200,
    );
    expect((await player.get('/looks/texture/RoboSkins.robo1')).status).toBe(404);
  });
});
