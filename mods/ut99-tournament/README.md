# UT99 Tournament Mod (`UTTourney_v1`)

UnrealScript package for UT99 469f. Planned classes:

| Class | Role |
|---|---|
| `TournamentDM` | Game type (extends `Botpack.DeathMatchPlus`): token login, roles, ready check, countdown, bots |
| `TournamentConfig` | Ini config: bridge host/port, shared key |
| `BridgeLink` | `TcpLink` client, flat JSON line parser/writer, reconnect |
| `TournamentRI` | Replicated bracket, standings and phase for clients |
| `TournamentHUD` | HUD mutator: bracket and standings overlay |
| `VoteWindow` / `ReadyWindow` | UWindow dialogs for map vote and ready |

Protocol: see [`docs/protocol.md`](../../docs/protocol.md).

Build scripts (`build.sh` / `build.ps1`) copy `Classes/` into a UT installation and run `ucc make`.
The package name carries a version suffix; bump it for every network-incompatible release.
