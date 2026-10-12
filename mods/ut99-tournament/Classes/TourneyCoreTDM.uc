//=============================================================================
// TourneyCoreTDM
// TourneyCore for TournamentTDM: puts players and bots into the red (side a)
// and blue (side b) team, reads the team scores, applies the team rules.
//=============================================================================
class TourneyCoreTDM extends TourneyCore;

function TournamentTDM TGame()
{
	return TournamentTDM(Game);
}

function ApplyMatchRules()
{
	Super.ApplyMatchRules();
	if (TGame() == None)
		return;
	TGame().GoalTeamScore = MatchFragLimit;
	Game.FragLimit = 0; // single players' frags never end a team game
	TGame().FriendlyFireScale = FClamp(MatchFF / 100.0, 0.0, 1.0);
	if (TournamentGameReplicationInfo(Game.GameReplicationInfo) != None)
	{
		TournamentGameReplicationInfo(Game.GameReplicationInfo).FragLimit = 0;
		TournamentGameReplicationInfo(Game.GameReplicationInfo).GoalTeamScore = TGame().GoalTeamScore;
	}
}

function AssignTeam(Pawn P, int Side)
{
	if (TGame() != None && P != None && P.PlayerReplicationInfo != None && Side >= 0 && Side <= 1)
		TGame().AddToTeam(Side, P);
}

function AnnounceTeam(Pawn P)
{
	if (TGame() != None)
		TGame().AnnounceTeam(P);
}

function int SideScore(int Side)
{
	if (TGame() != None && Side >= 0 && Side < 2 && TGame().Teams[Side] != None)
		return int(TGame().Teams[Side].Score);
	return 0;
}

defaultproperties
{
}
