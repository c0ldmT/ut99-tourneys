//=============================================================================
// TournamentDM
// 1v1 tournament deathmatch driven by the bridge (see docs/protocol.md).
//
// The mod keeps no tournament logic of its own. It
//   - admits only players with a token from the access list (?tk=...),
//   - lets the two match players play and makes everybody else a spectator,
//   - holds the match players until both are ready, runs the countdown,
//   - spawns bots for bot sides, reports scores and the end of the game,
//   - pauses when a match player drops and restores the score on return,
//   - performs the map change the bridge asks for.
//=============================================================================
class TournamentDM extends DeathMatchPlus;

const MOD_VERSION = "0.1.0";
const PROTOCOL_VERSION = 1;
const MAXACL = 64;
const MAXTRACK = 64;

var BridgeLink Link;
var TourneyMsg OutMsg;
var TourneyMutator TMut;
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
var bool bBotA, bBotB;
var string BotNameA, BotNameB, BotClsA, BotClsB;
var int BotSkillA, BotSkillB;
var string AclTok[64], AclName[64], AclRole[64];
var int AclCount;
var string VoteMap[32];
var int VoteCount;
var string BracketText[64];
var int BracketCount;
var string StandingText[32];
var int StandCount;

// Players on this level.
var PlayerPawn TrackPawn[64];
var string TrackTok[64];
var string TrackRole[64];
var byte TrackReady[64]; // 0/1 - UE1 has no bool arrays
var int TrackCount;

// Match runtime.
var Bot SideBot[2];
var bool bBotsSpawned;
var bool bGameLive;
var bool bEndReported;
var int CountdownLeft;
var int LastSentA, LastSentB, ScoreTicks;
var bool bTourneyPaused;
var string SavedTok[2];
var float SavedScore[2], SavedDeaths[2];
var string PendingAddr;
var string PendingEnd;
var bool bTokenFromAddress;

//=============================================================================
// Startup
//=============================================================================

event InitGame(string Options, out string Error)
{
	bTournament = false;
	Super.InitGame(Options, Error);
	MinPlayers = 0;
	MaxPlayers = Max(MaxPlayers, 4);
	RemainingBots = 0;
	// Hold everybody in the waiting state until the bridge starts the countdown.
	bNetReady = false;
	bRequireReady = true;
	CountDown = 9999;
	LoadCache();
	ApplyMatchRules();
}

function PostBeginPlay()
{
	Super.PostBeginPlay();
	OutMsg = Spawn(class'TourneyMsg');
	TMut = Spawn(class'TourneyMutator');
	TMut.Game = self;
	BaseMutator.AddMutator(TMut);
	RegisterMessageMutator(TMut);
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
		case "sync":
			bInSync = M.Get("st") == "begin";
			if (!bInSync)
			{
				SaveCache();
				if (!bJoinsSent)
					SendAllJoins();
				ApplyPhase();
			}
			break;
		case "phase":
			Phase = M.Get("p");
			PhaseSec = M.GetInt("sec");
			if (!bInSync)
				ApplyPhase();
			break;
		case "match":
			if (M.Get("mid") != MatchId || M.GetInt("g") != GameNo)
				PendingEnd = "";
			MatchId = M.Get("mid");
			GameNo = M.GetInt("g");
			BestOf = M.GetInt("bo");
			WinsA = M.GetInt("wa");
			WinsB = M.GetInt("wb");
			NameA = M.Get("na");
			NameB = M.Get("nb");
			MatchFragLimit = M.GetInt("fl");
			MatchTimeLimit = M.GetInt("tl");
			bBotA = false;
			bBotB = false;
			if (!bGameLive)
				ApplyMatchRules();
			break;
		case "bot":
			if (M.Get("s") == "a")
			{
				bBotA = true;
				BotNameA = M.Get("name");
				BotSkillA = M.GetInt("sk");
				BotClsA = M.Get("cls");
			}
			else
			{
				bBotB = true;
				BotNameB = M.Get("name");
				BotSkillB = M.GetInt("sk");
				BotClsB = M.Get("cls");
			}
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
			break;
		case "vmap":
			i = M.GetInt("i") - 1;
			if (i >= 0 && i < 32)
			{
				VoteMap[i] = M.Get("map");
				VoteCount = Max(VoteCount, i + 1);
			}
			break;
		case "vclose":
			BroadcastMessage("Next map:" @ M.Get("map"), true);
			break;
		case "travel":
			DoTravel(M.Get("map"), M.Get("opt"));
			break;
		case "cd":
			CountdownLeft = Max(1, M.GetInt("sec"));
			Phase = "countdown";
			break;
		case "pause":
			SetTourneyPause(M.GetBool("on"), M.Get("why"));
			break;
		case "abort":
			AbortGame(M.Get("w"), M.Get("why"));
			break;
		case "brh":
			BracketCount = 0;
			break;
		case "brm":
			AddBracketLine(M);
			break;
		case "sth":
			StandCount = 0;
			break;
		case "ste":
			AddStandingLine(M);
			break;
		case "say":
			SayTo(M.GetInt("pid"), M.Get("msg"));
			break;
		default:
			Log("unknown bridge message" @ T, 'UTTourney');
	}
}

function ApplyPhase()
{
	if (Phase == "vote")
		ShowVote();
	else if (Phase == "ready")
		SpawnBotsOnce();
	else if (Phase == "finished")
		BroadcastMessage("The tournament is over. Type !standings for the final placements.", true);
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

function bool SideTaken(string SRole)
{
	local int t;
	for (t = 0; t < TrackCount; t++)
		if (TrackRole[t] == SRole && TrackPawn[t] != None && !TrackPawn[t].IsA('Spectator'))
			return true;
	return false;
}

event PreLogin(string Options, string Address, out string Error, out string FailCode)
{
	local string Tok;
	Super.PreLogin(Options, Address, Error, FailCode);
	if (Error != "")
		return;
	Tok = ParseOption(Options, "tk");
	if (Tok == "")
		Tok = TokenForAddress(Address);
	if (FindAcl(Tok) < 0)
	{
		Error = "This server runs a tournament. Join with your personal link from the tournament website.";
		FailCode = "NOTOKEN";
		ReportReject(ParseOption(Options, "Name"), "no token");
		return;
	}
	// Login() has no address; remember it for the token fallback (Login follows PreLogin).
	PendingAddr = Address;
}

event playerpawn Login(string Portal, string Options, out string Error, class<playerpawn> SpawnClass)
{
	local string Tok, SRole;
	local int i;
	local PlayerPawn P;

	Tok = ParseOption(Options, "tk");
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
		return None;
	}
	SRole = AclRole[i];
	if ((SRole != "a" && SRole != "b") || SideTaken(SRole))
	{
		SRole = "s";
		SpawnClass = class'Botpack.CHSpectator';
	}
	P = Super.Login(Portal, Options, Error, SpawnClass);
	if (P == None)
		return None;
	if (P.IsA('Spectator'))
		SRole = "s"; // joined with the spectate option
	ChangeName(P, AclName[i], false);
	Track(P, Tok, SRole);
	return P;
}

event PostLogin(PlayerPawn NewPlayer)
{
	local int t;

	Super.PostLogin(NewPlayer);
	t = FindTrack(NewPlayer);
	if (t < 0)
		return;
	RememberAddress(NewPlayer.GetPlayerNetworkAddress(), TrackTok[t]);
	if (TrackRole[t] == "a" || TrackRole[t] == "b")
	{
		if (!bGameLive)
			HoldPlayer(NewPlayer);
		else
			RestoreScore(NewPlayer, TrackRole[t]);
	}
	if (bTokenFromAddress && TokenForAddress(NewPlayer.GetPlayerNetworkAddress()) != TrackTok[t])
		Log("token fallback mismatch for" @ NewPlayer.PlayerReplicationInfo.PlayerName, 'UTTourney');
	bTokenFromAddress = false;
	SendJoin(t);
	if (Phase == "vote" && IsMatchPlayerToken(TrackTok[t]))
		ShowVoteTo(NewPlayer);
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
	P.PlayerRestartState = 'PlayerWaiting';
	P.GotoState('PlayerWaiting');
	P.ClientGotoState('PlayerWaiting', 'Begin');
}

function Logout(Pawn Exiting)
{
	local int t;
	local string SRole;

	t = FindTrack(PlayerPawn(Exiting));
	if (t >= 0)
	{
		SRole = TrackRole[t];
		if (bGameLive && !bGameEnded && (SRole == "a" || SRole == "b"))
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
	Super.Logout(Exiting);
}

function Track(PlayerPawn P, string Tok, string SRole)
{
	if (TrackCount >= MAXTRACK)
		return;
	TrackPawn[TrackCount] = P;
	TrackTok[TrackCount] = Tok;
	TrackRole[TrackCount] = SRole;
	TrackReady[TrackCount] = 0;
	TrackCount++;
}

function Untrack(int t)
{
	TrackCount--;
	TrackPawn[t] = TrackPawn[TrackCount];
	TrackTok[t] = TrackTok[TrackCount];
	TrackRole[t] = TrackRole[TrackCount];
	TrackReady[t] = TrackReady[TrackCount];
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

function Pawn SidePawn(int Side)
{
	if (SideBot[Side] != None)
		return SideBot[Side];
	if (Side == 0)
		return SidePlayer("a");
	return SidePlayer("b");
}

//=============================================================================
// Match flow
//=============================================================================

function ApplyMatchRules()
{
	FragLimit = MatchFragLimit;
	TimeLimit = MatchTimeLimit;
	if (!bGameLive)
		RemainingTime = 60 * TimeLimit;
	if (TournamentGameReplicationInfo(GameReplicationInfo) != None)
	{
		TournamentGameReplicationInfo(GameReplicationInfo).FragLimit = FragLimit;
		TournamentGameReplicationInfo(GameReplicationInfo).TimeLimit = TimeLimit;
	}
	if (GameReplicationInfo != None)
		GameReplicationInfo.RemainingTime = RemainingTime;
}

function SpawnBotsOnce()
{
	if (bBotsSpawned || MatchId == "")
		return;
	bBotsSpawned = true;
	if (bBotA)
		SideBot[0] = SpawnSideBot(BotNameA, BotSkillA, BotClsA);
	if (bBotB)
		SideBot[1] = SpawnSideBot(BotNameB, BotSkillB, BotClsB);
}

function int FindBotIndex(string BName)
{
	local int i;
	for (i = 0; i < 32; i++)
		if (BotConfig.GetBotName(i) ~= BName)
			return i;
	return -1;
}

// Spawns a specific configured bot (name, skill 0..7, optional class) waiting for the start.
function Bot SpawnSideBot(string BName, int BSkill, string BClass)
{
	local NavigationPoint StartSpot;
	local class<Bot> BC;
	local Bot B;
	local int N;

	N = FindBotIndex(BName);
	if (BClass != "")
		BC = class<Bot>(DynamicLoadObject(BClass, class'Class'));
	if (BC == None && N >= 0)
		BC = BotConfig.CHGetBotClass(N);
	if (BC == None)
		BC = class'Botpack.TMale1Bot';

	StartSpot = FindPlayerStart(None, 255);
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
	B.PlayerReplicationInfo.PlayerID = CurrentID++;
	if (N >= 0)
		BotConfig.CHIndividualize(B, N, NumBots);
	ChangeName(B, BName, false);
	// UT bot skill is 0..3 (plus a global novice flag); the tournament uses 0..7.
	B.InitializeSkill(FClamp(BSkill * 3.0 / 7.0, 0.0, 3.0));
	B.ViewRotation = StartSpot.Rotation;
	BroadcastMessage(B.PlayerReplicationInfo.PlayerName $ EnteredMessage, false);
	ModifyBehaviour(B);
	AddDefaultInventory(B);
	NumBots++;
	B.GotoState('Dying', 'WaitingForStart');
	return B;
}

function Timer()
{
	BridgeTick();
	if (!bGameLive)
	{
		PreMatchTick();
		Super(GameInfo).Timer();
		return;
	}
	if (bTourneyPaused)
	{
		Super(GameInfo).Timer(); // game clock stands still
		return;
	}
	Super.Timer();
	LiveTick();
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
			P.ClearProgressMessages();
			P.SetProgressTime(2);
			P.SetProgressMessage(MatchTitle(), 0);
			if (TrackReady[t] != 0)
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
	bRequireReady = false;
	CountDown = 0;
	bNetReady = false;
	ApplyMatchRules();
	bGameLive = true;
	bEndReported = false;
	LastSentA = -1;
	LastSentB = -1;
	StartMatch();
	OutMsg.Begin("live");
	OutMsg.AddStr("mid", MatchId);
	OutMsg.AddInt("g", GameNo);
	Send();
}

function LiveTick()
{
	local int A, B;
	if (bGameEnded)
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
		if (TimeLimit > 0)
			OutMsg.AddInt("tl", RemainingTime);
		else
			OutMsg.AddInt("tl", -1);
		OutMsg.AddBool("ot", bOverTime);
		Send();
	}
}

function int SideScore(int Side)
{
	local Pawn P;
	P = SidePawn(Side);
	if (P != None && P.PlayerReplicationInfo != None)
		return int(P.PlayerReplicationInfo.Score);
	if (SavedTok[Side] != "")
		return int(SavedScore[Side]);
	return 0;
}

function EndGame(string Reason)
{
	local bool bWasOvertime;
	bWasOvertime = bOverTime;
	Super.EndGame(Reason);
	if (bGameEnded && bGameLive && !bEndReported)
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

// The bridge decided the game (forfeit). End it without reporting a result.
function AbortGame(string Winner, string Why)
{
	local Pawn P;

	bEndReported = true;
	bTourneyPaused = false;
	if (!bGameEnded)
	{
		// SetEndCams refuses to end a tied game (it starts overtime), so end it directly.
		bGameEnded = true;
		for (P = Level.PawnList; P != None; P = P.NextPawn)
		{
			P.GotoState('GameEnded');
			if (PlayerPawn(P) != None)
				PlayerPawn(P).ClientGameEnded();
		}
	}
	if (Winner == "a")
		BroadcastMessage(NameA @ "wins by forfeit", true);
	else
		BroadcastMessage(NameB @ "wins by forfeit", true);
}

// Never restart or rotate maps on our own: the bridge sends the next map.
function RestartGame()
{
}

function DoTravel(string MapName, string Opt)
{
	local string URL;
	SaveCache();
	URL = MapName $ "?game=" $ string(Class) $ Opt;
	Log("travel to" @ URL, 'UTTourney');
	Level.ServerTravel(URL, false);
}

// Soft pause. Level.Pauser is not used on purpose: a paused level stops ticking actors, which
// would also stop the bridge connection. Instead the match pawns are held out of play and the
// game clock (DeathMatchPlus.Timer) is not advanced. On resume both sides respawn.
function SetTourneyPause(bool bOn, string Why)
{
	local int Side;
	local Pawn P;

	if (bOn == bTourneyPaused)
		return;
	if (!bOn && bGameLive && !bGameEnded)
	{
		// Do not resume while a human side is still missing; tell the bridge again.
		if (!bBotA && SidePlayer("a") == None)
		{
			SendLost("a");
			return;
		}
		if (!bBotB && SidePlayer("b") == None)
		{
			SendLost("b");
			return;
		}
	}
	bTourneyPaused = bOn;
	if (!bGameLive || bGameEnded)
		return;
	for (Side = 0; Side < 2; Side++)
	{
		P = SidePawn(Side);
		if (P == None)
			continue;
		if (bOn)
		{
			if (P.IsA('Bot'))
				P.GotoState('Dying', 'WaitingForStart');
			else if (P.IsA('PlayerPawn'))
				HoldPlayer(PlayerPawn(P));
		}
		else
		{
			if (P.IsA('PlayerPawn'))
				PlayerPawn(P).PlayerRestartState = PlayerPawn(P).Default.PlayerRestartState;
			RestartPlayer(P);
			if (P.IsA('Bot'))
				Bot(P).StartMatch();
		}
	}
	if (bOn)
		BroadcastMessage("Game paused:" @ Why, true);
	else
		BroadcastMessage("Game resumed", true);
}

function SaveScore(Pawn P, string SRole)
{
	local int Side;
	Side = 0;
	if (SRole == "b")
		Side = 1;
	SavedTok[Side] = SRole;
	SavedScore[Side] = P.PlayerReplicationInfo.Score;
	SavedDeaths[Side] = P.PlayerReplicationInfo.Deaths;
}

function RestoreScore(PlayerPawn P, string SRole)
{
	local int Side;
	Side = 0;
	if (SRole == "b")
		Side = 1;
	if (SavedTok[Side] == "")
		return;
	P.PlayerReplicationInfo.Score = SavedScore[Side];
	P.PlayerReplicationInfo.Deaths = SavedDeaths[Side];
	SavedTok[Side] = "";
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
			ShowVoteTo(TrackPawn[t]);
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
	else if (Word ~= "vote")
		HandleVote(P, Rest);
	else if (Word ~= "bracket")
		ShowBracket(P);
	else if (Word ~= "standings")
		ShowStandings(P);
	else if (Word ~= "help")
		P.ClientMessage("Commands: !ready  !vote 3 1 5  !bracket  !standings");
}

function HandleVote(PlayerPawn P, string Args)
{
	local string Pick[3], Word;
	local int n, Sp, Num;

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
		return;
	}
	OutMsg.Begin("vote");
	OutMsg.AddInt("pid", P.PlayerReplicationInfo.PlayerID);
	OutMsg.AddStr("m1", OutMsg.FitWire(Pick[0], 64));
	OutMsg.AddStr("m2", OutMsg.FitWire(Pick[1], 64));
	OutMsg.AddStr("m3", OutMsg.FitWire(Pick[2], 64));
	Send();
	P.ClientMessage("Vote received:" @ Pick[0] @ Pick[1] @ Pick[2]);
}

function string TrimSpaces(string S)
{
	while (Left(S, 1) == " ")
		S = Mid(S, 1);
	while (Right(S, 1) == " ")
		S = Left(S, Len(S) - 1);
	return S;
}

function AddBracketLine(TourneyMsg M)
{
	local string S, St;
	if (BracketCount >= 64)
		return;
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
	if (M.GetInt("pl") > 0)
		S = M.Get("pl") $ "." @ M.Get("name");
	else
		S = "-" @ M.Get("name") @ "(still in)";
	S = S @ "  W" $ M.Get("w") @ "L" $ M.Get("l");
	StandingText[StandCount++] = S;
}

// Text version until the HUD overlay exists (milestone 6).
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

function SayTo(int Pid, string Msg)
{
	local Pawn P;
	if (Pid < 0)
	{
		BroadcastMessage(Msg, true);
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
	class'TournamentConfig'.default.CachedBotA = bBotA;
	class'TournamentConfig'.default.CachedBotB = bBotB;
	class'TournamentConfig'.default.CachedBotNameA = BotNameA;
	class'TournamentConfig'.default.CachedBotNameB = BotNameB;
	class'TournamentConfig'.default.CachedBotSkillA = BotSkillA;
	class'TournamentConfig'.default.CachedBotSkillB = BotSkillB;
	class'TournamentConfig'.default.CachedBotClsA = BotClsA;
	class'TournamentConfig'.default.CachedBotClsB = BotClsB;
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
	bBotA = class'TournamentConfig'.default.CachedBotA;
	bBotB = class'TournamentConfig'.default.CachedBotB;
	BotNameA = class'TournamentConfig'.default.CachedBotNameA;
	BotNameB = class'TournamentConfig'.default.CachedBotNameB;
	BotSkillA = class'TournamentConfig'.default.CachedBotSkillA;
	BotSkillB = class'TournamentConfig'.default.CachedBotSkillB;
	BotClsA = class'TournamentConfig'.default.CachedBotClsA;
	BotClsB = class'TournamentConfig'.default.CachedBotClsB;
	Phase = "lobby";
}

defaultproperties
{
	GameName="Tournament 1v1 DM"
	MapPrefix="DM"
	BeaconName="TDM1v1"
	bTournament=False
	MinPlayers=0
	MaxPlayers=4
	FragLimit=20
	TimeLimit=10
}
