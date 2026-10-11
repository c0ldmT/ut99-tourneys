import fs from 'node:fs';
import path from 'node:path';
import type { ServerProfile } from '@tourney/protocol';
import {
  GENERATED_FILES,
  iniChanges,
  serverArgs,
  serverBinaryCandidates,
  type CpuArch,
  type ModConnectionConfig,
  type Ut99DmRules,
} from '@tourney/adapter-ut99';
import { IniFile } from './ini.js';

export interface PreparedServer {
  binary: string;
  systemDir: string;
  args: string[];
  iniPath: string;
  userIniPath: string;
}

export class ServerSetupError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ServerSetupError';
  }
}

export function currentArch(): CpuArch {
  return process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? 'ia32' : 'x64';
}

/** Absolute path of the server binary: the profile override, or the first existing candidate. */
export function resolveBinary(
  profile: Pick<ServerProfile, 'os' | 'installDir' | 'binary'>,
  arch: CpuArch = currentArch(),
  exists: (p: string) => boolean = fs.existsSync,
): string {
  if (profile.binary) {
    const p = path.resolve(profile.installDir, profile.binary);
    if (!exists(p)) throw new ServerSetupError(`server binary ${p} does not exist`);
    return p;
  }
  const candidates = serverBinaryCandidates(profile.os, arch).map((c) =>
    path.resolve(profile.installDir, c),
  );
  const found = candidates.find((c) => exists(c));
  if (!found) {
    throw new ServerSetupError(
      `no UT server binary found in ${profile.installDir} (tried ${candidates.join(', ')}). ` +
        'Set "binary" in the server profile.',
    );
  }
  return found;
}

function firstExisting(paths: string[]): string | undefined {
  return paths.find((p) => fs.existsSync(p));
}

/**
 * Writes Tourney.ini / TourneyUser.ini next to the binary (copies of the installation's own ini
 * files plus our changes) and returns how to start the server. The user's ini files are untouched.
 */
export function prepareServer(
  profile: ServerProfile,
  rules: Ut99DmRules,
  mod: ModConnectionConfig,
  arch: CpuArch = currentArch(),
): PreparedServer {
  const binary = resolveBinary(profile, arch);
  const systemDir = path.dirname(binary);
  const stdSystem = path.join(profile.installDir, 'System');

  const baseIni = firstExisting([
    path.join(systemDir, 'UnrealTournament.ini'),
    path.join(stdSystem, 'UnrealTournament.ini'),
  ]);
  if (!baseIni) {
    throw new ServerSetupError(
      `no UnrealTournament.ini found in ${systemDir}. Start UT or the server once so it is created.`,
    );
  }
  const userIni = firstExisting([
    path.join(systemDir, 'User.ini'),
    path.join(stdSystem, 'User.ini'),
  ]);

  const ini = IniFile.parse(fs.readFileSync(baseIni, 'latin1'));
  ini.apply(iniChanges(rules, profile, mod));
  const iniPath = path.join(systemDir, GENERATED_FILES.ini);
  const userIniPath = path.join(systemDir, GENERATED_FILES.userIni);
  try {
    fs.writeFileSync(iniPath, ini.serialize(), 'latin1');
    fs.writeFileSync(userIniPath, userIni ? fs.readFileSync(userIni) : '');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    throw new ServerSetupError(
      code === 'EACCES' || code === 'EPERM'
        ? `no permission to write ${iniPath}. Run the bridge with write access to the UT System folder ` +
            '(e.g. install UT outside "Program Files").'
        : `cannot write ${iniPath}: ${(e as Error).message}`,
      { cause: e },
    );
  }
  return { binary, systemDir, args: serverArgs(rules, profile), iniPath, userIniPath };
}
