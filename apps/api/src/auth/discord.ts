import type { ExternalIdentity } from './users.service.js';

/** The part of Discord's OAuth2 API we use; replaceable in tests. */
export interface DiscordApi {
  authorizeUrl(state: string): string;
  /** Exchanges the authorization code and returns the user (and guild ids if requested). */
  identify(code: string): Promise<ExternalIdentity & { guildIds?: string[] }>;
}

export const DISCORD = Symbol('DISCORD');

const API = 'https://discord.com/api/v10';

export function discordApi(opts: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  withGuilds: boolean;
}): DiscordApi {
  const scope = opts.withGuilds ? 'identify guilds' : 'identify';
  return {
    authorizeUrl(state) {
      const q = new URLSearchParams({
        response_type: 'code',
        client_id: opts.clientId,
        scope,
        redirect_uri: opts.redirectUri,
        state,
        prompt: 'none',
      });
      return `https://discord.com/oauth2/authorize?${q}`;
    },
    async identify(code) {
      const tokenRes = await fetch(`${API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: opts.redirectUri,
          client_id: opts.clientId,
          client_secret: opts.clientSecret,
        }),
      });
      if (!tokenRes.ok) throw new Error(`discord token exchange failed (${tokenRes.status})`);
      const token = (await tokenRes.json()) as { access_token: string; token_type: string };
      const auth = { Authorization: `${token.token_type} ${token.access_token}` };
      const meRes = await fetch(`${API}/users/@me`, { headers: auth });
      if (!meRes.ok) throw new Error(`discord /users/@me failed (${meRes.status})`);
      const me = (await meRes.json()) as {
        id: string;
        username: string;
        global_name?: string | null;
        avatar?: string | null;
      };
      let guildIds: string[] | undefined;
      if (opts.withGuilds) {
        const gRes = await fetch(`${API}/users/@me/guilds`, { headers: auth });
        if (!gRes.ok) throw new Error(`discord /users/@me/guilds failed (${gRes.status})`);
        guildIds = ((await gRes.json()) as { id: string }[]).map((g) => g.id);
      }
      return {
        discordId: me.id,
        username: me.username,
        displayName: me.global_name || me.username,
        avatar: me.avatar
          ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=64`
          : null,
        ...(guildIds ? { guildIds } : {}),
      };
    },
  };
}
