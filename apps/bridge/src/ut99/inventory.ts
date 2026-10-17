import fs from 'node:fs';
import path from 'node:path';
import type { BotSpec, BotTraits, GameAssets, MapInfo, ServerProfile } from '@tourney/protocol';
import { IniFile } from './ini.js';
import { readLevelMeta } from './unreal-package.js';

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

function findDir(root: string, name: string): string | undefined {
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
 * What the installation offers for bots, from the `Object=` lines of System/*.int: bot classes
 * (MetaClass ...Bot), voice packs, weapons, and textures with a description (skins and faces).
 */
export function readAssets(installDir: string): GameAssets {
  const assets: GameAssets = { botClasses: [], textures: [], voices: [], weapons: [] };
  const system = findDir(installDir, 'System');
  if (!system) return assets;
  let files: string[];
  try {
    files = fs.readdirSync(system).filter((f) => f.toLowerCase().endsWith('.int'));
  } catch {
    return assets;
  }
  const add = (list: GameAssets['botClasses'], name: string, label: string, max: number) => {
    if (list.length >= max || !name || name.length > 128) return;
    if (!list.some((x) => x.name.toLowerCase() === name.toLowerCase()))
      list.push({ name, label: (label || name.split('.').pop() || name).slice(0, 64) });
  };
  for (const f of files) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(system, f), 'latin1');
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
      else if (cls === 'class' && meta.endsWith('voicepack')) add(assets.voices, o.name, desc, 500);
      else if (cls === 'class' && meta.endsWith('tournamentweapon'))
        add(assets.weapons, o.name, desc, 500);
      else if (cls === 'texture' && desc) add(assets.textures, o.name, desc, 5000);
    }
  }
  return assets;
}
