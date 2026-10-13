import fs from 'node:fs';
import path from 'node:path';
import { IniFile } from './ini.js';

/** Where UT keeps the bot setup (Bots menu): names, classes, skins, faces, skills, voices. */
export const BOT_SECTION = 'Botpack.ChallengeBotInfo';

export interface MissingPackage {
  bot: string;
  /** BotClasses, BotSkins or BotFaces. */
  key: string;
  package: string;
}

export interface BotImport {
  /** The server's User.ini with the bot section of the source. */
  text: string;
  bots: string[];
  /** Packages a bot needs (class, skin, face) that the server installation does not have. */
  missing: MissingPackage[];
}

/**
 * Takes the bot section from a User.ini (e.g. from the PC where the bots were set up) and puts it
 * into the server's User.ini in place of its own. Everything else in the server's file stays.
 * `installDir`: the server's UT folder, to report packages the bots need but the server lacks.
 */
export function importBots(sourceText: string, targetText: string, installDir?: string): BotImport {
  const source = IniFile.parse(sourceText);
  const lines = source.sectionLines(BOT_SECTION);
  if (!lines) throw new Error(`no [${BOT_SECTION}] section in the source User.ini`);
  const entries = source.entries(BOT_SECTION);
  const bots: { idx: string; name: string }[] = [];
  for (const [k, v] of entries) {
    const m = /^BotNames\[(\d+)\]$/i.exec(k);
    if (m && v.trim()) bots.push({ idx: m[1] as string, name: v.trim() });
  }
  if (!bots.length) throw new Error(`[${BOT_SECTION}] in the source User.ini has no bot names`);

  const target = IniFile.parse(targetText);
  target.replaceSection(BOT_SECTION, lines);

  const missing: MissingPackage[] = [];
  if (installDir) {
    const have = installedPackages(installDir);
    const value = (key: string, idx: string) =>
      entries.find(([k]) => k.toLowerCase() === `${key}[${idx}]`.toLowerCase())?.[1]?.trim();
    for (const b of bots) {
      for (const key of ['BotClasses', 'BotSkins', 'BotFaces']) {
        const v = value(key, b.idx);
        const pkg = v?.includes('.') ? v.split('.')[0]?.trim() : undefined;
        if (pkg && !have.has(pkg.toLowerCase())) missing.push({ bot: b.name, key, package: pkg });
      }
    }
  }
  return { text: target.serialize(), bots: bots.map((b) => b.name), missing };
}

/** Package names (lower case) in System (*.u) and Textures (*.utx) of a UT installation. */
function installedPackages(installDir: string): Set<string> {
  const out = new Set<string>();
  for (const [dir, ext] of [
    ['System', '.u'],
    ['Textures', '.utx'],
  ] as const) {
    const real = fs
      .readdirSync(installDir, { withFileTypes: true })
      .find((d) => d.isDirectory() && d.name.toLowerCase() === dir.toLowerCase());
    if (!real) continue;
    for (const f of fs.readdirSync(path.join(installDir, real.name))) {
      if (f.toLowerCase().endsWith(ext)) out.add(f.slice(0, -ext.length).toLowerCase());
    }
  }
  return out;
}

/**
 * CLI: imports the bots into `<installDir>/System/User.ini` (backup next to it) and reports
 * what was imported. Returns the lines to print.
 */
export function importBotsIntoInstallation(
  sourceFile: string,
  installDir: string,
  now = new Date(),
): string[] {
  const system = fs
    .readdirSync(installDir, { withFileTypes: true })
    .find((d) => d.isDirectory() && d.name.toLowerCase() === 'system');
  if (!system) throw new Error(`no System folder in ${installDir}`);
  const targetFile = path.join(installDir, system.name, 'User.ini');
  if (path.resolve(sourceFile) === path.resolve(targetFile)) {
    throw new Error('source and target are the same User.ini');
  }
  const targetText = fs.existsSync(targetFile) ? fs.readFileSync(targetFile, 'latin1') : '';
  const result = importBots(fs.readFileSync(sourceFile, 'latin1'), targetText, installDir);
  const out: string[] = [];
  if (targetText) {
    const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backup = `${targetFile}.bak-${stamp}`;
    fs.copyFileSync(targetFile, backup);
    out.push(`backup: ${backup}`);
  }
  fs.writeFileSync(targetFile, result.text, 'latin1');
  out.push(`${result.bots.length} bots imported into ${targetFile}: ${result.bots.join(', ')}`);
  for (const m of result.missing) {
    out.push(
      `warning: ${m.bot} needs package ${m.package} (${m.key}), which is not on the server - copy it into System or Textures, otherwise the bot cannot use it`,
    );
  }
  out.push('Now scan the server on the website (Servers -> Scan) to see the bots there.');
  return out;
}
