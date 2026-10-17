import { createApi, type AppOverrides, type RunningApi } from '../src/app.js';
import { loadConfig } from '../src/config.js';

export interface Logger {
  debug(m: string): void;
  info(m: string): void;
  warn(m: string): void;
  error(m: string): void;
}

export function memoryLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const push = (level: string) => (m: string) => void lines.push(`${level}: ${m}`);
  return {
    lines,
    debug: push('debug'),
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
  };
}

export async function startApi(env: Record<string, string> = {}, overrides: AppOverrides = {}) {
  const config = loadConfig({
    PORT: '0',
    HOST: '127.0.0.1',
    DATA_DIR: ':memory:',
    DEV_LOGIN: 'true',
    ...env,
  });
  const log = memoryLogger();
  const api = await createApi(config, { logger: log, ...overrides });
  return { api, log, config };
}

/** A logged-in browser: keeps the session cookie, sends the CSRF header. */
export class Client {
  cookie = '';
  constructor(private readonly api: RunningApi) {}

  async req<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: T }> {
    const res = await fetch(`${this.api.url}/api${path}`, {
      method,
      redirect: 'manual',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'x-tourney': '1' } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie();
    for (const c of set) {
      const [pair] = c.split(';');
      if (pair?.startsWith('tsid=')) this.cookie = pair.endsWith('=') ? '' : pair;
    }
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      // not JSON
    }
    return { status: res.status, body: parsed as T };
  }

  get<T = any>(path: string) {
    return this.req<T>('GET', path);
  }
  post<T = any>(path: string, body: unknown = {}) {
    return this.req<T>('POST', path, body);
  }
  patch<T = any>(path: string, body: unknown) {
    return this.req<T>('PATCH', path, body);
  }
  put<T = any>(path: string, body: unknown) {
    return this.req<T>('PUT', path, body);
  }
  del<T = any>(path: string) {
    return this.req<T>('DELETE', path);
  }

  static async login(api: RunningApi, name: string, admin = false) {
    const c = new Client(api);
    const r = await c.post('/auth/dev-login', { name, admin });
    if (r.status !== 200) throw new Error(`login failed: ${JSON.stringify(r.body)}`);
    return c;
  }
}

export const RULES = {
  mapPool: ['DM-Deck16][', 'DM-Morpheus', 'DM-Phobos', 'DM-Codex'],
  voteTimeoutSec: 15,
};

export function tournamentBody(
  over: Record<string, unknown> = {},
  settings: Record<string, unknown> = {},
) {
  return {
    name: 'Friday Cup',
    agentId: 'pi',
    profileId: 'local',
    botPool: [
      'Xan',
      'Loque',
      'Malcolm',
      'Brock',
      'Lauren',
      'Visse',
      'Tamika',
      'Dominator',
      'Rankin',
    ].map((name, i) => ({ name, skill: 7 - (i % 7) })),
    settings: {
      format: 'double',
      size: 8,
      checkInWindowMin: 1,
      noShowSec: 60,
      reconnectGraceSec: 60,
      postTournamentShutdownSec: 30,
      ...settings,
      game: { adapter: 'ut99-dm', rules: RULES },
    },
    ...over,
  };
}

/** Starts a season today (30 days) as admin; returns its number. */
export async function startSeason(admin: Client, days = 30): Promise<number> {
  const { today } = (await admin.get('/seasons')).body as { today: string };
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const endDate = new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  const res = await admin.post('/seasons', { startDate: today, endDate });
  if (res.status !== 201) throw new Error(`season: ${JSON.stringify(res.body)}`);
  return (res.body as { number: number }).number;
}
