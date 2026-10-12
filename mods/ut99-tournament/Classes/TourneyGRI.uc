//=============================================================================
// TourneyGRI
// Tournament state for the clients (HUD, vote window). Spawned once per level
// by TournamentDM, replicated to everybody. The server only copies what the
// bridge sent; there is no logic in here.
//=============================================================================
class TourneyGRI extends ReplicationInfo;

var string TName;          // tournament name
var string Phase;          // lobby vote ready countdown live paused post finished
var int PhaseSec;          // seconds left in the current phase (-1 = none)
var string MatchId, NameA, NameB, MapName;
var byte GameNo, BestOf, WinsA, WinsB;
var int ScoreA, ScoreB;
var byte ReadyA, ReadyB;   // 1 = ready (bots are always ready)
var bool bBotA, bBotB, bPaused;
var string PauseReason;

// Bracket: one line per match "side|round|index|id|nameA|nameB|scoreA|scoreB|status|winner"
var string Lines[64];
var byte LineCount;
var int BracketRev;        // changes whenever the bracket changes (clients re-parse)
var string Fmt;            // single / double

// Standings: "placement|name|wins|losses|bot"
var string Stand[32];
var byte StandCount;
var int StandRev;

// Map vote
var string VoteMaps[16];
var byte VoteCount;

replication
{
	reliable if (Role == ROLE_Authority)
		TName, Phase, PhaseSec, MatchId, NameA, NameB, MapName, GameNo, BestOf, WinsA, WinsB,
		ScoreA, ScoreB, ReadyA, ReadyB, bBotA, bBotB, bPaused, PauseReason,
		Lines, LineCount, BracketRev, Fmt, Stand, StandCount, StandRev, VoteMaps, VoteCount;
}

defaultproperties
{
	bAlwaysRelevant=True
	RemoteRole=ROLE_SimulatedProxy
	NetUpdateFrequency=4
}
