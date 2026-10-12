import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseRules } from '@tourney/adapter-ut99';
import { ServerProfileSchema } from '@tourney/protocol';
import { FakeClock } from '../src/clock.js';
import { memoryLogger } from '../src/log.js';
import { IniFile } from '../src/ut99/ini.js';
import { scanInventory } from '../src/ut99/inventory.js';
import { prepareServer, resolveBinary, ServerSetupError } from '../src/ut99/prepare.js';
import { ServerProcess } from '../src/ut99/server-process.js';
import { readLevelMeta } from '../src/ut99/unreal-package.js';

const tmpDirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tourney-'));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// A tiny writer for UE1 packages, mirroring the reader (format per the UT99 package layout).
// ---------------------------------------------------------------------------------------------
function compactIndex(v: number): Buffer {
  const out: number[] = [];
  const abs = Math.abs(v);
  let b0 = abs & 0x3f;
  if (v < 0) b0 |= 0x80;
  let rest = abs >> 6;
  if (rest) b0 |= 0x40;
  out.push(b0);
  while (rest) {
    let b = rest & 0x7f;
    rest >>= 7;
    if (rest) b |= 0x80;
    out.push(b);
  }
  return Buffer.from(out);
}
const u32 = (v: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0);
  return b;
};
const i32 = (v: number) => {
  const b = Buffer.alloc(4);
  b.writeInt32LE(v);
  return b;
};
const fstr = (s: string) =>
  Buffer.concat([compactIndex(s.length + 1), Buffer.from(s + '\0', 'latin1')]);

function fakeMap(props: Record<string, string>, opts: { withStack?: boolean } = {}): Buffer {
  const names = [
    'None',
    'Core',
    'Engine',
    'Class',
    'LevelInfo',
    'LevelInfo0',
    'Title',
    'Author',
    'IdealPlayerCount',
    'bHighDetail',
    'Gravity',
  ];
  const n = (s: string) => names.indexOf(s);
  // Object data: optional state frame, tagged properties, None.
  const parts: Buffer[] = [];
  if (opts.withStack !== false) {
    parts.push(compactIndex(0), compactIndex(0), Buffer.alloc(8), i32(0)); // node=0 -> no offset
  }
  parts.push(compactIndex(n('bHighDetail')), Buffer.from([0x03 | 0x80])); // bool true, no payload
  parts.push(compactIndex(n('Gravity')), Buffer.from([0x24]), Buffer.alloc(4)); // float, size code 2
  for (const [k, v] of Object.entries(props)) {
    const payload = fstr(v);
    parts.push(compactIndex(n(k)), Buffer.from([0x5d]), Buffer.from([payload.length]), payload); // str, size byte
  }
  parts.push(compactIndex(n('None')));
  const object = Buffer.concat(parts);

  const header = 4 + 2 + 2 + 4 + 6 * 4;
  const nameTable = Buffer.concat(names.map((s) => Buffer.concat([fstr(s), u32(0)])));
  const importTable = Buffer.concat([
    // Engine.LevelInfo (class) and Engine package
    Buffer.concat([
      compactIndex(n('Core')),
      compactIndex(n('Class')),
      i32(-2),
      compactIndex(n('LevelInfo')),
    ]),
    Buffer.concat([
      compactIndex(n('Core')),
      compactIndex(n('Core')),
      i32(0),
      compactIndex(n('Engine')),
    ]),
  ]);
  const nameOffset = header;
  const importOffset = nameOffset + nameTable.length;
  const objectOffset = importOffset + importTable.length;
  const exportOffset = objectOffset + object.length;
  const flags = opts.withStack !== false ? 0x02000000 : 0;
  const exportTable = Buffer.concat([
    compactIndex(-1),
    compactIndex(0),
    i32(0),
    compactIndex(n('LevelInfo0')),
    u32(flags),
    compactIndex(object.length),
    compactIndex(objectOffset),
  ]);
  const head = Buffer.concat([
    u32(0x9e2a83c1),
    Buffer.from([69, 0, 0, 0]), // version 69, licensee 0
    u32(0),
    i32(names.length),
    i32(nameOffset),
    i32(1),
    i32(exportOffset),
    i32(2),
    i32(importOffset),
  ]);
  return Buffer.concat([head, nameTable, importTable, object, exportTable]);
}

describe('IniFile', () => {
  const text =
    '[URL]\r\nPort=7777\r\n\r\n[Engine.GameEngine]\r\nServerPackages=Botpack\r\nServerPackages=SmartSB\r\n; comment\r\n';

  it('round-trips untouched files', () => {
    expect(IniFile.parse(text).serialize()).toBe(text);
  });

  it('reads repeated keys and compares case-insensitively', () => {
    const ini = IniFile.parse(text);
    expect(ini.getAll('engine.gameengine', 'serverpackages')).toEqual(['Botpack', 'SmartSB']);
    expect(ini.get('URL', 'Port')).toBe('7777');
  });

  it('set replaces, ensure adds once, missing sections are appended', () => {
    const ini = IniFile.parse(text);
    ini.set('URL', 'Port', '7790');
    ini.ensure('Engine.GameEngine', 'ServerPackages', 'UTTourney_v1');
    ini.ensure('Engine.GameEngine', 'ServerPackages', 'botpack');
    ini.set('UTTourney_v1.TournamentConfig', 'SharedKey', 'secret');
    expect(ini.get('URL', 'Port')).toBe('7790');
    expect(ini.getAll('Engine.GameEngine', 'ServerPackages')).toEqual([
      'Botpack',
      'SmartSB',
      'UTTourney_v1',
    ]);
    expect(ini.serialize()).toContain('[UTTourney_v1.TournamentConfig]\r\nSharedKey=secret\r\n');
    const dupes = IniFile.parse('[A]\nK=1\nK=2\n');
    dupes.set('A', 'K', '3');
    expect(dupes.getAll('A', 'K')).toEqual(['3']);
  });
});

describe('Unreal package reader', () => {
  it('reads Title, Author and IdealPlayerCount from LevelInfo', () => {
    const meta = readLevelMeta(
      fakeMap({ Title: 'Deck16', Author: 'Elliot Cannon', IdealPlayerCount: '2-8' }),
    );
    expect(meta).toEqual({ title: 'Deck16', author: 'Elliot Cannon', idealPlayerCount: '2-8' });
  });

  it('works without a state frame', () => {
    expect(readLevelMeta(fakeMap({ Title: 'X' }, { withStack: false }))).toEqual({ title: 'X' });
  });

  it('returns {} for garbage', () => {
    expect(readLevelMeta(Buffer.from('not a package at all'))).toEqual({});
    expect(readLevelMeta(fakeMap({ Title: 'X' }).subarray(0, 60))).toEqual({});
  });
});

describe('inventory', () => {
  it('lists DM maps with metadata and configured bots', () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, 'maps'));
    fs.mkdirSync(path.join(root, 'System'));
    fs.writeFileSync(
      path.join(root, 'maps', 'DM-Custom.unr'),
      fakeMap({ Title: 'Custom Arena', Author: 'Me' }),
    );
    fs.writeFileSync(path.join(root, 'maps', 'DM-Deck16][.UNR'), 'garbage');
    fs.writeFileSync(path.join(root, 'maps', 'CTF-Face.unr'), 'x');
    fs.writeFileSync(
      path.join(root, 'System', 'User.ini'),
      '[Botpack.ChallengeBotInfo]\r\nDifficulty=3\r\nBotNames[0]=Xan\r\nBotSkills[0]=2.0\r\nBotClasses[0]=BotPack.TBossBot\r\nBotNames[1]=Loque\r\nBotSkills[1]=-1\r\nBotNames[2]=\r\n',
    );
    const inv = scanInventory({ installDir: root });
    expect(inv.maps.map((m) => m.id)).toEqual(['DM-Custom', 'DM-Deck16][']);
    expect(inv.maps[0]).toMatchObject({ title: 'Custom Arena', author: 'Me', stock: false });
    expect(inv.maps[1]).toMatchObject({ id: 'DM-Deck16][', stock: true });
    expect(inv.bots).toEqual([
      { name: 'Xan', skill: 5, botClass: 'BotPack.TBossBot' },
      { name: 'Loque', skill: 2 },
    ]);
  });

  it('warns about missing folders and bots', () => {
    const inv = scanInventory({ installDir: tmp() });
    expect(inv.maps).toEqual([]);
    expect(inv.warnings.join(' ')).toMatch(/no Maps folder.*no bots configured/);
  });
});

describe('server setup', () => {
  const rules = parseRules({ mapPool: ['DM-Deck16]['] });
  const mod = { bridgeHost: '127.0.0.1', bridgePort: 7790, sharedKey: 'k3y-12345' };

  function install(binary = 'System/ucc-bin-amd64') {
    const root = tmp();
    fs.mkdirSync(path.join(root, 'System'));
    fs.writeFileSync(path.join(root, binary), '');
    fs.writeFileSync(
      path.join(root, 'System', 'UnrealTournament.ini'),
      '[URL]\r\nPort=7777\r\n[Engine.GameReplicationInfo]\r\nServerName=Old\r\n',
    );
    fs.writeFileSync(
      path.join(root, 'System', 'User.ini'),
      '[Botpack.ChallengeBotInfo]\r\nBotNames[0]=Xan\r\n',
    );
    return ServerProfileSchema.parse({
      id: 'p',
      name: 'p',
      os: 'linux',
      installDir: root,
      lobbyMap: 'DM-Deck16][',
      port: 7790,
      serverName: 'Cup',
    });
  }

  it('picks the first existing binary for the platform', () => {
    const profile = install('System/ucc-bin');
    expect(resolveBinary(profile, 'x64')).toBe(path.join(profile.installDir, 'System', 'ucc-bin'));
    expect(() => resolveBinary({ ...profile, binary: 'nope' })).toThrow(ServerSetupError);
    expect(() => resolveBinary({ ...profile, os: 'windows' }, 'x64')).toThrow(
      /no UT server binary/,
    );
  });

  it('writes Tourney.ini and TourneyUser.ini without touching the originals', () => {
    const profile = install();
    const p = prepareServer(profile, rules, mod, 'x64');
    const ini = IniFile.parse(fs.readFileSync(p.iniPath, 'latin1'));
    expect(ini.get('URL', 'Port')).toBe('7790');
    expect(ini.get('Engine.GameReplicationInfo', 'ServerName')).toBe('Cup');
    expect(ini.get('UTTourney_v1.TournamentConfig', 'SharedKey')).toBe('k3y-12345');
    expect(ini.get('UTTourney_v1.TournamentDM', 'bMultiWeaponStay')).toBe('True');
    // Clients download the mod (HUD, vote window); existing entries are kept.
    expect(ini.getAll('Engine.GameEngine', 'ServerPackages')).toContain('UTTourney_v1');
    expect(fs.readFileSync(p.userIniPath, 'latin1')).toContain('BotNames[0]=Xan');
    expect(
      fs.readFileSync(path.join(profile.installDir, 'System', 'UnrealTournament.ini'), 'latin1'),
    ).toContain('Port=7777');
    expect(p.args).toContain('ini=Tourney.ini');
    expect(p.systemDir).toBe(path.join(profile.installDir, 'System'));
  });
});

describe('ServerProcess', () => {
  const script = (body: string) => {
    const f = path.join(tmp(), 'fake-ucc.cjs');
    fs.writeFileSync(f, body);
    return f;
  };
  const viaNode = (file: string) => (_cmd: string, args: string[], opts: object) =>
    spawn(process.execPath, [file, ...args], opts);
  const waitFor = async (cond: () => boolean) => {
    for (let i = 0; i < 300 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
    if (!cond()) throw new Error('timeout');
  };

  it('starts, detects readiness from the log and stops', async () => {
    const f = script(`console.log('Game engine initialized'); setInterval(() => {}, 1000);`);
    const log = memoryLogger();
    const sp = new ServerProcess({ log, clock: new FakeClock(), spawn: viaNode(f) });
    sp.start({ binary: 'ucc', args: ['server', 'DM-X'], cwd: os.tmpdir() });
    await waitFor(() => sp.state === 'running');
    expect(sp.pid).toBeGreaterThan(0);
    await sp.stop();
    expect(sp.state).toBe('stopped');
    expect(sp.tail).toContain('Game engine initialized');
  });

  it('restarts after crashes with backoff and gives up eventually', async () => {
    const f = script(`console.log('boom'); process.exit(3);`);
    const clock = new FakeClock();
    const log = memoryLogger();
    const sp = new ServerProcess({ log, clock, spawn: viaNode(f), restartDelaysMs: [1000, 2000] });
    const states: string[] = [];
    sp.on('state', (s: string) => states.push(s));
    sp.start({ binary: 'ucc', args: [], cwd: os.tmpdir() });
    await waitFor(() => states.filter((s) => s === 'crashed').length === 1);
    clock.advance(1000);
    await waitFor(() => states.filter((s) => s === 'crashed').length === 2);
    clock.advance(2000);
    await waitFor(() => states.filter((s) => s === 'crashed').length === 3);
    expect(log.lines.some((l) => l.includes('gave up after 2 restarts'))).toBe(true);
    expect(clock.pendingTimers).toBe(0);
  });
});
