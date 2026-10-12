//=============================================================================
// TournamentTDM
// Team deathmatch for the tournament (2on2, 3on3, 5on5): side a is the red
// team, side b the blue team. Tokens, roles, ready check, bots, votes and
// travel all come from TourneyCore (via TournamentDM); TourneyCoreTDM puts
// pawns into the teams.
//
// TournamentDM extends DeathMatchPlus, so the team rules are taken over from
// Botpack.TeamGamePlus here: team scores, friendly fire, team skins, the end
// of the game and the bots' attitude to team mates. The frag limit the bridge
// sends is the team score goal. Teams come from the access list; players
// cannot switch.
//=============================================================================
class TournamentTDM extends TournamentDM;

var TeamInfo Teams[2];          // Red (side a), Blue (side b)
var float GoalTeamScore;        // the match's frag limit, counted per team
var float FriendlyFireScale;    // from the match (0, 0.5 or 1)
var localized string TeamColor[2];

event InitGame(string Options, out string Error)
{
	Super.InitGame(Options, Error);
	MaxPlayers = Max(MaxPlayers, 12);
}

function PostBeginPlay()
{
	local int i;

	// As TeamGamePlus: the teams exist before anybody logs in (the HUD and scoreboard read them).
	for (i = 0; i < 2; i++)
	{
		Teams[i] = Spawn(class'TeamInfo');
		Teams[i].Size = 0;
		Teams[i].Score = 0;
		Teams[i].TeamName = TeamColor[i];
		Teams[i].TeamIndex = i;
		if (TournamentGameReplicationInfo(GameReplicationInfo) != None)
			TournamentGameReplicationInfo(GameReplicationInfo).Teams[i] = Teams[i];
	}
	Super.PostBeginPlay();
}

//=============================================================================
// Teams
//=============================================================================

// Called by GameInfo.Login: the team comes from the access list (TournamentDM.Login sets
// LoginTeam). Players cannot change teams themselves.
function bool ChangeTeam(Pawn Other, int NewTeam)
{
	if (Other == None || Other.PlayerReplicationInfo == None)
		return false;
	if (Other.IsA('Spectator'))
	{
		Other.PlayerReplicationInfo.Team = 255;
		return true;
	}
	if (!bInLogin)
		return false;
	if (LoginTeam > 1)
	{
		Other.PlayerReplicationInfo.Team = 255;
		return true;
	}
	AddToTeam(LoginTeam, Other);
	return true;
}

// From TeamGamePlus.AddToTeam (without team balancing).
function AddToTeam(int Num, Pawn Other)
{
	local TeamInfo aTeam;
	local Pawn P;
	local bool bSuccess;
	local string SkinName, FaceName;

	if (Other == None || Num < 0 || Num > 1 || Teams[Num] == None)
		return;
	aTeam = Teams[Num];
	aTeam.Size++;
	Other.PlayerReplicationInfo.Team = Num;
	Other.PlayerReplicationInfo.TeamName = aTeam.TeamName;
	if (LocalLog != None)
		LocalLog.LogTeamChange(Other);
	if (WorldLog != None)
		WorldLog.LogTeamChange(Other);
	if (Other.IsA('PlayerPawn'))
	{
		Other.PlayerReplicationInfo.TeamID = 0;
		PlayerPawn(Other).ClientChangeTeam(Other.PlayerReplicationInfo.Team);
	}
	else
		Other.PlayerReplicationInfo.TeamID = 1;

	// A team-unique id (used for the team HUD and voice messages).
	while (!bSuccess)
	{
		bSuccess = true;
		for (P = Level.PawnList; P != None; P = P.NextPawn)
			if (P.bIsPlayer && P != Other && P.PlayerReplicationInfo != None
				&& P.PlayerReplicationInfo.Team == Other.PlayerReplicationInfo.Team
				&& P.PlayerReplicationInfo.TeamID == Other.PlayerReplicationInfo.TeamID)
				bSuccess = false;
		if (!bSuccess)
			Other.PlayerReplicationInfo.TeamID++;
	}

	// During Login the player still has the URL name; TournamentDM.Login announces it later.
	if (!bInLogin)
		BroadcastLocalizedMessage(DMMessageClass, 3, Other.PlayerReplicationInfo, None, aTeam);
	Other.static.GetMultiSkin(Other, SkinName, FaceName);
	Other.static.SetMultiSkin(Other, SkinName, FaceName, Num);
}

function AnnounceTeam(Pawn P)
{
	if (P != None && P.PlayerReplicationInfo != None && P.PlayerReplicationInfo.Team < 2)
		BroadcastLocalizedMessage(DMMessageClass, 3, P.PlayerReplicationInfo, None, Teams[P.PlayerReplicationInfo.Team]);
}

event PostLogin(PlayerPawn NewPlayer)
{
	Super.PostLogin(NewPlayer);
	// As TeamGamePlus: the team change during Login is not replicated yet, send it again.
	if (Level.NetMode != NM_Standalone && NewPlayer != None && NewPlayer.PlayerReplicationInfo != None)
		NewPlayer.ClientChangeTeam(NewPlayer.PlayerReplicationInfo.Team);
}

function Logout(Pawn Exiting)
{
	local byte T;

	T = 255;
	if (Exiting != None && Exiting.PlayerReplicationInfo != None && !Exiting.IsA('Spectator'))
		T = Exiting.PlayerReplicationInfo.Team;
	Super.Logout(Exiting);
	if (T < 2 && Teams[T] != None && Teams[T].Size > 0)
		Teams[T].Size--;
}

//=============================================================================
// Rules (from TeamGamePlus)
//=============================================================================

function int ReduceDamage(int Damage, name DamageType, Pawn Injured, Pawn InstigatedBy)
{
	Damage = Super.ReduceDamage(Damage, DamageType, Injured, InstigatedBy);
	if (InstigatedBy == None)
		return Damage;
	if (InstigatedBy != Injured && Injured.bIsPlayer && InstigatedBy.bIsPlayer
		&& Injured.PlayerReplicationInfo != None && InstigatedBy.PlayerReplicationInfo != None
		&& Injured.PlayerReplicationInfo.Team == InstigatedBy.PlayerReplicationInfo.Team)
	{
		if (Injured.IsA('Bot'))
			Bot(Injured).YellAt(InstigatedBy);
		return Damage * FriendlyFireScale;
	}
	return Damage;
}

function AddTeamScore(int T, int N)
{
	if (T >= 0 && T < 2 && Teams[T] != None)
		Teams[T].Score += N;
}

function ScoreKill(Pawn Killer, Pawn Other)
{
	// Team kills do not count for the killer.
	if (Killer == None || Killer == Other || !Other.bIsPlayer || !Killer.bIsPlayer
		|| Killer.PlayerReplicationInfo.Team != Other.PlayerReplicationInfo.Team)
		Super.ScoreKill(Killer, Other);

	if (Other.bIsPlayer && (Killer == None || Killer.bIsPlayer))
	{
		if (Killer == Other || Killer == None)
			AddTeamScore(Other.PlayerReplicationInfo.Team, -1);
		else if (Killer.PlayerReplicationInfo.Team != Other.PlayerReplicationInfo.Team)
			AddTeamScore(Killer.PlayerReplicationInfo.Team, 1);
		else if (FriendlyFireScale > 0)
		{
			AddTeamScore(Other.PlayerReplicationInfo.Team, -1);
			Killer.PlayerReplicationInfo.Score -= 1;
		}
	}

	if (Killer == None || !Killer.bIsPlayer || Killer.PlayerReplicationInfo == None)
		return;
	if (GoalTeamScore > 0 && Killer.PlayerReplicationInfo.Team < 2
		&& Teams[Killer.PlayerReplicationInfo.Team].Score >= GoalTeamScore)
		EndGame("teamscorelimit");
	else if (bOverTime)
		EndGame("timelimit"); // 469: any frag in overtime decides
}

// The team with the higher score wins; a tie at the time limit goes to overtime.
function bool SetEndCams(string Reason)
{
	local TeamInfo BestTeam;
	local Pawn P, Best;
	local PlayerPawn Player;

	if (Teams[0] == None || Teams[1] == None)
		return true;
	for (P = Level.PawnList; P != None; P = P.NextPawn)
		if (P.bIsPlayer && !P.IsA('Spectator') && P.PlayerReplicationInfo != None
			&& (Best == None || P.PlayerReplicationInfo.Score > Best.PlayerReplicationInfo.Score))
			Best = P;

	if (Teams[0].Score == Teams[1].Score)
	{
		BroadcastLocalizedMessage(DMMessageClass, 0);
		return false;
	}
	BestTeam = Teams[0];
	if (Teams[1].Score > Teams[0].Score)
		BestTeam = Teams[1];
	if (BestTeam == Teams[0])
		GameReplicationInfo.GameEndedComments = Core.NameA @ GameEndedMessage;
	else
		GameReplicationInfo.GameEndedComments = Core.NameB @ GameEndedMessage;

	EndTime = Level.TimeSeconds + 3.0;
	for (P = Level.PawnList; P != None; P = P.NextPawn)
	{
		Player = PlayerPawn(P);
		if (Player != None)
		{
			if (Player.PlayerReplicationInfo != None)
				PlayWinMessage(Player, Player.PlayerReplicationInfo.Team == BestTeam.TeamIndex);
			Player.bBehindView = true;
			if (Player == Best)
				Player.ViewTarget = None;
			else
				Player.ViewTarget = Best;
			Player.ClientGameEnded();
		}
		P.GotoState('GameEnded');
	}
	CalcEndStats();
	return true;
}

// Bots leave their team mates alone.
function byte AssessBotAttitude(Bot aBot, Pawn Other)
{
	if (Other.bIsPlayer && Other.PlayerReplicationInfo != None && aBot.PlayerReplicationInfo != None
		&& aBot.PlayerReplicationInfo.Team == Other.PlayerReplicationInfo.Team)
		return 3; // friendly
	return Super.AssessBotAttitude(aBot, Other);
}

defaultproperties
{
	CoreClass=Class'TourneyCoreTDM'
	TeamColor(0)="Red"
	TeamColor(1)="Blue"
	bTeamGame=True
	bCanChangeSkin=False
	HUDType=Class'Botpack.ChallengeTeamHUD'
	ScoreBoardType=Class'Botpack.TeamScoreBoard'
	GameName="Tournament Team DM"
	BeaconName="TTDM"
	MaxPlayers=12
}
