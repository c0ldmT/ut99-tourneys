//=============================================================================
// TourneyCore
// The tournament logic of the mod, driven by the bridge (see docs/protocol.md).
// One per level, spawned by the game type (TournamentDM, TournamentTDM, and
// TournamentMH in the Monster Hunt package), which forwards the engine events
// it gets (login, logout, timer, end of game) and keeps the Super calls.
//
// The mod keeps no tournament logic of its own. It
//   - admits only players with a token from the access list (?tk=...),
//   - lets the match players play and makes everybody else a spectator,
//   - holds the match players until they are ready, runs the countdown,
//   - spawns the bots the bridge names, reports scores and the end of the game,
//   - 1v1: pauses when a match player drops and restores the score on return
//     (team games go on; the bridge sends a stand-in bot),
//   - performs the map change the bridge asks for.
// Server only: clients never see this actor.
//=============================================================================
class TourneyCore extends Info;

const MOD_VERSION = "0.5.2";
const MAXBOTS = 10;
const MAXSAVED = 16;
const PROTOCOL_VERSION = 1;
const MAXACL = 64;
const MAXTRACK = 64;

var DeathMatchPlus Game;          // the game this core drives (TournamentDM, TournamentTDM, TournamentMH)
var BridgeLink Link;
var TourneyMsg OutMsg;
var TourneyMutator TMut;
var TourneyChatListener ChatListener;
var TourneyGRI TGRI;
var float NextConnectTime;
var bool bJoinsSent;
var bool bInSync;

// State received from the bridge.
var string Phase;
var int PhaseSec;
var string MatchId;
var int GameNo, BestOf, WinsA, WinsB;
var string NameA, NameB;
var int MatchFragLimit, MatchTimeLimit;
var int TeamSize;                  // players per side: 1 = one on one, else team deathmatch
var int MatchFF;                   // team games: friendly fire in percent
// Bots of the match: 1v1 the bot side, team games the bots of both teams (also stand-ins).
var string BotName[10];
var int BotSkill[10];
var string BotCls[10];
var byte BotSide[10];              // 0 = side a, 1 = side b
var Bot BotPawn[10];
var int BotCount;
// The list before the last "match" line: its bots are taken over by the new list.
var string OldBotName[10];
var Bot OldBotPawn[10];
var byte OldBotSide[10];
var int OldBotCount;
var bool bTeamReadyA, bTeamReadyB; // team games: the bridge declared the side ready
var string AclTok[64], AclName[64], AclRole[64];
var int AclCount;
var string VoteMap[32];
var int VoteCount;
var int VoteSecLeft;
var string TrackVote[64]; // what each player voted, shown in the vote panel
var string BracketText[64];
var int BracketCount;
var string StandingText[32];
var int StandCount;

// Players on this level.
var PlayerPawn TrackPawn[64];
var string TrackTok[64];
var string TrackRole[64];
var byte TrackReady[64]; // 0/1 - UE1 has no bool arrays
var float TrackPanelUntil[64]; // a panel (standings) owns the middle of the screen until then
var TourneyClient TrackClient[64]; // HUD, vote window and follow for this player
var float TrackVoteAt[64];         // last vote (rate limit)
var string VoteKey;                // match and game of the current vote (a resync repeats vopen)
var int TrackCount;

// Match runtime.
var bool bBotsSpawned;
var bool bGameLive;
var bool bEndReported;
var int CountdownLeft;
var int LastSentA, LastSentB, ScoreTicks;
var bool bTourneyPaused;
var string SavedKey[16];           // 1v1: the side (a/b), team games: the player's token
var float SavedScore[16], SavedDeaths[16];
var string PendingAddr;
var string PendingEnd;
var bool bTokenFromAddress;
var float ReleaseAt; // see ReleaseScoreboards

//=============================================================================
// Startup (from the game type)
//=============================================================================

// Called by the game's InitGame: tournament defaults, then the cached match (map changes).
// Subclasses must not use Game before this (it is set right after the core is spawned).
function OnInitGame()
{
	// Scoreboard and server browser show the game type with the mod version (GameInfo copies it
	// into the GameReplicationInfo in PostBeginPlay).
	Game.GameName = Game.default.GameName @ "v" $ MOD_VERSION;
	Game.MinPlayers = 0;
	Game.MaxPlayers = Max(Game.MaxPlayers, 4);
	Game.RemainingBots = 0;
	Game.bMuteSpectators = false; // spectators must be able to type !vote and !standings
	// Hold everybody in the waiting state until the bridge starts the countdown.
	Game.bNetReady = false;
	Game.bRequireReady = true;
	Game.CountDown = 9999;
	LoadCache();
	ApplyMatchRules();
}

// Called by the game's PostBeginPlay.
function OnPostBeginPlay()
{
	if (OutMsg != None)
		return;
	OutMsg = Spawn(class'TourneyMsg');
	TGRI = Spawn(class'TourneyGRI');
	TGRI.MapName = CurrentMapName();
	TGRI.ModVersion = "UTTourney v" $ MOD_VERSION;
	TMut = Spawn(class'TourneyMutator');
	TMut.Game = self;
	Game.BaseMutator.AddMutator(TMut);
	Game.RegisterMessageMutator(TMut);
	// Chat commands come from the listener (it also hears spectators); the mutator only handles "mutate".
	ChatListener = Spawn(class'TourneyChatListener');
	if (ChatListener != None)
	{
		ChatListener.Game = self;
		if (ChatListener.PlayerReplicationInfo != None)
		{
			ChatListener.PlayerReplicationInfo.PlayerName = "Tournament";
			ChatListener.PlayerReplicationInfo.bIsSpectator = true;
		}
	}
	else
		Log("could not spawn chat listener, chat commands only work via mutate", 'UTTourney');
	ApplyMatchRules();
	ConnectBridge();
}

function string CurrentMapName()
{
	local string S;
	S = string(Level);
	return Left(S, InStr(S, "."));
}

//=============================================================================
// Bridge connection
//=============================================================================

function ConnectBridge()
{
	if (Link != None)
		return;
	Link = Spawn(class'BridgeLink');
	Link.Init(self);
	NextConnectTime = Level.TimeSeconds + 3.0;
}

function OnBridgeOpened()
{
	bJoinsSent = false;
	OutMsg.Begin("hello");
	OutMsg.AddStr("key", class'TournamentConfig'.default.SharedKey);
	OutMsg.AddInt("pv", PROTOCOL_VERSION);
	OutMsg.AddStr("mv", MOD_VERSION);
	OutMsg.AddInt("eng", int(Level.EngineVersion));
	OutMsg.AddStr("lvl", OutMsg.FitWire(CurrentMapName(), 64));
	// gm: a game was started on this level (running or just ended); the bridge keeps its state.
	OutMsg.AddBool("gm", bGameLive);
	Send();
	if (PendingEnd != "")
		Link.SendLine(PendingEnd); // result reported while the bridge was unreachable
}

function Send()
{
	if (Link != None)
		Link.SendLine(OutMsg.Finish());
}

function BridgeTick()
{
	if (Link == None && Level.TimeSeconds >= NextConnectTime)
		ConnectBridge();
}

function HandleBridgeMessage(TourneyMsg M)
{
	local string T;
	local int i;

	T = M.Get("t");
	switch (T)
	{
		case "welcome":
			break;
		case "title":
			TGRI.TName = M.Get("name");
			break;
		case "sync":
			bInSync = M.Get("st") == "begin";
			if (bInSync)
			{
				// The snapshot repeats "tready" for teams that are still ready.
				bTeamReadyA = false;
				bTeamReadyB = false;
			}
			else
			{
				SaveCache();
				if (!bJoinsSent)
					SendAllJoins();
				PruneBots();
				ApplyPhase();
			}
			break;
		case "phase":
			Phase = M.Get("p");
			PhaseSec = M.GetInt("sec");
			if (Phase == "vote")
				VoteSecLeft = PhaseSec;
			TGRI.Phase = Phase;
			TGRI.PhaseSec = PhaseSec;
			if (!bInSync)
				ApplyPhase();
			break;
		case "match":
			if (M.Get("mid") != MatchId || M.GetInt("g") != GameNo)
			{
				PendingEnd = "";
				bTeamReadyA = false;
				bTeamReadyB = false;
			}
			MatchId = M.Get("mid");
			GameNo = M.GetInt("g");
			BestOf = M.GetInt("bo");
			WinsA = M.GetInt("wa");
			WinsB = M.GetInt("wb");
			NameA = M.Get("na");
			NameB = M.Get("nb");
			MatchFragLimit = M.GetInt("fl");
			MatchTimeLimit = M.GetInt("tl");
			TeamSize = Max(1, M.GetInt("ts"));
			MatchFF = M.GetInt("ff");
			// The bot lines follow; bots already in the level are taken over (see AddBotSpec).
			KeepOldBots();
			BotCount = 0;
			TGRI.TeamSize = TeamSize;
			TGRI.MatchId = MatchId;
			TGRI.GameNo = GameNo;
			TGRI.BestOf = BestOf;
			TGRI.WinsA = WinsA;
			TGRI.WinsB = WinsB;
			TGRI.NameA = NameA;
			TGRI.NameB = NameB;
			TGRI.bBotA = false;
			TGRI.bBotB = false;
			if (!bGameLive)
				ApplyMatchRules();
			break;
		case "bot":
			AddBotSpec(SideIndex(M.Get("s")), M.Get("name"), M.GetInt("sk"), M.Get("cls"));
			if (TeamSize <= 1)
			{
				TGRI.bBotA = SideHasBot(0);
				TGRI.bBotB = SideHasBot(1);
			}
			break;
		case "botadd":
			// Team games: a stand-in joins the running game right away.
			AddBotSpec(SideIndex(M.Get("s")), M.Get("name"), M.GetInt("sk"), M.Get("cls"));
			if (bBotsSpawned)
				SpawnBots();
			break;
		case "botdel":
			RemoveBot(M.Get("name"));
			break;
		case "tready":
			if (M.Get("s") == "a")
				bTeamReadyA = true;
			else
				bTeamReadyB = true;
			break;
		case "acl":
			AclCount = 0;
			break;
		case "acle":
		case "acladd":
			// Saved at sync end or before travel; no ini write per entry.
			SetAcl(M.Get("tk"), M.Get("name"), M.Get("r"));
			break;
		case "acldel":
			i = FindAcl(M.Get("tk"));
			if (i >= 0)
			{
				AclCount--;
				AclTok[i] = AclTok[AclCount];
				AclName[i] = AclName[AclCount];
				AclRole[i] = AclRole[AclCount];
			}
			break;
		case "vopen":
			VoteCount = 0;
			VoteSecLeft = M.GetInt("sec");
			TGRI.VoteCount = 0;
			// "$" binds weaker than "==" and "&&" in UnrealScript: parenthesize.
			if (Phase == "vote" && (M.Get("mid") $ "/" $ GameNo) == VoteKey)
				break; // same vote again (bridge resync): keep votes and the window state
			VoteKey = M.Get("mid") $ "/" $ GameNo;
			for (i = 0; i < 64; i++)
				TrackVote[i] = "";
			for (i = 0; i < TrackCount; i++)
				if (TrackClient[i] != None)
				{
					TrackClient[i].MyVote = "";
					TrackClient[i].bVoteOpened = false;
				}
			break;
		case "vmap":
			i = M.GetInt("i") - 1;
			if (i >= 0 && i < 32)
			{
				VoteMap[i] = M.Get("map");
				VoteCount = Max(VoteCount, i + 1);
				if (i < 16)
				{
					TGRI.VoteMaps[i] = VoteMap[i];
					TGRI.VoteCount = Min(16, VoteCount);
				}
			}
			break;
		case "vclose":
			ClearAllProgress();
			for (i = 0; i < TrackCount; i++)
				if (TrackClient[i] != None && TrackClient[i].bHasHud)
					TrackClient[i].ClientCloseVote();
			Game.BroadcastMessage("Next map:" @ M.Get("map"), true, 'CriticalEvent');
			break;
		case "travel":
			DoTravel(M.Get("map"), M.Get("opt"));
			break;
		case "cd":
			CountdownLeft = Max(1, M.GetInt("sec"));
			Phase = "countdown";
			// Team games: the bots of this game came with the countdown.
			bBotsSpawned = true;
			SpawnBots();
			PruneBots();
			AutoFollowAll();
			break;
		case "pause":
			SetTourneyPause(M.GetBool("on"), M.Get("why"));
			break;
		case "abort":
			AbortGame(M.Get("w"), M.Get("why"));
			break;
		case "brh":
			BracketCount = 0;
			TGRI.LineCount = 0;
			TGRI.Fmt = M.Get("fmt");
			TGRI.BracketRev++;
			break;
		case "brm":
			AddBracketLine(M);
			break;
		case "sth":
			StandCount = 0;
			TGRI.StandCount = 0;
			TGRI.StandRev++;
			break;
		case "ste":
			AddStandingLine(M);
			break;
		case "say":
			SayTo(M.GetInt("pid"), M.Get("msg"));
			break;
		case "warn":
			WarnPlayer(M.GetInt("pid"), M.Get("msg"));
			break;
		default:
			Log("unknown bridge message" @ T, 'UTTourney');
	}
}

function ApplyPhase()
{
	if (Phase == "vote")
	{
		ReleaseScoreboards();
		ShowVote();
	}
	else if (Phase == "ready")
		SpawnBotsOnce();
	else if (Phase == "finished")
	{
		ReleaseScoreboards();
		ShowFinalStandings(true);
	}
}

//=============================================================================
// Access list and players
//=============================================================================

function int FindAcl(string Tok)
{
	local int i;
	if (Tok == "")
		return -1;
	for (i = 0; i < AclCount; i++)
		if (AclTok[i] == Tok)
			return i;
	return -1;
}

function SetAcl(string Tok, string PName, string SRole)
{
	local int i;
	i = FindAcl(Tok);
	if (i < 0)
	{
		if (AclCount >= MAXACL)
			return;
		i = AclCount++;
	}
	AclTok[i] = Tok;
	AclName[i] = PName;
	AclRole[i] = SRole;
}

// SRole in the *next/current* match according to the access list. Differs from TrackRole
// (the role the player logged in with) while the next match is being voted on.
function bool IsMatchPlayerToken(string Tok)
{
	local int i;
	i = FindAcl(Tok);
	return i >= 0 && (AclRole[i] == "a" || AclRole[i] == "b");
}

function string StripPort(string Addr)
{
	local int P;
	P = InStr(Addr, ":");
	if (P >= 0)
		return Left(Addr, P);
	return Addr;
}

function string TokenForAddress(string Addr)
{
	local int i;
	Addr = StripPort(Addr);
	if (Addr == "")
		return "";
	for (i = 0; i < 64; i++)
		if (class'TournamentConfig'.default.KnownAddr[i] == Addr)
			return class'TournamentConfig'.default.KnownAddrTok[i];
	return "";
}

function RememberAddress(string Addr, string Tok)
{
	local int i, Free;
	Addr = StripPort(Addr);
	if (Addr == "" || Tok == "")
		return;
	Free = -1;
	for (i = 0; i < 64; i++)
	{
		if (class'TournamentConfig'.default.KnownAddr[i] == Addr)
		{
			Free = i;
			break;
		}
		if (Free < 0 && class'TournamentConfig'.default.KnownAddr[i] == "")
			Free = i;
	}
	if (Free < 0)
		Free = Rand(64);
	class'TournamentConfig'.default.KnownAddr[Free] = Addr;
	class'TournamentConfig'.default.KnownAddrTok[Free] = Tok;
	class'TournamentConfig'.static.StaticSaveConfig();
}

// Number of players on a side (not counting spectators).
function int SideCount(string SRole)
{
	local int t, n;
	for (t = 0; t < TrackCount; t++)
		if (TrackRole[t] == SRole && TrackPawn[t] != None && !TrackPawn[t].IsA('Spectator'))
			n++;
	return n;
}

// Players of a side who pressed FIRE / typed !ready.
function int SideReadyCount(string SRole)
{
	local int t, n;
	for (t = 0; t < TrackCount; t++)
		if (TrackRole[t] == SRole && TrackPawn[t] != None && !TrackPawn[t].IsA('Spectator') && TrackReady[t] != 0)
			n++;
	return n;
}

function bool SideTaken(string SRole)
{
	return SideCount(SRole) >= Max(1, TeamSize);
}

function int SideIndex(string SRole)
{
	if (SRole == "b")
		return 1;
	return 0;
}

function string SideRole(int Side)
{
	if (Side == 1)
		return "b";
	return "a";
}

// Called by the game's PreLogin (after the engine's checks passed).
function CheckPreLogin(string Options, string Address, out string Error, out string FailCode)
{
	local string Tok;
	Tok = Game.ParseOption(Options, "tk");
	if (Tok == "")
		Tok = TokenForAddress(Address);
	if (FindAcl(Tok) < 0)
	{
		Error = "This server runs a tournament. Join with your personal link from the tournament website.";
		FailCode = "NOTOKEN";
		ReportReject(Game.ParseOption(Options, "Name"), "no token");
		return;
	}
	// Login() has no address; remember it for the token fallback (Login follows PreLogin).
	PendingAddr = Address;
}

// Login, part 1 (before the game's Super.Login): token, role, player or spectator class.
function bool BeginLogin(string Options, out string Error, out class<PlayerPawn> SpawnClass, out string Tok, out string SRole)
{
	local int i;

	Tok = Game.ParseOption(Options, "tk");
	bTokenFromAddress = false;
	if (Tok == "")
	{
		Tok = TokenForAddress(PendingAddr);
		bTokenFromAddress = Tok != "";
	}
	PendingAddr = "";
	i = FindAcl(Tok);
	if (i < 0)
	{
		Error = "No valid tournament token.";
		return false;
	}
	SRole = AclRole[i];
	if ((SRole != "a" && SRole != "b") || SideTaken(SRole))
	{
		SRole = "s";
		SpawnClass = class'Botpack.CHSpectator';
	}
	return true;
}

// Team of a role (team games put the player into it during Super.Login).
function byte TeamOfRole(string SRole)
{
	if (SRole == "a")
		return 0;
	if (SRole == "b")
		return 1;
	return 255;
}

// Login, part 2 (after the game's Super.Login): name from the access list, tracking.
function PlayerPawn EndLogin(PlayerPawn P, string Tok, string SRole)
{
	local int i;

	if (P == None)
		return None;
	i = FindAcl(Tok);
	if (P.IsA('Spectator'))
		SRole = "s"; // joined with the spectate option
	if (i >= 0)
		Game.ChangeName(P, AclName[i], false);
	AnnounceTeam(P);
	Track(P, Tok, SRole);
	return P;
}

// Team games: "X is on the red team", after the player got the name from the access list.
function AnnounceTeam(Pawn P)
{
}

// Called by the game's PostLogin (after Super.PostLogin).
function OnPostLogin(PlayerPawn NewPlayer)
{
	local int t;

	t = FindTrack(NewPlayer);
	if (t < 0)
		return;
	RememberAddress(NewPlayer.GetPlayerNetworkAddress(), TrackTok[t]);
	if (TrackRole[t] == "a" || TrackRole[t] == "b")
	{
		if (!bGameLive)
			HoldPlayer(NewPlayer);
		else
			RestoreScore(NewPlayer, ScoreKey(t));
	}
	if (bTokenFromAddress && TokenForAddress(NewPlayer.GetPlayerNetworkAddress()) != TrackTok[t])
		Log("token fallback mismatch for" @ NewPlayer.PlayerReplicationInfo.PlayerName, 'UTTourney');
	bTokenFromAddress = false;
	SendJoin(t);
	if (Phase == "vote" && IsMatchPlayerToken(TrackTok[t]))
		ShowVoteTo(NewPlayer);
	else if (Phase == "finished")
		ShowStandings(NewPlayer);
}

function SendLost(string SRole)
{
	OutMsg.Begin("lost");
	OutMsg.AddStr("mid", MatchId);
	OutMsg.AddStr("s", SRole);
	Send();
}

function HoldPlayer(PlayerPawn P)
{
	// Server-side only: UE1 sends the state name to the owning client with every movement
	// correction (ClientAdjustPosition), so the client follows on its own.
	P.PlayerRestartState = 'PlayerWaiting';
	P.GotoState('PlayerWaiting');
}

// Called by the game's Logout (before Super.Logout).
function OnLogout(Pawn Exiting)
{
	local int t;
	local string SRole;

	t = FindTrack(PlayerPawn(Exiting));
	if (t >= 0)
	{
		SRole = TrackRole[t];
		if (bGameLive && !Game.bGameEnded && (SRole == "a" || SRole == "b") && TeamSize > 1)
		{
			// Team games go on; the bridge sends a stand-in bot after a while.
			SaveScore(Exiting, TrackTok[t]);
		}
		else if (bGameLive && !Game.bGameEnded && (SRole == "a" || SRole == "b"))
		{
			SaveScore(Exiting, SRole);
			Untrack(t);
			t = -1;
			SetTourneyPause(true, Exiting.PlayerReplicationInfo.PlayerName @ "disconnected");
			SendLost(SRole);
		}
		else if (!bGameLive && Phase == "countdown" && (SRole == "a" || SRole == "b"))
		{
			// A match player left during the countdown: back to the ready check.
			CountdownLeft = 0;
			Phase = "ready";
		}
		OutMsg.Begin("leave");
		OutMsg.AddInt("pid", Exiting.PlayerReplicationInfo.PlayerID);
		Send();
		if (t >= 0)
			Untrack(t);
	}
}

function Track(PlayerPawn P, string Tok, string SRole)
{
	if (TrackCount >= MAXTRACK)
		return;
	TrackPawn[TrackCount] = P;
	TrackTok[TrackCount] = Tok;
	TrackRole[TrackCount] = SRole;
	TrackReady[TrackCount] = 0;
	TrackVote[TrackCount] = "";
	TrackPanelUntil[TrackCount] = 0;
	TrackVoteAt[TrackCount] = -10;
	TrackClient[TrackCount] = Spawn(class'TourneyClient', P);
	if (TrackClient[TrackCount] != None)
	{
		TrackClient[TrackCount].Game = self;
		TrackClient[TrackCount].MyRole = SRole;
	}
	TrackCount++;
}

function Untrack(int t)
{
	TrackCount--;
	TrackPawn[t] = TrackPawn[TrackCount];
	TrackTok[t] = TrackTok[TrackCount];
	TrackRole[t] = TrackRole[TrackCount];
	TrackReady[t] = TrackReady[TrackCount];
	TrackVote[t] = TrackVote[TrackCount];
	TrackPanelUntil[t] = TrackPanelUntil[TrackCount];
	TrackVoteAt[t] = TrackVoteAt[TrackCount];
	if (TrackClient[t] != None)
		TrackClient[t].Destroy();
	TrackClient[t] = TrackClient[TrackCount];
	TrackClient[TrackCount] = None;
	TrackPawn[TrackCount] = None;
}

function int FindTrack(PlayerPawn P)
{
	local int t;
	if (P == None)
		return -1;
	for (t = 0; t < TrackCount; t++)
		if (TrackPawn[t] == P)
			return t;
	return -1;
}

function SendJoin(int t)
{
	OutMsg.Begin("join");
	OutMsg.AddInt("pid", TrackPawn[t].PlayerReplicationInfo.PlayerID);
	OutMsg.AddStr("tk", TrackTok[t]);
	OutMsg.AddStr("name", OutMsg.FitWire(TrackPawn[t].PlayerReplicationInfo.PlayerName, 32));
	OutMsg.AddStr("role", TrackRole[t]);
	Send();
}

function SendAllJoins()
{
	local int t;
	bJoinsSent = true;
	for (t = 0; t < TrackCount; t++)
		if (TrackPawn[t] != None)
		{
			SendJoin(t);
			TrackReady[t] = 0; // re-sent by PreMatchTick if still ready
		}
}

function ReportReject(string PName, string Why)
{
	OutMsg.Begin("reject");
	OutMsg.AddStr("name", OutMsg.FitWire(PName, 32));
	OutMsg.AddStr("why", Why);
	Send();
}

function PlayerPawn SidePlayer(string SRole)
{
	local int t;
	for (t = 0; t < TrackCount; t++)
		if (TrackRole[t] == SRole && TrackPawn[t] != None && !TrackPawn[t].IsA('Spectator'))
			return TrackPawn[t];
	return None;
}

// Key under which a player's score is kept while they are away.
function string ScoreKey(int t)
{
	if (TeamSize > 1)
		return TrackTok[t];
	return TrackRole[t];
}

// A pawn playing for a side: its (first) player, else its first bot.
function Pawn SidePawn(int Side)
{
	local Pawn P;
	local int i;
	P = SidePlayer(SideRole(Side));
	if (P != None)
		return P;
	for (i = 0; i < BotCount; i++)
		if (BotSide[i] == Side && BotPawn[i] != None && !BotPawn[i].bDeleteMe)
			return BotPawn[i];
	// Between a "match" line and its "bot" lines the old list still knows the bots.
	for (i = 0; i < OldBotCount; i++)
		if (OldBotSide[i] == Side && OldBotPawn[i] != None && !OldBotPawn[i].bDeleteMe)
			return OldBotPawn[i];
	return None;
}

function bool SideHasBot(int Side)
{
	local int i;
	for (i = 0; i < BotCount; i++)
		if (BotSide[i] == Side)
			return true;
	return false;
}

// Team games: puts a pawn into the team of a side (TourneyCoreTDM). Nothing to do in 1v1.
function AssignTeam(Pawn P, int Side)
{
}

//=============================================================================
// Match flow
//=============================================================================

function ApplyMatchRules()
{
	Game.FragLimit = MatchFragLimit;
	Game.TimeLimit = MatchTimeLimit;
	if (!bGameLive)
		Game.RemainingTime = 60 * Game.TimeLimit;
	if (TournamentGameReplicationInfo(Game.GameReplicationInfo) != None)
	{
		TournamentGameReplicationInfo(Game.GameReplicationInfo).FragLimit = Game.FragLimit;
		TournamentGameReplicationInfo(Game.GameReplicationInfo).TimeLimit = Game.TimeLimit;
	}
	if (Game.GameReplicationInfo != None)
		Game.GameReplicationInfo.RemainingTime = Game.RemainingTime;
}

// 1v1: the bot side waits from the ready check on (team games get their bots with the countdown).
function SpawnBotsOnce()
{
	if (MatchId == "")
		return;
	bBotsSpawned = true;
	SpawnBots();
}

// UT cuts player names to 24 characters (DeathMatchPlus.ChangeName).
function bool SameBotName(string A, string B)
{
	return Left(A, 24) ~= Left(B, 24);
}

// Remembers the current list before a "match" line replaces it.
function KeepOldBots()
{
	local int i;
	for (i = 0; i < BotCount; i++)
	{
		OldBotName[i] = BotName[i];
		OldBotPawn[i] = BotPawn[i];
		OldBotSide[i] = BotSide[i];
	}
	OldBotCount = BotCount;
}

// Adds a bot to the list (or updates it). A bot of the previous list, or of that name in the
// level, is taken over instead of spawning a second one.
function AddBotSpec(int Side, string BName, int BSkill, string BClass)
{
	local int i, j;
	if (BName == "")
		return;
	for (i = 0; i < BotCount; i++)
		if (SameBotName(BotName[i], BName))
			break;
	if (i == BotCount)
	{
		if (BotCount >= MAXBOTS)
			return;
		BotCount++;
		BotPawn[i] = None;
		for (j = 0; j < OldBotCount; j++)
			if (SameBotName(OldBotName[j], BName) && OldBotPawn[j] != None && !OldBotPawn[j].bDeleteMe)
			{
				BotPawn[i] = OldBotPawn[j];
				break;
			}
		if (BotPawn[i] == None)
			BotPawn[i] = FindBotPawn(BName);
	}
	BotName[i] = BName;
	BotSkill[i] = BSkill;
	BotCls[i] = BClass;
	BotSide[i] = Side;
}

function Bot FindBotPawn(string BName)
{
	local Pawn P;
	for (P = Level.PawnList; P != None; P = P.NextPawn)
		if (Bot(P) != None && !P.bDeleteMe && P.PlayerReplicationInfo != None && SameBotName(P.PlayerReplicationInfo.PlayerName, BName))
			return Bot(P);
	return None;
}

// Removes bots that are not on the list any more (team games: the fill bots of a countdown that
// was interrupted). Not after the end of a game: the scoreboard keeps showing them.
function PruneBots()
{
	local Pawn P, Next;
	local int i;
	local bool bListed;

	if (Game.bGameEnded)
		return;
	for (P = Level.PawnList; P != None; P = Next)
	{
		Next = P.NextPawn;
		if (Bot(P) == None || P.bDeleteMe)
			continue;
		bListed = false;
		for (i = 0; i < BotCount; i++)
			if (BotPawn[i] == P)
				bListed = true;
		if (!bListed)
		{
			Log("removing bot" @ P.PlayerReplicationInfo.PlayerName @ "(not in the match any more)", 'UTTourney');
			P.Destroy();
		}
	}
	OldBotCount = 0;
}

// Team games: a stand-in leaves because the player is back.
function RemoveBot(string BName)
{
	local int i, j;
	local Bot B;
	for (i = 0; i < BotCount; i++)
		if (SameBotName(BotName[i], BName))
			break;
	if (i == BotCount)
		return;
	B = BotPawn[i];
	if (B == None)
		B = FindBotPawn(BName);
	for (j = i; j < BotCount - 1; j++)
	{
		BotName[j] = BotName[j + 1];
		BotSkill[j] = BotSkill[j + 1];
		BotCls[j] = BotCls[j + 1];
		BotSide[j] = BotSide[j + 1];
		BotPawn[j] = BotPawn[j + 1];
	}
	BotCount--;
	BotPawn[BotCount] = None;
	if (B != None)
	{
		Log("removing stand-in bot" @ BName, 'UTTourney');
		B.Destroy();
	}
}

// Spawns every listed bot that is not in the level (yet or any more). While the game runs a new
// bot joins right away: a stand-in, or a bot that vanished (destroyed, kicked, failed spawn).
function SpawnBots()
{
	local int i;
	for (i = 0; i < BotCount; i++)
	{
		if (BotPawn[i] != None && !BotPawn[i].bDeleteMe)
			continue;
		BotPawn[i] = FindBotPawn(BotName[i]);
		if (BotPawn[i] != None || Game.bGameEnded)
			continue;
		BotPawn[i] = SpawnSideBot(BotName[i], BotSkill[i], BotCls[i], BotSide[i]);
		if (BotPawn[i] != None && bGameLive && !bTourneyPaused)
			RespawnMatchPawn(BotPawn[i]);
	}
}

// Bots are held (hidden, in Dying) before the countdown, during a pause and after the end.
// Nobody may bring them back early: SmartStockBots' FastRespawn, for example, respawns every
// bot that has been "dead" for a moment. Our own respawns happen while the game is live.
// The game's RestartPlayer asks this first.
function bool MayRestart(Pawn aPlayer)
{
	return !(Bot(aPlayer) != None && (!bGameLive || bTourneyPaused || Game.bGameEnded));
}


// Spawns listed bots again if they vanished.
function EnsureBots()
{
	if (!bBotsSpawned || Game.bGameEnded)
		return;
	SpawnBots();
}

function int FindBotIndex(string BName)
{
	local int i;
	for (i = 0; i < 32; i++)
		if (Game.BotConfig.GetBotName(i) ~= BName)
			return i;
	return -1;
}

// Spawns a specific configured bot (name, skill 0..7, optional class) for a side, waiting for
// the start.
function Bot SpawnSideBot(string BName, int BSkill, string BClass, int Side)
{
	local NavigationPoint StartSpot;
	local class<Bot> BC;
	local Bot B;
	local int N;

	N = FindBotIndex(BName);
	if (BClass != "")
		BC = class<Bot>(DynamicLoadObject(BClass, class'Class'));
	if (BC == None && N >= 0)
		BC = Game.BotConfig.CHGetBotClass(N);
	if (BC == None)
		BC = class'Botpack.TMale1Bot';

	StartSpot = Game.FindPlayerStart(None, 255);
	if (StartSpot == None)
	{
		Log("no start spot for bot" @ BName, 'UTTourney');
		return None;
	}
	B = Spawn(BC, , , StartSpot.Location, StartSpot.Rotation);
	if (B == None)
	{
		Log("could not spawn bot" @ BName, 'UTTourney');
		return None;
	}
	B.PlayerReplicationInfo.PlayerID = Game.CurrentID++;
	if (N >= 0)
		Game.BotConfig.CHIndividualize(B, N, Game.NumBots);
	Game.ChangeName(B, BName, false);
	// UT bot skill is 0..3 (plus a global novice flag); the tournament uses 0..7.
	B.InitializeSkill(FClamp(BSkill * 3.0 / 7.0, 0.0, 3.0));
	B.ViewRotation = StartSpot.Rotation;
	Game.BroadcastMessage(B.PlayerReplicationInfo.PlayerName $ Game.EnteredMessage, false);
	Game.ModifyBehaviour(B);
	Game.AddDefaultInventory(B);
	Game.NumBots++;
	AssignTeam(B, Side);
	B.GotoState('Dying', 'WaitingForStart');
	Log("spawned bot" @ BName @ "class" @ BC @ "skill" @ BSkill @ "config index" @ N, 'UTTourney');
	return B;
}

// Once a second from the game's Timer. Returns what the game clock does: 0 = stands still
// (before the start, paused: the game calls Super(GameInfo).Timer()), 1 = runs (the game calls
// its Super.Timer(), then LiveTick()).
function int TimerStep()
{
	BridgeTick();
	if (Phase == "ready" && PhaseSec > 0)
		PhaseSec--;
	UpdateGRI();
	if (Phase == "vote")
	{
		VoteTick();
		if (VoteSecLeft > 0)
			VoteSecLeft--;
	}
	if (Phase == "finished")
	{
		if (PhaseSec > 0)
			PhaseSec--;
		ShowFinalStandings(false);
	}
	if (Phase == "ready" || bGameLive)
		EnsureBots();
	if (!bGameLive)
	{
		PreMatchTick();
		return 0;
	}
	if (bTourneyPaused)
		return 0;
	return 1;
}

// Copies the per-second state into the replicated TourneyGRI (HUD of the clients).
function UpdateGRI()
{
	local int t;

	if (TGRI == None)
		return;
	TGRI.Phase = Phase;
	if (Phase == "vote")
		TGRI.PhaseSec = VoteSecLeft;
	else if (Phase == "countdown")
		TGRI.PhaseSec = CountdownLeft;
	else if (Phase == "ready" || Phase == "finished")
		TGRI.PhaseSec = PhaseSec;
	else
		TGRI.PhaseSec = -1;
	TGRI.ScoreA = SideScore(0);
	TGRI.ScoreB = SideScore(1);
	TGRI.TeamSize = Max(1, TeamSize);
	if (TeamSize > 1)
	{
		// Team games: how many are here and ready; the bridge decides when a team is ready.
		TGRI.ReadyA = SideReadyCount("a");
		TGRI.ReadyB = SideReadyCount("b");
		TGRI.PresentA = SideCount("a");
		TGRI.PresentB = SideCount("b");
		TGRI.TeamReadyA = 0;
		TGRI.TeamReadyB = 0;
		if (bTeamReadyA)
			TGRI.TeamReadyA = 1;
		if (bTeamReadyB)
			TGRI.TeamReadyB = 1;
	}
	else
	{
		TGRI.ReadyA = ReadyFlag("a", SideHasBot(0));
		TGRI.ReadyB = ReadyFlag("b", SideHasBot(1));
	}
	TGRI.bPaused = bTourneyPaused || Phase == "paused";
	for (t = 0; t < TrackCount; t++)
		if (TrackClient[t] != None)
		{
			TrackClient[t].bVoter = Phase == "vote" && IsMatchPlayerToken(TrackTok[t]);
			TrackClient[t].bReadyMe = TrackReady[t] != 0;
		}
}

function byte ReadyFlag(string SRole, bool bBot)
{
	local int t;
	if (bBot)
		return 1;
	t = FindTrack(SidePlayer(SRole));
	if (t < 0)
		return 0;
	return TrackReady[t];
}

function bool IsVoter(PlayerPawn P)
{
	local int t;
	t = FindTrack(P);
	return Phase == "vote" && t >= 0 && IsMatchPlayerToken(TrackTok[t]);
}

function bool HasHud(int t)
{
	return t >= 0 && TrackClient[t] != None && TrackClient[t].bHasHud;
}

function PreMatchTick()
{
	local int t;
	local PlayerPawn P;

	if (Phase == "ready")
	{
		SpawnBotsOnce();
		for (t = 0; t < TrackCount; t++)
		{
			P = TrackPawn[t];
			if (P == None || (TrackRole[t] != "a" && TrackRole[t] != "b"))
				continue;
			if (P.bReadyToPlay && TrackReady[t] == 0)
			{
				TrackReady[t] = 1;
				OutMsg.Begin("ready");
				OutMsg.AddInt("pid", P.PlayerReplicationInfo.PlayerID);
				Send();
			}
			if (PanelActive(t))
				continue;
			P.ClearProgressMessages();
			P.SetProgressTime(2);
			P.SetProgressMessage(MatchTitle(), 0);
			if (TrackReady[t] != 0 && TeamSize > 1)
				P.SetProgressMessage("You are ready. Waiting for the others...", 1);
			else if (TrackReady[t] != 0)
				P.SetProgressMessage("You are ready. Waiting for your opponent...", 1);
			else
				P.SetProgressMessage("Press FIRE or type !ready when you are ready", 1);
		}
	}
	else if (Phase == "countdown" && CountdownLeft > 0)
	{
		AnnounceCountdown(CountdownLeft);
		CountdownLeft--;
	}
	else if (Phase == "countdown" && CountdownLeft == 0)
	{
		CountdownLeft = -1;
		StartTournamentMatch();
	}
}

function string MatchTitle()
{
	local string S;
	S = MatchId $ ":" @ NameA @ "vs" @ NameB;
	if (BestOf > 1)
		S = S @ "- game" @ GameNo @ "of up to" @ BestOf @ "(" $ WinsA $ ":" $ WinsB $ ")";
	return S;
}

function AnnounceCountdown(int N)
{
	local Pawn P;
	for (P = Level.PawnList; P != None; P = P.NextPawn)
		if (P.IsA('PlayerPawn'))
		{
			PlayerPawn(P).ClearProgressMessages();
			if (N <= 10 && P.IsA('TournamentPlayer'))
				TournamentPlayer(P).TimeMessage(N);
			else
				PlayerPawn(P).SetProgressMessage(MatchTitle() @ "starts in" @ N, 0);
		}
}

function StartTournamentMatch()
{
	Game.bRequireReady = false;
	Game.CountDown = 0;
	Game.bNetReady = false;
	ApplyMatchRules();
	bGameLive = true;
	bEndReported = false;
	LastSentA = -1;
	LastSentB = -1;
	Game.StartMatch();
	AutoFollowAll();
	OutMsg.Begin("live");
	OutMsg.AddStr("mid", MatchId);
	OutMsg.AddInt("g", GameNo);
	Send();
}

function LiveTick()
{
	local int A, B;
	if (Game.bGameEnded)
		return;
	A = SideScore(0);
	B = SideScore(1);
	ScoreTicks++;
	if (A != LastSentA || B != LastSentB || ScoreTicks >= 5)
	{
		ScoreTicks = 0;
		LastSentA = A;
		LastSentB = B;
		OutMsg.Begin("score");
		OutMsg.AddStr("mid", MatchId);
		OutMsg.AddInt("g", GameNo);
		OutMsg.AddInt("sa", A);
		OutMsg.AddInt("sb", B);
		if (Game.TimeLimit > 0)
			OutMsg.AddInt("tl", Game.RemainingTime);
		else
			OutMsg.AddInt("tl", -1);
		OutMsg.AddBool("ot", Game.bOverTime);
		Send();
	}
}

function int SideScore(int Side)
{
	local Pawn P;
	local int i;
	P = SidePawn(Side);
	if (P != None && P.PlayerReplicationInfo != None)
		return int(P.PlayerReplicationInfo.Score);
	i = FindSaved(SideRole(Side));
	if (i >= 0)
		return int(SavedScore[i]);
	return 0;
}

// Called by the game's EndGame (after Super.EndGame).
function OnEndGame(string Reason, bool bWasOvertime)
{
	if (Game.bGameEnded && bGameLive && !bEndReported)
		ReportEnd(Reason, bWasOvertime);
}

function ReportEnd(string Reason, bool bWasOvertime)
{
	local int A, B;
	local string Why;

	bEndReported = true;
	A = SideScore(0);
	B = SideScore(1);
	if (bWasOvertime)
		Why = "sd";
	else if (Reason ~= "timelimit")
		Why = "time";
	else
		Why = "frag";
	OutMsg.Begin("end");
	OutMsg.AddStr("mid", MatchId);
	OutMsg.AddInt("g", GameNo);
	OutMsg.AddInt("sa", A);
	OutMsg.AddInt("sb", B);
	if (A >= B)
		OutMsg.AddStr("w", "a");
	else
		OutMsg.AddStr("w", "b");
	OutMsg.AddStr("why", Why);
	PendingEnd = OutMsg.Finish();
	Send();
}

// The bridge ended the game: forfeit, organizer decision ("admin"), match called off ("void")
// or restart. End it without reporting a result.
function AbortGame(string Winner, string Why)
{
	local Pawn P;

	bEndReported = true;
	bTourneyPaused = false;
	if (!Game.bGameEnded)
	{
		// SetEndCams refuses to end a tied game (it starts overtime), so end it directly.
		Game.bGameEnded = true;
		for (P = Level.PawnList; P != None; P = P.NextPawn)
		{
			P.GotoState('GameEnded');
			if (PlayerPawn(P) != None)
				PlayerPawn(P).ClientGameEnded();
		}
	}
	if (Why == "restart")
		Game.BroadcastMessage("The organizer restarts this game", true);
	else if (Why == "void")
		Game.BroadcastMessage("The organizer called this match off", true);
	else if (Why == "admin" && Winner == "a")
		Game.BroadcastMessage(NameA @ "wins (decided by the organizer)", true);
	else if (Why == "admin")
		Game.BroadcastMessage(NameB @ "wins (decided by the organizer)", true);
	else if (Winner == "a")
		Game.BroadcastMessage(NameA @ "wins by forfeit", true);
	else
		Game.BroadcastMessage(NameB @ "wins by forfeit", true);
}


function DoTravel(string MapName, string Opt)
{
	local string URL;
	SaveCache();
	URL = MapName $ "?game=" $ string(Game.Class) $ Opt;
	Log("travel to" @ URL, 'UTTourney');
	Level.ServerTravel(URL, false);
}

// Soft pause. Level.Pauser is not used on purpose: a paused level stops ticking actors, which
// would also stop the bridge connection. Instead the match pawns are held out of play and the
// game clock (DeathMatchPlus.Timer) is not advanced. On resume both sides respawn.
function SetTourneyPause(bool bOn, string Why)
{
	local int t, i;
	local Pawn P;

	if (bOn == bTourneyPaused)
		return;
	if (!bOn && bGameLive && !Game.bGameEnded && TeamSize <= 1)
	{
		// 1v1: do not resume while a human side is still missing; tell the bridge again.
		if (!SideHasBot(0) && SidePlayer("a") == None)
		{
			SendLost("a");
			return;
		}
		if (!SideHasBot(1) && SidePlayer("b") == None)
		{
			SendLost("b");
			return;
		}
	}
	bTourneyPaused = bOn;
	if (bOn && TGRI != None)
		TGRI.PauseReason = Why;
	if (!bGameLive || Game.bGameEnded)
		return;
	// Everybody playing: the players of both sides and all bots.
	for (t = 0; t < TrackCount; t++)
	{
		P = TrackPawn[t];
		if (P == None || P.IsA('Spectator') || (TrackRole[t] != "a" && TrackRole[t] != "b"))
			continue;
		if (bOn)
			HoldPlayer(PlayerPawn(P));
		else
			RespawnMatchPawn(P);
	}
	for (i = 0; i < BotCount; i++)
	{
		P = BotPawn[i];
		if (P == None || P.bDeleteMe)
			continue;
		if (bOn)
			P.GotoState('Dying', 'WaitingForStart');
		else
			RespawnMatchPawn(P);
	}
	if (bOn)
		Game.BroadcastMessage("Game paused:" @ Why, true);
	else
		Game.BroadcastMessage("Game resumed", true);
}

// Brings a held match pawn back into play like a normal respawn: leave the waiting state
// (restores mesh, collision and the player flag for the HUD), move to a start spot with the
// default inventory, and tell the client to restart.
function RespawnMatchPawn(Pawn P)
{
	local PlayerPawn PP;

	if (P.IsA('Bot'))
	{
		// Held bots wait in Dying (hidden, ignoring damage). RestartPlayer only moves them;
		// the AI runs again once the bot is back in its normal state.
		if (Game.RestartPlayer(P))
		{
			P.bHidden = false;
			P.Velocity = vect(0, 0, 0);
			P.Acceleration = vect(0, 0, 0);
			P.SetPhysics(PHYS_Falling);
			P.GotoState('Roaming');
		}
		else
			Log("could not respawn bot" @ P.PlayerReplicationInfo.PlayerName, 'UTTourney');
		return;
	}
	PP = PlayerPawn(P);
	if (PP == None)
		return;
	PP.PlayerRestartState = PP.Default.PlayerRestartState;
	PP.GotoState(PP.PlayerRestartState);
	if (Game.RestartPlayer(PP))
		PP.ClientReStart();
	else
		Log("could not respawn" @ PP.PlayerReplicationInfo.PlayerName, 'UTTourney');
}

function int FindSaved(string Key)
{
	local int i;
	for (i = 0; i < MAXSAVED; i++)
		if (SavedKey[i] == Key)
			return i;
	return -1;
}

// Keeps the score of a player who dropped (Key: side in 1v1, token in team games).
function SaveScore(Pawn P, string Key)
{
	local int i;
	if (Key == "")
		return;
	i = FindSaved(Key);
	if (i < 0)
		i = FindSaved("");
	if (i < 0)
		i = 0;
	SavedKey[i] = Key;
	SavedScore[i] = P.PlayerReplicationInfo.Score;
	SavedDeaths[i] = P.PlayerReplicationInfo.Deaths;
}

function RestoreScore(PlayerPawn P, string Key)
{
	local int i;
	if (Key == "")
		return;
	i = FindSaved(Key);
	if (i < 0)
		return;
	P.PlayerReplicationInfo.Score = SavedScore[i];
	P.PlayerReplicationInfo.Deaths = SavedDeaths[i];
	SavedKey[i] = "";
	// Still paused: wait in the hold until the bridge resumes the game.
	if (bTourneyPaused)
		HoldPlayer(P);
}

//=============================================================================
// Map vote, commands, messages
//=============================================================================

function ShowVote()
{
	local int t;
	for (t = 0; t < TrackCount; t++)
		if (TrackPawn[t] != None && IsMatchPlayerToken(TrackTok[t]))
		{
			ShowVoteTo(TrackPawn[t]);
			if (TrackClient[t] != None)
				TrackClient[t].bVoter = true;
			if (HasHud(t) && !TrackClient[t].bVoteOpened)
			{
				TrackClient[t].bVoteOpened = true;
				TrackClient[t].ClientOpenVote();
			}
		}
	VoteTick();
}

// Big vote panel in the middle of the screen, refreshed every second while the vote runs.
function VoteTick()
{
	local int t, i, Line;
	local string Row, Title;
	local PlayerPawn P;

	Title = "MAP VOTE" @ MatchId $ ":" @ NameA @ "vs" @ NameB @ "-" @ Max(VoteSecLeft, 0) $ "s";
	for (t = 0; t < TrackCount; t++)
	{
		P = TrackPawn[t];
		if (P == None || PanelActive(t))
			continue;
		P.ClearProgressMessages();
		P.SetProgressTime(2);
		P.SetProgressMessage(Title, 0);
		Line = 1;
		Row = "";
		for (i = 0; i < VoteCount && Line < 6; i++)
		{
			Row = Row $ (i + 1) $ ")" @ VoteMap[i] $ "     ";
			if ((i + 1) % 3 == 0)
			{
				P.SetProgressMessage(Row, Line++);
				Row = "";
			}
		}
		if (Row != "" && Line < 6)
			P.SetProgressMessage(Row, Line++);
		if (!IsMatchPlayerToken(TrackTok[t]))
			P.SetProgressMessage("The players are choosing the map.", 7);
		else if (TrackVote[t] != "")
			P.SetProgressMessage("Your vote:" @ TrackVote[t] $ "   (vote again to change)", 7);
		else
			P.SetProgressMessage("Press T and type  !vote 2 1 3  - up to 3 numbers, best first", 7);
	}
}

function ClearAllProgress()
{
	local int t;
	for (t = 0; t < TrackCount; t++)
		if (TrackPawn[t] != None)
			TrackPawn[t].ClearProgressMessages();
}

function ShowVoteTo(PlayerPawn P)
{
	local int i;
	local string Line;
	P.ClientMessage("Map vote for" @ MatchId $ ": type !vote followed by up to 3 numbers, best first (e.g. !vote 2 4 1)");
	Line = "";
	for (i = 0; i < VoteCount; i++)
	{
		Line = Line $ (i + 1) $ ")" @ VoteMap[i] $ "   ";
		if (Len(Line) > 80)
		{
			P.ClientMessage(Line);
			Line = "";
		}
	}
	if (Line != "")
		P.ClientMessage(Line);
}

function HandleCommand(PlayerPawn P, string Cmd)
{
	local string Word, Rest;
	local int Sp, t;

	Cmd = TrimSpaces(Cmd);
	Sp = InStr(Cmd, " ");
	if (Sp >= 0)
	{
		Word = Left(Cmd, Sp);
		Rest = TrimSpaces(Mid(Cmd, Sp + 1));
	}
	else
		Word = Cmd;

	if (Word ~= "ready")
	{
		t = FindTrack(P);
		if (t >= 0 && (TrackRole[t] == "a" || TrackRole[t] == "b") && Phase == "ready")
			P.bReadyToPlay = true;
	}
	else if (Word ~= "vote" || Word ~= "v")
		HandleVote(P, Rest);
	else if (Word ~= "bracket")
	{
		t = FindTrack(P);
		if (HasHud(t))
			TrackClient[t].ClientShowBracket();
		else
			ShowBracket(P);
	}
	else if (Word ~= "standings")
	{
		t = FindTrack(P);
		ShowStandings(P);
		if (HasHud(t))
			TrackClient[t].ClientShowStandings();
		else if (Phase != "finished")
			ShowStandingsPanel(P, 10, "");
	}
	else if (Word ~= "follow")
		FollowCommand(P, Rest);
	else if (Word ~= "fp")
		ToggleFirstPerson(P);
	else if (Word ~= "start")
		SendCmd(P, "start"); // team captain: play now, bots fill missing places (the bridge decides)
	else if (Word ~= "help")
	{
		P.ClientMessage("Commands: !ready  !vote 3 1 5 (or !v, !vote alone opens the window)  !bracket  !standings  !follow [name|off]  !fp");
		if (TeamSize > 1)
			P.ClientMessage("Team captains: !start begins the game with bots for missing players (after a short wait)");
	}
}

function SendCmd(PlayerPawn P, string C)
{
	OutMsg.Begin("cmd");
	OutMsg.AddInt("pid", P.PlayerReplicationInfo.PlayerID);
	OutMsg.AddStr("c", C);
	Send();
}

function HandleVote(PlayerPawn P, string Args)
{
	local string Pick[3], Word;
	local int n, Sp, Num, t;

	if (Phase != "vote" || FindTrack(P) < 0)
		return;
	n = 0;
	while (Args != "" && n < 3)
	{
		Sp = InStr(Args, " ");
		if (Sp >= 0)
		{
			Word = Left(Args, Sp);
			Args = TrimSpaces(Mid(Args, Sp + 1));
		}
		else
		{
			Word = Args;
			Args = "";
		}
		Num = int(Word);
		if (Num >= 1 && Num <= VoteCount)
			Pick[n++] = VoteMap[Num - 1];
		else if (Word != "")
			Pick[n++] = Word; // map name typed directly
	}
	if (n == 0)
	{
		ShowVoteTo(P);
		t = FindTrack(P);
		if (HasHud(t) && IsMatchPlayerToken(TrackTok[t]))
			TrackClient[t].ClientOpenVote();
		return;
	}
	SendVote(P, Pick[0], Pick[1], Pick[2]);
}

// From the vote window (TourneyClient.ServerVote): map names instead of numbers.
function VoteByName(PlayerPawn P, string M1, string M2, string M3)
{
	if (Phase != "vote" || FindTrack(P) < 0 || M1 == "")
		return;
	SendVote(P, M1, M2, M3);
}

function SendVote(PlayerPawn P, string M1, string M2, string M3)
{
	local string Pick[3];
	local int t;

	t = FindTrack(P);
	if (t >= 0)
	{
		if (Level.TimeSeconds - TrackVoteAt[t] < 0.5)
			return;
		TrackVoteAt[t] = Level.TimeSeconds;
	}
	Pick[0] = M1;
	Pick[1] = M2;
	Pick[2] = M3;
	OutMsg.Begin("vote");
	OutMsg.AddInt("pid", P.PlayerReplicationInfo.PlayerID);
	OutMsg.AddStr("m1", OutMsg.FitWire(Pick[0], 64));
	OutMsg.AddStr("m2", OutMsg.FitWire(Pick[1], 64));
	OutMsg.AddStr("m3", OutMsg.FitWire(Pick[2], 64));
	Send();
	t = FindTrack(P);
	if (t >= 0)
	{
		TrackVote[t] = TrimSpaces(Pick[0] @ Pick[1] @ Pick[2]);
		if (TrackClient[t] != None)
			TrackClient[t].MyVote = TrackVote[t];
	}
	P.ClientMessage("Vote received:" @ Pick[0] @ Pick[1] @ Pick[2]);
	VoteTick();
}

function string TrimSpaces(string S)
{
	while (Left(S, 1) == " ")
		S = Mid(S, 1);
	while (Right(S, 1) == " ")
		S = Left(S, Len(S) - 1);
	return S;
}

// "|" separates the fields of the HUD lines; names must not contain it.
function string NoBar(string S)
{
	local int i;
	i = InStr(S, "|");
	while (i >= 0)
	{
		S = Left(S, i) $ "/" $ Mid(S, i + 1);
		i = InStr(S, "|");
	}
	return S;
}

function AddBracketLine(TourneyMsg M)
{
	local string S, St;
	if (BracketCount >= 64)
		return;
	TGRI.Lines[BracketCount] = M.Get("s") $ "|" $ M.Get("r") $ "|" $ M.Get("i") $ "|" $ M.Get("id") $ "|"
		$ NoBar(M.Get("na")) $ "|" $ NoBar(M.Get("nb")) $ "|" $ M.Get("sa") $ "|" $ M.Get("sb") $ "|"
		$ M.Get("st") $ "|" $ M.Get("w");
	TGRI.LineCount = BracketCount + 1;
	TGRI.BracketRev++;
	St = M.Get("st");
	S = M.Get("id") $ ":" @ NameOr(M.Get("na"));
	if (M.GetInt("sa") >= 0)
		S = S @ M.Get("sa") $ ":" $ M.Get("sb");
	else
		S = S @ "vs";
	S = S @ NameOr(M.Get("nb"));
	if (St == "l")
		S = S @ "(live)";
	else if (St == "c" && M.Get("w") == "a")
		S = S @ "- winner" @ M.Get("na");
	else if (St == "c" && M.Get("w") == "b")
		S = S @ "- winner" @ M.Get("nb");
	else if (St == "v")
		S = S @ "(not needed)";
	BracketText[BracketCount++] = S;
}

function string NameOr(string N)
{
	if (N == "")
		return "TBD";
	return N;
}

function AddStandingLine(TourneyMsg M)
{
	local string S;
	if (StandCount >= 32)
		return;
	TGRI.Stand[StandCount] = M.Get("pl") $ "|" $ NoBar(M.Get("name")) $ "|" $ M.Get("w") $ "|" $ M.Get("l") $ "|" $ M.Get("bot");
	TGRI.StandCount = StandCount + 1;
	TGRI.StandRev++;
	if (M.GetInt("pl") > 0)
		S = M.Get("pl") $ "." @ M.Get("name");
	else
		S = "-" @ M.Get("name") @ "(still in)";
	S = S @ "  W" $ M.Get("w") @ "L" $ M.Get("l");
	StandingText[StandCount++] = S;
}

// Text version (console) for clients without the HUD and for the console history.
function ShowBracket(PlayerPawn P)
{
	local int i;
	for (i = 0; i < BracketCount; i++)
		P.ClientMessage(BracketText[i]);
}

function ShowStandings(PlayerPawn P)
{
	local int i;
	for (i = 0; i < StandCount; i++)
		P.ClientMessage(StandingText[i]);
}

// True if the middle of this player's screen is taken: by a standings panel, or by the
// HUD of the mod itself (then the text fallbacks with progress messages are not needed).
function bool PanelActive(int t)
{
	return HasHud(t) || TrackPanelUntil[t] > Level.TimeSeconds;
}

// Standings in the middle of the screen (the 8 progress message lines).
function ShowStandingsPanel(PlayerPawn P, int Secs, string Footer)
{
	local int i, Line, t;

	P.ClearProgressMessages();
	P.SetProgressTime(Secs);
	if (Phase == "finished")
		P.SetProgressMessage("FINAL STANDINGS", 0);
	else
		P.SetProgressMessage("STANDINGS", 0);
	Line = 1;
	for (i = 0; i < StandCount && Line < 7; i++)
		P.SetProgressMessage(StandingText[i], Line++);
	if (StandCount == 0)
		P.SetProgressMessage("No results yet.", 1);
	if (Footer != "")
		P.SetProgressMessage(Footer, 7);
	else if (StandCount > 6)
		P.SetProgressMessage("Full list in the console", 7);
	t = FindTrack(P);
	if (t >= 0)
		TrackPanelUntil[t] = Level.TimeSeconds + Secs;
}

function string ShutdownText()
{
	if (PhaseSec > 0)
		return "The tournament is over. Server shuts down in" @ PhaseSec @ "s";
	return "The tournament is over.";
}

// End of the tournament: final standings for everybody, refreshed every second (countdown).
function ShowFinalStandings(bool bFirst)
{
	local int t;
	for (t = 0; t < TrackCount; t++)
	{
		if (TrackPawn[t] == None)
			continue;
		if (bFirst)
			ShowStandings(TrackPawn[t]);
		if (!HasHud(t))
			ShowStandingsPanel(TrackPawn[t], 3, ShutdownText());
	}
}

// The end-of-game scoreboard covers the middle of the screen, so the vote panel or the standings
// would only show after F1. UT clears the scoreboard only when a player leaves the Dying state
// (PlayerPawn.Dying.EndState), and the client follows the server's state with every movement
// correction (ClientAdjustPosition, at least every 0.1 s). So the pawns go GameEnded -> Dying ->
// holding state on the server, with a short stop in Dying for the clients to catch up.
function ReleaseScoreboards()
{
	local int t;
	local PlayerPawn P;

	for (t = 0; t < TrackCount; t++)
	{
		P = TrackPawn[t];
		if (P == None || !P.IsInState('GameEnded'))
			continue;
		P.bHidden = true; // no carcass from Dying
		P.GotoState('Dying');
		P.SetTimer(5.0, false); // keeps bFrozen: FIRE in Dying must not respawn the player
		ReleaseAt = Level.TimeSeconds + 0.8;
	}
}

event Tick(float DeltaTime)
{
	local int t;
	local PlayerPawn P;

	if (ReleaseAt <= 0 || Level.TimeSeconds < ReleaseAt)
		return;
	ReleaseAt = 0;
	for (t = 0; t < TrackCount; t++)
	{
		P = TrackPawn[t];
		if (P == None || !P.IsInState('Dying'))
			continue;
		if (P.IsA('Spectator'))
			P.GotoState('CheatFlying');
		else
		{
			StripInventory(P); // no weapon floating in front of the camera while waiting
			HoldPlayer(P);
		}
	}
}

// Only used after a game has ended: every game is played on a freshly loaded level, so the
// player gets a new pawn with a new inventory anyway. Nothing is dropped as a pickup.
function StripInventory(Pawn P)
{
	local Inventory Inv, Next;

	P.Weapon = None;
	P.PendingWeapon = None;
	P.SelectedItem = None;
	for (Inv = P.Inventory; Inv != None; Inv = Next)
	{
		Next = Inv.Inventory;
		Inv.Destroy();
	}
}

//=============================================================================
// Spectators: follow a player
//=============================================================================

function FollowCommand(PlayerPawn P, string Arg)
{
	local int t;
	local Pawn Target, Q;

	t = FindTrack(P);
	if (t < 0 || TrackClient[t] == None)
		return;
	if (!P.IsA('Spectator'))
	{
		P.ClientMessage("Only spectators can follow a player.");
		return;
	}
	if (Arg ~= "off")
	{
		TrackClient[t].bAutoFollow = false;
		P.ViewTarget = None;
		P.bBehindView = false;
		TrackClient[t].ClientViewMode(false);
		P.ClientMessage("Free camera. !follow to follow the match players again.");
		return;
	}
	TrackClient[t].bAutoFollow = true;
	if (Arg == "")
	{
		// Toggle between the two sides of the current match.
		Target = SidePawn(0);
		if (Target == None || P.ViewTarget == Target)
			Target = SidePawn(1);
	}
	else
	{
		for (Q = Level.PawnList; Q != None; Q = Q.NextPawn)
			// Not bIsSpectator: held match players (PlayerWaiting) are flagged as spectators too.
			if (Q.bIsPlayer && Q.PlayerReplicationInfo != None && !Q.IsA('Spectator')
				&& Left(Q.PlayerReplicationInfo.PlayerName, Len(Arg)) ~= Arg)
			{
				Target = Q;
				break;
			}
	}
	if (Target == None)
	{
		P.ClientMessage("Nobody to follow" @ Arg);
		return;
	}
	SetFollow(t, Target);
}

function SetFollow(int t, Pawn Target)
{
	local PlayerPawn P;
	P = TrackPawn[t];
	if (P == None || Target == None || Target == P)
		return;
	P.ViewTarget = Target;
	P.bBehindView = !TrackClient[t].bFirstPerson;
	TrackClient[t].ClientViewMode(!TrackClient[t].bFirstPerson);
	if (Target.PlayerReplicationInfo != None)
		P.ClientMessage("Following" @ Target.PlayerReplicationInfo.PlayerName, 'Event');
}

function ToggleFirstPerson(PlayerPawn P)
{
	local int t;
	t = FindTrack(P);
	if (t < 0 || TrackClient[t] == None)
		return;
	TrackClient[t].bFirstPerson = !TrackClient[t].bFirstPerson;
	if (P.ViewTarget != None)
	{
		P.bBehindView = !TrackClient[t].bFirstPerson;
		TrackClient[t].ClientViewMode(!TrackClient[t].bFirstPerson);
	}
	if (TrackClient[t].bFirstPerson)
		P.ClientMessage("First person view");
	else
		P.ClientMessage("Third person view");
}

// At the start of a game every spectator who wants it watches side a (FIRE switches).
function AutoFollowAll()
{
	local int t;
	local Pawn Target;
	local Pawn A, B;

	A = SidePawn(0);
	B = SidePawn(1);
	Target = A;
	if (Target == None)
		Target = B;
	if (Target == None)
		return;
	for (t = 0; t < TrackCount; t++)
	{
		if (TrackPawn[t] == None || !TrackPawn[t].IsA('Spectator') || TrackClient[t] == None)
			continue;
		if (!TrackClient[t].bAutoFollow)
			continue;
		if (TrackPawn[t].ViewTarget != None && (TrackPawn[t].ViewTarget == A || TrackPawn[t].ViewTarget == B))
			continue;
		SetFollow(t, Target);
	}
}

// Chat line "!cmd ..." from a player (via TourneyChatListener.TeamMessage).
function HandleChatCommand(PlayerReplicationInfo PRI, string Cmd)
{
	local PlayerPawn P;
	P = PlayerPawn(PRI.Owner);
	if (P != None && FindTrack(P) >= 0)
		HandleCommand(P, Cmd);
}

// Chat line "!cmd ..." from a spectator. Spectator.Say does not send a team message but a
// broadcast "Name:text", so the sender is found by name (names are set from the access list).
function HandleSpectatorChat(string PName, string Cmd)
{
	local int t;
	local PlayerPawn P;
	for (t = 0; t < TrackCount; t++)
	{
		P = TrackPawn[t];
		if (P != None && P.IsA('Spectator') && P.PlayerReplicationInfo != None && P.PlayerReplicationInfo.PlayerName == PName)
		{
			HandleCommand(P, Cmd);
			return;
		}
	}
}

// Big warning in the middle of one player's screen for about 10 seconds.
function WarnPlayer(int Pid, string Msg)
{
	local int t;
	local PlayerPawn P;
	for (t = 0; t < TrackCount; t++)
	{
		P = TrackPawn[t];
		if (P == None || P.PlayerReplicationInfo == None || P.PlayerReplicationInfo.PlayerID != Pid)
			continue;
		P.ClientMessage(Msg, 'CriticalEvent', true);
		P.ClearProgressMessages();
		P.SetProgressTime(10);
		P.SetProgressMessage(Msg, 0);
	}
}

function SayTo(int Pid, string Msg)
{
	local Pawn P;
	if (Pid < 0)
	{
		Game.BroadcastMessage(Msg, true);
		return;
	}
	for (P = Level.PawnList; P != None; P = P.NextPawn)
		if (P.IsA('PlayerPawn') && P.PlayerReplicationInfo != None && P.PlayerReplicationInfo.PlayerID == Pid)
			P.ClientMessage(Msg);
}

//=============================================================================
// Cache (survives map changes)
//=============================================================================

function SaveCache()
{
	local int i;
	class'TournamentConfig'.default.CachedAclCount = AclCount;
	for (i = 0; i < MAXACL; i++)
	{
		class'TournamentConfig'.default.CachedAclTok[i] = AclTok[i];
		class'TournamentConfig'.default.CachedAclName[i] = AclName[i];
		class'TournamentConfig'.default.CachedAclRole[i] = AclRole[i];
	}
	class'TournamentConfig'.default.CachedMatchId = MatchId;
	class'TournamentConfig'.default.CachedGameNo = GameNo;
	class'TournamentConfig'.default.CachedBestOf = BestOf;
	class'TournamentConfig'.default.CachedNameA = NameA;
	class'TournamentConfig'.default.CachedNameB = NameB;
	class'TournamentConfig'.default.CachedFragLimit = MatchFragLimit;
	class'TournamentConfig'.default.CachedTimeLimit = MatchTimeLimit;
	class'TournamentConfig'.default.CachedTeamSize = TeamSize;
	class'TournamentConfig'.default.CachedFF = MatchFF;
	class'TournamentConfig'.default.CachedBotCount = BotCount;
	for (i = 0; i < MAXBOTS; i++)
	{
		class'TournamentConfig'.default.CachedBotName[i] = BotName[i];
		class'TournamentConfig'.default.CachedBotSkill[i] = BotSkill[i];
		class'TournamentConfig'.default.CachedBotCls[i] = BotCls[i];
		class'TournamentConfig'.default.CachedBotSide[i] = BotSide[i];
	}
	class'TournamentConfig'.static.StaticSaveConfig();
}

function LoadCache()
{
	local int i;
	AclCount = Min(class'TournamentConfig'.default.CachedAclCount, MAXACL);
	for (i = 0; i < AclCount; i++)
	{
		AclTok[i] = class'TournamentConfig'.default.CachedAclTok[i];
		AclName[i] = class'TournamentConfig'.default.CachedAclName[i];
		AclRole[i] = class'TournamentConfig'.default.CachedAclRole[i];
	}
	MatchId = class'TournamentConfig'.default.CachedMatchId;
	GameNo = class'TournamentConfig'.default.CachedGameNo;
	BestOf = class'TournamentConfig'.default.CachedBestOf;
	NameA = class'TournamentConfig'.default.CachedNameA;
	NameB = class'TournamentConfig'.default.CachedNameB;
	MatchFragLimit = class'TournamentConfig'.default.CachedFragLimit;
	MatchTimeLimit = class'TournamentConfig'.default.CachedTimeLimit;
	TeamSize = Max(1, class'TournamentConfig'.default.CachedTeamSize);
	MatchFF = class'TournamentConfig'.default.CachedFF;
	BotCount = Clamp(class'TournamentConfig'.default.CachedBotCount, 0, MAXBOTS);
	for (i = 0; i < BotCount; i++)
	{
		BotName[i] = class'TournamentConfig'.default.CachedBotName[i];
		BotSkill[i] = class'TournamentConfig'.default.CachedBotSkill[i];
		BotCls[i] = class'TournamentConfig'.default.CachedBotCls[i];
		BotSide[i] = class'TournamentConfig'.default.CachedBotSide[i];
	}
	Phase = "lobby";
}

defaultproperties
{
	RemoteRole=ROLE_None
	bHidden=True
	bGameRelevant=True
}
