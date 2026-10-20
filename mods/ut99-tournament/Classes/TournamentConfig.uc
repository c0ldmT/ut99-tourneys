//=============================================================================
// TournamentConfig
// Server-side settings written by the bridge into Tourney.ini, plus a small
// cache so the access list and match survive a map change (logins on the new
// level can arrive before the bridge connection is re-established).
// Access only through class'TournamentConfig'.default.* and StaticSaveConfig().
//=============================================================================
class TournamentConfig extends Info
	config;

// Connection to the bridge (same machine).
var config string BridgeHost;
var config int BridgePort;
var config string SharedKey;

// Cache: access list (token -> name, role a/b/s).
var config int CachedAclCount;
var config string CachedAclTok[64];
var config string CachedAclName[64];
var config string CachedAclRole[64];

// Cache: current match.
var config string CachedMatchId;
var config int CachedGameNo;
var config int CachedBestOf;
var config string CachedNameA;
var config string CachedNameB;
var config int CachedFragLimit;
var config int CachedTimeLimit;
var config int CachedTeamSize;
var config int CachedFF;
var config byte CachedSkillCurve;                 // 1 = bots on the skill curve (mod 0.13.0)
// Bots of the match (1v1: the bot side; team games: the bots of both teams).
var config int CachedBotCount;
var config string CachedBotName[10];
var config int CachedBotSkill[10];
var config string CachedBotCls[10];
var config byte CachedBotSide[10];
// Monster Hunt settings for the next level (-1 = not known yet, keep Monster Hunt's own).
var config int CachedLives;
var config int CachedMonsterSkill;
var config byte CachedWeaponStay, CachedHardcore; // 0 = off, 1 = on
var config byte CachedWaypointFix;                // 1 = TourneyMHBotExtension

// Fallback when a client reconnects without ?tk= after a map change: address -> token.
var config string KnownAddr[64];
var config string KnownAddrTok[64];

defaultproperties
{
	BridgeHost="127.0.0.1"
	BridgePort=7790
	SharedKey=""
	CachedFragLimit=20
	CachedTimeLimit=10
	CachedBestOf=1
	CachedGameNo=1
	CachedTeamSize=1
	CachedSkillCurve=1
	CachedLives=-1
	CachedMonsterSkill=-1
	CachedWeaponStay=1
	CachedHardcore=1
	CachedWaypointFix=1
}
