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

export const newJoinToken = () => randomId(24);
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
