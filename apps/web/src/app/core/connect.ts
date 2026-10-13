/** Helpers for the "join the server" box on the tournament page. */

/** The UT URL players connect to: address plus their personal token. */
export function joinUrl(address: string, token: string): string {
  return `${address}?tk=${token}`;
}

/**
 * True for addresses only the server PC itself can reach (127.x, localhost, 0.0.0.0, ::1).
 * Other players cannot connect with them; the address belongs in bridge.json (publicAddress)
 * or the tournament's "address for players".
 */
export function isLocalAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  let host = address
    .trim()
    .toLowerCase()
    .replace(/^unreal:\/\//, '');
  if (host.startsWith('[')) host = host.slice(1, host.indexOf(']'));
  else host = host.split(':')[0] ?? host;
  return (
    host === 'localhost' ||
    host.startsWith('127.') ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === ''
  );
}

/** Single-quotes a value for sh/bash/zsh. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** A folder for `cd`: a leading ~ stays outside the quotes, so the shell expands it. */
function shellDir(dir: string): string {
  if (dir === '~') return '~';
  if (dir.startsWith('~/')) return `~/${shellQuote(dir.slice(2))}`;
  return shellQuote(dir);
}

/**
 * Terminal command that starts the native UT99 client (OldUnreal 469, Linux) and connects right
 * away - for players whose UT console cannot paste. `systemDir` is the folder with `ut-bin`
 * (empty: the command is meant to be run inside that folder).
 */
export function linuxStartCommand(systemDir: string, address: string, token: string): string {
  const dir = systemDir.trim().replace(/\/+$/, '');
  const start = `./ut-bin ${shellQuote(joinUrl(address, token))}`;
  return dir ? `cd ${shellDir(dir)} && ${start}` : start;
}
