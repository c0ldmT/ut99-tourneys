//=============================================================================
// TourneyCoreMH
// TourneyCore for the Monster Hunt time race (TournamentMH). One level = one
// run of one team: the run starts with the countdown, the clock stops in a
// pause, every death in the team counts (players and bots). The run ends at
// the exit, at the time limit (the core's own clock, Monster Hunt's time
// limit is switched off) or when no hunters are left; then "runend" goes to
// the bridge, which decides the game after both runs.
//=============================================================================
class TourneyCoreMH extends TourneyCore;

var byte RaceSide;          // running side: 1 = a, 2 = b, 0 = not known yet
var int RaceRun;            // run 1 or 2 of the game
var int PenaltySec;         // seconds per death (display only, the bridge adds it)
var int PrevMs, PrevDeaths, PrevPoints; // the other team's finished run (PrevMs -1 = none)
var bool bPrevDone;
var float RunSec;           // game seconds of this run, pauses excluded
var int RunDeaths;
var bool bRunReported;
var int LastRpDeaths, RpTicks;
// Monster Hunt settings from the bridge (race line), applied when a level starts. MonsterHunt
// reads its own config from MonsterHunt.ini, so the tournament sets them in code instead.
var int HuntLives;          // 0 = unlimited, -1 = not known (Monster Hunt's own setting)
var int HuntMonsterSkill;   // -1 = not known
var bool bHuntWeaponStay, bHuntHardcore;
var bool bHuntWaypointFix;  // bots use TourneyMHBotExtension (waypoint order, jump routes, mover guard, unstick)
// Virtual captain: teams without a player on the server get "Attack" (as from the V menu) at
// the start of the run and every CaptainSec seconds, so their bots follow the map's waypoints
// (Monster Hunt gives bots of such teams no orders at all).
var int CaptainSec;
var int CaptainLeft;
var bool bCaptainLogged;
var Bot AckBot[32];         // bots that got the order: their confirmation goes to the log a second later
var int NumAck;
// Where the runners were when a pause began (a resume puts them back, not to the start).
var Pawn SpotPawn[16];
var vector SpotLoc[16];
var rotator SpotRot[16];
var int SpotCount;

function TournamentMH MHGame()
{
	return TournamentMH(Game);
}

function HandleBridgeMessage(TourneyMsg M)
{
	local string T;

	T = M.Get("t");
	if (T == "race")
	{
		// Settings for the next levels (saved with the cache before every travel).
		HuntLives = Max(0, M.GetInt("lv"));
		HuntMonsterSkill = Clamp(M.GetInt("mk"), 0, 7);
		bHuntWeaponStay = M.GetBool("ws");
		bHuntHardcore = M.GetBool("hc");
		bHuntWaypointFix = M.GetBool("wf");
		// After the end of this run the bridge already describes the next one (other level).
		if (bRunReported)
			return;
		if (M.Get("rs") == "b")
			RaceSide = 2;
		else
			RaceSide = 1;
		RaceRun = Max(1, M.GetInt("n"));
		PenaltySec = M.GetInt("pen");
		PrevMs = M.GetInt("pt");
		PrevDeaths = M.GetInt("pd");
		PrevPoints = M.GetInt("pp");
		bPrevDone = M.GetBool("pf");
		UpdateRaceGRI();
		return;
	}
	if (T == "match" && (M.Get("mid") != MatchId || M.GetInt("g") != GameNo))
		RaceSide = 0; // a new game: its race line follows
	Super.HandleBridgeMessage(M);
}

// Runners are Monster Hunt's hunters (team 0) whichever side they play for.
function byte TeamOfRole(string SRole)
{
	if (SRole == "a" || SRole == "b")
		return 0;
	return 255;
}

// Lives (0 = unlimited), monster skill, weapon stay and hardcore for this level. Runs in
// InitGame: monsters get their skill in PreBeginPlay (MonsterHunt.IsRelevant), the lives go
// into the GameReplicationInfo in PostBeginPlay (InitGameReplicationInfo).
function OnInitGame()
{
	Super.OnInitGame();
	ApplyHuntSettings();
}

function ApplyHuntSettings()
{
	if (MHGame() == None)
		return;
	if (HuntLives >= 0)
		MHGame().Lives = HuntLives;
	if (HuntMonsterSkill >= 0)
		MHGame().MonsterSkill = HuntMonsterSkill;
	Game.bMultiWeaponStay = bHuntWeaponStay;
	Game.bHardCoreMode = bHuntHardcore;
	// Monster Hunt spawns its bot extension in PreBeginPlay (spawnExtensions), after this.
	if (bHuntWaypointFix)
		MHGame().BotExtensionType = class'TourneyMHBotExtension';
	Log("Monster Hunt: lives" @ MHGame().Lives @ "(0 = unlimited), monster skill" @ MHGame().MonsterSkill
		@ "bot extension" @ MHGame().BotExtensionType, 'UTTourney');
}

function SaveCache()
{
	class'TournamentConfig'.default.CachedLives = HuntLives;
	class'TournamentConfig'.default.CachedMonsterSkill = HuntMonsterSkill;
	class'TournamentConfig'.default.CachedWeaponStay = 0;
	if (bHuntWeaponStay)
		class'TournamentConfig'.default.CachedWeaponStay = 1;
	class'TournamentConfig'.default.CachedHardcore = 0;
	if (bHuntHardcore)
		class'TournamentConfig'.default.CachedHardcore = 1;
	class'TournamentConfig'.default.CachedWaypointFix = 0;
	if (bHuntWaypointFix)
		class'TournamentConfig'.default.CachedWaypointFix = 1;
	Super.SaveCache(); // writes the ini
}

function LoadCache()
{
	Super.LoadCache();
	HuntLives = class'TournamentConfig'.default.CachedLives;
	HuntMonsterSkill = class'TournamentConfig'.default.CachedMonsterSkill;
	bHuntWeaponStay = class'TournamentConfig'.default.CachedWeaponStay != 0;
	bHuntHardcore = class'TournamentConfig'.default.CachedHardcore != 0;
	bHuntWaypointFix = class'TournamentConfig'.default.CachedWaypointFix != 0;
}

function AssignTeam(Pawn P, int Side)
{
	if (MHGame() != None)
		MHGame().JoinHunters(P);
}

function ApplyMatchRules()
{
	Super.ApplyMatchRules();
	// No frag limit; the time limit is measured by the core (see Tick).
	Game.FragLimit = 0;
	Game.TimeLimit = 0;
	if (TeamGamePlus(Game) != None)
		TeamGamePlus(Game).GoalTeamScore = 0; // monster points never end a run
	if (TournamentGameReplicationInfo(Game.GameReplicationInfo) != None)
	{
		TournamentGameReplicationInfo(Game.GameReplicationInfo).FragLimit = 0;
		TournamentGameReplicationInfo(Game.GameReplicationInfo).TimeLimit = 0;
		TournamentGameReplicationInfo(Game.GameReplicationInfo).GoalTeamScore = 0;
	}
}

function StartTournamentMatch()
{
	RunSec = 0;
	RunDeaths = 0;
	bRunReported = false;
	LastRpDeaths = -1;
	RpTicks = 0;
	CaptainLeft = 1; // first orders right after the start
	NumAck = 0;
	Super.StartTournamentMatch();
	if (RaceSide == 0)
		Log("run started without a race line from the bridge", 'UTTourney');
}

function bool RunActive()
{
	return bGameLive && !bTourneyPaused && !Game.bGameEnded && !bRunReported;
}

event Tick(float DeltaTime)
{
	Super.Tick(DeltaTime);
	if (!RunActive())
		return;
	RunSec += DeltaTime;
	if (MatchTimeLimit > 0 && RunSec >= MatchTimeLimit * 60)
	{
		RunSec = MatchTimeLimit * 60;
		ReportRun(false);
		EndRunLevel("timelimit");
	}
	if (TGRI != None)
		TGRI.RaceMs = int(RunSec * 1000);
}

// From TournamentMH.Killed: a hunter died (players and bots; not monsters, not spectators).
function OnPawnKilled(Pawn Other)
{
	if (!RunActive() || Other == None || !Other.bIsPlayer || Other.PlayerReplicationInfo == None)
		return;
	if (Other.IsA('Spectator') || Other.IsA('ScriptedPawn'))
		return;
	RunDeaths++;
	SendProgress();
	UpdateRaceGRI();
}

// Progress for the website instead of scores: every few seconds and on every death.
function LiveTick()
{
	if (!RunActive())
		return;
	StatTick();
	CaptainTick();
	RpTicks++;
	if (RpTicks >= 3 || RunDeaths != LastRpDeaths)
		SendProgress();
}

// Once a second while the run is live (not in a pause). Every order and, a second later, what
// each bot made of it go to the server log only (no voice message, nothing in the game).
function CaptainTick()
{
	local Pawn P;
	local int n;
	local name Was;

	if (NumAck > 0)
		LogAcks();
	CaptainLeft--;
	if (CaptainLeft > 0)
		return;
	CaptainLeft = CaptainSec;
	if (RaceSide == 0 || SideCount(SideRole(RaceSide - 1)) > 0)
		return; // a player leads the team (bots follow them, they give orders themselves)
	for (P = Level.PawnList; P != None; P = P.NextPawn)
		if (Bot(P) != None && !P.bDeleteMe && P.Health > 0 && P.PlayerReplicationInfo != None
			&& P.PlayerReplicationInfo.Team == 0 && !P.PlayerReplicationInfo.bIsSpectator)
		{
			Was = Bot(P).Orders;
			Bot(P).SetOrders('Attack', None, true);
			Log("bot" @ RunStamp() @ "order: Attack ->" @ P.PlayerReplicationInfo.PlayerName @ "(was" @ Was $ ")",
				'UTTourney');
			if (NumAck < 32)
			{
				AckBot[NumAck] = Bot(P);
				NumAck++;
			}
			n++;
		}
	if (n > 0 && !bCaptainLogged)
	{
		bCaptainLogged = true;
		Log("virtual captain: Attack for" @ n @ "bots, every" @ CaptainSec @ "s", 'UTTourney');
	}
}

function LogAcks()
{
	local int i;
	local Bot B;
	local string Goal;

	for (i = 0; i < NumAck; i++)
	{
		B = AckBot[i];
		AckBot[i] = None;
		if (B == None || B.bDeleteMe || B.PlayerReplicationInfo == None)
			continue;
		if (B.Health <= 0)
		{
			Log("bot" @ RunStamp() @ "ack:" @ B.PlayerReplicationInfo.PlayerName @ "died before it could follow",
				'UTTourney');
			continue;
		}
		if (B.Orders != 'Attack')
		{
			Log("bot" @ RunStamp() @ "ack:" @ B.PlayerReplicationInfo.PlayerName @ "does NOT follow, orders"
				@ B.Orders, 'UTTourney');
			continue;
		}
		if (MHGame() != None && TourneyMHBotExtension(MHGame().botExtension) != None)
			Goal = TourneyMHBotExtension(MHGame().botExtension).GoalText(B);
		else if (B.MoveTarget != None)
			Goal = string(B.MoveTarget.Name);
		else
			Goal = "nothing";
		Log("bot" @ RunStamp() @ "ack:" @ B.PlayerReplicationInfo.PlayerName @ "follows Attack, state"
			@ B.GetStateName() $ ", goal" @ Goal, 'UTTourney');
	}
	NumAck = 0;
}

// Run time for the bot log lines, e.g. "[2:05.3]".
function string RunStamp()
{
	return "[" $ class'TourneyClient'.static.RaceTime(int(RunSec * 1000)) $ "]";
}

function SendProgress()
{
	RpTicks = 0;
	LastRpDeaths = RunDeaths;
	OutMsg.Begin("rp");
	OutMsg.AddStr("mid", MatchId);
	OutMsg.AddInt("g", GameNo);
	OutMsg.AddInt("n", Max(1, RaceRun));
	OutMsg.AddInt("ms", int(RunSec * 1000));
	OutMsg.AddInt("d", RunDeaths);
	OutMsg.AddInt("pts", HunterPoints());
	Send();
}

// Monster points of the running team: the hunters' scores plus those of players who left.
function int HunterPoints()
{
	local Pawn P;
	local int i;
	local float Sum;

	for (P = Level.PawnList; P != None; P = P.NextPawn)
		if (P.bIsPlayer && P.PlayerReplicationInfo != None && !P.IsA('Spectator') && !P.IsA('ScriptedPawn')
			&& P.PlayerReplicationInfo.Team == 0)
			Sum += P.PlayerReplicationInfo.Score;
	for (i = 0; i < 16; i++) // TourneyCore.MAXSAVED
		if (SavedKey[i] != "")
			Sum += SavedScore[i];
	return int(Sum);
}

// Statistics: every hunter runs for the running side.
function byte StatSide(Pawn P)
{
	if (RaceSide == 2)
		return 1;
	return 0;
}

// Monster points: the hunter's score (players who left: their saved score).
function int StatPoints(int i)
{
	local int j;

	if (StPawn[i] != None && !StPawn[i].bDeleteMe && StPawn[i].PlayerReplicationInfo != None)
		return int(StPawn[i].PlayerReplicationInfo.Score);
	if (StKey[i] != "")
	{
		j = FindSaved(StKey[i]);
		if (j < 0 && TeamSize <= 1)
			j = FindSaved(SideRole(StSide[i])); // one player per side: saved by side
		if (j >= 0)
			return int(SavedScore[j]);
	}
	return 0;
}

// Reasons that are not the exit: time limit, no hunters left, score limits.
function bool ReachedExit(string Reason)
{
	local string R;
	R = Caps(Reason);
	return R != "TIMELIMIT" && R != "TEAMSCORELIMIT" && R != "FRAGLIMIT" && InStr(R, "HUNTERS") < 0
		&& InStr(R, "ESCAPED") < 0;
}

function OnEndGame(string Reason, bool bWasOvertime)
{
	if (!bGameLive || bRunReported)
		return;
	ReportRun(ReachedExit(Reason));
	EndRunLevel(Reason);
}

function ReportRun(bool bDone)
{
	SendStats(Max(1, RaceRun), int(RunSec)); // the running team's players and bots
	bRunReported = true;
	bEndReported = true;
	OutMsg.Begin("runend");
	OutMsg.AddStr("mid", MatchId);
	OutMsg.AddInt("g", GameNo);
	OutMsg.AddInt("n", Max(1, RaceRun));
	OutMsg.AddInt("ms", int(RunSec * 1000));
	OutMsg.AddInt("d", RunDeaths);
	OutMsg.AddInt("pts", HunterPoints());
	OutMsg.AddBool("done", bDone);
	PendingEnd = OutMsg.Finish(); // sent again if the bridge reconnects before it travels
	Send();
	if (bDone)
		Game.BroadcastMessage("Exit reached:" @ RunText(), true, 'CriticalEvent');
	else
		Game.BroadcastMessage("Run over:" @ RunText(), true, 'CriticalEvent');
}

function string RunText()
{
	local int Ms;
	Ms = int(RunSec * 1000);
	return class'TourneyClient'.static.RaceTime(Ms) @ "+" @ RunDeaths @ "deaths x" @ PenaltySec $ "s ="
		@ class'TourneyClient'.static.RaceTime(Ms + RunDeaths * PenaltySec * 1000);
}

// Ends the level if Monster Hunt did not (time limit of the core, or EndGame refused).
function EndRunLevel(string Reason)
{
	local Pawn P;

	if (Game.bGameEnded)
		return;
	Game.EndGame(Reason);
	if (Game.bGameEnded)
		return;
	Game.bGameEnded = true;
	for (P = Level.PawnList; P != None; P = P.NextPawn)
	{
		P.GotoState('GameEnded');
		if (PlayerPawn(P) != None)
			PlayerPawn(P).ClientGameEnded();
	}
}

// A pause holds the runners; on resume the core respawns them at a start spot. In a race that
// would cost the team its way through the map, so they go back to where they were.
function SetTourneyPause(bool bOn, string Why)
{
	local bool bWas;

	bWas = bTourneyPaused;
	if (bOn && !bWas && bGameLive && !Game.bGameEnded)
		SaveRunnerSpots();
	Super.SetTourneyPause(bOn, Why);
	if (!bOn && bWas && !bTourneyPaused)
		RestoreRunnerSpots();
}

function SaveRunnerSpots()
{
	local Pawn P;

	SpotCount = 0;
	for (P = Level.PawnList; P != None && SpotCount < 16; P = P.NextPawn)
		if (P.bIsPlayer && P.PlayerReplicationInfo != None && P.PlayerReplicationInfo.Team == 0
			&& !P.IsA('Spectator') && !P.IsA('ScriptedPawn') && P.Health > 0)
		{
			SpotPawn[SpotCount] = P;
			SpotLoc[SpotCount] = P.Location;
			SpotRot[SpotCount] = P.Rotation;
			SpotCount++;
		}
}

function RestoreRunnerSpots()
{
	local int i;
	local Pawn P;

	for (i = 0; i < SpotCount; i++)
	{
		P = SpotPawn[i];
		SpotPawn[i] = None;
		if (P == None || P.bDeleteMe || P.Health <= 0)
			continue;
		if (!P.SetLocation(SpotLoc[i]))
			continue; // blocked: the player keeps the start spot
		P.SetRotation(SpotRot[i]);
		if (PlayerPawn(P) != None)
		{
			PlayerPawn(P).ViewRotation = SpotRot[i];
			PlayerPawn(P).ClientSetLocation(SpotLoc[i], SpotRot[i]);
		}
	}
	SpotCount = 0;
}

function UpdateGRI()
{
	Super.UpdateGRI();
	UpdateRaceGRI();
}

function UpdateRaceGRI()
{
	if (TGRI == None)
		return;
	TGRI.RaceSide = RaceSide;
	TGRI.RaceRun = RaceRun;
	TGRI.RacePen = PenaltySec;
	TGRI.RaceLimit = MatchTimeLimit * 60;
	TGRI.RaceDeaths = RunDeaths;
	TGRI.RaceMs = int(RunSec * 1000);
	TGRI.PrevMs = PrevMs;
	TGRI.PrevDeaths = PrevDeaths;
	TGRI.bPrevDone = bPrevDone;
}

defaultproperties
{
	PrevMs=-1
	RaceRun=1
	HuntLives=-1
	HuntMonsterSkill=-1
	bHuntWeaponStay=True
	bHuntHardcore=True
	bHuntWaypointFix=True
	CaptainSec=45
}
