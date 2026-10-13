//=============================================================================
// TournamentMH
// Monster Hunt 613 as a tournament time race (package UTTourneyMH_v1, server
// side only). Each level is one run of one team: the running team plays as
// Monster Hunt's hunters, the other team watches. The tournament logic lives
// in TourneyCore (UTTourney_v1); TourneyCoreMH measures the run, counts the
// deaths and reports the end of the run. This game type creates the core and
// forwards the engine events, like TournamentDM, keeping the Super calls into
// MonsterHunt.
//
// "config" (no file name): Monster Hunt's settings (MonsterSkill, Lives, ...)
// are read from the ini the server was started with (Tourney.ini, written by
// the bridge), section [UTTourneyMH_v1.TournamentMH]. MonsterHunt.ini is not
// touched.
//=============================================================================
class TournamentMH extends MonsterHunt config;

var TourneyCore TCore;          // (names prefixed: Monster Hunt has its own members)
var class<TourneyCore> CoreClass;
var bool bTInLogin;                // set around Super.Login, see ChangeTeam
var byte TLoginTeam;               // 0 = hunter, 255 = spectator
var bool bTeamByCore;              // the core puts a bot into the hunter team

function EnsureCore()
{
	if (TCore != None)
		return;
	TCore = Spawn(CoreClass);
	if (TCore == None)
	{
		Log("could not spawn the tournament core" @ CoreClass, 'UTTourney');
		return;
	}
	TCore.Game = self;
}

event InitGame(string Options, out string Error)
{
	bTournament = false;
	Super.InitGame(Options, Error);
	EnsureCore();
	if (TCore != None)
		TCore.OnInitGame();
}

function PostBeginPlay()
{
	Super.PostBeginPlay();
	EnsureCore();
	if (TCore != None)
		TCore.OnPostBeginPlay();
}

event PreLogin(string Options, string Address, out string Error, out string FailCode)
{
	Super.PreLogin(Options, Address, Error, FailCode);
	if (Error == "" && TCore != None)
		TCore.CheckPreLogin(Options, Address, Error, FailCode);
}

event playerpawn Login(string Portal, string Options, out string Error, class<playerpawn> SpawnClass)
{
	local string Tok, SRole;
	local PlayerPawn P;

	if (TCore == None)
	{
		Error = "The tournament is not ready (server error, see the server log).";
		return None;
	}
	if (!TCore.BeginLogin(Options, Error, SpawnClass, Tok, SRole))
		return None;
	TLoginTeam = TCore.TeamOfRole(SRole);
	bTInLogin = true;
	P = Super.Login(Portal, Options, Error, SpawnClass);
	bTInLogin = false;
	return TCore.EndLogin(P, Tok, SRole);
}

event PostLogin(PlayerPawn NewPlayer)
{
	Super.PostLogin(NewPlayer);
	if (TCore != None)
		TCore.OnPostLogin(NewPlayer);
}

function Logout(Pawn Exiting)
{
	if (TCore != None)
		TCore.OnLogout(Exiting);
	Super.Logout(Exiting);
}

// The running team are the hunters (team 0); everybody else watches. Players cannot switch.
function bool ChangeTeam(Pawn Other, int NewTeam)
{
	if (Other == None || Other.PlayerReplicationInfo == None)
		return false;
	if (Other.IsA('Spectator'))
	{
		Other.PlayerReplicationInfo.Team = 255;
		return true;
	}
	if (bTInLogin)
	{
		if (TLoginTeam > 1)
		{
			Other.PlayerReplicationInfo.Team = 255;
			return true;
		}
		return Super.ChangeTeam(Other, 0);
	}
	if (bTeamByCore)
		return Super.ChangeTeam(Other, 0);
	return false;
}

// Called by TourneyCoreMH for the bots of the running team.
function JoinHunters(Pawn P)
{
	if (P == None || P.PlayerReplicationInfo == None)
		return;
	if (P.PlayerReplicationInfo.Team != 0)
	{
		bTeamByCore = true;
		ChangeTeam(P, 0);
		bTeamByCore = false;
	}
	if (P.PlayerReplicationInfo.Team != 0)
		Log("could not put" @ P.PlayerReplicationInfo.PlayerName @ "into the hunter team", 'UTTourney');
	else if (Bot(P) != None)
		SetBotOrders(Bot(P));
}

// Every death of a hunter (players and bots) costs the team time.
function Killed(Pawn Killer, Pawn Other, name DamageType)
{
	if (TCore != None)
		TCore.OnKilled(Killer, Other, DamageType); // statistics (monsters killed, deaths, ...)
	if (TourneyCoreMH(TCore) != None)
		TourneyCoreMH(TCore).OnPawnKilled(Other);
	Super.Killed(Killer, Other, DamageType);
}

function bool RestartPlayer(Pawn aPlayer)
{
	if (TCore != None && !TCore.MayRestart(aPlayer))
		return false;
	return Super.RestartPlayer(aPlayer);
}

// Bots are spawned by the tournament only.
function bool TooManyBots()
{
	return false;
}

function Timer()
{
	if (TCore != None && TCore.TimerStep() == 1)
	{
		Super.Timer();
		TCore.LiveTick();
	}
	else
		Super(GameInfo).Timer(); // nothing runs before the start and in a pause
}

// Monster Hunt ends the level at the exit ("Hunt Successful!") or when no hunters are left.
function EndGame(string Reason)
{
	local bool bWasOvertime;

	// Before the countdown and in a pause the runners are held (flagged as spectators):
	// Monster Hunt must not end the level for "no hunters" then.
	if (TCore != None && (!TCore.bGameLive || TCore.bTourneyPaused))
	{
		Log("ignored EndGame(" $ Reason $ ") while the run is not active", 'UTTourney');
		return;
	}
	bWasOvertime = bOverTime;
	Super.EndGame(Reason);
	if (TCore != None)
		TCore.OnEndGame(Reason, bWasOvertime);
}

// Never restart or rotate maps on our own: the bridge sends the next map.
function RestartGame()
{
}

defaultproperties
{
	CoreClass=Class'TourneyCoreMH'
	GameName="Tournament Monster Hunt"
	BeaconName="TMH"
	bTournament=False
	MinPlayers=0
	MaxPlayers=12
}
