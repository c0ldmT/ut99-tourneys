import type { ServerOs, ServerProfile } from '@tourney/protocol';
import { MOD_GAME_CLASS, MOD_PACKAGE, SMART_STOCK_BOTS_ACTOR, type Ut99DmRules } from './rules.js';

/**
 * How to start a UT99 469f dedicated server for a tournament.
 *
 * Pure functions: they produce paths, arguments and ini changes; the bridge executes them.
 * Binary names differ between 469 releases (469f moved all builds into System/), so the bridge
 * probes the candidates in order and uses the first existing file, unless the profile overrides it.
 */

export type CpuArch = 'x64' | 'arm64' | 'ia32';

/** Candidate server binaries relative to the install dir, most likely first. */
export function serverBinaryCandidates(os: ServerOs, arch: CpuArch): string[] {
  if (os === 'windows') {
    return arch === 'x64'
      ? ['System64/UCC.exe', 'System/UCC64.exe', 'System/UCC.exe']
      : ['System/UCC.exe'];
  }
  switch (arch) {
    case 'arm64':
      return ['System/ucc-bin-arm64', 'SystemARM64/ucc-bin', 'System/ucc-bin'];
    case 'ia32':
      return ['System/ucc-bin-x86', 'System/ucc-bin'];
    default:
      return ['System/ucc-bin-amd64', 'System64/ucc-bin', 'System/ucc-bin'];
  }
}

/** Folder containing the binary; ucc must be started with this as working directory. */
export function systemDirOf(binaryRelPath: string): string {
  const parts = binaryRelPath.split('/');
  parts.pop();
  return parts.join('/') || '.';
}

export interface ModConnectionConfig {
  bridgeHost: string;
  bridgePort: number;
  sharedKey: string;
}

/** Names of the files the bridge generates next to the binary. Never touches the user's own ini. */
export const GENERATED_FILES = {
  ini: 'Tourney.ini',
  userIni: 'TourneyUser.ini',
  log: 'Tourney.log',
} as const;

/** URL options appended to every map URL (start and travel). */
export function urlOptions(
  rules: Ut99DmRules,
  profile: Pick<ServerProfile, 'maxSpectators'>,
): string {
  let opts = `?game=${MOD_GAME_CLASS}`;
  if (rules.mutators.length) opts += `?mutator=${rules.mutators.join(',')}`;
  opts += `?MaxSpectators=${profile.maxSpectators}`;
  return opts;
}

/** Extra URL options sent with each `travel` line (the mod adds its own game class). */
export function travelOptions(rules: Ut99DmRules): string {
  return rules.mutators.length ? `?mutator=${rules.mutators.join(',')}` : '';
}

/** Command line arguments for `ucc server`. */
export function serverArgs(rules: Ut99DmRules, profile: ServerProfile): string[] {
  const args = [
    'server',
    `${profile.lobbyMap}${urlOptions(rules, profile)}`,
    `port=${profile.port}`,
    `ini=${GENERATED_FILES.ini}`,
    `userini=${GENERATED_FILES.userIni}`,
    `log=${GENERATED_FILES.log}`,
  ];
  if (profile.extraArgs) args.push(...profile.extraArgs.split(/\s+/).filter(Boolean));
  return args;
}

export type IniChange =
  | { section: string; key: string; value: string }
  /** Ensures `value` is present in an array-like key (multiple `Key=` lines), e.g. ServerPackages. */
  | { section: string; key: string; ensure: string }
  /** Removes `value` from an array-like key if present. */
  | { section: string; key: string; remove: string };

const bool = (b: boolean) => (b ? 'True' : 'False');

/**
 * Changes applied to a copy of the installation's UnrealTournament.ini to produce Tourney.ini.
 * Match-specific values (frag/time limit) are not here; the mod applies them per match.
 */
export function iniChanges(
  rules: Ut99DmRules,
  profile: ServerProfile,
  mod: ModConnectionConfig,
): IniChange[] {
  const dm = 'Botpack.DeathMatchPlus';
  return [
    // Clients download the mod for the HUD, the vote window and spectator follow (milestone 6).
    { section: 'Engine.GameEngine', key: 'ServerPackages', ensure: MOD_PACKAGE },
    // SmartStockBots runs as a server actor (its recommended setup) on every map, or not at all.
    rules.smartStockBots
      ? { section: 'Engine.GameEngine', key: 'ServerActors', ensure: SMART_STOCK_BOTS_ACTOR }
      : { section: 'Engine.GameEngine', key: 'ServerActors', remove: SMART_STOCK_BOTS_ACTOR },
    { section: 'URL', key: 'Port', value: String(profile.port) },
    ...(profile.serverName
      ? [{ section: 'Engine.GameReplicationInfo', key: 'ServerName', value: profile.serverName }]
      : []),
    // Per-class config: written for DeathMatchPlus and for our subclass, which reads its own section.
    ...[dm, MOD_GAME_CLASS].flatMap((section) => [
      { section, key: 'bMultiWeaponStay', value: bool(rules.weaponStay) },
      { section, key: 'bHardCoreMode', value: bool(rules.hardcore) },
    ]),
    { section: dm, key: 'bTournament', value: 'False' }, // our own ready check replaces it
    { section: dm, key: 'MinPlayers', value: '0' }, // bots are spawned by the mod only
    { section: dm, key: 'MaxPlayers', value: '4' }, // 2 match players + room for a reconnect
    { section: 'Engine.GameInfo', key: 'GameSpeed', value: (rules.gameSpeedPct / 100).toFixed(2) },
    { section: 'Engine.GameInfo', key: 'MaxSpectators', value: String(profile.maxSpectators) },
    { section: `${MOD_PACKAGE}.TournamentConfig`, key: 'BridgeHost', value: mod.bridgeHost },
    {
      section: `${MOD_PACKAGE}.TournamentConfig`,
      key: 'BridgePort',
      value: String(mod.bridgePort),
    },
    { section: `${MOD_PACKAGE}.TournamentConfig`, key: 'SharedKey', value: mod.sharedKey },
  ];
}
