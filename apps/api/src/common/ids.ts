import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Random string from [A-Za-z0-9]: safe in URLs, file names and UT travel options. */
export function randomId(length = 12): string {
  const bytes = crypto.randomBytes(length * 2);
  let out = '';
  for (let i = 0; out.length < length && i < bytes.length; i++) {
    const b = bytes[i] as number;
    if (b < 248) out += ALPHABET[b % 62];
  }
  return out.length === length ? out : out + randomId(length - out.length);
}

/**
 * Join token (the ?tk= option): 10 characters, lower case, no look-alikes (0/o, 1/l/i), so it can
 * be typed in the UT console where pasting does not work (native Linux client). 31^10 = 8e14.
 */
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export function newJoinToken(): string {
  const bytes = crypto.randomBytes(40);
  let out = '';
  for (let i = 0; out.length < 10 && i < bytes.length; i++) {
    const b = bytes[i] as number;
    if (b < 248) out += CODE_ALPHABET[b % 31];
  }
  return out.length === 10 ? out : newJoinToken();
}
export const newSessionId = () => randomId(43);
export const newAgentToken = () => `agt_${randomId(40)}`;

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Tournament ids end up in file names on the bridge, so they stay simple. */
export const TOURNAMENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'tournament';
}
