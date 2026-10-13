//=============================================================================
// TournamentDM
// 1v1 tournament deathmatch. The tournament logic lives in TourneyCore; this
// game type only creates it and forwards the engine events, keeping the Super
// calls (which only a subclass of DeathMatchPlus can make). TournamentTDM and
// TournamentMH (Monster Hunt package) forward the same way.
//=============================================================================
class TournamentDM extends DeathMatchPlus;

var TourneyCore Core;
var class<TourneyCore> CoreClass;
var bool bInLogin;                 // set around Super.Login, see TournamentTDM.ChangeTeam
var byte LoginTeam;                // team of the player logging in (255 = spectator)

function EnsureCore()
{
	if (Core != None)
		return;
	Core = Spawn(CoreClass);
	if (Core == None)
	{
		Log("could not spawn the tournament core" @ CoreClass, 'UTTourney');
		return;
	}
	Core.Game = self;
}

event InitGame(string Options, out string Error)
{
	bTournament = false;
	Super.InitGame(Options, Error);
	EnsureCore();
	if (Core != None)
		Core.OnInitGame();
}

function PostBeginPlay()
{
	Super.PostBeginPlay();
	EnsureCore();
	if (Core != None)
		Core.OnPostBeginPlay();
}

event PreLogin(string Options, string Address, out string Error, out string FailCode)
{
	Super.PreLogin(Options, Address, Error, FailCode);
	if (Error == "" && Core != None)
		Core.CheckPreLogin(Options, Address, Error, FailCode);
}

event playerpawn Login(string Portal, string Options, out string Error, class<playerpawn> SpawnClass)
{
	local string Tok, SRole;
	local PlayerPawn P;

	if (Core == None)
	{
		Error = "The tournament is not ready (server error, see the server log).";
		return None;
	}
	if (!Core.BeginLogin(Options, Error, SpawnClass, Tok, SRole))
		return None;
	LoginTeam = Core.TeamOfRole(SRole);
	bInLogin = true;
	P = Super.Login(Portal, Options, Error, SpawnClass);
	bInLogin = false;
	return Core.EndLogin(P, Tok, SRole);
}

event PostLogin(PlayerPawn NewPlayer)
{
	Super.PostLogin(NewPlayer);
	if (Core != None)
		Core.OnPostLogin(NewPlayer);
}

function Logout(Pawn Exiting)
{
	if (Core != None)
		Core.OnLogout(Exiting);
	Super.Logout(Exiting);
}

function bool RestartPlayer(Pawn aPlayer)
{
	if (Core != None && !Core.MayRestart(aPlayer))
		return false;
	return Super.RestartPlayer(aPlayer);
}

// Bots are spawned by the tournament only. DeathMatchPlus would remove every bot above MinPlayers
// (which is 0 here) as soon as it respawns, so tell it there are never too many.
function bool TooManyBots()
{
	return false;
}

function Timer()
{
	if (Core != None && Core.TimerStep() == 1)
	{
		Super.Timer();
		Core.LiveTick();
	}
	else
		Super(GameInfo).Timer(); // the game clock stands still before the start and in a pause
}

// Statistics: the core counts kills, deaths and more per player (before the scoring).
function Killed(Pawn Killer, Pawn Other, name DamageType)
{
	if (TCore != None)
		TCore.OnKilled(Killer, Other, DamageType);
	Super.Killed(Killer, Other, DamageType);
}

function EndGame(string Reason)
{
	local bool bWasOvertime;
	bWasOvertime = bOverTime;
	Super.EndGame(Reason);
	if (Core != None)
		Core.OnEndGame(Reason, bWasOvertime);
}

// Never restart or rotate maps on our own: the bridge sends the next map.
function RestartGame()
{
}

defaultproperties
{
	CoreClass=Class'TourneyCore'
	GameName="Tournament 1v1 DM"
	MapPrefix="DM"
	BeaconName="TDM1v1"
	bTournament=False
	MinPlayers=0
	MaxPlayers=4
	FragLimit=20
	TimeLimit=10
}
