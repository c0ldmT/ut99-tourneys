/**
 * Anonymised copy of the website database (for simulators and analyses outside the Pi).
 *
 * - Players, bots, clans, teams, tags, tournaments, series, servers and server profiles get
 *   neutral names ("Spieler03", "Bot12", "Team04", "T02", "Turnier 7", "Server 1"), numbered in
 *   the order of the originals, so lists sorted by name keep their order.
 * - Names are replaced where the schema keeps names: the name columns and the name fields of the
 *   JSON columns (entrants, bot specs, team members, match statistics, pools, talents). Ids that
 *   carry names (tournament slugs, `bot-<name>` entrants, server and profile ids) are replaced
 *   as whole values and inside refs ("udt-match:<tournament>:W1-1:<user>"). Other strings are
 *   never searched and replaced, so states and kinds ("admin", "watch") stay intact.
 * - Secrets and free texts go: sessions, tokens, Discord ids (except AI and test managers) and
 *   avatars, join tokens, webhooks, server addresses, server inventories, bot bios and lines,
 *   dedications, trade messages, pause/abort reasons, replays.
 * - Numbers stay as they are, so wallets, ratings and the Dream Team economy compute the same.
 *
 * The source is read through SQLite's backup (consistent while the website runs) and never
 * changed. The copy is built in `<out>.part`; at the end every text is scanned for the
 * originals. Only a copy without leftovers is renamed to `out` - otherwise nothing is left.
 */
import { existsSync, renameSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { newJoinToken, randomId, sha256 } from '../common/ids.js';

export interface AnonymizeReport {
  /** Whether the copy was written (no leftovers). */
  written: boolean;
  /** How many originals got a neutral name, per kind. */
  mapped: Record<string, number>;
  /** Rows removed (sessions, replays, inventories). */
  removed: Record<string, number>;
  /** Originals still found in the copy (then no copy is written). */
  leftovers: { name: string; where: string; sample: string }[];
}

type Kind = 'player' | 'bot' | 'team' | 'clan' | 'name';
const PREFIX: Record<Kind, string> = {
  player: 'Spieler',
  bot: 'Bot',
  team: 'Team',
  clan: 'Clan',
  name: 'Name',
};
/** JSON keys whose strings are names of players, bots or teams. */
const NAME_KEYS = new Set(['displayName', 'name', 'gameName']);
/** JSON keys of game assets (models, skins, maps): kept and not scanned. */
const ASSET_KEYS = new Set([
  'botClass',
  'skin',
  'face',
  'voice',
  'favoriteWeapon',
  'weapon',
  'weapons',
  'map',
  'mapPool',
  'picks',
  'tiedFor',
  'adapter',
  'mesh',
  'model',
]);
/** JSON keys of secrets and addresses: removed (all optional in the schemas). */
const SECRET_KEY = /webhook|token|secret|password|address|avatar/i;
/** JSON keys of free texts: emptied (bot lines need a text, they get "..."). */
const TEXT_KEYS = new Set(['text', 'kill', 'death', 'message', 'bio', 'description']);
/** Keys and columns of states and kinds: never names (also not scanned, "admin" is a kind). */
const STATE_KEY =
  /^(kind|type|status|phase|outcome|mode|format|stage|side|origin|personality|box|rarity|code|source|level|form|notify_mode|notifyMode|botMatchMode|botPlacement|aiStrength|humanOrder)$/;
/** Ledger refs with a tournament id as their second part. */
const TOURNAMENT_REFS = new Set(['udt-match', 'udt-place', 'udt-pot', 'breeder-title', 'ticket']);
/** Columns of game assets and looks: kept and not scanned. */
const ASSET_COLUMNS = new Set([
  'bots.bot_class',
  'bots.skin',
  'bots.face',
  'users.look_json',
  'udt_traits.weapon',
]);
/** Keys and columns of ids, refs and tokens: checked against old ids only (random ids would hit names). */
const ID_KEY = /(^id$|Id$|_id$|^ref$|Ref$|_ref$|^rngSeed$|^token_hash$|^join_token$|^invite_code$)/;
const REF_KEY = /(^ref$|Ref$|_ref$)/;
/** Discord ids that are no secrets and that the website reads (AI and test managers). */
const KEEP_DISCORD = /^(ai:|dev:test\d+$)/;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const botEntrantId = (name: string) => `bot-${name.replace(/[^A-Za-z0-9_-]/g, '_')}`;
const pad = (n: number, width: number) => String(n).padStart(width, '0');
const byName = (a: string, b: string) => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
};

/** Original -> neutral names, injective, never one of the originals. */
class Names {
  private readonly map = new Map<string, string>();
  /** Discord user names: only looked up, never written to a name column. */
  private readonly aliases = new Map<string, string>();
  /** Tournaments, series, servers: their own names, apart from players, bots and teams. */
  private readonly fixedMap = new Map<string, string>();
  private readonly tagMap = new Map<string, string>();
  /** Every result of `field` (in-game names with tags ...): for the entrant ids. */
  readonly fields = new Map<string, string>();
  private readonly count: Record<Kind | 'tag', number> = {
    player: 0,
    bot: 0,
    team: 0,
    clan: 0,
    name: 0,
    tag: 0,
  };
  private readonly width: Record<Kind | 'tag', number> = {
    player: 2,
    bot: 2,
    team: 2,
    clan: 2,
    name: 2,
    tag: 2,
  };
  private readonly taken = new Set<string>();

  constructor(originals: Iterable<string>) {
    for (const s of originals) this.taken.add(s.toLowerCase());
  }

  private next(kind: Kind | 'tag'): string {
    for (;;) {
      const n = pad(++this.count[kind], this.width[kind]);
      const c = kind === 'tag' ? `T${n}` : `${PREFIX[kind]}${n}`;
      if (this.taken.has(c.toLowerCase())) continue;
      this.taken.add(c.toLowerCase());
      return c;
    }
  }

  /** Neutral names for a kind's originals, numbered in their sorted order. */
  assign(kind: Kind, list: Iterable<string>) {
    const todo = [...new Set(list)].filter((s) => s && !this.map.has(s)).sort(byName);
    this.width[kind] = Math.max(2, String(todo.length + this.count[kind]).length);
    for (const s of todo) this.map.set(s, this.next(kind));
  }

  assignTags(list: Iterable<string>) {
    const todo = [...new Set(list)].filter((s) => s && !this.tagMap.has(s)).sort(byName);
    this.width.tag = Math.max(2, String(todo.length + this.count.tag).length);
    for (const s of todo) this.tagMap.set(s, this.next('tag'));
  }

  get(original: string): string | undefined {
    return this.map.get(original) ?? this.aliases.get(original) ?? this.fixedMap.get(original);
  }

  /** An alias (a Discord user name) for the neutral name of another original. */
  alias(original: string, neutral: string) {
    if (original && !this.map.has(original)) this.aliases.set(original, neutral);
  }

  /** A fixed neutral name (tournaments, series, servers). */
  fixed(original: string, neutral: string) {
    this.fixedMap.set(original, neutral);
    this.taken.add(neutral.toLowerCase());
  }

  fixedName(original: string): string | undefined {
    return this.fixedMap.get(original);
  }

  of(original: string, kind: Kind): string {
    const known = this.map.get(original);
    if (known) return known;
    const made = this.next(kind);
    this.map.set(original, made);
    return made;
  }

  tag(original: string): string {
    const known = this.tagMap.get(original);
    if (known) return known;
    const made = this.next('tag');
    this.tagMap.set(original, made);
    return made;
  }

  /** A known name, also with a number the website appended to make it unique ("Mario2"). */
  private known(rest: string): string | undefined {
    const whole = this.map.get(rest) ?? this.aliases.get(rest);
    if (whole) return whole;
    const d = /^(.*?[^\d])(\d+)$/.exec(rest);
    const base = d ? (this.map.get(d[1]!) ?? this.aliases.get(d[1]!)) : undefined;
    return base && d ? `${base}_${d[2]}` : undefined;
  }

  /**
   * A name field: "Name", "Name2", "Team Name" or an in-game name with the team or clan tag in
   * front ("MMStarbot", "[T1]Rookie1"). A name not seen before (a deleted bot, a server bot, a
   * cut name) gets its own neutral name.
   */
  field(value: string, kind: Kind): string {
    const done = this.fields.get(value);
    if (done) return done;
    const result = this.resolve(value, kind);
    this.fields.set(value, result);
    return result;
  }

  private resolve(value: string, kind: Kind): string {
    const direct = this.known(value);
    if (direct) return direct;
    const tags = [...this.tagMap.keys()].sort((a, b) => b.length - a.length);
    for (const t of tags) {
      if (!value.startsWith(t) || value.length === t.length) continue;
      const rest = this.known(value.slice(t.length));
      if (rest) return this.tagMap.get(t)! + rest;
    }
    const m = /^\[([^\]]{1,8})\](.+)$/s.exec(value);
    if (m) return `[${this.tag(m[1]!)}]${this.known(m[2]!) ?? this.of(m[2]!, kind)}`;
    return this.of(value, kind);
  }

  counts(): Record<string, number> {
    return { ...this.count };
  }

  /** Originals of names and tags (for the scan). */
  originals(): string[] {
    return [
      ...this.map.keys(),
      ...this.aliases.keys(),
      ...this.fixedMap.keys(),
      ...this.tagMap.keys(),
      ...this.fields.keys(),
    ];
  }
}

interface Column {
  name: string;
  type: string;
  notnull: number;
}

export async function anonymizeDatabase(src: string, out: string): Promise<AnonymizeReport> {
  if (!existsSync(src)) throw new Error(`no database at ${src}`);
  if (existsSync(out)) throw new Error(`${out} exists already`);
  const part = `${out}.part`;
  rmSync(part, { force: true });
  let report: AnonymizeReport | undefined;
  try {
    const source = new Database(src, { readonly: true, fileMustExist: true });
    try {
      await source.backup(part);
    } finally {
      source.close();
    }
    const db = new Database(part);
    try {
      db.pragma('journal_mode = DELETE');
      db.pragma('foreign_keys = OFF');
      report = run(db);
      if (!report.leftovers.length) db.exec('VACUUM');
    } finally {
      db.close();
    }
    if (!report.leftovers.length) {
      renameSync(part, out);
      report.written = true;
    }
    return report;
  } finally {
    // A copy with originals (an error, leftovers) is never left behind.
    if (!report?.written) rmSync(part, { force: true });
    rmSync(`${part}-journal`, { force: true });
  }
}

function run(db: Database.Database): AnonymizeReport {
  const tables = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
  )
    .map((t) => t.name)
    .filter((t) => !t.startsWith('sqlite_'));
  const has = (t: string) => tables.includes(t);
  const columns = new Map<string, Column[]>(
    tables.map((t) => [t, db.prepare(`PRAGMA table_info("${t}")`).all() as Column[]]),
  );
  const hasCol = (t: string, c: string) => !!columns.get(t)?.some((x) => x.name === c);
  const rows = <T>(sql: string): T[] => db.prepare(sql).all() as T[];
  const col = <T>(t: string, c: string, order = 'rowid'): T[] =>
    has(t) && hasCol(t, c)
      ? rows<{ v: T }>(`SELECT "${c}" AS v FROM "${t}" ORDER BY ${order}`).map((r) => r.v)
      : [];
  const parse = (s: unknown): unknown => {
    if (typeof s !== 'string' || !/^[[{"]/.test(s)) return undefined;
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return undefined;
    }
  };
  const removed: Record<string, number> = {};

  // --- The originals.
  const users = has('users')
    ? rows<{ id: string; display_name: string; username: string; discord_id: string | null }>(
        'SELECT id, display_name, username, discord_id FROM users ORDER BY created_at, id',
      )
    : [];
  const clans = has('bot_clans')
    ? rows<{ name: string; tag: string }>('SELECT name, tag FROM bot_clans')
    : [];
  const tournaments = has('tournaments')
    ? rows<{ id: string; name: string; kind: string | null }>(
        `SELECT id, name, ${hasCol('tournaments', 'kind') ? 'kind' : 'NULL AS kind'} FROM tournaments ORDER BY created_at, id`,
      )
    : [];
  const agents = col<string>('agents', 'id', 'created_at, id');
  const teamNames: string[] = [];
  if (has('settings')) {
    const row = db.prepare("SELECT value_json FROM settings WHERE key = 'teamNames'").get() as
      { value_json: string } | undefined;
    const v = parse(row?.value_json);
    if (Array.isArray(v)) teamNames.push(...v.filter((x): x is string => typeof x === 'string'));
  }
  const tableNames = {
    player: users.map((u) => u.display_name),
    bot: [...col<string>('bots', 'name'), ...col<string>('udt_hall', 'name')],
    team: [...col<string>('udt_teams', 'name'), ...col<string>('teams', 'name'), ...teamNames],
    clan: clans.map((c) => c.name),
  };
  const tableTags = [
    ...clans.map((c) => c.tag),
    ...col<string>('udt_teams', 'tag'),
    ...col<string | null>('teams', 'tag').filter((t): t is string => !!t),
  ];

  // Tournament ids, also of deleted tournaments (left in refs, entries, the ledger).
  const tids = new Set(tournaments.map((t) => t.id));
  for (const t of tables)
    if (hasCol(t, 'tournament_id'))
      for (const id of col<string>(t, 'tournament_id')) if (id) tids.add(id);
  for (const r of [
    ...col<string>('neuro_ledger', 'ref'),
    ...col<string>('udt_entries', 'ticket_ref'),
  ]) {
    const [kind, id] = (r ?? '').split(':');
    if (kind && id && TOURNAMENT_REFS.has(kind)) tids.add(id);
  }
  for (const m of col<string>('neuro_ledger', 'meta_json')) {
    const v = parse(m) as { tournamentId?: unknown } | undefined;
    if (typeof v?.tournamentId === 'string') tids.add(v.tournamentId);
  }
  const profiles = new Set<string>(
    [
      ...col<string>('tournaments', 'profile_id'),
      ...col<string>('inventories', 'profile_id'),
    ].filter(Boolean),
  );

  const names = new Names([
    ...Object.values(tableNames).flat(),
    ...users.map((u) => u.username),
    ...tableTags,
  ]);
  names.assign('player', tableNames.player);
  for (const u of users) names.alias(u.username, names.get(u.display_name)!);
  names.assign('bot', tableNames.bot);
  names.assign('team', tableNames.team);
  names.assign('clan', tableNames.clan);
  names.assignTags(tableTags);
  const userName = new Map(users.map((u) => [u.id, names.get(u.display_name)!]));

  const tid = new Map<string, string>();
  const ordered = [
    ...tournaments.map((t) => t.id),
    ...[...tids].filter((id) => !tournaments.some((t) => t.id === id)).sort(),
  ];
  const width = Math.max(3, String(ordered.length).length);
  let n = 0;
  for (const id of ordered) {
    let neutral: string;
    do neutral = `t${pad(++n, width)}`;
    while (tids.has(neutral));
    tid.set(id, neutral);
  }
  tournaments.forEach((t, i) =>
    names.fixed(t.name, `${t.kind === 'udt' ? 'Dream Team Cup' : 'Turnier'} ${i + 1}`),
  );
  col<string>('series', 'name', 'created_at, id').forEach((s, i) =>
    names.fixed(s, `Serie ${i + 1}`),
  );
  const agentIds = new Map(agents.map((a, i) => [a, `server${i + 1}`]));
  col<string>('agents', 'name', 'created_at, id').forEach((a, i) =>
    names.fixed(a, `Server ${i + 1}`),
  );
  const profileIds = new Map([...profiles].sort().map((p, i) => [p, `profile${i + 1}`]));

  // --- Ids and refs.
  const entrantIds = new Map<string, string>();
  const ref = (s: string): string =>
    s
      .split(':')
      .map((p) => tid.get(p) ?? entrantIds.get(p) ?? p)
      .join(':');
  /** A string that may be an id: tournaments, bot entrants, refs; servers and profiles by key. */
  const remap = (s: string, key: string): string => {
    if (key === 'agentId' || key === 'agent_id') return agentIds.get(s) ?? s;
    if (key === 'profileId' || key === 'serverProfileId' || key === 'profile_id')
      return profileIds.get(s) ?? s;
    const e = entrantIds.get(s);
    if (e) return e;
    const t = tid.get(s);
    // A slug without "-" or digits ("watch") could also be a state: only under an id key.
    if (t && (/[-\d]/.test(s) || /(^id$|Id$|_id$)/.test(key))) return t;
    if (key === 'rngSeed') {
      const m = /^(.*)-(\d+)$/.exec(s);
      if (m && tid.has(m[1]!)) return `${tid.get(m[1]!)}-${m[2]}`;
    }
    if (REF_KEY.test(key)) return ref(s);
    return s;
  };

  // --- JSON.
  interface Ctx {
    kind: Kind;
    event?: string;
    user?: string;
  }
  const walk = (v: unknown, key: string, ctx: Ctx): unknown => {
    if (typeof v === 'string') {
      if (ASSET_KEYS.has(key) || STATE_KEY.test(key)) return v;
      if (TEXT_KEYS.has(key)) return key === 'text' ? '...' : '';
      if (key === 'reason' && ctx.event && /paused|aborted/.test(ctx.event)) return 'anonymized';
      if (key === 'tag') return names.tag(v);
      if (key === 'name' && ctx.event === 'tournament.created')
        return names.fixedName(v) ?? 'Turnier';
      if (NAME_KEYS.has(key)) return ctx.user ?? names.get(v) ?? names.field(v, ctx.kind);
      return remap(v, key);
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, key, ctx));
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      let kind: Kind = ctx.kind;
      if (o.kind === 'human' || typeof o.userId === 'string') kind = 'player';
      else if (o.kind === 'bot' || o.bot === true || 'skill' in o) kind = 'bot';
      else if (o.kind === 'team' || 'members' in o) kind = 'team';
      const user = typeof o.userId === 'string' ? userName.get(o.userId) : undefined;
      const inner: Ctx = {
        kind,
        ...(ctx.event ? { event: ctx.event } : {}),
        ...(user ? { user } : {}),
      };
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(o)) {
        if (SECRET_KEY.test(k)) continue;
        // A bridge acts with its agent id.
        if (k === 'id' && o.kind === 'bridge' && typeof x === 'string') {
          out[k] = agentIds.get(x) ?? x;
          continue;
        }
        out[entrantIds.get(k) ?? k] = walk(x, k, inner);
      }
      return out;
    }
    return v;
  };
  /** The kind of names in a JSON column (when its objects do not tell). */
  const jsonKind = (table: string, column: string): Kind =>
    column === 'bot_pool_json' || table === 'udt_scouts' ? 'bot' : 'name';
  const cells = (t: string, c: string) =>
    rows<{ v: unknown; type?: string }>(
      `SELECT "${c}" AS v${t === 'events' ? ', type' : ''} FROM "${t}"`,
    );

  // First pass: every name field of every JSON column, so names the tables do not know (deleted
  // bots, server bots, cut names) get their neutral names before ids are derived from them.
  for (const t of tables) {
    if (t === 'inventories') continue;
    for (const c of columns.get(t)!) {
      if (ASSET_COLUMNS.has(`${t}.${c.name}`)) continue;
      for (const r of cells(t, c.name)) {
        const j = parse(r.v);
        if (j !== undefined && typeof j === 'object')
          walk(j, c.name, { kind: jsonKind(t, c.name), ...(r.type ? { event: r.type } : {}) });
      }
    }
  }
  // Bots without a library id are entrants by their (in-game) name.
  for (const [original, neutral] of names.fields)
    entrantIds.set(botEntrantId(original), botEntrantId(neutral));
  for (const original of names.originals()) {
    const neutral = names.get(original);
    if (neutral && !entrantIds.has(botEntrantId(original)))
      entrantIds.set(botEntrantId(original), botEntrantId(neutral));
  }
  for (const [k, v] of [...entrantIds]) if (k === v) entrantIds.delete(k);

  // --- Rewrite.
  const discordIds: string[] = [];
  const update = db.transaction(() => {
    for (const t of ['sessions', 'game_replays', 'inventories'])
      if (has(t)) removed[t] = db.prepare(`DELETE FROM "${t}"`).run().changes;
    users.forEach((u, i) => {
      const neutral = userName.get(u.id)!;
      const keep = u.discord_id !== null && KEEP_DISCORD.test(u.discord_id);
      if (u.discord_id && !keep) discordIds.push(u.discord_id);
      const set = ['display_name = ?', 'display_key = ?', 'username = ?'];
      const values: unknown[] = [neutral, neutral.toLowerCase(), neutral.toLowerCase()];
      if (hasCol('users', 'discord_id') && !keep && u.discord_id !== null) {
        set.push('discord_id = ?');
        values.push(`anon:${i + 1}`);
      }
      if (hasCol('users', 'avatar')) set.push('avatar = NULL');
      if (hasCol('users', 'join_token')) {
        set.push('join_token = ?');
        values.push(newJoinToken());
      }
      db.prepare(`UPDATE users SET ${set.join(', ')} WHERE id = ?`).run(...values, u.id);
    });
    for (const [id, neutral] of agentIds) {
      const name = (db.prepare('SELECT name FROM agents WHERE id = ?').get(id) as { name: string })
        .name;
      db.prepare(
        `UPDATE agents SET id = ?, name = ?, token_hash = ?${hasCol('agents', 'info_json') ? ", info_json = '{}'" : ''} WHERE id = ?`,
      ).run(neutral, names.fixedName(name)!, sha256(randomId(40)), id);
    }
    const named = (
      t: string,
      set: (r: Record<string, string | null>) => Record<string, unknown>,
    ) => {
      if (!has(t)) return;
      for (const r of rows<Record<string, string | null> & { __rowid: number }>(
        `SELECT rowid AS __rowid, * FROM "${t}"`,
      )) {
        const s = Object.entries(set(r)).filter(([c]) => hasCol(t, c));
        if (s.length)
          db.prepare(
            `UPDATE "${t}" SET ${s.map(([c]) => `"${c}" = ?`).join(', ')} WHERE rowid = ?`,
          ).run(...s.map(([, v]) => v), r.__rowid);
      }
    };
    named('tournaments', (r) => ({
      name: names.fixedName(r.name!) ?? r.name,
      webhook_url: null,
      connect_address: null,
    }));
    named('series', (r) => ({ name: names.fixedName(r.name!) ?? r.name }));
    named('bots', (r) => {
      const neutral = names.get(r.name!)!;
      return { name: neutral, name_key: neutral.toLowerCase(), bio: null };
    });
    named('bot_clans', (r) => {
      const neutral = names.get(r.name!)!;
      return {
        name: neutral,
        name_key: neutral.toLowerCase(),
        tag: names.tag(r.tag!),
        description: null,
      };
    });
    named('udt_teams', (r) => {
      const neutral = names.get(r.name!)!;
      const tag = names.tag(r.tag!);
      return { name: neutral, name_key: neutral.toLowerCase(), tag, tag_key: tag.toLowerCase() };
    });
    named('teams', (r) => {
      const neutral = names.get(r.name!)!;
      return {
        name: neutral,
        name_key: neutral.toLowerCase(),
        tag: r.tag ? names.tag(r.tag) : null,
      };
    });
    named('udt_hall', (r) => ({ name: names.get(r.name!)! }));
    named('udt_trades', () => ({ message: null }));

    const done = new Set([
      'users.display_name',
      'users.display_key',
      'users.username',
      'users.discord_id',
      'users.avatar',
      'users.join_token',
      'agents.id',
      'agents.name',
      'agents.token_hash',
      'agents.info_json',
      'tournaments.name',
      'tournaments.webhook_url',
      'tournaments.connect_address',
      'series.name',
      'bots.name',
      'bots.name_key',
      'bots.bio',
      'bot_clans.name',
      'bot_clans.name_key',
      'bot_clans.tag',
      'bot_clans.description',
      'udt_teams.name',
      'udt_teams.name_key',
      'udt_teams.tag',
      'udt_teams.tag_key',
      'teams.name',
      'teams.name_key',
      'teams.tag',
      'udt_hall.name',
      'udt_trades.message',
    ]);
    for (const t of tables) {
      const cols = columns
        .get(t)!
        .filter(
          (c) =>
            !done.has(`${t}.${c.name}`) &&
            !ASSET_COLUMNS.has(`${t}.${c.name}`) &&
            !STATE_KEY.test(c.name),
        );
      if (!cols.length) continue;
      for (const r of rows<Record<string, unknown>>(
        `SELECT rowid AS __rowid, ${cols.map((c) => `"${c.name}"`).join(', ')}${
          t === 'events' ? ', type AS __type' : ''
        }${t === 'settings' ? ', key AS __key' : ''} FROM "${t}"`,
      )) {
        const set: string[] = [];
        const values: unknown[] = [];
        for (const c of cols) {
          const v = r[c.name];
          if (typeof v !== 'string') continue;
          let next: string;
          const j = parse(v);
          if (r.__key === 'teamNames' && Array.isArray(j))
            next = JSON.stringify(j.map((x) => (typeof x === 'string' ? names.of(x, 'team') : x)));
          else if (j !== undefined && typeof j === 'object' && j !== null)
            next = JSON.stringify(
              walk(j, c.name, {
                kind: jsonKind(t, c.name),
                ...(typeof r.__type === 'string' ? { event: r.__type } : {}),
              }),
            );
          else next = remap(v, c.name);
          if (next !== v) {
            set.push(`"${c.name}" = ?`);
            values.push(next);
          }
        }
        if (set.length)
          db.prepare(`UPDATE "${t}" SET ${set.join(', ')} WHERE rowid = ?`).run(
            ...values,
            r.__rowid,
          );
      }
    }
  });
  update();

  const leftovers = scan(
    db,
    tables,
    columns,
    [
      ...entrantIds.keys(),
      ...tids,
      ...agents,
      ...[...profiles].filter((p) => p !== 'local'),
      ...discordIds,
    ],
    names.originals(),
  );
  return {
    written: false,
    mapped: {
      ...names.counts(),
      tournaments: tid.size,
      series: col<string>('series', 'id').length,
      servers: agents.length,
    },
    removed,
    leftovers,
  };
}

/** Every original (name, old id, Discord id) still in a text of the copy. */
function scan(
  db: Database.Database,
  tables: string[],
  columns: Map<string, Column[]>,
  ids: string[],
  list: string[],
): AnonymizeReport['leftovers'] {
  // Old ids (entrants "bot-Bo", tournament slugs, servers, Discord ids) as whole ids only:
  // "bot-Bot17" is a neutral one.
  // Very short ids ("pi", Discord test ids) would hit any number or word.
  ids = [...new Set(ids)].filter((id) => id.length >= 4);
  const idRe = ids.length
    ? new RegExp(`(?<![A-Za-z0-9_-])(${ids.map(escape).join('|')})(?![A-Za-z0-9_-])`)
    : null;
  // Originals that look like neutral names ("Server", "T") would hit every neutral name.
  const neutral =
    /^(Spieler|Bot|Team|Clan|Name|Turnier|Serie|Server|Dream Team Cup|T|t|server|profile)[\s_\d]*$/;
  // Also originals inside the neutral words ("Spiel" in "Spieler01").
  const words = new Set(
    'spieler bot team clan name turnier serie server dream cup profile anon anonymized'.split(' '),
  );
  const originals = [...new Set(list)].filter(
    (k) => k && !neutral.test(k) && !words.has(k.toLowerCase()),
  );
  const re = (l: string[], f: (x: string) => string) =>
    l.length ? new RegExp(l.map(f).join('|'), 'i') : null;
  // From 4 characters anywhere (also glued to a tag: "MMStarbot"), 3 as a word, shorter ones
  // only as a whole name. Case-insensitive.
  const long = re(
    originals.filter((k) => k.length >= 4),
    escape,
  );
  const mid = re(
    originals.filter((k) => k.length === 3),
    (k) => `(?<![A-Za-z0-9])${escape(k)}(?![A-Za-z])`,
  );
  const short = new Set(originals.filter((k) => k.length < 3).map((k) => k.toLowerCase()));
  const found: AnonymizeReport['leftovers'] = [];
  // Ids, refs and tokens only against old ids: a random id may contain a name ("l03hAwKzi").
  const check = (s: string, where: string, mode: 'id' | 'name' | 'text') => {
    const hit =
      idRe?.exec(s)?.[0] ??
      (mode === 'id'
        ? null
        : (long?.exec(s)?.[0] ??
          mid?.exec(s)?.[0] ??
          (mode === 'name' && short.has(s.toLowerCase()) ? s : null)));
    if (hit && found.length < 200) found.push({ name: hit, where, sample: s.slice(0, 80) });
  };
  const values = (v: unknown, key: string, where: string) => {
    if (typeof v === 'string') {
      if (!ASSET_KEYS.has(key) && !STATE_KEY.test(key))
        check(
          v,
          where,
          ID_KEY.test(key) ? 'id' : NAME_KEYS.has(key) || key === 'tag' ? 'name' : 'text',
        );
    } else if (Array.isArray(v)) v.forEach((x) => values(x, key, where));
    else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v)) {
        if (k.startsWith('bot-')) check(k, where, 'id'); // entrant ids of bots by name
        values(x, k, where);
      }
  };
  const nameColumns = /^(name|display_name|username|tag)$/;
  for (const t of tables)
    for (const c of columns.get(t)!) {
      if (ASSET_COLUMNS.has(`${t}.${c.name}`) || STATE_KEY.test(c.name)) continue;
      for (const r of db.prepare(`SELECT "${c.name}" AS v FROM "${t}"`).all() as { v: unknown }[]) {
        if (typeof r.v !== 'string') continue;
        if (c.name === 'discord_id' && KEEP_DISCORD.test(r.v)) continue;
        let j: unknown;
        try {
          j = /^[[{]/.test(r.v) ? (JSON.parse(r.v) as unknown) : undefined;
        } catch {
          j = undefined;
        }
        if (j !== undefined) values(j, c.name, `${t}.${c.name}`);
        else
          check(
            r.v,
            `${t}.${c.name}`,
            ID_KEY.test(c.name) ? 'id' : nameColumns.test(c.name) ? 'name' : 'text',
          );
      }
    }
  return found;
}
