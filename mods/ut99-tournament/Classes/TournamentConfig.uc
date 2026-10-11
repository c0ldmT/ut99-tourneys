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
var config bool CachedBotA;
var config bool CachedBotB;
var config string CachedBotNameA;
var config string CachedBotNameB;
var config int CachedBotSkillA;
var config int CachedBotSkillB;
var config string CachedBotClsA;
var config string CachedBotClsB;

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
}
