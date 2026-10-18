import type { ApiLogger } from '../common/logger.js';

/**
 * Outgoing Discord messages: webhook posts to a channel and direct messages from a bot.
 * Everything here is best effort: failures are logged, never thrown, and nothing waits for it.
 */
/** A Discord embed (https://discord.com/developers/docs/resources/message#embed-object). */
export interface Embed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  author?: { name: string; url?: string };
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
}

/** A channel post: text, embeds or both. */
export interface DiscordPost {
  content?: string;
  embeds: Embed[];
}

export interface DiscordOut {
  /** Posts to a channel webhook (plain text or embeds). */
  webhook(url: string, content: string | DiscordPost): void;
  /** Sends a direct message to a Discord user (needs a bot token). */
  dm(discordUserId: string, content: string): void;
  /** Resolves when everything queued so far was sent or given up (tests). */
  idle(): Promise<void>;
}

export const DISCORD_OUT = Symbol('DISCORD_OUT');

const API = 'https://discord.com/api/v10';
const WEBHOOK =
  /^https:\/\/(?:(?:ptb|canary)\.)?(?:discord|discordapp)\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/[\w-]+$/;

/** Only real Discord webhook URLs are used (an admin typo must not post anywhere else). */
export const isWebhookUrl = (url: string) => WEBHOOK.test(url.trim());

/** A Discord user id (snowflake); development logins ("dev:...") have none. */
export const isDiscordId = (id: string) => /^\d{5,25}$/.test(id);

/** Discord rejects messages over 2000 characters. */
export const fitMessage = (s: string) => (s.length <= 1900 ? s : `${s.slice(0, 1897)}...`);

const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 3)}...`);

/** Discord's embed limits: title 256, description 4096, 25 fields (name 256, value 1024). */
export function fitEmbed(e: Embed): Embed {
  return {
    ...e,
    ...(e.title ? { title: cut(e.title, 256) } : {}),
    ...(e.description ? { description: cut(e.description, 4000) } : {}),
    ...(e.author ? { author: { ...e.author, name: cut(e.author.name, 256) } } : {}),
    ...(e.fields
      ? {
          fields: e.fields
            .slice(0, 25)
            .map((f) => ({ ...f, name: cut(f.name, 256), value: cut(f.value || '–', 1024) })),
        }
      : {}),
  };
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export function discordOut(opts: {
  botToken: string;
  log: ApiLogger;
  fetchFn?: FetchFn;
  /** Pause between two requests (Discord allows about 5 per second per route). */
  gapMs?: number;
}): DiscordOut {
  const fetchFn = opts.fetchFn ?? ((url, init) => fetch(url, init));
  const gap = opts.gapMs ?? 300;
  let queue: Promise<void> = Promise.resolve();
  const dmChannels = new Map<string, string>();
  let botBroken = false;
  const warned = new Set<string>();
  const warnOnce = (key: string, msg: string) => {
    if (warned.has(key)) return;
    warned.add(key);
    opts.log.warn(msg);
  };
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.());

  /** One request with a retry after a rate limit. Returns the response or undefined. */
  async function send(url: string, body: unknown, auth?: string): Promise<Response | undefined> {
    for (let attempt = 0; attempt < 3; attempt++) {
      let res: Response;
      try {
        res = await fetchFn(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(auth ? { Authorization: auth } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (e) {
        opts.log.warn(`discord: request failed: ${(e as Error).message}`);
        return undefined;
      }
      if (res.status !== 429) return res;
      const data = (await res.json().catch(() => ({}))) as { retry_after?: number };
      await sleep(Math.min(10_000, Math.max(500, (data.retry_after ?? 1) * 1000)));
    }
    return undefined;
  }

  function enqueue(task: () => Promise<void>) {
    queue = queue
      .then(task)
      .catch((e: unknown) => opts.log.warn(`discord: ${(e as Error).message}`))
      .then(() => sleep(gap));
  }

  const message = (content: string | DiscordPost) =>
    typeof content === 'string'
      ? { content: fitMessage(content), allowed_mentions: { parse: [] as string[] } }
      : {
          ...(content.content ? { content: fitMessage(content.content) } : {}),
          embeds: content.embeds.slice(0, 10).map(fitEmbed),
          allowed_mentions: { parse: [] as string[] },
        };

  return {
    webhook(url, content) {
      if (!isWebhookUrl(url)) {
        warnOnce(`url:${url}`, 'discord: the webhook URL is not a Discord webhook, nothing posted');
        return;
      }
      enqueue(async () => {
        const res = await send(`${url.trim()}?wait=false`, message(content));
        if (res && !res.ok)
          warnOnce(
            `wh:${url}:${res.status}`,
            `discord: webhook answered ${res.status} (check the URL)`,
          );
      });
    },
    dm(discordUserId, content) {
      if (!opts.botToken || botBroken || !isDiscordId(discordUserId)) return;
      const auth = `Bot ${opts.botToken}`;
      enqueue(async () => {
        if (botBroken) return; // the token was rejected while this message waited
        let channel = dmChannels.get(discordUserId);
        if (!channel) {
          const res = await send(
            `${API}/users/@me/channels`,
            { recipient_id: discordUserId },
            auth,
          );
          if (!res) return;
          if (res.status === 401) {
            botBroken = true;
            opts.log.warn('discord: the bot token was rejected (401), direct messages are off');
            return;
          }
          if (!res.ok) {
            opts.log.warn(`discord: cannot open a DM with ${discordUserId} (${res.status})`);
            return;
          }
          channel = ((await res.json()) as { id: string }).id;
          dmChannels.set(discordUserId, channel);
        }
        const res = await send(`${API}/channels/${channel}/messages`, message(content), auth);
        // 403: the user does not accept DMs from this bot (no shared server, DMs closed).
        if (res && !res.ok) opts.log.info(`discord: DM to ${discordUserId} failed (${res.status})`);
      });
    },
    idle: () => queue,
  };
}
