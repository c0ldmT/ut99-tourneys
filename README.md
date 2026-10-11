# Tourney

Tournament platform for **Unreal Tournament 99 (patch 469f)**: a website to create and run 8/16/32-player
single or double elimination tournaments, a bridge agent that runs the game server, and a UT mod that plays
the matches in-game, with ready checks, map votes and a live bracket HUD.

The website and bridge are game-agnostic; UT99 Deathmatch is the first game adapter.

```
Angular SPA ──HTTP/WS──> API (NestJS, SQLite)  <──WSS──  Bridge agent (Node)  ──TCP──  UT99 mod
```

## Repository layout

| Path                    | What                                                                        | Status  |
| ----------------------- | --------------------------------------------------------------------------- | ------- |
| `packages/bracket`      | Deterministic SE/DE bracket engine, seeding, scheduler                      | done    |
| `packages/protocol`     | Schemas: event log, website↔bridge, bridge↔mod lines; tournament projection | done    |
| `packages/adapter-ut99` | UT99 rules, map vote, bot simulation, server launch config                  | done    |
| `apps/bridge`           | Agent: game server process, match flow, mod TCP server, inventory scan      | next    |
| `mods/ut99-tournament`  | UnrealScript game type, HUD, vote/ready UI, TcpLink client                  | next    |
| `apps/api`              | NestJS backend, Discord OAuth, event store, agent gateway                   | planned |
| `apps/web`              | Angular frontend                                                            | planned |

## Development

Requirements: Node ≥ 22.12, pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm test        # all unit tests
pnpm verify      # format check, lint, typecheck, test, build (what CI runs)
```

Workspace packages resolve to their TypeScript sources during tests (custom export condition
`@tourney/source`), so no build is needed before testing.

## Docs

- [Architecture](docs/architecture.md)
- [Protocol](docs/protocol.md)
- [Decisions](docs/decisions.md)
