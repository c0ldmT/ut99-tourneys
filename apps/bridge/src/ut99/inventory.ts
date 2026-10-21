import fs from 'node:fs';
import path from 'node:path';
import type { BotSpec, BotTraits, GameAssets, MapInfo, ServerProfile } from '@tourney/protocol';
import { IniFile } from './ini.js';
import { listExports, readLevelMeta } from './unreal-package.js';

/** Deathmatch maps shipped with UT99 GOTY: clients have them, no download needed. */
const STOCK_DM = new Set(
  [
    'DM-Agony',
    'DM-Barricade',
    'DM-Codex',
    'DM-Conveyor',
    'DM-Curse][',
    'DM-Deck16][',
    'DM-Fetid',
    'DM-Fractal',
    'DM-Gothic',
    'DM-Grinder',
    'DM-HealPod][',
    'DM-HyperBlast',
    'DM-KGalleon',
    'DM-Liandri',
    'DM-Morbias][',
    'DM-Morpheus',
    'DM-Oblivion',
    'DM-Peak',
    'DM-Phobos',
    'DM-Pressure',
    'DM-Pyramid',
    'DM-Shrapnel][',
    'DM-SpaceNoxx',
    'DM-Stalwart',
    'DM-StalwartXL',
    // GOTY bonus maps
    'DM-ArcaneTemple',
    'DM-Crane',
    'DM-Cybrosis][',
    'DM-Malevolence',
    'DM-Mojo][',
    'DM-Tutorial',
    'DM-Tempest',
    'DM-Turbine',
    'DM-Zeto',
  ].map((m) => m.toLowerCase()),
);

export interface Inventory {
  maps: MapInfo[];
  bots: BotSpec[];
  /** UnrealScript packages (*.u) in the System folder, without extension, e.g. "SmartStockBots". */
  packages: string[];
  /** Bot classes, textures (skins/faces), voices, weapons from the .int files. */
  assets: GameAssets;
  warnings: string[];
}

export interface ScanOptions {
  /** Map file prefixes of the game types, default DM (deathmatch) and MH (Monster Hunt). */
  prefixes?: readonly string[];
  /** Read Title/Author from the map packages (slower; reads every file). */
  readMeta?: boolean;
}

/** Lists maps and configured bots of a UT installation. Works while the server is stopped. */
export function scanInventory(
  profile: Pick<ServerProfile, 'installDir'>,
  options: ScanOptions = {},
): Inventory {
  const prefixes = (options.prefixes ?? ['DM', 'MH']).map((x) => `${x}-`.toLowerCase());
  const warnings: string[] = [];
  const mapsDir = findDir(profile.installDir, 'Maps');
  const maps: MapInfo[] = [];

  if (!mapsDir) {
    warnings.push(`no Maps folder in ${profile.installDir}`);
  } else {
    for (const file of fs.readdirSync(mapsDir)) {
      const ext = path.extname(file).toLowerCase();
      const id = file.slice(0, -ext.length);
      if (ext !== '.unr' || !prefixes.some((x) => id.toLowerCase().startsWith(x))) continue;
      const full = path.join(mapsDir, file);
      const info: MapInfo = { id, stock: STOCK_DM.has(id.toLowerCase()) };
      try {
        info.sizeBytes = fs.statSync(full).size;
        if (options.readMeta !== false) Object.assign(info, readLevelMeta(fs.readFileSync(full)));
      } catch (e) {
        warnings.push(`cannot read ${file}: ${(e as Error).message}`);
      }
      maps.push(info);
    }
    maps.sort((a, b) => a.id.localeCompare(b.id, 'en', { sensitivity: 'base' }));
  }

  return {
    maps,
    bots: readBots(profile.installDir, warnings),
    packages: listPackages(profile.installDir),
    assets: readAssets(profile.installDir),
    warnings,
  };
}

function listPackages(installDir: string): string[] {
  const system = findDir(installDir, 'System');
  if (!system) return [];
  try {
    return fs
      .readdirSync(system)
      .filter((f) => f.toLowerCase().endsWith('.u'))
      .map((f) => f.slice(0, -2))
      .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  } catch {
    return [];
  }
}

export function findDir(root: string, name: string): string | undefined {
  try {
    const hit = fs
      .readdirSync(root, { withFileTypes: true })
      .find((d) => d.isDirectory() && d.name.toLowerCase() === name.toLowerCase());
    return hit ? path.join(root, hit.name) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Bots come from the [Botpack.ChallengeBotInfo] section (User.ini on a standard install).
 * BotSkills there are adjustments relative to the global Difficulty; we report the resulting
 * absolute skill 0..7 as a suggestion.
 */
function readBots(installDir: string, warnings: string[]): BotSpec[] {
  const system = findDir(installDir, 'System');
  const section = 'Botpack.ChallengeBotInfo';
  const files = ['User.ini', 'UnrealTournament.ini'];
  for (const f of files) {
    const p = system ? path.join(system, f) : undefined;
    if (!p || !fs.existsSync(p)) continue;
    const ini = IniFile.parse(fs.readFileSync(p, 'latin1'));
    const entries = ini.entries(section);
    if (!entries.length) continue;
    const arr = (key: string) => {
      const out: Record<number, string> = {};
      for (const [k, v] of entries) {
        const m = new RegExp(`^${key}\\[(\\d+)\\]$`, 'i').exec(k);
        if (m) out[Number(m[1])] = v;
      }
      return out;
    };
    const names = arr('BotNames');
    const classes = arr('BotClasses');
    const skins = arr('BotSkins');
    const faces = arr('BotFaces');
    const skills = arr('BotSkills');
    const num = (a: Record<number, string>, i: number) => {
      const v = Number(a[i]);
      return Number.isFinite(v) ? v : undefined;
    };
    const accuracy = arr('BotAccuracy');
    const combat = arr('CombatStyle');
    const alertness = arr('Alertness');
    const camping = arr('Camping');
    const strafing = arr('StrafingAbility');
    const weapon = arr('FavoriteWeapon');
    const jumpy = arr('BotJumpy');
    const voice = arr('VoiceType');
    const difficulty = Number(ini.get(section, 'Difficulty') ?? 1);
    const bots: BotSpec[] = [];
    for (const [i, name] of Object.entries(names)) {
      if (!name.trim()) continue;
      const idx = Number(i);
      const adjust = Number(skills[idx] ?? 0);
      const spec: BotSpec = {
        name: name.trim().slice(0, 32),
        skill: Math.max(
          0,
          Math.min(7, Math.round((Number.isFinite(difficulty) ? difficulty : 1) + adjust)),
        ),
      };
      if (classes[idx]) spec.botClass = classes[idx];
      if (skins[idx]) spec.skin = skins[idx];
      if (faces[idx]) spec.face = faces[idx];
      const clamp = (v: number | undefined, lo: number) =>
        v === undefined ? undefined : Math.max(lo, Math.min(1, v));
      const traits: BotTraits = {};
      const set = <K extends keyof BotTraits>(k: K, v: BotTraits[K] | undefined) => {
        if (v !== undefined) traits[k] = v;
      };
      set('accuracy', clamp(num(accuracy, idx), -1));
      set('combatStyle', clamp(num(combat, idx), -1));
      set('alertness', clamp(num(alertness, idx), -1));
      set('camping', clamp(num(camping, idx), 0));
      set('strafing', clamp(num(strafing, idx), -1));
      if (jumpy[idx] !== undefined) traits.jumpy = Number(jumpy[idx]) !== 0;
      const w = weapon[idx]?.trim();
      if (w && w.toLowerCase() !== 'none') traits.favoriteWeapon = w.slice(0, 64);
      const vc = voice[idx]?.trim();
      if (vc && vc.toLowerCase() !== 'none') traits.voice = vc.slice(0, 64);
      if (Object.keys(traits).length) spec.traits = traits;
      bots.push(spec);
    }
    if (bots.length) return bots;
  }
  warnings.push(
    `no bots configured ([${section}] in User.ini). Bots still work with the names from the tournament settings.`,
  );
  return [];
}

/** Fields of an `Object=(Name=...,Class=...,MetaClass=...,Description="...")` line of a .int file. */
export function parseIntObject(line: string): Record<string, string> | undefined {
  const m = /^\s*Object\s*=\s*\((.*)\)\s*$/i.exec(line);
  if (!m) return undefined;
  const out: Record<string, string> = {};
  const re = /\s*([A-Za-z]+)\s*=\s*("([^"]*)"|[^,]*)\s*,?/g;
  let f: RegExpExecArray | null;
  while ((f = re.exec(m[1]!)) && f[0]) out[f[1]!.toLowerCase()] = (f[3] ?? f[2] ?? '').trim();
  return out;
}

/**
 * The folders with `.int` files: System/, and SystemLocalized/int/ where UT 469 keeps them
 * (the game reads both).
 */
export function intDirs(installDir: string): string[] {
  const out: string[] = [];
  const system = findDir(installDir, 'System');
  const localized = findDir(installDir, 'SystemLocalized');
  const int = localized ? findDir(localized, 'int') : undefined;
  if (system) out.push(system);
  if (int) out.push(int);
  return out;
}

/** Voice packs: the meta class is a voice pack class (`BotPack.VoiceMale`, `…ChallengeVoicePack`). */
function isVoiceMeta(meta: string): boolean {
  return meta.endsWith('voicepack') || /\.voice[a-z]*$/.test(meta);
}

/**
 * What the installation offers for bots, from the `Object=` lines of the .int files (System/ and
 * SystemLocalized/int/): bot classes (MetaClass ...Bot), voice packs with their meta class,
 * weapons, and the texture entries (skins and faces; with or without a description).
 */
export function readAssets(installDir: string): GameAssets {
  const assets: GameAssets = {
    botClasses: [],
    textures: [],
    voices: [],
    weapons: [],
    skinPackages: [],
    // Bot class defaults come from the mod (ModelCatalog), not from the files.
    classDefaults: [],
  };
  const files: string[] = [];
  for (const dir of intDirs(installDir)) {
    try {
      for (const f of fs.readdirSync(dir).sort())
        if (f.toLowerCase().endsWith('.int')) files.push(path.join(dir, f));
    } catch {
      // unreadable folder: skip
    }
  }
  const add = (
    list: GameAssets['botClasses'],
    name: string,
    label: string,
    max: number,
    extra: { meta?: string; bare?: boolean } = {},
  ) => {
    if (list.length >= max || !name || name.length > 128) return;
    // Textures keep an empty label (no description: no skin or face in UT's menu).
    const shown = label || (extra.bare ? '' : (name.split('.').pop() ?? name));
    if (!list.some((x) => x.name.toLowerCase() === name.toLowerCase()))
      list.push({ name, label: shown.slice(0, 64), ...(extra.meta ? { meta: extra.meta } : {}) });
  };
  for (const f of files) {
    let text: string;
    try {
      text = fs.readFileSync(f, 'latin1');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const o = parseIntObject(line);
      if (!o?.name) continue;
      const cls = (o.class ?? '').toLowerCase();
      const meta = (o.metaclass ?? '').toLowerCase();
      const desc = o.description ?? '';
      if (cls === 'class' && /\.bot$/.test(meta)) add(assets.botClasses, o.name, desc, 500);
      else if (cls === 'class' && isVoiceMeta(meta))
        add(assets.voices, o.name, desc, 500, { meta: (o.metaclass ?? '').slice(0, 128) });
      else if (cls === 'class' && meta.endsWith('tournamentweapon'))
        add(assets.weapons, o.name, desc, 500);
      // Texture entries: UT's menu tells skins and faces apart by name and description (the
      // unnamed T_* and team textures are never offered, so they are not sent).
      else if (cls === 'texture' && (desc || !/(^|\.)t_|\dt_\d+$/i.test(o.name)))
        add(assets.textures, o.name, desc, 5000, { bare: true });
    }
  }
  assets.skinPackages = readSkinPackages(installDir);
  // Bot classes of custom model packages that only declare their player class in the .int.
  for (const c of readBotClasses(installDir)) add(assets.botClasses, c, '', 500);
  return assets;
}

/** Packages that come with UT: their bot classes are known (stock list). */
const STOCK_PACKAGES = new Set(['botpack', 'unrealshare', 'unreali', 'engine', 'core', 'utmenu']);

/** Texture packages with skins (Textures/*skin*.utx): their top-level textures. */
export function readSkinPackages(installDir: string): { pkg: string; textures: string[] }[] {
  const dir = findDir(installDir, 'Textures');
  if (!dir) return [];
  let files: string[];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.utx') && f.toLowerCase().includes('skin'));
  } catch {
    return [];
  }
  const out: { pkg: string; textures: string[] }[] = [];
  for (const f of files.sort().slice(0, 200)) {
    let buf: Buffer;
    try {
      buf = fs.readFileSync(path.join(dir, f));
    } catch {
      continue;
    }
    const textures = listExports(buf)
      .filter((e) => e.topLevel && e.className === 'Texture' && /^\w{1,48}$/.test(e.name))
      .map((e) => e.name)
      .slice(0, 300);
    if (textures.length) out.push({ pkg: f.slice(0, -4), textures });
  }
  return out;
}

/** Classes named *Bot in the System packages that do not come with UT (e.g. a model pack). */
export function readBotClasses(installDir: string): string[] {
  const system = findDir(installDir, 'System');
  if (!system) return [];
  const out: string[] = [];
  let files: string[];
  try {
    files = fs.readdirSync(system).filter((f) => f.toLowerCase().endsWith('.u'));
  } catch {
    return [];
  }
  for (const f of files.sort()) {
    const pkg = f.slice(0, -2);
    // UT's own packages and the tournament mod's (its bot classes are internal).
    if (STOCK_PACKAGES.has(pkg.toLowerCase()) || /^uttourney/i.test(pkg)) continue;
    let buf: Buffer;
    try {
      buf = fs.readFileSync(path.join(system, f));
    } catch {
      continue;
    }
    for (const e of listExports(buf))
      if (
        e.topLevel &&
        e.className === 'Class' &&
        /^\w+Bot$/i.test(e.name) &&
        !/^(Bot|HumanBotPlus|MaleBotPlus|FemaleBotPlus)$/i.test(e.name)
      )
        out.push(`${pkg}.${e.name}`);
    if (out.length >= 200) break;
  }
  return out;
}
