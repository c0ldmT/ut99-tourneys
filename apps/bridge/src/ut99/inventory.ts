import fs from 'node:fs';
import path from 'node:path';
import type { BotSpec, MapInfo, ServerProfile } from '@tourney/protocol';
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
  warnings: string[];
}

export interface ScanOptions {
  /** Map file prefix for the game type, e.g. "DM". */
  prefix?: string;
  /** Read Title/Author from the map packages (slower; reads every file). */
  readMeta?: boolean;
}

/** Lists maps and configured bots of a UT installation. Works while the server is stopped. */
export function scanInventory(
  profile: Pick<ServerProfile, 'installDir'>,
  options: ScanOptions = {},
): Inventory {
  const prefix = `${options.prefix ?? 'DM'}-`.toLowerCase();
  const warnings: string[] = [];
  const mapsDir = findDir(profile.installDir, 'Maps');
  const maps: MapInfo[] = [];

  if (!mapsDir) {
    warnings.push(`no Maps folder in ${profile.installDir}`);
  } else {
    for (const file of fs.readdirSync(mapsDir)) {
      const ext = path.extname(file).toLowerCase();
      const id = file.slice(0, -ext.length);
      if (ext !== '.unr' || !id.toLowerCase().startsWith(prefix)) continue;
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
      bots.push(spec);
    }
    if (bots.length) return bots;
  }
  warnings.push(
    `no bots configured ([${section}] in User.ini). Bots still work with the names from the tournament settings.`,
  );
  return [];
}
