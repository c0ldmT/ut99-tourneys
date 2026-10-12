//=============================================================================
// TourneyGRI
// Tournament state for the clients (HUD, vote window). Spawned once per level
// by TourneyCore, replicated to everybody. The server only copies what the
// bridge sent; there is no logic in here.
//=============================================================================
class TourneyGRI extends ReplicationInfo;

var string TName;          // tournament name
var string ModVersion;     // "UTTourney v0.5.2", shown in the bracket title
var string Phase;          // lobby vote ready countdown live paused post finished
var int PhaseSec;          // seconds left in the current phase (-1 = none)
var string MatchId, NameA, NameB, MapName;
var byte GameNo, BestOf, WinsA, WinsB;
var int ScoreA, ScoreB;
var byte ReadyA, ReadyB;   // 1v1: 1 = ready (bots are always ready); team games: players ready
var bool bBotA, bBotB, bPaused;
// Team games (TeamSize > 1): players per side, players here, team declared ready by the bridge.
var byte TeamSize, PresentA, PresentB, TeamReadyA, TeamReadyB;
var string PauseReason;
// Monster Hunt time race (TourneyCoreMH): running side (1 = a, 2 = b, 0 = no race), run 1/2,
// run time in ms, deaths, seconds per death, time limit in seconds, the other team's finished run.
var byte RaceSide, RaceRun;
var int RaceMs, RaceDeaths, RacePen, RaceLimit, PrevMs, PrevDeaths;
var bool bPrevDone;

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
		TName, ModVersion, Phase, PhaseSec, MatchId, NameA, NameB, MapName, GameNo, BestOf, WinsA, WinsB,
		ScoreA, ScoreB, ReadyA, ReadyB, bBotA, bBotB, bPaused, PauseReason,
		TeamSize, PresentA, PresentB, TeamReadyA, TeamReadyB,
		RaceSide, RaceRun, RaceMs, RaceDeaths, RacePen, RaceLimit, PrevMs, PrevDeaths, bPrevDone,
		Lines, LineCount, BracketRev, Fmt, Stand, StandCount, StandRev, VoteMaps, VoteCount;
}

defaultproperties
{
	TeamSize=1
	PrevMs=-1
	bAlwaysRelevant=True
	RemoteRole=ROLE_SimulatedProxy
	NetUpdateFrequency=4
}
