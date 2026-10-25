# Website API

NestJS backend of the website: Discord login, tournaments, the canonical event log and the WebSocket gateway
for bridge agents. It also serves the built Angular app (`apps/web/dist`).

## Quick start (local, without Discord)

```sh
pnpm install && pnpm build
cp apps/api/.env.example apps/api/.env       # set DEV_LOGIN=true
node --env-file=apps/api/.env apps/api/dist/main.js
```

Open http://localhost:8080, log in with any name ("as admin" for the first user), add a game server under
**Servers** and put the shown agent id and token into the bridge's `bridge.json` (see
[apps/bridge/README.md](../bridge/README.md#website-mode)).

## Discord login

1. https://discord.com/developers/applications → **New Application**.
2. **OAuth2** → copy _Client ID_ and _Client Secret_ → `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`.
3. **OAuth2 → Redirects** → add `<PUBLIC_URL>/api/auth/discord/callback`
   (e.g. `https://cup.example.com/api/auth/discord/callback`, or `http://localhost:8080/...` for testing).
4. Optional: only members of your Discord server may log in → `DISCORD_GUILD_ID` (server id; enable the
   developer mode in Discord to copy ids).
5. `ADMIN_DISCORD_IDS` = your Discord user id (comma separated for several). Admins can promote other users
   on the **Users** page.
6. Set `DEV_LOGIN=false`.

The app only asks for the `identify` scope (plus `guilds` with a guild restriction); it never sees e-mail
addresses or messages.

## Configuration

All settings are environment variables, see [.env.example](.env.example).

| Variable                                      | Default                    | Meaning                                          |
| --------------------------------------------- | -------------------------- | ------------------------------------------------ |
| `PUBLIC_URL`                                  | `http://localhost:8080`    | URL in the browser; https enables secure cookies |
| `HOST` / `PORT`                               | `0.0.0.0` / `8080`         | Listen address                                   |
| `DATA_DIR`                                    | `./data`                   | SQLite database `tourney.db`                     |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` |                            | Discord login (both needed)                      |
| `DISCORD_GUILD_ID`                            |                            | Restrict login to members of one Discord server  |
| `ADMIN_DISCORD_IDS`                           |                            | Admins                                           |
| `DEV_LOGIN`                                   | `false`                    | Name-only login for local tests                  |
| `WEB_DIST`                                    | `apps/web/dist` if present | Built frontend                                   |
| `SESSION_DAYS`                                | `30`                       | Login lifetime                                   |
| `DISCORD_WEBHOOK_URL`                         |                            | Optional: default channel for notifications      |
| `DISCORD_BOT_TOKEN`                           |                            | Optional: direct messages from a bot             |
| `NOTIFY_LANG` / `NOTIFY_REMIND_MIN`           | `de` / `30`                | Message language, reminder before the start      |
| `SEASON_TZ`                                   | `Europe/Berlin`            | Time zone of the season days                     |
| `TEST_MODE`                                   | `false`                    | Dream Team test mode (local test instance only)  |

### Dream Team test mode (local)

For trying a whole Dream Team season in an afternoon: a second instance on a PC with its own data folder, e.g.
a copy of the real database.

```sh
DATA_DIR=./data-test DEV_LOGIN=true TEST_MODE=true PORT=8099 pnpm --filter @tourney/api dev
```

Admin endpoints (`/api/udt/test`, 404 without `TEST_MODE`): `GET` state; `POST advance {hours}` moves the clock
(market days on the way run), `POST market-day`, `POST season-end`, `POST simulate/:id` plays a Dream Team
tournament without a game server (results by the bots' strength), `POST managers {count}` creates test managers
with a team, `POST managers/act` lets them bid, line up and enter open tournaments. `POST league/day` plays the next
league evening ("Matchday now": the clock goes to its slot, the games on the server are simulated, the clock
moves past the evening so every result shows), `POST league/end` plays every evening left with the relegation
and the final four ("League season end"). The clock offset lives in memory: a restart starts at the real time.

### Discord notifications (optional)

Nothing depends on them: without these settings, or with wrong ones, the website works as before (a wrong
webhook URL or a rejected bot token is logged once and the notifications stay off).

- **Channel (webhook):** registration open, check-in started, every match result, the champion. Default from
  `DISCORD_WEBHOOK_URL`; each tournament can use the default, its own webhook or none (tournament form).
- **Direct messages (bot):** check-in with the personal connect command, "your match starts now", a reminder
  `NOTIFY_REMIND_MIN` minutes before the scheduled start, team joins (to the player and the captain), the
  final place. Players switch them off in their profile. The bot must share a Discord server with the player;
  development logins get none.

## Running it for real

Everything on one Raspberry Pi (64-bit OS) or the website on a separate host — both work, the bridge connects
outbound to the website.

- **Installation:** release bundle and install scripts, see [Raspberry Pi](../../docs/install-raspberry-pi.md),
  [Linux server](../../docs/install-linux.md) and [Windows server](../../docs/install-windows.md). The systemd
  units are in [deploy/linux](../../deploy/linux).
- **HTTPS:** Discord requires https for public redirect URLs. A reverse proxy such as Caddy does it in two
  lines ([deploy/Caddyfile](../../deploy/Caddyfile)); it passes WebSockets (`/api/agent`) and server-sent events
  (`/api/tournaments/*/stream`) through without extra settings. With nginx, disable buffering for the stream
  and forward the `Upgrade` header for `/api/agent`.
- **Backup:** the whole state is `DATA_DIR/tourney.db` (SQLite in WAL mode; copy it with
  `sqlite3 tourney.db ".backup backup.db"` while the API runs).

## API overview

| Endpoint                                                                                                                                               | Who            | Purpose                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/config`                                                                                                                                      | everyone       | Site name, available login methods                                                                                                                        |
| `GET /api/auth/discord`, `/api/auth/discord/callback`                                                                                                  | everyone       | Discord OAuth2                                                                                                                                            |
| `POST /api/auth/dev-login`, `POST /api/auth/logout`                                                                                                    |                | Development login, logout                                                                                                                                 |
| `GET/PATCH /api/me`, `POST /api/me/token`                                                                                                              | user           | Profile, in-game name, join token                                                                                                                         |
| `GET /api/tournaments`, `GET /api/tournaments/:id`                                                                                                     | user           | List, detail (incl. projection and bracket)                                                                                                               |
| `GET /api/tournaments/:id/stream`                                                                                                                      | user           | Server-sent events                                                                                                                                        |
| `POST/DELETE /api/tournaments/:id/registration`, `/watch`                                                                                              | user           | Take part, watch on the server                                                                                                                            |
| `POST /api/tournaments/:id/teams`, `.../teams/join`                                                                                                    | user           | Team tournaments: create a team, join by invite code                                                                                                      |
| `PATCH/DELETE /api/tournaments/:id/teams/:teamId`, `.../invite`, `.../lineup`, `.../members/:userId`                                                   | captain, admin | Rename, captaincy, invite link, starters, members                                                                                                         |
| `POST /api/tournaments/:id/teams/build`, `PUT .../registrations/:userId`                                                                               | admin          | Draw solo players into teams, move a player                                                                                                               |
| `POST /api/tournaments`, `PATCH`, `DELETE`                                                                                                             | admin          | Drafts                                                                                                                                                    |
| `POST /api/tournaments/:id/seed`, `/reset`, `/run`                                                                                                     | admin          | Seeding (auto/manual), back to draft, start                                                                                                               |
| `POST /api/tournaments/:id/command`                                                                                                                    | admin          | forceStart, pause, resume, abort, announce                                                                                                                |
| `GET /api/tournaments/:id/events`                                                                                                                      | admin          | Event log                                                                                                                                                 |
| `GET/POST /api/agents`, `POST /api/agents/:id/token`, ...                                                                                              | admin          | Game servers (bridges), inventory scan                                                                                                                    |
| `GET /api/stats/players?mode=dm\|tdm\|mh&bots=1&season=N\|lifetime`, `GET /api/stats/players/:key`, `GET /api/stats/records`, `GET /api/stats/ratings` | user           | Statistics page: player table, player page (`u:<user id>` or `b:<bot name>`), records and Monster Hunt map records (seasons only), ratings (seasons only) |
| `GET /api/seasons`; `POST /api/seasons`, `PATCH /api/seasons/:n`, `POST /api/seasons/:n/end`, `DELETE /api/seasons/:n`                                 | user; admin    | Seasons: overview (in or out of season); plan or start, change days, end now, delete the newest                                                           |
| `GET /api/settings`, `PUT /api/settings/rating`                                                                                                        | admin          | Rating settings (defaults for new seasons, applied to the running and planned season)                                                                     |
| `GET /api/users`, `PATCH /api/users/:id`                                                                                                               | admin          | Users, admin rights                                                                                                                                       |
| `WS /api/agent`                                                                                                                                        | bridges        | Agent protocol (see docs/protocol.md)                                                                                                                     |

State-changing requests need the header `x-tourney: 1`.
