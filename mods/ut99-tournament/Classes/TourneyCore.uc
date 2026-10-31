//=============================================================================
// TourneyCore
// The tournament logic of the mod, driven by the bridge (see docs/protocol.md).
// One per level, spawned by the game type (TournamentDM, TournamentTDM, and
// TournamentMH in the Monster Hunt package), which forwards the engine events
// it gets (login, logout, timer, end of game) and keeps the Super calls.
//
// The mod keeps no tournament logic of its own. It
//   - admits only players with a token from the access list (?tk=...),
//   - lets the match players play and makes everybody else a spectator,
//   - holds the match players until they are ready, runs the countdown,
//   - spawns the bots the bridge names, reports scores and the end of the game,
//   - 1v1: pauses when a match player drops and restores the score on return
//     (team games go on; the bridge sends a stand-in bot),
//   - performs the map change the bridge asks for.
// Server only: clients never see this actor.
//=============================================================================
class TourneyCore extends Info;

const MOD_VERSION = "0.17.0";
const MAXBOTS = 10;
const MAXSAVED = 16;
const PROTOCOL_VERSION = 1;
const MAXACL = 64;
const MAXTRACK = 64;
const MAXST = 32;   // players and bots with statistics per game
const MAXW = 8;     // weapons per player
const MAXCFG = 16;  // website bots with a configuration
const MAXSAY = 192; // their chat lines
const MAXRIV = 96;  // their rivals
const MAXDED = 64;  // dedications of the players (Neuro shop)
const DEDCHANCE = 60; // percent: a bot says a dedication line on its occasion
const SAYCOOLDOWN = 12.0; // seconds between two lines of one bot
const SAYGAP = 2.0;       // seconds between two bot lines

var DeathMatchPlus Game;          // the game this core drives (TournamentDM, TournamentTDM, TournamentMH)
var BridgeLink Link;
var TourneyMsg OutMsg;
var TourneyMutator TMut;
var TourneyChatListener ChatListener;
var TourneyGRI TGRI;
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
var int TeamSize;                  // players per side: 1 = one on one, else team deathmatch
var int MatchFF;                   // team games: friendly fire in percent
// Bots of the match: 1v1 the bot side, team games the bots of both teams (also stand-ins).
var string BotName[10];
var int BotSkill[10];
var string BotCls[10];
var byte BotSide[10];              // 0 = side a, 1 = side b
var Bot BotPawn[10];
var int BotCount;
// The list before the last "match" line: its bots are taken over by the new list.
var string OldBotName[10];
var Bot OldBotPawn[10];
var byte OldBotSide[10];
var int OldBotCount;
var bool bTeamReadyA, bTeamReadyB; // team games: the bridge declared the side ready
var string AclTok[64], AclName[64], AclRole[64];
var int AclCount;
var string VoteMap[32];
var int VoteCount;
var int VoteSecLeft;
var string TrackVote[64]; // what each player voted, shown in the vote panel
var string BracketText[64];
var int BracketCount;
var string StandingText[32];
var int StandCount;

// Players on this level.
var PlayerPawn TrackPawn[64];
var string TrackTok[64];
var string TrackRole[64];
var byte TrackReady[64]; // 0/1 - UE1 has no bool arrays
var float TrackPanelUntil[64]; // a panel (standings) owns the middle of the screen until then
var TourneyClient TrackClient[64]; // HUD, vote window and follow for this player
var float TrackVoteAt[64];         // last vote (rate limit)
var string VoteKey;                // match and game of the current vote (a resync repeats vopen)
var int TrackCount;

// Match runtime.
var bool bBotsSpawned;
var bool bGameLive;
var bool bEndReported;
var int CountdownLeft;
var int LastSentA, LastSentB, ScoreTicks;
var bool bTourneyPaused;
var string SavedKey[16];           // 1v1: the side (a/b), team games: the player's token
var float SavedScore[16], SavedDeaths[16];
var string PendingAddr;
var string PendingEnd;
var string PendingStat[260];       // statistics lines of the end, sent again with PendingEnd
var int PendingStatCount;
var bool bTokenFromAddress;
var float ReleaseAt; // see ReleaseScoreboards
// Player statistics of the current game (Monster Hunt: run), sent before its end (ps/px/pw/pse).
// Players are kept by token, bots by name, so leaving and coming back keeps the counts.
var string StKey[32];              // join token ("" for bots)
var string StBot[32];              // bot name ("" for players)
var Pawn StPawn[32];               // the pawn last seen for the slot (None after leaving)
var byte StSide[32];               // 0 = side a, 1 = side b
var int StKills[32], StDeaths[32], StSuicides[32], StTeamKills[32], StHead[32];
var int StSpree[32], StBestSpree[32], StSprees[32], StMulti[32];
var int StM2[32], StM3[32], StM4[32], StM5[32], StSec[32], StMon[32];
var byte StFirst[32];
var float StLastKill[32];
var string StWName[256];           // MAXST * MAXW: weapon names per player
var int StWCount[256];
var int StCount;
var int StGameSec;
var bool bFirstBlood;
var int FeedFlags, FeedSpree, FeedMulti; // kill feed of the kill being counted (kf line)
// Live data (mod 0.16.0) per statistics slot: damage, items taken, what went to the bridge.
var int StDmgOut[32], StDmgIn[32];  // damage dealt to opponents (and monsters), damage taken
var int StAmp[32], StBelt[32], StArmor[32], StKeg[32];
var string StLastSt[32];           // last st line sent (sent again only when it changed or after 5 s)
var float StStAt[32];
var byte StListed[32];             // 1 = its lr line went out
var string StBState[32], StBTarget[32]; // bots: last bt line (state code, target)
var float StBAt[32];
var Pawn PkPawn[8];                // pickup queries of this second, checked in the next tick
var Inventory PkItem[8];
var string PkCode[8];
var int PkHealth[8];
var float PkAt[8];
var int PkCount;
var int CounterTicks;              // sx lines every 5 s

// Website bots (bridge lines bcfg/btr/bpers/bsay/brv, sent before their "bot" line): look, play
// style, chat lines and rivals by name in the game. Bots without these lines use the ini.
var string CfgName[16], CfgSkin[16], CfgFace[16], CfgVoice[16], CfgWeapon[16];
var float CfgAcc[16], CfgAlert[16], CfgStyle[16], CfgCamp[16], CfgStrafe[16];
var byte CfgJump[16];
var byte CfgTraits[16];            // 1 = a btr line came (else the play style stays as spawned)
var int CfgTalk[16];               // chance to say something, percent
var float CfgSayAt[16];            // no line before this time (per bot cooldown)
var byte CfgStarted[16];           // 1 = had its chance for a start line
var byte CfgBet[16];               // latest bet with Neuro: 0 none, 1 won, 2 lost (bbet)
var int CfgBetAmt[16];             // Neuro won or lost
var string CfgBetPick[16];         // whom the bot backed
var int CfgCount;
var byte CfgBody[16];              // Dream Team game traits (btrt): 1 start armour, 2 thick skin,
                                   // 4 adrenaline, 8 glass cannon, 16 vampire, 32 phoenix
var byte CfgPhoenix[16];           // 1 = the phoenix was used this game
var float CfgAdrUntil[16];         // adrenaline: faster until then (0 = not boosted)
var float CfgAdrSpeed[16];         // the ground speed before the boost
var int CfgBeh[16];                // behaviour traits (btrt, mod 0.10.0): 1 vulture, 2 kamikaze,
                                   // 4 berserker, 8 revenant, 16 bounty hunter
var byte CfgAggr[16];              // 1 = the hurt bot's aggressiveness was changed by a trait
var byte CfgVal[16];               // values traits as curve edges (btrt, mod 0.14.0): 1 steady
                                   // hand, 2 watchdog, 4 side-stepper, 8 patient hunter, 16
                                   // eagle eye, 32 all-rounder, 0.15.0: 64 daredevil, 128
                                   // bouncer (TourneySkillCurve.SetEdges)
var string CfgAvenge[16];          // revenant: its last killer
                                   // mod 0.11.0: 32 sniper's nest, 64 team player, 128 shuffle
                                   // dancer, 256 item controller
var NavigationPoint CfgNest[16];   // sniper's nest: the nest it heads for
var NavigationPoint CfgLastNest[16];
var float CfgNestUntil[16];        // gives up the way there then
var float CfgNestNext[16];         // no new nest before then
var float CfgDanceNext[16];        // shuffle dancer: next dodge not before then
var byte CfgDanceSide[16];
var Inventory CfgItem[16];         // item controller: the item it heads for or waits at
// Mod 0.17.0: trait log. Per bot configuration c and tracked trait t (0-14, see TrCode) at
// c * 15 + t: whether an episode runs, since when, and the game's counters.
var byte TrOn[240];
var float TrSince[240], TrSec[240];
var int TrAct[240], TrKills[240], TrDeaths[240], TrVal[240], TrVal2[240], TrEpK[240];
var int TrStartSec[240];           // game second the episode began (StGameSec, pauses excluded)
var float TrLast[240];             // last time the condition held (traits that flicker end 3 s later)
var bool bTrFinal;                 // SendTraitStats runs: "tv" lines are kept for a resend
var float CfgPhxAt[16];            // phoenix: when it rose
var int CfgFocus[16];              // mod 0.17.0: Monster Hunt focus of its manager, -2 hunter .. 2 sprinter
var float CfgItemUntil[16];
var float CfgItemNext[16];
var NavigationPoint Nest[12];      // high points with a view (sniper's nest), found once per map
var int NestScore[12];
var int NestCount;
var bool bNestsDone;
var Inventory PowItem[16];         // armour, shield belts, damage amplifiers of the map
var float PowBack[16];             // when a taken one is back (0 = it is there)
var int PowCount;
var bool bPowDone;
var byte SayCfg[192];              // chat lines: bot (index into Cfg*), occasion, text
var string SayKind[192];
var string SayText[192];
var int SayCount;
var byte RivCfg[96];               // rivals: bot, rival's name in the game, 1 rival / 2 nemesis
var string RivName[96];
var byte RivLevel[96];
var int RivCount;
var string DedTo[64];              // dedications (ded): player's name, kill/death, line
var string DedKind[64];
var string DedText[64];
var int DedCount;
var float NextBotSay;              // no bot line before this time (all bots)
var int StartTalkLeft;             // seconds after the start in which bots may greet
var int HuntTicks;
// Bot AI help (match line "ai"): 0 off, 1 failsafe, 2 also the duel mode (one on one).
var int AiLevel;
var bool bSkillCurve;              // mod 0.13.0: bots on the tournament's skill curve (match "sc")
var TourneySkillCurve Curve;
var Bot IdleBot[32];               // bots watched for standing still
var vector IdleLoc[32];            // where the bot stood when the watch (re)started
var float IdleSince[32];           // since then it did not move away
var float FreeSince[32];           // since then it had no enemy
var byte IdleStage[32];            // 0 nothing done, 1 sent after an opponent, 2 sent wandering
var int IdleCount;
var vector StuckRef[32];           // where the bot last made progress (150 units, mod 0.10.1)
var int StuckSec[32];              // seconds trying to move without progress
var byte StuckSide[32];            // side of the next jump aside
var vector AreaRef[32];            // centre of the area (300 units) the bot has not left
var float AreaSince[32];           // since then (not counted while it fights or camps)
var byte AreaStage[32];            // 0 nothing done, 1 and 2 detours, 3 respawned
var Pawn HuntFor[32];              // target of a hunt this mod started
var float HuntCheckAt[32];         // when the hunt's progress is checked next
var float HuntDist[32];            // distance to the target at the last check
var float HuntBlock[32];           // no hunts from this mod before this time
var byte NoPathN[32];              // hunts refused in a row for lack of a path (mod 0.12.1)
var byte NoPathStay[32];           // 1: stayed once, no start spot had a path to an opponent
var Actor StuckGoal[32];           // where the bot was heading when it last got stuck
var float StuckAt[32];             // when that was
var byte StuckRep[32];             // times in a row stuck heading there (within 60 s each)
var float MeleeHit[32];            // when the bot last hurt someone (mod 0.15.0)
var byte MeleeSec[32];             // seconds with only a melee weapon and its enemy out of reach
var Pawn MeleeSkip[32];            // an enemy it leaves alone until MeleeSkipUntil
var float MeleeSkipUntil[32];

//=============================================================================
// Startup (from the game type)
//=============================================================================

// Called by the game's InitGame: tournament defaults, then the cached match (map changes).
// Subclasses must not use Game before this (it is set right after the core is spawned).
function OnInitGame()
{
	// Scoreboard and server browser show the game type with the mod version (GameInfo copies it
	// into the GameReplicationInfo in PostBeginPlay).
	Game.GameName = Game.default.GameName @ "v" $ MOD_VERSION;
	Game.MinPlayers = 0;
	Game.MaxPlayers = Max(Game.MaxPlayers, 4);
	Game.RemainingBots = 0;
	Game.bMuteSpectators = false; // spectators must be able to type !vote and !standings
	// Hold everybody in the waiting state until the bridge starts the countdown.
	Game.bNetReady = false;
	Game.bRequireReady = true;
	Game.CountDown = 9999;
	LoadCache();
	ApplyMatchRules();
}

// Called by the game's PostBeginPlay.
function OnPostBeginPlay()
{
	if (OutMsg != None)
		return;
	OutMsg = Spawn(class'TourneyMsg');
	TGRI = Spawn(class'TourneyGRI');
	TGRI.MapName = CurrentMapName();
	TGRI.ModVersion = "UTTourney v" $ MOD_VERSION;
	TMut = Spawn(class'TourneyMutator');
	TMut.Game = self;
	Game.BaseMutator.AddMutator(TMut);
	Game.RegisterMessageMutator(TMut);
	Game.RegisterDamageMutator(TMut);
	// Chat commands come from the listener (it also hears spectators); the mutator only handles "mutate".
	Curve = Spawn(class'TourneySkillCurve');
	if (Curve != None)
	{
		Curve.bOn = bSkillCurve;
		Curve.Init(self);
	}
	ChatListener = Spawn(class'TourneyChatListener');
	if (ChatListener != None)
	{
		ChatListener.Game = self;
		if (ChatListener.PlayerReplicationInfo != None)
		{
			ChatListener.PlayerReplicationInfo.PlayerName = "Tournament";
			ChatListener.PlayerReplicationInfo.bIsSpectator = true;
		}
	}
	else
		Log("could not spawn chat listener, chat commands only work via mutate", 'UTTourney');
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
	local int i;

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
	ResetLiveSent();
	if (PendingEnd != "")
	{
		// result reported while the bridge was unreachable: statistics first, then the end
		for (i = 0; i < PendingStatCount; i++)
			Link.SendLine(PendingStat[i]);
		Link.SendLine(PendingEnd);
	}
}

function Send()
{
	if (Link != None)
		Link.SendLine(OutMsg.Finish());
}

// Mod 0.14.1: a bot class's defaults as UT's setup menu reads them (UMenuPlayerSetupClient,
// UTIndivBotSetupClient): mesh name (its skins start with it), multi-skin flag, voice meta
// class, own voice, default skin. The bridge asks once per class (outside a game) and keeps
// the answer; ok=false: the class does not load, is no bot or has no mesh.
function DescribeModel(int Req, string CName)
{
	local class<Bot> BC;
	local string Reply, MeshName;

	BC = None;
	if (CName != "")
		BC = class<Bot>(DynamicLoadObject(CName, class'Class', true));
	if (BC != None && BC.default.Mesh != None)
	{
		MeshName = GetItemName(string(BC.default.Mesh));
		OutMsg.Begin("model");
		OutMsg.AddInt("i", Req);
		OutMsg.AddBool("ok", true);
		OutMsg.AddStr("m", MeshName);
		OutMsg.AddBool("ms", BC.default.bIsMultiSkinned);
		OutMsg.AddStr("vm", BC.default.VoicePackMetaClass);
		OutMsg.AddStr("v", BC.default.VoiceType);
		OutMsg.AddStr("s", BC.default.DefaultSkinName);
		Reply = OutMsg.Finish();
		// Each value fits the protocol (64 bytes), the whole line too.
		if (Len(Reply) <= 250 && Len(MeshName) <= 64 && Len(BC.default.VoicePackMetaClass) <= 64
			&& Len(BC.default.VoiceType) <= 64 && Len(BC.default.DefaultSkinName) <= 64)
		{
			if (Link != None)
				Link.SendLine(Reply);
			return;
		}
	}
	OutMsg.Begin("model");
	OutMsg.AddInt("i", Req);
	OutMsg.AddBool("ok", false);
	Send();
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
		case "title":
			TGRI.TName = M.Get("name");
			break;
		case "sync":
			bInSync = M.Get("st") == "begin";
			if (bInSync)
			{
				// The snapshot repeats "tready" for teams that are still ready.
				bTeamReadyA = false;
				bTeamReadyB = false;
			}
			else
			{
				SaveCache();
				if (!bJoinsSent)
					SendAllJoins();
				PruneBots();
				ApplyPhase();
			}
			break;
		case "phase":
			Phase = M.Get("p");
			PhaseSec = M.GetInt("sec");
			if (Phase == "vote")
				VoteSecLeft = PhaseSec;
			TGRI.Phase = Phase;
			TGRI.PhaseSec = PhaseSec;
			if (!bInSync)
				ApplyPhase();
			break;
		case "match":
			if (M.Get("mid") != MatchId || M.GetInt("g") != GameNo)
			{
				PendingEnd = "";
				PendingStatCount = 0;
				bTeamReadyA = false;
				bTeamReadyB = false;
			}
			MatchId = M.Get("mid");
			GameNo = M.GetInt("g");
			BestOf = M.GetInt("bo");
			WinsA = M.GetInt("wa");
			WinsB = M.GetInt("wb");
			NameA = M.Get("na");
			NameB = M.Get("nb");
			MatchFragLimit = M.GetInt("fl");
			MatchTimeLimit = M.GetInt("tl");
			TeamSize = Max(1, M.GetInt("ts"));
			MatchFF = M.GetInt("ff");
			AiLevel = Clamp(M.GetInt("ai"), 0, 2);
			// Skill curve: on unless the bridge sends sc=0 (bridges before 0.13.0 send nothing).
			bSkillCurve = M.Get("sc") != "0";
			if (Curve != None)
				Curve.SetOn(bSkillCurve);
			IdleCount = 0;
			// The bot lines follow; bots already in the level are taken over (see AddBotSpec).
			KeepOldBots();
			ClearBotConfigs();
			BotCount = 0;
			TGRI.TeamSize = TeamSize;
			TGRI.MatchId = MatchId;
			TGRI.GameNo = GameNo;
			TGRI.BestOf = BestOf;
			TGRI.WinsA = WinsA;
			TGRI.WinsB = WinsB;
			TGRI.NameA = NameA;
			TGRI.NameB = NameB;
			TGRI.bBotA = false;
			TGRI.bBotB = false;
			if (!bGameLive)
				ApplyMatchRules();
			break;
		case "bcfg":
			i = FindCfg(M.Get("name"), true);
			if (i >= 0)
			{
				CfgSkin[i] = M.Get("skn");
				CfgFace[i] = M.Get("fac");
				CfgVoice[i] = M.Get("vc");
			}
			break;
		case "btr":
			i = FindCfg(M.Get("name"), true);
			if (i >= 0)
			{
				CfgWeapon[i] = M.Get("fw");
				CfgAcc[i] = FClamp(M.GetInt("acc") / 100.0, -1.0, 1.0);
				CfgAlert[i] = FClamp(M.GetInt("alt") / 100.0, -1.0, 1.0);
				CfgStyle[i] = FClamp(M.GetInt("cs") / 100.0, -1.0, 1.0);
				CfgCamp[i] = FClamp(M.GetInt("cmp") / 100.0, 0.0, 1.0);
				CfgStrafe[i] = FClamp(M.GetInt("str") / 100.0, -1.0, 1.0);
				if (M.GetBool("jmp"))
					CfgJump[i] = 1;
				else
					CfgJump[i] = 0;
				CfgTraits[i] = 1;
			}
			break;
		case "btrt":
			i = FindCfg(M.Get("name"), true);
			if (i >= 0)
			{
				CfgBody[i] = byte(ParseGameTraits(M.Get("c")));
				CfgBeh[i] = ParseBehaviourTraits(M.Get("c"));
				CfgVal[i] = byte(ParseValueTraits(M.Get("c")));
				CfgFocus[i] = Clamp(M.GetInt("mf"), -2, 2);
			}
			break;
		case "bpers":
			i = FindCfg(M.Get("name"), true);
			if (i >= 0)
			{
				CfgTalk[i] = Clamp(M.GetInt("tk"), 0, 100);
				ClearPersonality(i);
			}
			break;
		case "bbet":
			i = FindCfg(M.Get("name"), false);
			if (i >= 0)
			{
				if (M.GetBool("w"))
					CfgBet[i] = 1;
				else
					CfgBet[i] = 2;
				CfgBetAmt[i] = M.GetInt("amt");
				CfgBetPick[i] = M.Get("pk");
			}
			break;
		case "bsay":
			i = FindCfg(M.Get("name"), false);
			if (i >= 0 && SayCount < MAXSAY && M.Get("x") != "")
			{
				SayCfg[SayCount] = byte(i);
				SayKind[SayCount] = M.Get("k");
				SayText[SayCount] = M.Get("x");
				SayCount++;
			}
			break;
		case "ded":
			if (DedCount < MAXDED && M.Get("to") != "" && M.Get("x") != "")
			{
				DedTo[DedCount] = M.Get("to");
				DedKind[DedCount] = M.Get("k");
				DedText[DedCount] = M.Get("x");
				DedCount++;
			}
			break;
		case "brv":
			i = FindCfg(M.Get("name"), false);
			if (i >= 0 && RivCount < MAXRIV && M.Get("r") != "")
			{
				RivCfg[RivCount] = byte(i);
				RivName[RivCount] = M.Get("r");
				RivLevel[RivCount] = byte(Clamp(M.GetInt("lv"), 1, 2));
				RivCount++;
			}
			break;
		case "bot":
			AddBotSpec(SideIndex(M.Get("s")), M.Get("name"), M.GetInt("sk"), M.Get("cls"));
			ApplyBotConfig(FindBotPawn(M.Get("name")), M.Get("name"));
			if (TeamSize <= 1)
			{
				TGRI.bBotA = SideHasBot(0);
				TGRI.bBotB = SideHasBot(1);
			}
			break;
		case "botadd":
			// Team games: a stand-in joins the running game right away.
			AddBotSpec(SideIndex(M.Get("s")), M.Get("name"), M.GetInt("sk"), M.Get("cls"));
			ApplyBotConfig(FindBotPawn(M.Get("name")), M.Get("name"));
			if (bBotsSpawned)
				SpawnBots();
			break;
		case "botdel":
			RemoveBot(M.Get("name"));
			break;
		case "tready":
			if (M.Get("s") == "a")
				bTeamReadyA = true;
			else
				bTeamReadyB = true;
			break;
		case "acl":
			AclCount = 0;
			break;
		case "acle":
		case "acladd":
			// Saved at sync end or before travel; no ini write per entry.
			SetAcl(M.Get("tk"), M.Get("name"), M.Get("r"));
			break;
		case "describe":
			DescribeModel(M.GetInt("i"), M.Get("c"));
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
			VoteSecLeft = M.GetInt("sec");
			TGRI.VoteCount = 0;
			// "$" binds weaker than "==" and "&&" in UnrealScript: parenthesize.
			if (Phase == "vote" && (M.Get("mid") $ "/" $ GameNo) == VoteKey)
				break; // same vote again (bridge resync): keep votes and the window state
			VoteKey = M.Get("mid") $ "/" $ GameNo;
			for (i = 0; i < 64; i++)
				TrackVote[i] = "";
			for (i = 0; i < TrackCount; i++)
				if (TrackClient[i] != None)
				{
					TrackClient[i].MyVote = "";
					TrackClient[i].bVoteOpened = false;
				}
			break;
		case "vmap":
			i = M.GetInt("i") - 1;
			if (i >= 0 && i < 32)
			{
				VoteMap[i] = M.Get("map");
				VoteCount = Max(VoteCount, i + 1);
				if (i < 16)
				{
					TGRI.VoteMaps[i] = VoteMap[i];
					TGRI.VoteCount = Min(16, VoteCount);
				}
			}
			break;
		case "vclose":
			ClearAllProgress();
			for (i = 0; i < TrackCount; i++)
				if (TrackClient[i] != None && TrackClient[i].bHasHud)
					TrackClient[i].ClientCloseVote();
			Game.BroadcastMessage("Next map:" @ M.Get("map"), true, 'CriticalEvent');
			break;
		case "travel":
			DoTravel(M.Get("map"), M.Get("opt"));
			break;
		case "cd":
			CountdownLeft = Max(1, M.GetInt("sec"));
			Phase = "countdown";
			// Team games: the bots of this game came with the countdown.
			bBotsSpawned = true;
			SpawnBots();
			PruneBots();
			AutoFollowAll();
			break;
		case "pause":
			SetTourneyPause(M.GetBool("on"), M.Get("why"));
			break;
		case "abort":
			AbortGame(M.Get("w"), M.Get("why"));
			break;
		case "brh":
			BracketCount = 0;
			TGRI.LineCount = 0;
			TGRI.Fmt = M.Get("fmt");
			TGRI.BracketRev++;
			break;
		case "brm":
			AddBracketLine(M);
			break;
		case "sth":
			StandCount = 0;
			TGRI.StandCount = 0;
			TGRI.StandRev++;
			break;
		case "ste":
			AddStandingLine(M);
			break;
		case "say":
			SayTo(M.GetInt("pid"), M.Get("msg"));
			break;
		case "warn":
			WarnPlayer(M.GetInt("pid"), M.Get("msg"));
			break;
		default:
			Log("unknown bridge message" @ T, 'UTTourney');
	}
}

function ApplyPhase()
{
	if (Phase == "vote")
	{
		ReleaseScoreboards();
		ShowVote();
	}
	else if (Phase == "ready")
		SpawnBotsOnce();
	else if (Phase == "finished")
	{
		ReleaseScoreboards();
		ShowFinalStandings(true);
	}
}

//=============================================================================
// Access list and players
//=============================================================================

// Case does not matter: short join codes are typed by hand in the UT console.
function int FindAcl(string Tok)
{
	local int i;
	if (Tok == "")
		return -1;
	for (i = 0; i < AclCount; i++)
		if (AclTok[i] ~= Tok)
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

// Number of players on a side (not counting spectators).
function int SideCount(string SRole)
{
	local int t, n;
	for (t = 0; t < TrackCount; t++)
		if (TrackRole[t] == SRole && TrackPawn[t] != None && !TrackPawn[t].IsA('Spectator'))
			n++;
	return n;
}

// Players of a side who pressed FIRE / typed !ready.
function int SideReadyCount(string SRole)
{
	local int t, n;
	for (t = 0; t < TrackCount; t++)
		if (TrackRole[t] == SRole && TrackPawn[t] != None && !TrackPawn[t].IsA('Spectator') && TrackReady[t] != 0)
			n++;
	return n;
}

function bool SideTaken(string SRole)
{
	return SideCount(SRole) >= Max(1, TeamSize);
}

function int SideIndex(string SRole)
{
	if (SRole == "b")
		return 1;
	return 0;
}

function string SideRole(int Side)
{
	if (Side == 1)
		return "b";
	return "a";
}

// Called by the game's PreLogin (after the engine's checks passed).
function CheckPreLogin(string Options, string Address, out string Error, out string FailCode)
{
	local string Tok;
	Tok = Game.ParseOption(Options, "tk");
	if (Tok == "")
		Tok = TokenForAddress(Address);
	if (FindAcl(Tok) < 0)
	{
		Error = "This server runs a tournament. Join with your personal link from the tournament website.";
		FailCode = "NOTOKEN";
		ReportReject(Game.ParseOption(Options, "Name"), "no token");
		return;
	}
	// Login() has no address; remember it for the token fallback (Login follows PreLogin).
	PendingAddr = Address;
}

// Login, part 1 (before the game's Super.Login): token, role, player or spectator class.
function bool BeginLogin(string Options, out string Error, out class<PlayerPawn> SpawnClass, out string Tok, out string SRole)
{
	local int i;

	Tok = Game.ParseOption(Options, "tk");
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
		return false;
	}
	Tok = AclTok[i]; // as on the access list (the bridge compares it exactly)
	SRole = AclRole[i];
	if ((SRole != "a" && SRole != "b") || SideTaken(SRole))
	{
		SRole = "s";
		SpawnClass = class'Botpack.CHSpectator';
	}
	return true;
}

// Team of a role (team games put the player into it during Super.Login).
function byte TeamOfRole(string SRole)
{
	if (SRole == "a")
		return 0;
	if (SRole == "b")
		return 1;
	return 255;
}

// Login, part 2 (after the game's Super.Login): name from the access list, tracking.
function PlayerPawn EndLogin(PlayerPawn P, string Tok, string SRole)
{
	local int i;

	if (P == None)
		return None;
	i = FindAcl(Tok);
	if (P.IsA('Spectator'))
		SRole = "s"; // joined with the spectate option
	if (i >= 0)
		Game.ChangeName(P, AclName[i], false);
	AnnounceTeam(P);
	Track(P, Tok, SRole);
	return P;
}

// Team games: "X is on the red team", after the player got the name from the access list.
function AnnounceTeam(Pawn P)
{
}

// Called by the game's PostLogin (after Super.PostLogin).
function OnPostLogin(PlayerPawn NewPlayer)
{
	local int t;

	t = FindTrack(NewPlayer);
	if (t < 0)
		return;
	RememberAddress(NewPlayer.GetPlayerNetworkAddress(), TrackTok[t]);
	if (TrackRole[t] == "a" || TrackRole[t] == "b")
	{
		if (!bGameLive)
			HoldPlayer(NewPlayer);
		else
			RestoreScore(NewPlayer, ScoreKey(t));
	}
	if (bTokenFromAddress && TokenForAddress(NewPlayer.GetPlayerNetworkAddress()) != TrackTok[t])
		Log("token fallback mismatch for" @ NewPlayer.PlayerReplicationInfo.PlayerName, 'UTTourney');
	bTokenFromAddress = false;
	SendJoin(t);
	if (Phase == "vote" && IsMatchPlayerToken(TrackTok[t]))
		ShowVoteTo(NewPlayer);
	else if (Phase == "finished")
		ShowStandings(NewPlayer);
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
	// Server-side only: UE1 sends the state name to the owning client with every movement
	// correction (ClientAdjustPosition), so the client follows on its own.
	P.PlayerRestartState = 'PlayerWaiting';
	P.GotoState('PlayerWaiting');
}

// Called by the game's Logout (before Super.Logout).
function OnLogout(Pawn Exiting)
{
	local int t;
	local string SRole;

	t = FindTrack(PlayerPawn(Exiting));
	if (t >= 0)
	{
		SRole = TrackRole[t];
		if (bGameLive && !Game.bGameEnded && (SRole == "a" || SRole == "b") && TeamSize > 1)
		{
			// Team games go on; the bridge sends a stand-in bot after a while.
			SaveScore(Exiting, TrackTok[t]);
		}
		else if (bGameLive && !Game.bGameEnded && (SRole == "a" || SRole == "b"))
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
}

function Track(PlayerPawn P, string Tok, string SRole)
{
	if (TrackCount >= MAXTRACK)
		return;
	TrackPawn[TrackCount] = P;
	TrackTok[TrackCount] = Tok;
	TrackRole[TrackCount] = SRole;
	TrackReady[TrackCount] = 0;
	TrackVote[TrackCount] = "";
	TrackPanelUntil[TrackCount] = 0;
	TrackVoteAt[TrackCount] = -10;
	TrackClient[TrackCount] = Spawn(class'TourneyClient', P);
	if (TrackClient[TrackCount] != None)
	{
		TrackClient[TrackCount].Game = self;
		TrackClient[TrackCount].MyRole = SRole;
	}
	TrackCount++;
}

function Untrack(int t)
{
	TrackCount--;
	TrackPawn[t] = TrackPawn[TrackCount];
	TrackTok[t] = TrackTok[TrackCount];
	TrackRole[t] = TrackRole[TrackCount];
	TrackReady[t] = TrackReady[TrackCount];
	TrackVote[t] = TrackVote[TrackCount];
	TrackPanelUntil[t] = TrackPanelUntil[TrackCount];
	TrackVoteAt[t] = TrackVoteAt[TrackCount];
	if (TrackClient[t] != None)
		TrackClient[t].Destroy();
	TrackClient[t] = TrackClient[TrackCount];
	TrackClient[TrackCount] = None;
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

// Key under which a player's score is kept while they are away.
function string ScoreKey(int t)
{
	if (TeamSize > 1)
		return TrackTok[t];
	return TrackRole[t];
}

// A pawn playing for a side: its (first) player, else its first bot.
function Pawn SidePawn(int Side)
{
	local Pawn P;
	local int i;
	P = SidePlayer(SideRole(Side));
	if (P != None)
		return P;
	for (i = 0; i < BotCount; i++)
		if (BotSide[i] == Side && BotPawn[i] != None && !BotPawn[i].bDeleteMe)
			return BotPawn[i];
	// Between a "match" line and its "bot" lines the old list still knows the bots.
	for (i = 0; i < OldBotCount; i++)
		if (OldBotSide[i] == Side && OldBotPawn[i] != None && !OldBotPawn[i].bDeleteMe)
			return OldBotPawn[i];
	return None;
}

function bool SideHasBot(int Side)
{
	local int i;
	for (i = 0; i < BotCount; i++)
		if (BotSide[i] == Side)
			return true;
	return false;
}

// Team games: puts a pawn into the team of a side (TourneyCoreTDM). Nothing to do in 1v1.
function AssignTeam(Pawn P, int Side)
{
}

//=============================================================================
// Match flow
//=============================================================================

function ApplyMatchRules()
{
	Game.FragLimit = MatchFragLimit;
	Game.TimeLimit = MatchTimeLimit;
	if (!bGameLive)
		Game.RemainingTime = 60 * Game.TimeLimit;
	if (TournamentGameReplicationInfo(Game.GameReplicationInfo) != None)
	{
		TournamentGameReplicationInfo(Game.GameReplicationInfo).FragLimit = Game.FragLimit;
		TournamentGameReplicationInfo(Game.GameReplicationInfo).TimeLimit = Game.TimeLimit;
	}
	if (Game.GameReplicationInfo != None)
		Game.GameReplicationInfo.RemainingTime = Game.RemainingTime;
}

// 1v1: the bot side waits from the ready check on (team games get their bots with the countdown).
function SpawnBotsOnce()
{
	if (MatchId == "")
		return;
	bBotsSpawned = true;
	SpawnBots();
}

// UT cuts player names to 24 characters (DeathMatchPlus.ChangeName).
function bool SameBotName(string A, string B)
{
	return Left(A, 24) ~= Left(B, 24);
}

// Remembers the current list before a "match" line replaces it.
function KeepOldBots()
{
	local int i;
	for (i = 0; i < BotCount; i++)
	{
		OldBotName[i] = BotName[i];
		OldBotPawn[i] = BotPawn[i];
		OldBotSide[i] = BotSide[i];
	}
	OldBotCount = BotCount;
}

// Adds a bot to the list (or updates it). A bot of the previous list, or of that name in the
// level, is taken over instead of spawning a second one.
function AddBotSpec(int Side, string BName, int BSkill, string BClass)
{
	local int i, j;
	if (BName == "")
		return;
	for (i = 0; i < BotCount; i++)
		if (SameBotName(BotName[i], BName))
			break;
	if (i == BotCount)
	{
		if (BotCount >= MAXBOTS)
			return;
		BotCount++;
		BotPawn[i] = None;
		for (j = 0; j < OldBotCount; j++)
			if (SameBotName(OldBotName[j], BName) && OldBotPawn[j] != None && !OldBotPawn[j].bDeleteMe)
			{
				BotPawn[i] = OldBotPawn[j];
				break;
			}
		if (BotPawn[i] == None)
			BotPawn[i] = FindBotPawn(BName);
	}
	BotName[i] = BName;
	BotSkill[i] = BSkill;
	BotCls[i] = BClass;
	BotSide[i] = Side;
}

function Bot FindBotPawn(string BName)
{
	local Pawn P;
	for (P = Level.PawnList; P != None; P = P.NextPawn)
		if (Bot(P) != None && !P.bDeleteMe && P.PlayerReplicationInfo != None && SameBotName(P.PlayerReplicationInfo.PlayerName, BName))
			return Bot(P);
	return None;
}

// Removes bots that are not on the list any more (team games: the fill bots of a countdown that
// was interrupted). Not after the end of a game: the scoreboard keeps showing them.
function PruneBots()
{
	local Pawn P, Next;
	local int i;
	local bool bListed;

	if (Game.bGameEnded)
		return;
	for (P = Level.PawnList; P != None; P = Next)
	{
		Next = P.NextPawn;
		if (Bot(P) == None || P.bDeleteMe)
			continue;
		bListed = false;
		for (i = 0; i < BotCount; i++)
			if (BotPawn[i] == P)
				bListed = true;
		if (!bListed)
		{
			Log("removing bot" @ P.PlayerReplicationInfo.PlayerName @ "(not in the match any more)", 'UTTourney');
			P.Destroy();
		}
	}
	OldBotCount = 0;
}

// Team games: a stand-in leaves because the player is back.
function RemoveBot(string BName)
{
	local int i, j;
	local Bot B;
	for (i = 0; i < BotCount; i++)
		if (SameBotName(BotName[i], BName))
			break;
	if (i == BotCount)
		return;
	B = BotPawn[i];
	if (B == None)
		B = FindBotPawn(BName);
	for (j = i; j < BotCount - 1; j++)
	{
		BotName[j] = BotName[j + 1];
		BotSkill[j] = BotSkill[j + 1];
		BotCls[j] = BotCls[j + 1];
		BotSide[j] = BotSide[j + 1];
		BotPawn[j] = BotPawn[j + 1];
	}
	BotCount--;
	BotPawn[BotCount] = None;
	if (B != None)
	{
		Log("removing stand-in bot" @ BName, 'UTTourney');
		B.Destroy();
	}
}

// Spawns every listed bot that is not in the level (yet or any more). While the game runs a new
// bot joins right away: a stand-in, or a bot that vanished (destroyed, kicked, failed spawn).
function SpawnBots()
{
	local int i;
	for (i = 0; i < BotCount; i++)
	{
		if (BotPawn[i] != None && !BotPawn[i].bDeleteMe)
			continue;
		BotPawn[i] = FindBotPawn(BotName[i]);
		if (BotPawn[i] != None || Game.bGameEnded)
			continue;
		BotPawn[i] = SpawnSideBot(BotName[i], BotSkill[i], BotCls[i], BotSide[i]);
		if (BotPawn[i] != None && bGameLive && !bTourneyPaused)
			RespawnMatchPawn(BotPawn[i]);
	}
}

// Bots are held (hidden, in Dying) before the countdown, during a pause and after the end.
// Nobody may bring them back early: SmartStockBots' FastRespawn, for example, respawns every
// bot that has been "dead" for a moment. Our own respawns happen while the game is live.
// The game's RestartPlayer asks this first.
function bool MayRestart(Pawn aPlayer)
{
	return !(Bot(aPlayer) != None && (!bGameLive || bTourneyPaused || Game.bGameEnded));
}


// Spawns listed bots again if they vanished.
function EnsureBots()
{
	if (!bBotsSpawned || Game.bGameEnded)
		return;
	SpawnBots();
}

function int FindBotIndex(string BName)
{
	local int i;
	for (i = 0; i < 32; i++)
		if (Game.BotConfig.GetBotName(i) ~= BName)
			return i;
	return -1;
}

// Spawns a specific configured bot (name, skill 0..7, optional class) for a side, waiting for
// the start.
function Bot SpawnSideBot(string BName, int BSkill, string BClass, int Side)
{
	local NavigationPoint StartSpot;
	local class<Bot> BC;
	local Bot B;
	local int N;

	N = FindBotIndex(BName);
	if (BClass != "")
		BC = class<Bot>(DynamicLoadObject(BClass, class'Class'));
	if (BC == None && N >= 0)
		BC = Game.BotConfig.CHGetBotClass(N);
	if (BC == None)
		BC = class'Botpack.TMale1Bot';
	// Skill curve: the stock classes as the tournament's own (same bot, drifting aim).
	if (Curve != None)
		BC = Curve.BotClassFor(BC);

	StartSpot = Game.FindPlayerStart(None, 255);
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
	B.PlayerReplicationInfo.PlayerID = Game.CurrentID++;
	if (N >= 0)
		Game.BotConfig.CHIndividualize(B, N, Game.NumBots);
	Game.ChangeName(B, BName, false);
	// Tournament skill 0..7 = UT's Novice..Godlike: Bot.InitializeSkill takes exactly that range
	// (0-3 novice skills, 4-7 the full AI with skill 0-3), as the bot menu does.
	B.InitializeSkill(FClamp(BSkill, 0.0, 7.0));
	ApplyBotConfig(B, BName);
	B.ViewRotation = StartSpot.Rotation;
	Game.BroadcastMessage(B.PlayerReplicationInfo.PlayerName $ Game.EnteredMessage, false);
	Game.ModifyBehaviour(B);
	Game.AddDefaultInventory(B);
	Game.NumBots++;
	AssignTeam(B, Side);
	B.GotoState('Dying', 'WaitingForStart');
	Log("spawned bot" @ BName @ "class" @ BC @ "skill" @ BSkill @ "config index" @ N, 'UTTourney');
	return B;
}

// Once a second from the game's Timer. Returns what the game clock does: 0 = stands still
// (before the start, paused: the game calls Super(GameInfo).Timer()), 1 = runs (the game calls
// its Super.Timer(), then LiveTick()).
function int TimerStep()
{
	BridgeTick();
	if (Phase == "ready" && PhaseSec > 0)
		PhaseSec--;
	UpdateGRI();
	if (Phase == "vote")
	{
		VoteTick();
		if (VoteSecLeft > 0)
			VoteSecLeft--;
	}
	if (Phase == "finished")
	{
		if (PhaseSec > 0)
			PhaseSec--;
		ShowFinalStandings(false);
	}
	if (Phase == "ready" || bGameLive)
		EnsureBots();
	if (bGameLive && !bTourneyPaused && !Game.bGameEnded)
	{
		BotTick();
		HuntGuard();
		AntiIdle();
		AdrenalineTick();
		BehaviourTick();
		TraitTelemetryTick();
	}
	if (!bGameLive)
	{
		PreMatchTick();
		return 0;
	}
	if (bTourneyPaused)
		return 0;
	return 1;
}

// Copies the per-second state into the replicated TourneyGRI (HUD of the clients).
function UpdateGRI()
{
	local int t;

	if (TGRI == None)
		return;
	TGRI.Phase = Phase;
	if (Phase == "vote")
		TGRI.PhaseSec = VoteSecLeft;
	else if (Phase == "countdown")
		TGRI.PhaseSec = CountdownLeft;
	else if (Phase == "ready" || Phase == "finished")
		TGRI.PhaseSec = PhaseSec;
	else
		TGRI.PhaseSec = -1;
	TGRI.ScoreA = SideScore(0);
	TGRI.ScoreB = SideScore(1);
	TGRI.TeamSize = Max(1, TeamSize);
	if (TeamSize > 1)
	{
		// Team games: how many are here and ready; the bridge decides when a team is ready.
		TGRI.ReadyA = SideReadyCount("a");
		TGRI.ReadyB = SideReadyCount("b");
		TGRI.PresentA = SideCount("a");
		TGRI.PresentB = SideCount("b");
		TGRI.TeamReadyA = 0;
		TGRI.TeamReadyB = 0;
		if (bTeamReadyA)
			TGRI.TeamReadyA = 1;
		if (bTeamReadyB)
			TGRI.TeamReadyB = 1;
	}
	else
	{
		TGRI.ReadyA = ReadyFlag("a", SideHasBot(0));
		TGRI.ReadyB = ReadyFlag("b", SideHasBot(1));
	}
	TGRI.bPaused = bTourneyPaused || Phase == "paused";
	for (t = 0; t < TrackCount; t++)
		if (TrackClient[t] != None)
		{
			TrackClient[t].bVoter = Phase == "vote" && IsMatchPlayerToken(TrackTok[t]);
			TrackClient[t].bReadyMe = TrackReady[t] != 0;
		}
}

function byte ReadyFlag(string SRole, bool bBot)
{
	local int t;
	if (bBot)
		return 1;
	t = FindTrack(SidePlayer(SRole));
	if (t < 0)
		return 0;
	return TrackReady[t];
}

function bool IsVoter(PlayerPawn P)
{
	local int t;
	t = FindTrack(P);
	return Phase == "vote" && t >= 0 && IsMatchPlayerToken(TrackTok[t]);
}

function bool HasHud(int t)
{
	return t >= 0 && TrackClient[t] != None && TrackClient[t].bHasHud;
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
			if (PanelActive(t))
				continue;
			P.ClearProgressMessages();
			P.SetProgressTime(2);
			P.SetProgressMessage(MatchTitle(), 0);
			if (TrackReady[t] != 0 && TeamSize > 1)
				P.SetProgressMessage("You are ready. Waiting for the others...", 1);
			else if (TrackReady[t] != 0)
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
	Game.bRequireReady = false;
	Game.CountDown = 0;
	Game.bNetReady = false;
	ApplyMatchRules();
	bGameLive = true;
	bEndReported = false;
	ResetGameTraits();
	LastSentA = -1;
	StartTalkLeft = 8;
	HuntTicks = 0;
	NextBotSay = Level.TimeSeconds + SAYGAP;
	LastSentB = -1;
	Game.StartMatch();
	AutoFollowAll();
	OutMsg.Begin("live");
	OutMsg.AddStr("mid", MatchId);
	OutMsg.AddInt("g", GameNo);
	Send();
}

function LiveTick()
{
	local int A, B;
	if (Game.bGameEnded)
		return;
	StatTick();
	LiveDataTick();
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
		if (Game.TimeLimit > 0)
			OutMsg.AddInt("tl", Game.RemainingTime);
		else
			OutMsg.AddInt("tl", -1);
		OutMsg.AddBool("ot", Game.bOverTime);
		Send();
	}
}

function int SideScore(int Side)
{
	local Pawn P;
	local int i;
	P = SidePawn(Side);
	if (P != None && P.PlayerReplicationInfo != None)
		return int(P.PlayerReplicationInfo.Score);
	i = FindSaved(SideRole(Side));
	if (i >= 0)
		return int(SavedScore[i]);
	return 0;
}

//-----------------------------------------------------------------------------
// Player statistics

// Once a second while the game is live: time in the game for everyone on a side.
function StatTick()
{
	local Pawn P;
	local int i;

	if (!bGameLive || bEndReported || bTourneyPaused)
		return;
	StGameSec++;
	for (P = Level.PawnList; P != None; P = P.NextPawn)
	{
		i = StatIndex(P, true);
		if (i >= 0)
			StSec[i]++;
	}
}

// Side of a player or bot: team games by team, one on one by role (players) or bot side.
function byte StatSide(Pawn P)
{
	local int i, t;

	if (TeamSize > 1)
		return Min(P.PlayerReplicationInfo.Team, 1);
	if (PlayerPawn(P) != None)
	{
		t = FindTrack(PlayerPawn(P));
		if (t >= 0 && TrackRole[t] == "b")
			return 1;
		return 0;
	}
	for (i = 0; i < BotCount; i++)
		if (BotName[i] ~= P.PlayerReplicationInfo.PlayerName)
			return BotSide[i];
	return Min(P.PlayerReplicationInfo.Team, 1);
}

// Statistics slot of a player (by token) or bot (by name); -1 for spectators, monsters and
// players without a tracked token. bCreate adds a slot.
function int StatIndex(Pawn P, bool bCreate)
{
	local int i, t;
	local string Key, BName;

	if (P == None || P.bDeleteMe || !P.bIsPlayer || P.PlayerReplicationInfo == None || P.IsA('ScriptedPawn')
		|| P.IsA('Spectator') || P.PlayerReplicationInfo.bIsSpectator)
		return -1;
	if (PlayerPawn(P) != None)
	{
		t = FindTrack(PlayerPawn(P));
		if (t < 0 || TrackTok[t] == "" || TrackRole[t] == "s")
			return -1;
		Key = TrackTok[t];
	}
	else if (Bot(P) != None)
		BName = P.PlayerReplicationInfo.PlayerName;
	else
		return -1;
	for (i = 0; i < StCount; i++)
		if ((Key != "" && StKey[i] == Key) || (Key == "" && StKey[i] == "" && StBot[i] ~= Left(BName, 32)))
		{
			StPawn[i] = P;
			return i;
		}
	if (!bCreate || StCount >= MAXST)
		return -1;
	BName = Left(BName, 32); // the protocol's name limit
	i = StCount;
	StCount++;
	StKey[i] = Key;
	StBot[i] = BName;
	StPawn[i] = P;
	StSide[i] = StatSide(P);
	return i;
}

// From the game's Killed (before Super): counts the kill and sends it to the kill feed.
function OnKilled(Pawn Killer, Pawn Other, name DamageType)
{
	if (!bGameLive || bEndReported || bTourneyPaused || Game.bGameEnded)
		return;
	FeedFlags = 0;
	FeedSpree = 0;
	FeedMulti = 0;
	CountKill(Killer, Other, DamageType);
	SendFeed(Killer, Other, DamageType);
	GameTraitKill(Killer, Other);
}

// Counts kills, deaths and the rest for both pawns; notes the kill feed flags.
function CountKill(Pawn Killer, Pawn Other, name DamageType)
{
	local int v, k;

	BotTalkKill(Killer, Other);
	v = StatIndex(Other, true);
	if (v >= 0)
	{
		StDeaths[v]++;
		StSpree[v] = 0;
		StMulti[v] = 0;
		StLastKill[v] = -1000; // a multi kill ends with the death, as in UT
	}
	if (Killer == None || Killer == Other)
	{
		FeedFlags = FeedFlags | 4;
		if (v >= 0)
			StSuicides[v]++;
		return;
	}
	if (Other.IsA('ScriptedPawn'))
		FeedFlags = FeedFlags | 16;
	k = StatIndex(Killer, true);
	if (k < 0)
		return; // killed by a monster, a spectator's leftovers, ...
	if (Other.IsA('ScriptedPawn'))
	{
		StMon[k]++; // Monster Hunt
		AddWeaponKill(k, WeaponName(Killer, DamageType));
		return;
	}
	if (v < 0)
		return;
	if (!bFirstBlood)
	{
		bFirstBlood = true; // like UT's message: any kill of another player, team kills too
		StFirst[k] = 1;
		FeedFlags = FeedFlags | 2;
	}
	if ((TeamSize > 1 || Game.bTeamGame) && Killer.PlayerReplicationInfo.Team == Other.PlayerReplicationInfo.Team)
	{
		FeedFlags = FeedFlags | 8;
		StTeamKills[k]++;
		return;
	}
	StKills[k]++;
	if (DamageType == 'Decapitated')
	{
		StHead[k]++;
		FeedFlags = FeedFlags | 1;
	}
	StSpree[k]++;
	if (StSpree[k] > StBestSpree[k])
		StBestSpree[k] = StSpree[k];
	if (StSpree[k] == 5)
		StSprees[k]++;
	// UT's multi kill rule: kills less than 3 seconds apart
	if (Level.TimeSeconds - StLastKill[k] < 3)
	{
		StMulti[k]++;
		if (StMulti[k] == 1)
			StM2[k]++;
		else if (StMulti[k] == 2)
			StM3[k]++;
		else if (StMulti[k] == 3)
			StM4[k]++;
		else
			StM5[k]++;
	}
	else
		StMulti[k] = 0;
	StLastKill[k] = Level.TimeSeconds;
	FeedSpree = StSpree[k];
	if (StMulti[k] > 0)
		FeedMulti = StMulti[k] + 1;
	AddWeaponKill(k, WeaponName(Killer, DamageType));
}

// Name of a pawn in the kill feed: the player's name, else the monster's.
function string FeedName(Pawn P)
{
	local string S;

	if (P == None)
		return "";
	if (P.PlayerReplicationInfo != None)
		return P.PlayerReplicationInfo.PlayerName;
	S = P.MenuName;
	if (S == "")
		S = string(P.Class.Name);
	return S;
}

// Side of a pawn in the kill feed: 0 = a, 1 = b, 2 = none (monster).
function int FeedSide(Pawn P)
{
	if (P == None || P.PlayerReplicationInfo == None)
		return 2;
	return StatSide(P);
}

// Kill feed (mod 0.7.3): one kf line per kill of a player or by a player. Flags: 1 headshot,
// 2 first blood, 4 suicide, 8 team kill, 16 monster killed; sp = killer's spree, mk = multi kill.
function SendFeed(Pawn Killer, Pawn Other, name DamageType)
{
	local Pawn K;

	K = Killer;
	if (K == Other)
		K = None;
	if (Other == None)
		return;
	// Monsters killing monsters are no news.
	if (Other.PlayerReplicationInfo == None && (K == None || K.PlayerReplicationInfo == None))
		return;
	if (K != None && K.FindInventoryType(class'Botpack.UDamage') != None)
		FeedFlags = FeedFlags | 32;
	OutMsg.Begin("kf");
	OutMsg.AddStr("mid", MatchId);
	OutMsg.AddInt("g", GameNo);
	OutMsg.AddStr("k", OutMsg.FitWire(FeedName(K), 32));
	OutMsg.AddInt("ks", FeedSide(K));
	OutMsg.AddStr("v", OutMsg.FitWire(FeedName(Other), 32));
	OutMsg.AddInt("vs", FeedSide(Other));
	if (K != None)
		OutMsg.AddStr("w", OutMsg.FitWire(WeaponName(K, DamageType), 24));
	else
		OutMsg.AddStr("w", OutMsg.FitWire(string(DamageType), 24));
	OutMsg.AddInt("f", FeedFlags);
	OutMsg.AddInt("sp", FeedSpree);
	OutMsg.AddInt("mk", FeedMulti);
	if (K != None)
	{
		OutMsg.AddInt("kh", Max(K.Health, 0));
		OutMsg.AddInt("kd", int(VSize(K.Location - Other.Location)));
	}
	else
		OutMsg.AddInt("kh", -1);
	Send();
}

function string WeaponName(Pawn Killer, name DamageType)
{
	local string S;

	if (Killer.Weapon != None)
	{
		S = Killer.Weapon.ItemName;
		if (S == "")
			S = string(Killer.Weapon.Class.Name);
	}
	else
		S = string(DamageType);
	return Left(S, 32);
}

function AddWeaponKill(int k, string W)
{
	local int j, Base;

	if (W == "")
		return;
	Base = k * MAXW;
	for (j = 0; j < MAXW; j++)
	{
		if (StWName[Base + j] == W)
		{
			StWCount[Base + j]++;
			return;
		}
		if (StWName[Base + j] == "")
		{
			StWName[Base + j] = W;
			StWCount[Base + j] = 1;
			return;
		}
	}
}

// Sends the statistics of this game (N = 0) or Monster Hunt run (N = run), before end/runend.
function SendStats(int N, int Sec)
{
	local int i, j;

	PendingStatCount = 0;
	for (i = 0; i < StCount; i++)
	{
		OutMsg.Begin("ps");
		OutMsg.AddStr("mid", MatchId);
		OutMsg.AddInt("g", GameNo);
		OutMsg.AddInt("n", N);
		OutMsg.AddInt("i", i);
		OutMsg.AddStr("tk", StKey[i]);
		OutMsg.AddStr("bn", StBot[i]);
		OutMsg.AddStr("s", SideRole(StSide[i]));
		OutMsg.AddInt("k", StKills[i]);
		OutMsg.AddInt("d", StDeaths[i]);
		OutMsg.AddInt("su", StSuicides[i]);
		OutMsg.AddInt("tm", StTeamKills[i]);
		OutMsg.AddInt("sec", StSec[i]);
		SendStat();
		OutMsg.Begin("px");
		OutMsg.AddStr("mid", MatchId);
		OutMsg.AddInt("g", GameNo);
		OutMsg.AddInt("n", N);
		OutMsg.AddInt("i", i);
		OutMsg.AddInt("hs", StHead[i]);
		OutMsg.AddBool("fb", StFirst[i] != 0);
		OutMsg.AddInt("bs", StBestSpree[i]);
		OutMsg.AddInt("sp", StSprees[i]);
		OutMsg.AddInt("m2", StM2[i]);
		OutMsg.AddInt("m3", StM3[i]);
		OutMsg.AddInt("m4", StM4[i]);
		OutMsg.AddInt("m5", StM5[i]);
		OutMsg.AddInt("mk", StMon[i]);
		OutMsg.AddInt("mp", StatPoints(i));
		OutMsg.AddInt("dd", StDmgOut[i]);
		OutMsg.AddInt("dt", StDmgIn[i]);
		OutMsg.AddInt("ua", StAmp[i]);
		OutMsg.AddInt("ub", StBelt[i]);
		OutMsg.AddInt("ur", StArmor[i]);
		OutMsg.AddInt("uk", StKeg[i]);
		SendStat();
		for (j = 0; j < MAXW; j++)
		{
			if (StWName[i * MAXW + j] == "")
				break;
			OutMsg.Begin("pw");
			OutMsg.AddStr("mid", MatchId);
			OutMsg.AddInt("g", GameNo);
			OutMsg.AddInt("n", N);
			OutMsg.AddInt("i", i);
			OutMsg.AddStr("w", StWName[i * MAXW + j]);
			OutMsg.AddInt("c", StWCount[i * MAXW + j]);
			SendStat();
		}
	}
	SendTraitStats(N);
	OutMsg.Begin("pse");
	OutMsg.AddStr("mid", MatchId);
	OutMsg.AddInt("g", GameNo);
	OutMsg.AddInt("n", N);
	OutMsg.AddInt("c", StCount);
	OutMsg.AddInt("sec", Sec);
	SendStat();
}

// Sends a statistics line and keeps it for a resend with PendingEnd.
function SendStat()
{
	local string Line;

	Line = OutMsg.Finish();
	if (PendingStatCount < 260)
	{
		PendingStat[PendingStatCount] = Line;
		PendingStatCount++;
	}
	if (Link != None)
		Link.SendLine(Line);
}

// Monster points of a slot (Monster Hunt overrides it); 0 in deathmatch.
function int StatPoints(int i)
{
	return 0;
}

//-----------------------------------------------------------------------------
// Live data (mod 0.16.0): roster (lr), state (st), counters (sx), items (pk), bots (bt)

// The run for the live lines: 0 in deathmatch (Monster Hunt: the run).
function int LiveRun()
{
	return 0;
}

// Once a second while the game is live, after StatTick.
function LiveDataTick()
{
	local Pawn P;
	local int i;
	local bool bCounters;

	if (!bGameLive || bEndReported || bTourneyPaused || Game.bGameEnded)
		return;
	CounterTicks++;
	bCounters = CounterTicks >= 5;
	if (bCounters)
		CounterTicks = 0;
	for (P = Level.PawnList; P != None; P = P.NextPawn)
	{
		i = StatIndex(P, true);
		if (i < 0)
			continue;
		if (StListed[i] == 0)
			SendRoster(i, P);
		SendLiveState(i, P);
		if (Bot(P) != None)
			SendThought(i, Bot(P));
	}
	CheckPickups(); // after the roster: a pk line never comes before its lr line
	if (bCounters)
		for (i = 0; i < StCount; i++)
			if (StListed[i] != 0 && StPawn[i] != None && !StPawn[i].bDeleteMe)
				SendCounters(i);
}

// After a reconnect to the bridge: roster and state go out again.
function ResetLiveSent()
{
	local int i;
	for (i = 0; i < StCount; i++)
	{
		StListed[i] = 0;
		StLastSt[i] = "";
	}
}

function LiveHead(string T, int i)
{
	OutMsg.Begin(T);
	OutMsg.AddStr("mid", MatchId);
	OutMsg.AddInt("g", GameNo);
	OutMsg.AddInt("n", LiveRun());
	OutMsg.AddInt("i", i);
}

function SendRoster(int i, Pawn P)
{
	StListed[i] = 1;
	LiveHead("lr", i);
	OutMsg.AddStr("nm", OutMsg.FitWire(P.PlayerReplicationInfo.PlayerName, 32));
	OutMsg.AddInt("sd", StSide[i]);
	OutMsg.AddBool("b", StKey[i] == "");
	OutMsg.AddStr("tk", StKey[i]);
	Send();
}

// Alive, health, armour (all armour charges, as the HUD adds them), weapon, powerups.
function SendLiveState(int i, Pawn P)
{
	local Inventory Inv;
	local int ArmorSum, Pu, Ut, n;
	local bool bAlive;
	local string Line, W;

	bAlive = P.Health > 0 && !P.IsInState('Dying');
	if (bAlive)
	{
		for (Inv = P.Inventory; Inv != None && n < 100; Inv = Inv.Inventory)
		{
			n++;
			if (Inv.bIsAnArmor)
				ArmorSum += Inv.Charge;
			if (UDamage(Inv) != None)
			{
				// what is left: the running timer, then its final count of seconds
				Pu = Pu | 1;
				Ut = Max(0, int(Inv.TimerRate - Inv.TimerCounter + 0.5) + UDamage(Inv).FinalCount);
			}
			else if (UT_ShieldBelt(Inv) != None && Inv.Charge > 0)
				Pu = Pu | 2;
			else if (UT_Invisibility(Inv) != None && Inv.bActive)
				Pu = Pu | 4;
			else if (UT_JumpBoots(Inv) != None)
				Pu = Pu | 8;
		}
		if (P.Weapon != None)
		{
			W = P.Weapon.ItemName;
			if (W == "")
				W = string(P.Weapon.Class.Name);
		}
	}
	LiveHead("st", i);
	OutMsg.AddBool("al", bAlive);
	if (bAlive)
		OutMsg.AddInt("h", P.Health);
	else
		OutMsg.AddInt("h", 0);
	OutMsg.AddInt("a", Max(ArmorSum, 0));
	OutMsg.AddStr("w", OutMsg.FitWire(W, 24));
	OutMsg.AddInt("pu", Pu);
	OutMsg.AddInt("ut", Ut);
	Line = OutMsg.Finish();
	if (Line == StLastSt[i] && Level.TimeSeconds - StStAt[i] < 5)
		return;
	StLastSt[i] = Line;
	StStAt[i] = Level.TimeSeconds;
	if (Link != None)
		Link.SendLine(Line);
}

// Every 5 s: counters since the start of the game (run), ping and packet loss of players.
function SendCounters(int i)
{
	local Pawn P;
	local int Pg, Pl;

	P = StPawn[i];
	if (PlayerPawn(P) != None && !P.bDeleteMe && P.PlayerReplicationInfo != None)
	{
		Pg = P.PlayerReplicationInfo.Ping;
		Pl = P.PlayerReplicationInfo.PacketLoss;
	}
	LiveHead("sx", i);
	OutMsg.AddInt("k", StKills[i]);
	OutMsg.AddInt("d", StDeaths[i]);
	OutMsg.AddInt("su", StSuicides[i]);
	OutMsg.AddInt("dd", StDmgOut[i]);
	OutMsg.AddInt("dt", StDmgIn[i]);
	OutMsg.AddInt("pg", Max(Pg, 0));
	OutMsg.AddInt("pl", Max(Pl, 0));
	OutMsg.AddInt("mk", StMon[i]); // mod 0.17.0: monsters killed (Monster Hunt)
	Send();
}

// What a bot is up to (its state and target), when it changed and at most every 5 s.
function SendThought(int i, Bot B)
{
	local name St;
	local string S, Tg;
	local Inventory Itm;

	if (B.Health <= 0)
		return;
	St = B.GetStateName();
	if (St == 'Attacking' || St == 'RangedAttack' || St == 'Acquisition')
		S = "atk";
	else if (St == 'Charging')
		S = "chg";
	else if (St == 'TacticalMove')
		S = "tac";
	else if (St == 'Retreating' || St == 'Fallback')
		S = "ret";
	else if (St == 'Hunting')
		S = "hunt";
	else if (St == 'StakeOut' || St == 'Hold' || St == 'Holding')
		S = "camp";
	else if (St == 'Roaming' || St == 'Wandering')
		S = "roam";
	else
		return; // falling, hit, jumping, dying: nothing new
	// the item it walks to: the item itself when close, else the marked item of the path node
	Itm = Inventory(B.MoveTarget);
	if (Itm == None && InventorySpot(B.MoveTarget) != None)
		Itm = InventorySpot(B.MoveTarget).markedItem;
	if ((S == "roam" || S == "ret") && Itm != None)
	{
		if (S == "roam")
			S = "item";
		Tg = Itm.ItemName;
		if (Tg == "")
			Tg = string(Itm.Class.Name);
	}
	else if (S != "roam" && S != "ret" && B.Enemy != None)
		Tg = FeedName(B.Enemy);
	if (S == StBState[i] && Tg == StBTarget[i])
		return;
	if (Level.TimeSeconds - StBAt[i] < 5)
		return;
	StBState[i] = S;
	StBTarget[i] = Tg;
	StBAt[i] = Level.TimeSeconds;
	LiveHead("bt", i);
	OutMsg.AddStr("s", S);
	OutMsg.AddStr("tg", OutMsg.FitWire(Tg, 32));
	Send();
}

// From the mutator's HandlePickupQuery: a pawn touches an item; whether it took it is checked
// in the next tick (the query comes before the item decides, health packs check health).
function OnPickupQuery(Pawn P, Inventory Item)
{
	local int j;
	local string Code;

	if (!bGameLive || bTourneyPaused || P == None || Item == None || PkCount >= 8)
		return;
	Code = PickupCode(Item);
	if (Code == "")
		return;
	for (j = 0; j < PkCount; j++)
		if (PkPawn[j] == P && PkItem[j] == Item)
			return;
	PkPawn[PkCount] = P;
	PkItem[PkCount] = Item;
	PkCode[PkCount] = Code;
	PkHealth[PkCount] = P.Health;
	PkAt[PkCount] = Level.TimeSeconds;
	PkCount++;
}

function string PickupCode(Inventory Item)
{
	if (UDamage(Item) != None)
		return "amp";
	if (UT_ShieldBelt(Item) != None)
		return "belt";
	if (Armor2(Item) != None)
		return "armor";
	if (HealthPack(Item) != None)
		return "keg";
	if (UT_Invisibility(Item) != None)
		return "invis";
	if (UT_JumpBoots(Item) != None)
		return "boots";
	if (WarheadLauncher(Item) != None)
		return "redeemer";
	return "";
}

// Taken = the item is gone, owned by the pawn or sleeps until its respawn, and the pawn has it
// (a keg: it was below the keg's limit; a pawn that died since: the item went). Queries from
// before a pause are dropped.
function CheckPickups()
{
	local int j, i;
	local Pawn P;
	local Inventory Itm;
	local bool bTaken;

	for (j = 0; j < PkCount; j++)
	{
		P = PkPawn[j];
		Itm = PkItem[j];
		PkPawn[j] = None;
		PkItem[j] = None;
		if (P == None || P.bDeleteMe || Level.TimeSeconds - PkAt[j] > 2.5)
			continue;
		bTaken = Itm == None || Itm.bDeleteMe || Itm.Owner == P || Itm.IsInState('Sleeping');
		if (!bTaken || (P.Health > 0 && !HasPickup(P, PkCode[j], PkHealth[j])))
			continue;
		i = StatIndex(P, true);
		if (i < 0)
			continue;
		CountPickup(i, PkCode[j]);
		LiveHead("pk", i);
		OutMsg.AddStr("it", PkCode[j]);
		Send();
	}
	PkCount = 0;
}

function bool HasPickup(Pawn P, string Code, int HealthBefore)
{
	if (Code == "keg")
		return HealthBefore < Min(199, 2 * P.default.Health); // HealthPack (super heal) takes it then
	if (Code == "amp")
		return P.FindInventoryType(class'Botpack.UDamage') != None;
	if (Code == "belt")
		return P.FindInventoryType(class'Botpack.UT_ShieldBelt') != None;
	if (Code == "armor")
		return P.FindInventoryType(class'Botpack.Armor2') != None;
	if (Code == "invis")
		return P.FindInventoryType(class'Botpack.UT_Invisibility') != None;
	if (Code == "boots")
		return P.FindInventoryType(class'Botpack.UT_JumpBoots') != None;
	return P.FindInventoryType(class'Botpack.WarheadLauncher') != None;
}

function CountPickup(int i, string Code)
{
	if (Code == "amp")
		StAmp[i]++;
	else if (Code == "belt")
		StBelt[i]++;
	else if (Code == "armor")
		StArmor[i]++;
	else if (Code == "keg")
		StKeg[i]++;
}

// From the mutator's MutatorTakeDamage after the other damage mutators: damage as it reaches the
// health (armour already took its part), at most
// the health left. Team damage is no damage dealt.
function CountDamage(int Dmg, Pawn Victim, Pawn InstigatedBy)
{
	local int v, k;

	if (!bGameLive || bEndReported || bTourneyPaused || Game.bGameEnded || Victim == None)
		return;
	Dmg = Min(Dmg, Max(Victim.Health, 0));
	if (Dmg <= 0)
		return;
	v = StatIndex(Victim, true);
	if (v >= 0)
		StDmgIn[v] += Dmg;
	if (InstigatedBy == None || InstigatedBy == Victim)
		return;
	k = StatIndex(InstigatedBy, true);
	if (k < 0)
		return;
	if (v >= 0 && TeamSize > 1 && StSide[v] == StSide[k])
		return;
	StDmgOut[k] += Dmg;
}

// Called by the game's EndGame (after Super.EndGame).
function OnEndGame(string Reason, bool bWasOvertime)
{
	if (Game.bGameEnded && bGameLive && !bEndReported)
		ReportEnd(Reason, bWasOvertime);
}

function ReportEnd(string Reason, bool bWasOvertime)
{
	local int A, B;
	local string Why;

	A = SideScore(0);
	B = SideScore(1);
	SendStats(0, StGameSec); // before bEndReported: the last frag still counted
	bEndReported = true;
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
	if (A > B)
		BotTalkEnd(0);
	else if (B > A)
		BotTalkEnd(1);
}

// The bridge ended the game: forfeit, organizer decision ("admin"), match called off ("void")
// or restart. End it without reporting a result.
function AbortGame(string Winner, string Why)
{
	local Pawn P;

	bEndReported = true;
	bTourneyPaused = false;
	if (!Game.bGameEnded)
	{
		// SetEndCams refuses to end a tied game (it starts overtime), so end it directly.
		Game.bGameEnded = true;
		for (P = Level.PawnList; P != None; P = P.NextPawn)
		{
			P.GotoState('GameEnded');
			if (PlayerPawn(P) != None)
				PlayerPawn(P).ClientGameEnded();
		}
	}
	if (Why == "restart")
		Game.BroadcastMessage("The organizer restarts this game", true);
	else if (Why == "runforfeit")
		Game.BroadcastMessage("The organizer ended this run: it counts as not finished", true);
	else if (Why == "void")
		Game.BroadcastMessage("The organizer called this match off", true);
	else if (Why == "admin" && Winner == "a")
		Game.BroadcastMessage(NameA @ "wins (decided by the organizer)", true);
	else if (Why == "admin")
		Game.BroadcastMessage(NameB @ "wins (decided by the organizer)", true);
	else if (Winner == "a")
		Game.BroadcastMessage(NameA @ "wins by forfeit", true);
	else
		Game.BroadcastMessage(NameB @ "wins by forfeit", true);
}


function DoTravel(string MapName, string Opt)
{
	local string URL;
	SaveCache();
	URL = MapName $ "?game=" $ string(Game.Class) $ Opt;
	Log("travel to" @ URL, 'UTTourney');
	Level.ServerTravel(URL, false);
}

// Soft pause. Level.Pauser is not used on purpose: a paused level stops ticking actors, which
// would also stop the bridge connection. Instead the match pawns are held out of play and the
// game clock (DeathMatchPlus.Timer) is not advanced. On resume both sides respawn.
function SetTourneyPause(bool bOn, string Why)
{
	local int t, i;
	local Pawn P;

	if (bOn == bTourneyPaused)
		return;
	// Bot AI help: the clock ran on during the pause, start watching anew.
	IdleCount = 0;
	if (bOn)
		TrPauseEnd(); // mod 0.17.0: trait episodes end with the pause
	if (!bOn && bGameLive && !Game.bGameEnded && TeamSize <= 1)
	{
		// 1v1: do not resume while a human side is still missing; tell the bridge again.
		if (!SideHasBot(0) && SidePlayer("a") == None)
		{
			SendLost("a");
			return;
		}
		if (!SideHasBot(1) && SidePlayer("b") == None)
		{
			SendLost("b");
			return;
		}
	}
	bTourneyPaused = bOn;
	if (bOn && TGRI != None)
		TGRI.PauseReason = Why;
	if (!bGameLive || Game.bGameEnded)
		return;
	// Everybody playing: the players of both sides and all bots.
	for (t = 0; t < TrackCount; t++)
	{
		P = TrackPawn[t];
		if (P == None || P.IsA('Spectator') || (TrackRole[t] != "a" && TrackRole[t] != "b"))
			continue;
		if (bOn)
			HoldPlayer(PlayerPawn(P));
		else
			RespawnMatchPawn(P);
	}
	for (i = 0; i < BotCount; i++)
	{
		P = BotPawn[i];
		if (P == None || P.bDeleteMe)
			continue;
		if (bOn)
			P.GotoState('Dying', 'WaitingForStart');
		else
			RespawnMatchPawn(P);
	}
	if (bOn)
		Game.BroadcastMessage("Game paused:" @ Why, true);
	else
		Game.BroadcastMessage("Game resumed", true);
}

// Brings a held match pawn back into play like a normal respawn: leave the waiting state
// (restores mesh, collision and the player flag for the HUD), move to a start spot with the
// default inventory, and tell the client to restart.
function RespawnMatchPawn(Pawn P)
{
	local PlayerPawn PP;

	if (P.IsA('Bot'))
	{
		// Held bots wait in Dying (hidden, ignoring damage). RestartPlayer only moves them;
		// the AI runs again once the bot is back in its normal state.
		if (Game.RestartPlayer(P))
		{
			P.bHidden = false;
			P.Velocity = vect(0, 0, 0);
			P.Acceleration = vect(0, 0, 0);
			P.SetPhysics(PHYS_Falling);
			P.GotoState('Roaming');
		}
		else
			Log("could not respawn bot" @ P.PlayerReplicationInfo.PlayerName, 'UTTourney');
		return;
	}
	PP = PlayerPawn(P);
	if (PP == None)
		return;
	PP.PlayerRestartState = PP.Default.PlayerRestartState;
	PP.GotoState(PP.PlayerRestartState);
	if (Game.RestartPlayer(PP))
		PP.ClientReStart();
	else
		Log("could not respawn" @ PP.PlayerReplicationInfo.PlayerName, 'UTTourney');
}

function int FindSaved(string Key)
{
	local int i;
	for (i = 0; i < MAXSAVED; i++)
		if (SavedKey[i] == Key)
			return i;
	return -1;
}

// Keeps the score of a player who dropped (Key: side in 1v1, token in team games).
function SaveScore(Pawn P, string Key)
{
	local int i;
	if (Key == "")
		return;
	i = FindSaved(Key);
	if (i < 0)
		i = FindSaved("");
	if (i < 0)
		i = 0;
	SavedKey[i] = Key;
	SavedScore[i] = P.PlayerReplicationInfo.Score;
	SavedDeaths[i] = P.PlayerReplicationInfo.Deaths;
}

function RestoreScore(PlayerPawn P, string Key)
{
	local int i;
	if (Key == "")
		return;
	i = FindSaved(Key);
	if (i < 0)
		return;
	P.PlayerReplicationInfo.Score = SavedScore[i];
	P.PlayerReplicationInfo.Deaths = SavedDeaths[i];
	SavedKey[i] = "";
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
		{
			ShowVoteTo(TrackPawn[t]);
			if (TrackClient[t] != None)
				TrackClient[t].bVoter = true;
			if (HasHud(t) && !TrackClient[t].bVoteOpened)
			{
				TrackClient[t].bVoteOpened = true;
				TrackClient[t].ClientOpenVote();
			}
		}
	VoteTick();
}

// Big vote panel in the middle of the screen, refreshed every second while the vote runs.
function VoteTick()
{
	local int t, i, Line;
	local string Row, Title;
	local PlayerPawn P;

	Title = "MAP VOTE" @ MatchId $ ":" @ NameA @ "vs" @ NameB @ "-" @ Max(VoteSecLeft, 0) $ "s";
	for (t = 0; t < TrackCount; t++)
	{
		P = TrackPawn[t];
		if (P == None || PanelActive(t))
			continue;
		P.ClearProgressMessages();
		P.SetProgressTime(2);
		P.SetProgressMessage(Title, 0);
		Line = 1;
		Row = "";
		for (i = 0; i < VoteCount && Line < 6; i++)
		{
			Row = Row $ (i + 1) $ ")" @ VoteMap[i] $ "     ";
			if ((i + 1) % 3 == 0)
			{
				P.SetProgressMessage(Row, Line++);
				Row = "";
			}
		}
		if (Row != "" && Line < 6)
			P.SetProgressMessage(Row, Line++);
		if (!IsMatchPlayerToken(TrackTok[t]))
			P.SetProgressMessage("The players are choosing the map.", 7);
		else if (TrackVote[t] != "")
			P.SetProgressMessage("Your vote:" @ TrackVote[t] $ "   (vote again to change)", 7);
		else
			P.SetProgressMessage("Press T and type  !vote 2 1 3  - up to 3 numbers, best first", 7);
	}
}

function ClearAllProgress()
{
	local int t;
	for (t = 0; t < TrackCount; t++)
		if (TrackPawn[t] != None)
			TrackPawn[t].ClearProgressMessages();
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
	else if (Word ~= "vote" || Word ~= "v")
		HandleVote(P, Rest);
	else if (Word ~= "bracket")
	{
		t = FindTrack(P);
		if (HasHud(t))
			TrackClient[t].ClientShowBracket();
		else
			ShowBracket(P);
	}
	else if (Word ~= "standings")
	{
		t = FindTrack(P);
		ShowStandings(P);
		if (HasHud(t))
			TrackClient[t].ClientShowStandings();
		else if (Phase != "finished")
			ShowStandingsPanel(P, 10, "");
	}
	else if (Word ~= "follow")
		FollowCommand(P, Rest);
	else if (Word ~= "fp")
		ToggleFirstPerson(P);
	else if (Word ~= "start")
		SendCmd(P, "start"); // team captain: play now, bots fill missing places (the bridge decides)
	else if (Word ~= "help")
	{
		P.ClientMessage("Commands: !ready  !vote 3 1 5 (or !v, !vote alone opens the window)  !bracket  !standings  !follow [name|off]  !fp");
		if (TeamSize > 1)
			P.ClientMessage("Team captains: !start begins the game with bots for missing players (after a short wait)");
	}
}

function SendCmd(PlayerPawn P, string C)
{
	OutMsg.Begin("cmd");
	OutMsg.AddInt("pid", P.PlayerReplicationInfo.PlayerID);
	OutMsg.AddStr("c", C);
	Send();
}

function HandleVote(PlayerPawn P, string Args)
{
	local string Pick[3], Word;
	local int n, Sp, Num, t;

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
		t = FindTrack(P);
		if (HasHud(t) && IsMatchPlayerToken(TrackTok[t]))
			TrackClient[t].ClientOpenVote();
		return;
	}
	SendVote(P, Pick[0], Pick[1], Pick[2]);
}

// From the vote window (TourneyClient.ServerVote): map names instead of numbers.
function VoteByName(PlayerPawn P, string M1, string M2, string M3)
{
	if (Phase != "vote" || FindTrack(P) < 0 || M1 == "")
		return;
	SendVote(P, M1, M2, M3);
}

function SendVote(PlayerPawn P, string M1, string M2, string M3)
{
	local string Pick[3];
	local int t;

	t = FindTrack(P);
	if (t >= 0)
	{
		if (Level.TimeSeconds - TrackVoteAt[t] < 0.5)
			return;
		TrackVoteAt[t] = Level.TimeSeconds;
	}
	Pick[0] = M1;
	Pick[1] = M2;
	Pick[2] = M3;
	OutMsg.Begin("vote");
	OutMsg.AddInt("pid", P.PlayerReplicationInfo.PlayerID);
	OutMsg.AddStr("m1", OutMsg.FitWire(Pick[0], 64));
	OutMsg.AddStr("m2", OutMsg.FitWire(Pick[1], 64));
	OutMsg.AddStr("m3", OutMsg.FitWire(Pick[2], 64));
	Send();
	t = FindTrack(P);
	if (t >= 0)
	{
		TrackVote[t] = TrimSpaces(Pick[0] @ Pick[1] @ Pick[2]);
		if (TrackClient[t] != None)
			TrackClient[t].MyVote = TrackVote[t];
	}
	P.ClientMessage("Vote received:" @ Pick[0] @ Pick[1] @ Pick[2]);
	VoteTick();
}

function string TrimSpaces(string S)
{
	while (Left(S, 1) == " ")
		S = Mid(S, 1);
	while (Right(S, 1) == " ")
		S = Left(S, Len(S) - 1);
	return S;
}

// "|" separates the fields of the HUD lines; names must not contain it.
function string NoBar(string S)
{
	local int i;
	i = InStr(S, "|");
	while (i >= 0)
	{
		S = Left(S, i) $ "/" $ Mid(S, i + 1);
		i = InStr(S, "|");
	}
	return S;
}

function AddBracketLine(TourneyMsg M)
{
	local string S, St;
	if (BracketCount >= 64)
		return;
	TGRI.Lines[BracketCount] = M.Get("s") $ "|" $ M.Get("r") $ "|" $ M.Get("i") $ "|" $ M.Get("id") $ "|"
		$ NoBar(M.Get("na")) $ "|" $ NoBar(M.Get("nb")) $ "|" $ M.Get("sa") $ "|" $ M.Get("sb") $ "|"
		$ M.Get("st") $ "|" $ M.Get("w");
	TGRI.LineCount = BracketCount + 1;
	TGRI.BracketRev++;
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
	TGRI.Stand[StandCount] = M.Get("pl") $ "|" $ NoBar(M.Get("name")) $ "|" $ M.Get("w") $ "|" $ M.Get("l") $ "|" $ M.Get("bot");
	TGRI.StandCount = StandCount + 1;
	TGRI.StandRev++;
	if (M.GetInt("pl") > 0)
		S = M.Get("pl") $ "." @ M.Get("name");
	else
		S = "-" @ M.Get("name") @ "(still in)";
	S = S @ "  W" $ M.Get("w") @ "L" $ M.Get("l");
	StandingText[StandCount++] = S;
}

// Text version (console) for clients without the HUD and for the console history.
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

// True if the middle of this player's screen is taken: by a standings panel, or by the
// HUD of the mod itself (then the text fallbacks with progress messages are not needed).
function bool PanelActive(int t)
{
	return HasHud(t) || TrackPanelUntil[t] > Level.TimeSeconds;
}

// Standings in the middle of the screen (the 8 progress message lines).
function ShowStandingsPanel(PlayerPawn P, int Secs, string Footer)
{
	local int i, Line, t;

	P.ClearProgressMessages();
	P.SetProgressTime(Secs);
	if (Phase == "finished")
		P.SetProgressMessage("FINAL STANDINGS", 0);
	else
		P.SetProgressMessage("STANDINGS", 0);
	Line = 1;
	for (i = 0; i < StandCount && Line < 7; i++)
		P.SetProgressMessage(StandingText[i], Line++);
	if (StandCount == 0)
		P.SetProgressMessage("No results yet.", 1);
	if (Footer != "")
		P.SetProgressMessage(Footer, 7);
	else if (StandCount > 6)
		P.SetProgressMessage("Full list in the console", 7);
	t = FindTrack(P);
	if (t >= 0)
		TrackPanelUntil[t] = Level.TimeSeconds + Secs;
}

function string ShutdownText()
{
	if (PhaseSec > 0)
		return "The tournament is over. Server shuts down in" @ PhaseSec @ "s";
	return "The tournament is over.";
}

// End of the tournament: final standings for everybody, refreshed every second (countdown).
function ShowFinalStandings(bool bFirst)
{
	local int t;
	for (t = 0; t < TrackCount; t++)
	{
		if (TrackPawn[t] == None)
			continue;
		if (bFirst)
			ShowStandings(TrackPawn[t]);
		if (!HasHud(t))
			ShowStandingsPanel(TrackPawn[t], 3, ShutdownText());
	}
}

// The end-of-game scoreboard covers the middle of the screen, so the vote panel or the standings
// would only show after F1. UT clears the scoreboard only when a player leaves the Dying state
// (PlayerPawn.Dying.EndState), and the client follows the server's state with every movement
// correction (ClientAdjustPosition, at least every 0.1 s). So the pawns go GameEnded -> Dying ->
// holding state on the server, with a short stop in Dying for the clients to catch up.
function ReleaseScoreboards()
{
	local int t;
	local PlayerPawn P;

	for (t = 0; t < TrackCount; t++)
	{
		P = TrackPawn[t];
		if (P == None || !P.IsInState('GameEnded'))
			continue;
		P.bHidden = true; // no carcass from Dying
		P.GotoState('Dying');
		P.SetTimer(5.0, false); // keeps bFrozen: FIRE in Dying must not respawn the player
		ReleaseAt = Level.TimeSeconds + 0.8;
	}
}

event Tick(float DeltaTime)
{
	local int t;
	local PlayerPawn P;

	if (ReleaseAt <= 0 || Level.TimeSeconds < ReleaseAt)
		return;
	ReleaseAt = 0;
	for (t = 0; t < TrackCount; t++)
	{
		P = TrackPawn[t];
		if (P == None || !P.IsInState('Dying'))
			continue;
		if (P.IsA('Spectator'))
			P.GotoState('CheatFlying');
		else
		{
			StripInventory(P); // no weapon floating in front of the camera while waiting
			HoldPlayer(P);
		}
	}
}

// Only used after a game has ended: every game is played on a freshly loaded level, so the
// player gets a new pawn with a new inventory anyway. Nothing is dropped as a pickup.
function StripInventory(Pawn P)
{
	local Inventory Inv, Next;

	P.Weapon = None;
	P.PendingWeapon = None;
	P.SelectedItem = None;
	for (Inv = P.Inventory; Inv != None; Inv = Next)
	{
		Next = Inv.Inventory;
		Inv.Destroy();
	}
}

//=============================================================================
// Spectators: follow a player
//=============================================================================

function FollowCommand(PlayerPawn P, string Arg)
{
	local int t;
	local Pawn Target, Q;

	t = FindTrack(P);
	if (t < 0 || TrackClient[t] == None)
		return;
	if (!P.IsA('Spectator'))
	{
		P.ClientMessage("Only spectators can follow a player.");
		return;
	}
	if (Arg ~= "off")
	{
		TrackClient[t].bAutoFollow = false;
		P.ViewTarget = None;
		P.bBehindView = false;
		TrackClient[t].ClientViewMode(false);
		P.ClientMessage("Free camera. !follow to follow the match players again.");
		return;
	}
	TrackClient[t].bAutoFollow = true;
	if (Arg == "")
	{
		// Toggle between the two sides of the current match.
		Target = SidePawn(0);
		if (Target == None || P.ViewTarget == Target)
			Target = SidePawn(1);
	}
	else
	{
		for (Q = Level.PawnList; Q != None; Q = Q.NextPawn)
			// Not bIsSpectator: held match players (PlayerWaiting) are flagged as spectators too.
			if (Q.bIsPlayer && Q.PlayerReplicationInfo != None && !Q.IsA('Spectator')
				&& Left(Q.PlayerReplicationInfo.PlayerName, Len(Arg)) ~= Arg)
			{
				Target = Q;
				break;
			}
	}
	if (Target == None)
	{
		P.ClientMessage("Nobody to follow" @ Arg);
		return;
	}
	SetFollow(t, Target);
}

function SetFollow(int t, Pawn Target)
{
	local PlayerPawn P;
	P = TrackPawn[t];
	if (P == None || Target == None || Target == P)
		return;
	P.ViewTarget = Target;
	P.bBehindView = !TrackClient[t].bFirstPerson;
	TrackClient[t].ClientViewMode(!TrackClient[t].bFirstPerson);
	if (Target.PlayerReplicationInfo != None)
		P.ClientMessage("Following" @ Target.PlayerReplicationInfo.PlayerName, 'Event');
}

function ToggleFirstPerson(PlayerPawn P)
{
	local int t;
	t = FindTrack(P);
	if (t < 0 || TrackClient[t] == None)
		return;
	TrackClient[t].bFirstPerson = !TrackClient[t].bFirstPerson;
	if (P.ViewTarget != None)
	{
		P.bBehindView = !TrackClient[t].bFirstPerson;
		TrackClient[t].ClientViewMode(!TrackClient[t].bFirstPerson);
	}
	if (TrackClient[t].bFirstPerson)
		P.ClientMessage("First person view");
	else
		P.ClientMessage("Third person view");
}

// At the start of a game every spectator who wants it watches side a (FIRE switches).
function AutoFollowAll()
{
	local int t;
	local Pawn Target;
	local Pawn A, B;

	A = SidePawn(0);
	B = SidePawn(1);
	Target = A;
	if (Target == None)
		Target = B;
	if (Target == None)
		return;
	for (t = 0; t < TrackCount; t++)
	{
		if (TrackPawn[t] == None || !TrackPawn[t].IsA('Spectator') || TrackClient[t] == None)
			continue;
		if (!TrackClient[t].bAutoFollow)
			continue;
		if (TrackPawn[t].ViewTarget != None && (TrackPawn[t].ViewTarget == A || TrackPawn[t].ViewTarget == B))
			continue;
		SetFollow(t, Target);
	}
}

// Chat line "!cmd ..." from a player (via TourneyChatListener.TeamMessage).
function HandleChatCommand(PlayerReplicationInfo PRI, string Cmd)
{
	local PlayerPawn P;
	P = PlayerPawn(PRI.Owner);
	if (P != None && FindTrack(P) >= 0)
		HandleCommand(P, Cmd);
}

// Chat line "!cmd ..." from a spectator. Spectator.Say does not send a team message but a
// broadcast "Name:text", so the sender is found by name (names are set from the access list).
function HandleSpectatorChat(string PName, string Cmd)
{
	local int t;
	local PlayerPawn P;
	for (t = 0; t < TrackCount; t++)
	{
		P = TrackPawn[t];
		if (P != None && P.IsA('Spectator') && P.PlayerReplicationInfo != None && P.PlayerReplicationInfo.PlayerName == PName)
		{
			HandleCommand(P, Cmd);
			return;
		}
	}
}

// Big warning in the middle of one player's screen for about 10 seconds.
function WarnPlayer(int Pid, string Msg)
{
	local int t;
	local PlayerPawn P;
	for (t = 0; t < TrackCount; t++)
	{
		P = TrackPawn[t];
		if (P == None || P.PlayerReplicationInfo == None || P.PlayerReplicationInfo.PlayerID != Pid)
			continue;
		P.ClientMessage(Msg, 'CriticalEvent', true);
		P.ClearProgressMessages();
		P.SetProgressTime(10);
		P.SetProgressMessage(Msg, 0);
	}
}

function SayTo(int Pid, string Msg)
{
	local Pawn P;
	if (Pid < 0)
	{
		Game.BroadcastMessage(Msg, true);
		return;
	}
	for (P = Level.PawnList; P != None; P = P.NextPawn)
		if (P.IsA('PlayerPawn') && P.PlayerReplicationInfo != None && P.PlayerReplicationInfo.PlayerID == Pid)
			P.ClientMessage(Msg);
}

//=============================================================================
// Website bots: look, play style, chat lines, rivals
//=============================================================================

// The configuration of a website bot by its name in the game (-1: none; bCreate adds one).
function int FindCfg(string BName, bool bCreate)
{
	local int i;
	if (BName == "")
		return -1;
	for (i = 0; i < CfgCount; i++)
		if (SameBotName(CfgName[i], BName))
			return i;
	if (!bCreate)
		return -1;
	if (CfgCount >= MAXCFG)
	{
		Log("too many configured bots, ignoring" @ BName, 'UTTourney');
		return -1;
	}
	i = CfgCount;
	CfgCount++;
	CfgName[i] = BName;
	CfgSkin[i] = "";
	CfgFace[i] = "";
	CfgVoice[i] = "";
	CfgWeapon[i] = "";
	CfgTraits[i] = 0;
	CfgJump[i] = 0;
	CfgTalk[i] = 0;
	CfgSayAt[i] = 0;
	CfgStarted[i] = 0;
	CfgBet[i] = 0;
	CfgBetAmt[i] = 0;
	CfgBetPick[i] = "";
	CfgBody[i] = 0;
	CfgFocus[i] = 0;
	CfgPhoenix[i] = 0;
	CfgAdrUntil[i] = 0;
	CfgBeh[i] = 0;
	CfgVal[i] = 0;
	CfgNest[i] = None;
	CfgLastNest[i] = None;
	CfgNestNext[i] = 0;
	CfgItem[i] = None;
	CfgItemNext[i] = 0;
	CfgAggr[i] = 0;
	CfgAvenge[i] = "";
	return i;
}

// A new "match" line: the bot lines (with their configuration) follow.
function ClearBotConfigs()
{
	CfgCount = 0;
	SayCount = 0;
	RivCount = 0;
	DedCount = 0;
}

// A new "bpers" line replaces the chat lines and rivals of that bot.
function ClearPersonality(int c)
{
	local int i, j;
	CfgBet[c] = 0; // a "bbet" line follows if there is news
	CfgBetAmt[c] = 0;
	CfgBetPick[c] = "";
	j = 0;
	for (i = 0; i < SayCount; i++)
		if (SayCfg[i] != c)
		{
			SayCfg[j] = SayCfg[i];
			SayKind[j] = SayKind[i];
			SayText[j] = SayText[i];
			j++;
		}
	SayCount = j;
	j = 0;
	for (i = 0; i < RivCount; i++)
		if (RivCfg[i] != c)
		{
			RivCfg[j] = RivCfg[i];
			RivName[j] = RivName[i];
			RivLevel[j] = RivLevel[i];
			j++;
		}
	RivCount = j;
}

// Look and play style of a website bot, as ChallengeBotInfo.CHIndividualize does for the ini
// bots. Called after the spawn, before the team is assigned (the team keeps skin and face), and
// for a bot that is already in the level when its "bot" line comes.
function ApplyBotConfig(Bot B, string BName)
{
	local int c, Edges;
	local byte T;
	local class<Weapon> W;
	local class<VoicePack> V;

	if (B == None || B.bDeleteMe || B.PlayerReplicationInfo == None)
		return;
	// The traits' accuracy, alertness and jumpy back on the bot (the curve adds to them).
	if (Curve != None)
		Curve.TraitValues(B);
	c = FindCfg(BName, false);
	Edges = 0;
	if (c >= 0)
	{
		Edges = CfgVal[c];
		T = 255;
		if ((TeamSize > 1 || Game.bTeamGame) && B.PlayerReplicationInfo.Team < 4)
			T = B.PlayerReplicationInfo.Team;
		if (CfgSkin[c] != "")
			B.static.SetMultiSkin(B, CfgSkin[c], CfgFace[c], T);
		if (CfgVoice[c] != "")
		{
			V = class<VoicePack>(DynamicLoadObject(CfgVoice[c], class'Class'));
			if (V != None)
				B.PlayerReplicationInfo.VoiceType = V;
		}
		if (CfgTraits[c] == 1)
		{
			B.FavoriteWeapon = None;
			if (CfgWeapon[c] != "")
			{
				W = class<Weapon>(DynamicLoadObject(CfgWeapon[c], class'Class'));
				if (W != None)
					B.FavoriteWeapon = W;
			}
			B.Accuracy = CfgAcc[c];
			B.CombatStyle = B.Default.CombatStyle + 0.7 * CfgStyle[c];
			B.BaseAggressiveness = 0.5 * (B.Default.Aggressiveness + B.CombatStyle);
			B.BaseAlertness = CfgAlert[c];
			B.CampingRate = CfgCamp[c];
			B.bJumpy = CfgJump[c] == 1;
			B.StrafingAbility = CfgStrafe[c];
		}
		ApplyBehaviourTraits(B, c);
	}
	// Without a voice the bot stays silent in voice messages: the class's own, as UT does.
	if (B.PlayerReplicationInfo.VoiceType == None && B.VoiceType != "")
		B.PlayerReplicationInfo.VoiceType = class<VoicePack>(DynamicLoadObject(B.VoiceType, class'Class'));
	if (Curve != None)
		Curve.Setup(B, BotLevel(BName), Edges);
}

// The tournament skill (0..7) of a bot of the match, -1 = not in the list.
function int BotLevel(string BName)
{
	local int i;
	for (i = 0; i < BotCount; i++)
		if (SameBotName(BotName[i], BName))
			return Clamp(BotSkill[i], 0, 7);
	return -1;
}

// 0 = no rival, 1 = rival, 2 = nemesis of the configured bot c.
function int RivalLevelOf(int c, string PName)
{
	local int i;
	if (c < 0 || PName == "")
		return 0;
	for (i = 0; i < RivCount; i++)
		if (RivCfg[i] == c && SameBotName(RivName[i], PName))
			return RivLevel[i];
	return 0;
}

// The game's GameThreatAdd: a bot prefers its rivals (more so its nemesis) when choosing whom
// to attack among the enemies it sees.
function float RivalThreat(Bot B, Pawn Other)
{
	local int Lv;
	if (B == None || Other == None || CfgCount == 0 || RivCount == 0)
		return 0;
	if (B.PlayerReplicationInfo == None || Other.PlayerReplicationInfo == None)
		return 0;
	Lv = RivalLevelOf(FindCfg(B.PlayerReplicationInfo.PlayerName, false), Other.PlayerReplicationInfo.PlayerName);
	if (Lv == 2)
		return 0.8;
	if (Lv == 1)
		return 0.4;
	return 0;
}

// A living player or bot of that name that is not on B's team.
function Pawn FindOpponent(Bot B, string PName)
{
	local Pawn P;
	for (P = Level.PawnList; P != None; P = P.NextPawn)
		if (P != B && P.bIsPlayer && !P.bDeleteMe && P.Health > 0 && P.PlayerReplicationInfo != None
			&& !P.PlayerReplicationInfo.bIsSpectator && SameBotName(P.PlayerReplicationInfo.PlayerName, PName))
		{
			if ((TeamSize > 1 || Game.bTeamGame) && P.PlayerReplicationInfo.Team == B.PlayerReplicationInfo.Team)
				return None;
			return P;
		}
	return None;
}

// A nemesis is hunted down when the bot has no other enemy in sight.
function HuntNemeses()
{
	local int i;
	local Bot B;
	local Pawn N, Old;

	for (i = 0; i < RivCount; i++)
	{
		if (RivLevel[i] != 2)
			continue;
		B = FindBotPawn(CfgName[RivCfg[i]]);
		if (B == None || B.Health <= 0 || B.PlayerReplicationInfo == None)
			continue;
		N = FindOpponent(B, RivName[i]);
		if (N == None || B.Enemy == N)
			continue;
		if (B.Enemy == None)
		{
			if ((B.IsInState('Roaming') || B.IsInState('Wandering')) && !(B.bCamping && OnCampErrand(B)))
				ForceHunt(B, N);
		}
		else if (B.IsInState('Hunting') && !B.LineOfSightTo(B.Enemy) && HuntAllowed(B, N))
		{
			// Hunting someone out of sight: rather the nemesis.
			Old = B.Enemy;
			B.Enemy = None;
			if (!B.SetEnemy(N))
				B.Enemy = Old;
			else
				B.OldEnemy = Old;
		}
	}
}

// Once a second while the game runs: greetings at the start, nemesis hunts every 2 seconds.
function BotTick()
{
	local int i, j, c;
	local bool bSaid;
	if (CfgCount == 0)
		return;
	if (StartTalkLeft > 0)
	{
		// One chance per bot in the game, one bot per second, in a random order.
		StartTalkLeft--;
		j = Rand(CfgCount);
		for (i = 0; i < CfgCount; i++)
		{
			c = (i + j) % CfgCount;
			if (CfgStarted[c] == 0 && FindBotPawn(CfgName[c]) != None)
			{
				CfgStarted[c] = 1;
				// News first: a bet with Neuro decided since the bot's last game.
				if (CfgBet[c] == 1)
					bSaid = BotTalk(c, "bwon", "", "", CfgTalk[c], true);
				else if (CfgBet[c] == 2)
					bSaid = BotTalk(c, "blost", "", "", CfgTalk[c], true);
				CfgBet[c] = 0;
				if (!bSaid)
					BotTalk(c, "start", "", "", CfgTalk[c], true);
				break;
			}
		}
	}
	HuntTicks++;
	if (HuntTicks >= 2)
	{
		HuntTicks = 0;
		if (RivCount > 0)
			HuntNemeses();
	}
}

// Bot AI help only in the deathmatch games of this package. The classes are compared exactly:
// game types derived from them later (CTF, Domination, ...) keep the game's own AI, and Monster
// Hunt has its own help (TourneyMHBotExtension).
function bool AntiIdleAllowed()
{
	if (Game == None)
		return false;
	return Game.Class == class'TournamentDM' || Game.Class == class'TournamentTDM';
}

// The watch slot of a bot (a new one when it has none). -1 = all slots taken.
function int IdleSlot(Bot B)
{
	local int i, Free;
	Free = -1;
	for (i = 0; i < IdleCount; i++)
	{
		if (IdleBot[i] == B)
			return i;
		if (Free < 0 && (IdleBot[i] == None || IdleBot[i].bDeleteMe))
			Free = i;
	}
	if (Free < 0)
	{
		if (IdleCount >= 32)
			return -1;
		Free = IdleCount;
		IdleCount++;
	}
	IdleBot[Free] = B;
	ResetWatch(Free, B);
	return Free;
}

// A watch from now on (new slot, the bot respawned).
function ResetWatch(int s, Bot B)
{
	IdleLoc[s] = B.Location;
	IdleSince[s] = Level.TimeSeconds;
	FreeSince[s] = Level.TimeSeconds;
	IdleStage[s] = 0;
	StuckRef[s] = B.Location;
	StuckSec[s] = 0;
	AreaRef[s] = B.Location;
	AreaSince[s] = Level.TimeSeconds;
	AreaStage[s] = 0;
	HuntFor[s] = None;
	NoPathN[s] = 0;
	NoPathStay[s] = 0;
	StuckGoal[s] = None;
	StuckRep[s] = 0;
	MeleeHit[s] = Level.TimeSeconds;
	MeleeSec[s] = 0;
	MeleeSkip[s] = None;
	MeleeSkipUntil[s] = 0;
}

// The nearest living opponent of B: players and bots, not of its team in team games.
function Pawn NearestOpponent(Bot B)
{
	local Pawn P, Best;
	local float D, BestD;
	Best = None;
	BestD = 0;
	for (P = Level.PawnList; P != None; P = P.NextPawn)
	{
		if (P == B || !P.bIsPlayer || P.bDeleteMe || P.Health <= 0 || P.PlayerReplicationInfo == None)
			continue;
		if (P.PlayerReplicationInfo.bIsSpectator)
			continue;
		if ((TeamSize > 1 || Game.bTeamGame) && P.PlayerReplicationInfo.Team == B.PlayerReplicationInfo.Team)
			continue;
		D = VSize(P.Location - B.Location);
		if (Best == None || D < BestD)
		{
			Best = P;
			BestD = D;
		}
	}
	return Best;
}

// After SetEnemy on an opponent the bot may not see: novice bots (skill 0-3) would only turn
// towards it and give up (Acquisition -> WhatToDoNext restores OldEnemy); this makes them hunt.
function KeepHunting(Bot B, Pawn Target)
{
	if (B.bNovice)
	{
		B.OldEnemy = Target;
		B.bMustHunt = true;
	}
}

// Once a second while the game runs (match line "ai" > 0, deathmatch games only).
// Failsafe: a bot that has not moved away for 8 s and has no enemy is sent after the nearest
// opponent, after 16 s it wanders off; without an enemy for 15 s it hunts the nearest opponent.
// Duel mode (one on one): without an enemy for 4 s the bot hunts its opponent, like a nemesis.
// Only bots that roam or wander and play freelance or attack: hold, defend and follow orders and
// fights are left to the game. A camping bot (its camping value) is left alone, in the duel mode
// for 10 s at most. Dead bots start their watch anew when they are back.
function AntiIdle()
{
	local Pawn P, Opp;
	local Bot B;
	local int s;
	local float Now, Limit;
	local bool bStuck;

	if (AiLevel <= 0 || !AntiIdleAllowed())
		return;
	Now = Level.TimeSeconds;
	Limit = 15;
	if (AiLevel >= 2 && TeamSize <= 1)
		Limit = 4;
	for (P = Level.PawnList; P != None; P = P.NextPawn)
	{
		B = Bot(P);
		if (B == None || B.bDeleteMe || B.PlayerReplicationInfo == None)
			continue;
		s = IdleSlot(B);
		if (s < 0)
			continue;
		if (B.Health <= 0)
		{
			ResetWatch(s, B);
			continue;
		}
		if (UnstickBot(B, s))
		{
			DropTraitErrand(B, 20);
			continue;
		}
		if (OnTraitErrand(B))
		{
			IdleSince[s] = Now;
			FreeSince[s] = Now;
			continue;
		}
		if (B.bCamping && B.IsInState('Roaming'))
		{
			IdleSince[s] = Now;
			if (Limit > 4 || Now - FreeSince[s] < 10)
				continue;
		}
		if (VSize(B.Location - IdleLoc[s]) > 64)
		{
			IdleLoc[s] = B.Location;
			IdleSince[s] = Now;
			IdleStage[s] = 0;
		}
		if (B.Enemy != None)
		{
			FreeSince[s] = Now;
			continue;
		}
		if (B.Orders != '' && B.Orders != 'FreeLance' && B.Orders != 'Attack')
			continue;
		if (!B.IsInState('Roaming') && !B.IsInState('Wandering'))
			continue;
		bStuck = IdleStage[s] == 0 && Now - IdleSince[s] >= 8;
		if (bStuck || Now - FreeSince[s] >= Limit)
		{
			Opp = NearestOpponent(B);
			if (Opp != None && ForceHunt(B, Opp))
			{
				FreeSince[s] = Now;
				if (bStuck)
					IdleStage[s] = 1;
				continue;
			}
		}
		if (IdleStage[s] <= 1 && Now - IdleSince[s] >= 16)
		{
			IdleStage[s] = 2;
			B.GotoState('Wandering');
		}
	}
}

//-----------------------------------------------------------------------------
// Mod 0.10.1: hunts that lead nowhere, stuck bots and bots that run about on the spot.
// Hunts this mod starts (AI help, nemesis, revenant, bounty hunter) need a path to the target
// and must bring the bot closer: a hunt without progress for 6 s is given up and no hunt from
// this mod follows for 15 s (bots turned back and forth when a target out of reach was set
// again and again). With AI help: a bot that tries to move but makes no progress jumps aside
// (3 s, 5 s), takes a detour (8 s, 14 s) and is moved to a start spot without a death (20 s);
// a bot that has not left an area of 300 units for 12 s without a fight takes a far detour
// (12 s, 24 s) and is moved to a start spot at 36 s. Each step goes to the server log.
// Mod 0.12.1 (DM-SpaceNoxx: a bot on the upper ring, one on a kicker, the whole game): three
// hunts in a row refused for lack of a path and no opponent reachable -> a start spot with a
// path to one; the area is measured flat (bouncing counts); no far detour -> a near one, none
// -> start spot 12 s later; stuck heading for the same point again and again -> detour, the
// fourth time a start spot; an enemy is cleared with DropEnemy (StakeOut: Accessed None).
//-----------------------------------------------------------------------------

function BotLog(string S)
{
	Log("bot [" $ int(Level.TimeSeconds) $ "s]" @ S, 'UTTourney');
}

function string BName(Pawn P)
{
	if (P == None)
		return "nobody";
	if (P.PlayerReplicationInfo != None)
		return P.PlayerReplicationInfo.PlayerName;
	return string(P.Name);
}

function string Where(vector V)
{
	return "(" $ int(V.X) $ "," $ int(V.Y) $ "," $ int(V.Z) $ ")";
}

function string What(Actor A)
{
	if (A == None)
		return "nothing";
	return string(A.Name);
}

function vector Flat(vector V)
{
	V.Z = 0;
	return V;
}

// May this mod send B after N? Not while hunts are blocked for B, not when no path leads there.
function bool HuntAllowed(Bot B, Pawn N)
{
	local int s;
	if (B == None || N == None)
		return false;
	s = IdleSlot(B);
	if (s < 0)
		return false;
	if (Level.TimeSeconds < HuntBlock[s])
		return false;
	if (B.LineOfSightTo(N) || B.FindPathToward(N) != None)
	{
		NoPathN[s] = 0;
		NoPathStay[s] = 0;
		return true;
	}
	HuntBlock[s] = Level.TimeSeconds + 10;
	if (NoPathN[s] < 250)
		NoPathN[s]++;
	BotLog(BName(B) $ ": no path to" @ BName(N) @ "(" $ NoPathN[s] @ "in a row), no hunt for 10 s");
	return false;
}

// Clears B's enemy. Outside roaming and wandering the bot decides anew: states like StakeOut,
// Attacking or a fall that ends in StakeOut use the enemy without a check (Accessed None).
function DropEnemy(Bot B)
{
	B.bMustHunt = false;
	B.OldEnemy = None;
	B.Enemy = None;
	if (B.IsInState('Roaming') || B.IsInState('Wandering') || B.IsInState('GameEnded') || B.IsInState('Dying'))
		return;
	// In the air, hit or charging an impact jump: it continues with NextState when done.
	if (B.IsInState('FallingState') || B.IsInState('TakeHit') || B.IsInState('ImpactJumping'))
	{
		B.NextState = 'Roaming';
		B.NextLabel = 'Begin';
		// FireWhileFalling turns towards the enemy; Ducking waits for the landing.
		if (B.IsInState('FallingState') && B.Physics == PHYS_Falling)
			B.GotoState('FallingState', 'Ducking');
		return;
	}
	B.WhatToDoNext('', '');
}

// An opponent B sees or finds a path to (None: none).
function Pawn ReachableOpponent(Bot B)
{
	local Pawn P;
	for (P = Level.PawnList; P != None; P = P.NextPawn)
	{
		if (P == B || !P.bIsPlayer || P.bDeleteMe || P.Health <= 0 || P.PlayerReplicationInfo == None)
			continue;
		if (P.PlayerReplicationInfo.bIsSpectator)
			continue;
		if ((TeamSize > 1 || Game.bTeamGame) && P.PlayerReplicationInfo.Team == B.PlayerReplicationInfo.Team)
			continue;
		if (B.LineOfSightTo(P) || B.FindPathToward(P) != None)
			return P;
	}
	return None;
}

// Sends B after N (when allowed) and watches the hunt's progress.
function bool ForceHunt(Bot B, Pawn N)
{
	local int s;
	if (!HuntAllowed(B, N) || !B.SetEnemy(N))
		return false;
	KeepHunting(B, N);
	s = IdleSlot(B);
	if (s >= 0 && HuntFor[s] != N)
	{
		HuntFor[s] = N;
		HuntCheckAt[s] = Level.TimeSeconds + 6;
		HuntDist[s] = VSize(N.Location - B.Location);
	}
	return true;
}

// Once a second (deathmatch games): a hunt from this mod that brings the bot no closer is given up.
function HuntGuard()
{
	local Pawn P;
	local Bot B;
	local int s;
	local float D, Now;

	if (!AntiIdleAllowed())
		return;
	Now = Level.TimeSeconds;
	for (P = Level.PawnList; P != None; P = P.NextPawn)
	{
		B = Bot(P);
		if (B == None || B.bDeleteMe || B.Health <= 0)
			continue;
		s = IdleSlot(B);
		if (s < 0 || HuntFor[s] == None)
			continue;
		if (B.Enemy != HuntFor[s] || HuntFor[s].bDeleteMe || HuntFor[s].Health <= 0)
		{
			HuntFor[s] = None;
			continue;
		}
		D = VSize(HuntFor[s].Location - B.Location);
		if (B.LineOfSightTo(HuntFor[s]) || D < HuntDist[s] - 250)
		{
			HuntDist[s] = D;
			HuntCheckAt[s] = Now + 6;
			continue;
		}
		if (Now < HuntCheckAt[s])
			continue;
		BotLog(BName(B) $ ": hunt of" @ BName(HuntFor[s]) @ "without progress for 6 s at" @ Where(B.Location) $ ", given up for 15 s");
		HuntFor[s] = None;
		HuntBlock[s] = Now + 15;
		DropEnemy(B);
	}
}

// AI help: stuck bots and bots that run about on the spot. True: something was done this second.
// Only a melee weapon and an enemy it does not get to (mod 0.15.0; DM-SpaceNoxx: both bots out
// of ammo with the impact hammer, bouncing on the kickers in sight of each other for minutes):
// after 5 s without hurting anyone while that enemy stays 200 units away it leaves it alone for
// 10 s and roams (with no weapon the game rates weapons and ammo high).
function bool MeleeStuck(Bot B, int s)
{
	local float Now;
	Now = Level.TimeSeconds;
	if (MeleeSkip[s] != None && Now < MeleeSkipUntil[s])
	{
		if (B.Enemy == MeleeSkip[s] && OnlyMelee(B))
		{
			DropEnemy(B);
			return true;
		}
		return false;
	}
	MeleeSkip[s] = None;
	if (B.Enemy == None || !OnlyMelee(B) || Now - MeleeHit[s] < 5 || VSize(B.Enemy.Location - B.Location) < 200)
	{
		MeleeSec[s] = 0;
		return false;
	}
	if (MeleeSec[s] < 250)
		MeleeSec[s]++;
	if (MeleeSec[s] < 5)
		return false;
	MeleeSec[s] = 0;
	BotLog(BName(B) $ ": only a melee weapon, has not got to" @ BName(B.Enemy) @ "for 5 s at" @ Where(B.Location) $ ", leaves it for 10 s and looks for a weapon");
	MeleeSkip[s] = B.Enemy;
	MeleeSkipUntil[s] = Now + 10;
	HuntBlock[s] = Now + 10;
	DropEnemy(B);
	return true;
}

// The curve asks every 0.1 s: B's enemy is one it leaves alone right now (MeleeStuck).
function bool MeleeSkipped(Bot B)
{
	local int s;
	if (B == None || B.Enemy == None || IdleCount == 0)
		return false;
	for (s = 0; s < IdleCount; s++)
		if (IdleBot[s] == B)
			return MeleeSkip[s] != None && B.Enemy == MeleeSkip[s] && Level.TimeSeconds < MeleeSkipUntil[s] && OnlyMelee(B);
	return false;
}

// The bot holds a melee weapon (or the translocator) and has nothing else with ammo.
function bool OnlyMelee(Bot B)
{
	local Inventory Inv;
	local Weapon W;
	local int n;
	if (B.Weapon == None || (!B.Weapon.bMeleeWeapon && !B.Weapon.IsA('Translocator')))
		return false;
	n = 0;
	for (Inv = B.Inventory; Inv != None && n < 100; Inv = Inv.Inventory)
	{
		n++;
		W = Weapon(Inv);
		if (W == None || W.bMeleeWeapon || W.IsA('Translocator'))
			continue;
		if (W.AmmoType == None || W.AmmoType.AmmoAmount > 0)
			return false;
	}
	return true;
}

function bool UnstickBot(Bot B, int s)
{
	local bool bFight;
	local float Now;
	local Pawn Opp;

	Now = Level.TimeSeconds;
	if (MeleeStuck(B, s))
		return true;
	bFight = B.Enemy != None && B.LineOfSightTo(B.Enemy);
	if (bFight)
		NoPathN[s] = 0;
	// Cut off (three hunts in a row refused for lack of a path, about 30 s, no fight meanwhile):
	// a ring or ledge only a jump or kicker leads to, a kicker the bot bounces on. When no
	// opponent can be reached from here: to a start spot with a path to one.
	// Bots with hold, defend or follow orders stay.
	if (NoPathN[s] >= 3 && !bFight && (B.Orders == '' || B.Orders == 'FreeLance' || B.Orders == 'Attack'))
	{
		NoPathN[s] = 0;
		Opp = ReachableOpponent(B);
		if (Opp == None)
		{
			FreeRespawn(B, s, "no path to any opponent (3 hunts in a row)", true);
			return true;
		}
		// Only the one it was sent after is out of reach: another one.
		HuntBlock[s] = 0;
		if (B.Enemy == None && (B.IsInState('Roaming') || B.IsInState('Wandering')) && ForceHunt(B, Opp))
		{
			BotLog(BName(B) $ ": hunts" @ BName(Opp) @ "instead (a path leads there)");
			return true;
		}
	}
	// Progress: 150 units from where it last made progress.
	if (VSize(B.Location - StuckRef[s]) > 150)
	{
		if (StuckSec[s] >= 3)
			BotLog(BName(B) $ ": moves again after" @ StuckSec[s] @ "s");
		StuckSec[s] = 0;
		StuckRef[s] = B.Location;
	}
	else if (B.Physics != PHYS_Falling && MayBeStuck(B, bFight))
	{
		StuckSec[s]++;
		// Stuck again and again heading for the same point (within 60 s each time): a detour
		// instead of jumping aside, from the fourth time on a start spot.
		if (StuckSec[s] == 3)
		{
			if (B.MoveTarget != None && B.MoveTarget == StuckGoal[s] && Now - StuckAt[s] < 60)
				StuckRep[s]++;
			else
				StuckRep[s] = 1;
			StuckGoal[s] = B.MoveTarget;
			StuckAt[s] = Now;
			if (StuckRep[s] >= 4)
			{
				FreeRespawn(B, s, "stuck heading for" @ What(StuckGoal[s]) @ StuckRep[s] @ "times in a row", false);
				return true;
			}
			if (StuckRep[s] >= 2)
			{
				BotLog(BName(B) $ ": stuck heading for" @ What(StuckGoal[s]) @ StuckRep[s] @ "times in a row, takes a detour");
				if (Detour(B, s, 150, 900))
					return true;
			}
		}
		if (StuckSec[s] == 3 || StuckSec[s] == 5)
		{
			JumpAside(B, s);
			return true;
		}
		if (StuckSec[s] == 8 || StuckSec[s] == 14)
		{
			Detour(B, s, 150, 900);
			return true;
		}
		if (StuckSec[s] >= 20)
		{
			FreeRespawn(B, s, "stuck for 20 s", false);
			return true;
		}
	}
	// The area: 300 units around a point (see LeftArea); fights and camping do not count.
	if (LeftArea(B, s) || bFight || B.bCamping || B.Orders == 'Hold' || B.Orders == 'Follow'
		|| B.IsInState('StakeOut') || Mover(B.Base) != None)
	{
		if (LeftArea(B, s))
		{
			if (AreaStage[s] > 0)
				BotLog(BName(B) $ ": left the area after" @ int(Now - AreaSince[s]) @ "s");
			// In the air (a kicker): the height stays the one it left from.
			AreaRef[s].X = B.Location.X;
			AreaRef[s].Y = B.Location.Y;
			if (B.Physics != PHYS_Falling)
				AreaRef[s].Z = B.Location.Z;
			AreaStage[s] = 0;
		}
		AreaSince[s] = Now;
		return false;
	}
	if ((AreaStage[s] == 0 && Now - AreaSince[s] >= 12) || (AreaStage[s] == 1 && Now - AreaSince[s] >= 24))
	{
		AreaStage[s]++;
		HuntBlock[s] = Now + 15;
		BotLog(BName(B) $ ": has not left" @ Where(AreaRef[s]) @ "(300 units) for" @ int(Now - AreaSince[s]) @ "s, heading for" @ What(B.MoveTarget) $ ", enemy" @ BName(B.Enemy));
		if (B.Enemy != None)
			DropEnemy(B);
		else
			B.bMustHunt = false;
		// No far detour (or in the air): the near one; neither: the start spot 12 s later.
		if (B.Physics == PHYS_Falling || (!Detour(B, s, 600, 2000) && !Detour(B, s, 150, 900)))
		{
			AreaStage[s] = 2;
			AreaSince[s] = Now - 24;
		}
		return true;
	}
	if (AreaStage[s] == 2 && Now - AreaSince[s] >= 36)
	{
		AreaStage[s] = 3;
		FreeRespawn(B, s, "has not left an area of 300 units for 36 s", false);
		return true;
	}
	return false;
}

// Out of the area: 300 units away flat, or (on the ground) 400 units up or down. Heights in the
// air do not count: a bot bouncing on a kicker stays in its area (mod 0.12.1).
function bool LeftArea(Bot B, int s)
{
	if (VSize(Flat(B.Location - AreaRef[s])) > 300)
		return true;
	return B.Physics != PHYS_Falling && Abs(B.Location.Z - AreaRef[s].Z) > 400;
}

// Trying to move (not standing still on purpose, not riding or waiting for a lift, not fighting).
function bool MayBeStuck(Bot B, bool bFight)
{
	if (B.SpecialPause > 0 || B.MoveTarget == None || bFight)
		return false;
	if (B.bCamping || VSize(B.Acceleration) < 1 || B.Orders == 'Hold' || B.Orders == 'Follow' || B.IsInState('StakeOut'))
		return false;
	if (Mover(B.Base) != None)
		return false;
	if (LiftCenter(B.MoveTarget) != None && JumpSpot(B.MoveTarget) == None)
		return false;
	if (LiftExit(B.MoveTarget) != None && VSize(B.Location - B.MoveTarget.Location) < 60)
		return false;
	return !B.IsInState('GameEnded') && !B.IsInState('Dying');
}

function vector MoveDir(Bot B)
{
	local vector Dir;
	if (B.MoveTarget != None)
		Dir = Flat(B.MoveTarget.Location - B.Location);
	if (VSize(Dir) < 1)
		Dir = Flat(vector(B.Rotation));
	return Normal(Dir);
}

// Floor within a normal step down below V (no jump into a pit).
function bool FloorAt(Bot B, vector V)
{
	local vector HitLoc, HitNorm;
	return B.Trace(HitLoc, HitNorm, V - vect(0,0,1) * (B.CollisionHeight + 120), V, false) != None;
}

function JumpAside(Bot B, int s)
{
	local vector Dir, Side;
	Dir = MoveDir(B);
	Side = Normal(Dir Cross vect(0,0,1));
	if (StuckSide[s] != 0)
		Side = -Side;
	StuckSide[s] = 1 - StuckSide[s];
	if (!FloorAt(B, B.Location + Side * 150 + Dir * 100))
	{
		Side = -Side;
		if (!FloorAt(B, B.Location + Side * 150 + Dir * 100))
		{
			BotLog(BName(B) $ ": stuck for" @ StuckSec[s] @ "s at" @ Where(B.Location) $ ", heading for" @ What(B.MoveTarget) $ ": no floor beside it");
			return;
		}
	}
	BotLog(BName(B) $ ": stuck for" @ StuckSec[s] @ "s at" @ Where(B.Location) $ ", heading for" @ What(B.MoveTarget) $ ": jumps aside");
	B.Velocity = Side * 220 + Dir * 180;
	B.Velocity.Z = B.JumpZ;
	B.SetPhysics(PHYS_Falling);
	B.bJumpOffPawn = true;
	B.SetFall();
}

// A reachable path point MinD-MaxD units away, preferably to the side or behind; the bot walks
// there and then searches its way again. False: none found.
function bool Detour(Bot B, int s, float MinD, float MaxD)
{
	local NavigationPoint N, Best;
	local vector Dir;
	local float D, Score, BestScore;
	local int Tried;

	Dir = MoveDir(B);
	for (N = Level.NavigationPointList; N != None && Tried < 16; N = N.nextNavigationPoint)
	{
		if (N == B.MoveTarget || LiftCenter(N) != None || Teleporter(N) != None)
			continue;
		D = VSize(N.Location - B.Location);
		if (D < MinD || D > MaxD)
			continue;
		if (MaxD <= 900 && Abs(N.Location.Z - B.Location.Z) > 200)
			continue;
		Score = 1.5 - (Normal(Flat(N.Location - B.Location)) Dot Dir) + FRand();
		if (Best != None && Score <= BestScore)
			continue;
		Tried++;
		if (MaxD <= 900)
		{
			if (!B.ActorReachable(N))
				continue;
		}
		else if (B.FindPathToward(N) == None)
			continue;
		Best = N;
		BestScore = Score;
	}
	if (Best == None)
	{
		BotLog(BName(B) $ ": at" @ Where(B.Location) $ ", no detour found (" $ int(MinD) $ "-" $ int(MaxD) @ "units)");
		return false;
	}
	BotLog(BName(B) $ ": at" @ Where(B.Location) $ ", heading for" @ What(B.MoveTarget) $ ": detour via" @ Best.Name);
	if (MaxD > 900)
		B.MoveTarget = B.FindPathToward(Best);
	else
		B.MoveTarget = Best;
	B.SpecialPause = 0;
	if (!B.IsInState('Roaming') && !B.IsInState('Wandering') && !B.IsInState('FallBack') && !B.IsInState('Hunting'))
		return true; // fighting etc.: the next decision picks it up
	B.TweenToRunning(0.1);
	if (B.Enemy != None)
	{
		if (!B.IsInState('FallBack'))
			B.bNoClearSpecial = true;
		B.GotoState('FallBack', 'SpecialNavig');
	}
	else
	{
		if (!B.IsInState('Roaming'))
			B.bNoClearSpecial = true;
		B.GotoState('Roaming', 'SpecialNavig');
	}
	return true;
}

// A start spot from which B sees an opponent or finds a path to one (up to 12 tried, in random
// order; None: there is none). The bot is tried there without collision (no pickups, triggers or
// kickers touched) and standing, and is back where it was afterwards.
function NavigationPoint StartWithPath(Bot B)
{
	local NavigationPoint N, Cand[32], Found;
	local PlayerStart PS;
	local int i, k, Num, Tried;
	local vector Was, WasVel;
	local EPhysics WasPhys;
	local bool bActors, bBlockActors, bBlockPlayers, bTeamArea;

	bTeamArea = Game.bTeamGame && TeamGamePlus(Game) != None && TeamGamePlus(Game).bSpawnInTeamArea;
	for (N = Level.NavigationPointList; N != None && Num < 32; N = N.nextNavigationPoint)
	{
		PS = PlayerStart(N);
		if (PS == None || !PS.bEnabled || PS.Region.Zone.bWaterZone)
			continue;
		if (bTeamArea && PS.TeamNumber != B.PlayerReplicationInfo.Team)
			continue;
		Cand[Num] = PS;
		Num++;
	}
	if (Num == 0)
		return None;
	Was = B.Location;
	WasVel = B.Velocity;
	WasPhys = B.Physics;
	bActors = B.bCollideActors;
	bBlockActors = B.bBlockActors;
	bBlockPlayers = B.bBlockPlayers;
	B.SetCollision(false, false, false);
	B.Velocity = vect(0,0,0);
	B.SetPhysics(PHYS_Walking);
	k = Rand(Num);
	for (i = 0; i < Num && Tried < 12; i++)
	{
		N = Cand[k];
		k++;
		if (k >= Num)
			k = 0;
		if (VSize(N.Location - Was) < 200)
			continue;
		Tried++;
		if (B.SetLocation(N.Location) && ReachableOpponent(B) != None)
		{
			Found = N;
			break;
		}
	}
	B.SetLocation(Was);
	B.SetCollision(bActors, bBlockActors, bBlockPlayers);
	B.SetPhysics(WasPhys);
	B.Velocity = WasVel;
	return Found;
}

// Last resort: to a start spot without dying (no death, no score change), one with a path to an
// opponent when there is one. bNeedPath: only to such a spot, the first time without one the
// bot stays (the opponent may be the one cut off), the next time it goes to any start spot (both
// cut off from each other, e.g. one on a ring and one on a kicker).
function FreeRespawn(Bot B, int s, string Why, bool bNeedPath)
{
	local NavigationPoint N;
	local vector Was;
	local bool bMoved;

	Was = B.Location;
	N = StartWithPath(B);
	if (N == None && bNeedPath && NoPathStay[s] == 0)
	{
		NoPathStay[s] = 1;
		BotLog(BName(B) $ ":" @ Why @ "at" @ Where(Was) $ ", no start spot with a path to an opponent, stays");
		HuntBlock[s] = Level.TimeSeconds + 15;
		return;
	}
	bMoved = N != None && B.SetLocation(N.Location);
	// None with a path, or that one is taken (another player on it): any start spot.
	if (!bMoved)
	{
		N = Level.Game.FindPlayerStart(B, B.PlayerReplicationInfo.Team);
		bMoved = N != None && B.SetLocation(N.Location);
	}
	if (!bMoved)
	{
		BotLog(BName(B) $ ":" @ Why @ "at" @ Where(Was) $ ", respawn failed (no free start spot)");
		StuckSec[s] = 0;
		StuckRef[s] = B.Location;
		StuckRep[s] = 0;
		return;
	}
	B.SetRotation(N.Rotation);
	B.Velocity = vect(0,0,0);
	B.Acceleration = vect(0,0,0);
	B.MoveTarget = None;
	B.SpecialPause = 0;
	BotLog(BName(B) $ ":" @ Why @ "at" @ Where(Was) $ ", moved to" @ N.Name @ "(no death counted)");
	ResetWatch(s, B);
	if (B.Enemy != None && !B.LineOfSightTo(B.Enemy))
		DropEnemy(B);
	else if (B.IsInState('Roaming') || B.IsInState('Wandering') || B.IsInState('FallBack') || B.IsInState('Hunting'))
		B.WhatToDoNext('', '');
}

//-----------------------------------------------------------------------------
// Mod 0.11.0: behaviour traits, second group. Sniper's nest: with the sniper rifle (its
// favourite weapon) it heads for a high point with a view when it has no enemy in sight and
// camps there 8-14 s. Team player (team games): attacks what its team mates attack (target
// threat), and without an enemy in sight joins a team mate's fight within 2500 units. Shuffle
// dancer: in a fight it dodges left and right about once a second (the game's own dodge),
// strafes more. Item controller: knows when armour, shield belts and damage amplifiers come
// back and is there in time (waits next to them), when it has no enemy in sight.
//-----------------------------------------------------------------------------

// The bot heads for a nest or an item for its trait (no AI help hunt meanwhile).
function bool OnTraitErrand(Bot B)
{
	local int c;
	c = GameTraitCfg(B);
	if (c < 0)
		return false;
	return CfgNest[c] != None || CfgItem[c] != None;
}

// A bot with a trait that camps on purpose (sniper's nest, item controller).
function bool OnCampErrand(Bot B)
{
	local int c;
	c = GameTraitCfg(B);
	return c >= 0 && (CfgBeh[c] & (32 | 256)) != 0;
}

// Ends a nest or item errand (stuck, orders); no new one for Secs.
function DropTraitErrand(Bot B, float Secs)
{
	local int c;
	c = GameTraitCfg(B);
	if (c < 0)
		return;
	if (CfgNest[c] != None)
		CfgLastNest[c] = CfgNest[c];
	CfgNest[c] = None;
	CfgItem[c] = None;
	if (Secs > 0)
	{
		CfgNestNext[c] = Level.TimeSeconds + Secs;
		CfgItemNext[c] = Level.TimeSeconds + Secs;
	}
}

// Next step of B towards Goal; the bot takes it unless it fights. False: no way there.
function bool SteerTo(Bot B, Actor Goal)
{
	local Actor A;
	local int i;
	if (B.ActorReachable(Goal))
		A = Goal;
	else
		A = B.FindPathToward(Goal);
	if (A == None)
		return false;
	if (B.MoveTarget == A || B.MoveTarget == Goal || (!B.IsInState('Roaming') && !B.IsInState('Wandering')))
		return true;
	// Still on the route just searched (it may name the point the bot just passed): leave it alone.
	if (A != Goal)
		for (i = 0; i < 16; i++)
		{
			if (B.RouteCache[i] == None)
				break;
			if (B.MoveTarget == B.RouteCache[i])
				return true;
		}
	B.MoveTarget = A;
	B.SpecialPause = 0;
	if (!B.IsInState('Roaming'))
		B.bNoClearSpecial = true;
	B.GotoState('Roaming', 'SpecialNavig');
	return true;
}

// Stands still for Secs (the game's camping: an enemy in sight ends it).
function CampHere(Bot B, float Secs)
{
	if (B.Enemy != None && !B.LineOfSightTo(B.Enemy))
	{
		B.Enemy = None;
		B.OldEnemy = None;
		B.bMustHunt = false;
	}
	B.CampTime = Secs;
	B.bCampOnlyOnce = true;
	B.Acceleration = vect(0,0,0);
	B.GotoState('Roaming', 'Camp');
}

function bool HasSniper(Bot B)
{
	local Weapon W;
	W = Weapon(B.FindInventoryType(class'Botpack.SniperRifle'));
	return W != None && W.AmmoType != None && W.AmmoType.AmmoAmount > 0;
}

// Once per map: up to 12 high points (upper 45 % of the map's height) that see many path points
// below them; ambush points count more.
function FindNests()
{
	local NavigationPoint N, M;
	local float MinZ, MaxZ, Thresh;
	local int Count, Step, CStep, i, j, k, Score;

	bNestsDone = true;
	MinZ = 0;
	MaxZ = 0;
	for (N = Level.NavigationPointList; N != None; N = N.nextNavigationPoint)
	{
		if (Count == 0 || N.Location.Z < MinZ)
			MinZ = N.Location.Z;
		if (Count == 0 || N.Location.Z > MaxZ)
			MaxZ = N.Location.Z;
		Count++;
	}
	if (Count < 10 || MaxZ - MinZ < 256)
		return;
	Thresh = MinZ + 0.55 * (MaxZ - MinZ);
	Step = Max(1, Count / 30);
	CStep = Max(1, Count / 80);
	i = 0;
	for (N = Level.NavigationPointList; N != None; N = N.nextNavigationPoint)
	{
		i++;
		if (i % CStep != 0 || N.Location.Z < Thresh || LiftCenter(N) != None || Teleporter(N) != None)
			continue;
		Score = 0;
		j = 0;
		for (M = Level.NavigationPointList; M != None; M = M.nextNavigationPoint)
		{
			j++;
			if (j % Step != 0 || M.Location.Z > N.Location.Z - 96 || VSize(M.Location - N.Location) > 4000)
				continue;
			if (FastTrace(M.Location, N.Location))
				Score++;
		}
		if (Ambushpoint(N) != None)
			Score += 3;
		if (Score < 4)
			continue;
		// Insert sorted (best first), at most 12.
		k = NestCount;
		if (k >= 12)
		{
			if (Score <= NestScore[11])
				continue;
			k = 11;
		}
		else
			NestCount++;
		while (k > 0 && NestScore[k - 1] < Score)
		{
			Nest[k] = Nest[k - 1];
			NestScore[k] = NestScore[k - 1];
			k--;
		}
		Nest[k] = N;
		NestScore[k] = Score;
	}
	Log("sniper nests on this map:" @ NestCount, 'UTTourney');
}

// The best free nest for B (not its last one, not another sniper's), with a way there.
function NavigationPoint PickNest(Bot B, int c)
{
	local int i, m;
	local float D, Value, BestValue;
	local NavigationPoint Best;
	local bool bTaken;

	if (!bNestsDone)
		FindNests();
	for (i = 0; i < NestCount; i++)
	{
		if (Nest[i] == None || Nest[i] == CfgLastNest[c])
			continue;
		D = VSize(Nest[i].Location - B.Location);
		if (D < 200 || D > 4500)
			continue;
		bTaken = false;
		for (m = 0; m < CfgCount; m++)
			if (m != c && CfgNest[m] == Nest[i])
				bTaken = true;
		if (bTaken)
			continue;
		Value = NestScore[i] - D / 600 + 2 * FRand();
		if (Best != None && Value <= BestValue)
			continue;
		if (B.FindPathToward(Nest[i]) == None)
			continue;
		Best = Nest[i];
		BestValue = Value;
	}
	return Best;
}

// Sniper's nest. True: the bot is on its way to a nest or camps in it.
function bool SniperNest(Bot B, int c)
{
	local float Now;
	local NavigationPoint N;

	Now = Level.TimeSeconds;
	if (B.Enemy != None && B.LineOfSightTo(B.Enemy))
		return false;
	if (!HasSniper(B))
	{
		CfgNest[c] = None;
		return false;
	}
	if (CfgNest[c] != None)
	{
		if (VSize(CfgNest[c].Location - B.Location) < 250 && Abs(CfgNest[c].Location.Z - B.Location.Z) < B.CollisionHeight + 48
			&& B.FastTrace(CfgNest[c].Location))
		{
			BotLog(BName(B) $ ": sniper's nest" @ CfgNest[c].Name @ "reached, camps");
			CfgLastNest[c] = CfgNest[c];
			CfgNest[c] = None;
			CfgNestNext[c] = Now + 25;
			B.SwitchToBestWeapon();
			CampHere(B, 8 + 6 * FRand());
			return true;
		}
		if (Now > CfgNestUntil[c] || !SteerTo(B, CfgNest[c]))
		{
			BotLog(BName(B) $ ": sniper's nest" @ CfgNest[c].Name @ "not reached, gives up");
			CfgLastNest[c] = CfgNest[c];
			CfgNest[c] = None;
			CfgNestNext[c] = Now + 20;
			return false;
		}
		return true;
	}
	if (B.bCamping || Now < CfgNestNext[c] || (!B.IsInState('Roaming') && !B.IsInState('Wandering')))
		return false;
	N = PickNest(B, c);
	if (N == None)
	{
		CfgNestNext[c] = Now + 30;
		return false;
	}
	CfgNest[c] = N;
	CfgNestUntil[c] = Now + 25;
	BotLog(BName(B) $ ": heads for the sniper's nest" @ N.Name @ Where(N.Location));
	return SteerTo(B, N);
}

// Team player: is Other the enemy of one of B's team mates?
function bool MateTarget(Bot B, Pawn Other)
{
	local Pawn P;
	if (TeamSize <= 1 && !Game.bTeamGame)
		return false;
	for (P = Level.PawnList; P != None; P = P.NextPawn)
		if (P != B && Bot(P) != None && P.Health > 0 && SameTeam(P, B) && Bot(P).Enemy == Other)
			return true;
	return false;
}

// Team player without an enemy in sight: joins a team mate's fight within 2500 units.
// True: it goes for that enemy now.
function bool TeamPlay(Bot B)
{
	local Pawn P, T, Old, Mate, Q;
	local float D, BestD;
	if (TeamSize <= 1 && !Game.bTeamGame)
		return false;
	if (B.Enemy != None && B.LineOfSightTo(B.Enemy))
		return false;
	// The enemy of the nearest team mate in a fight, within 2500 units.
	for (Q = Level.PawnList; Q != None; Q = Q.NextPawn)
	{
		if (Q == B || Bot(Q) == None || Q.Health <= 0 || !SameTeam(Q, B))
			continue;
		T = Bot(Q).Enemy;
		if (T == None || T.Health <= 0 || T.bDeleteMe || SameTeam(T, B))
			continue;
		D = VSize(T.Location - B.Location);
		if (D > 2500 || (Mate != None && D >= BestD))
			continue;
		Mate = Q;
		BestD = D;
	}
	if (Mate != None)
	{
		P = Mate;
		T = Bot(P).Enemy;
		if (B.Enemy == T)
			return false;
		if (B.Enemy == None)
		{
			if ((B.IsInState('Roaming') || B.IsInState('Wandering')) && ForceHunt(B, T))
			{
				BotLog(BName(B) $ ": team player joins" @ BName(P) $ "'s fight against" @ BName(T));
				return true;
			}
			return false;
		}
		if (!HuntAllowed(B, T))
			return false;
		// Its own enemy is out of sight: rather the team mate's.
		Old = B.Enemy;
		B.Enemy = None;
		if (!B.SetEnemy(T))
		{
			B.Enemy = Old;
			return false;
		}
		B.OldEnemy = Old;
		return true;
	}
	return false;
}

// Shuffle dancer: in a fight, a dodge to the other side about once a second.
function ShuffleDance(Bot B, int c)
{
	local vector X, Y;
	if (B.Enemy == None || B.Physics != PHYS_Walking || Level.TimeSeconds < CfgDanceNext[c])
		return;
	if (!B.IsInState('Attacking') && !B.IsInState('TacticalMove') && !B.IsInState('RangedAttack') && !B.IsInState('Charging'))
		return;
	if (!B.LineOfSightTo(B.Enemy) || FRand() > 0.75)
		return;
	X = Normal(Flat(B.Enemy.Location - B.Location));
	Y = Normal(X Cross vect(0,0,1));
	CfgDanceSide[c] = 1 - CfgDanceSide[c];
	if (CfgDanceSide[c] == 1)
		Y = -Y;
	CfgDanceNext[c] = Level.TimeSeconds + 0.9;
	B.TryToDuck(Y, CfgDanceSide[c] == 1);
	TrCount(c, 7, 1, 0);
}

// Once per map (first item controller): the armour, shield belts and damage amplifiers lying in
// the level.
function FindPowerItems()
{
	local Inventory Itm;
	bPowDone = true;
	foreach AllActors(class'Inventory', Itm)
	{
		if (PowCount >= 16)
			break;
		if (Itm.Owner != None || Itm.bHeldItem || Itm.RespawnTime <= 0)
			continue;
		if (UDamage(Itm) == None && UT_ShieldBelt(Itm) == None && Armor2(Itm) == None && ThighPads(Itm) == None)
			continue;
		PowItem[PowCount] = Itm;
		PowBack[PowCount] = 0;
		if (Itm.IsInState('Sleeping'))
			PowBack[PowCount] = Level.TimeSeconds + FMax(Itm.LatentFloat, 0.1);
		PowCount++;
	}
	Log("power items on this map:" @ PowCount, 'UTTourney');
}

// Once a second: a taken item is back after its respawn time (taken = it sleeps).
function PowerItemTick()
{
	local int i;
	for (i = 0; i < PowCount; i++)
	{
		if (PowItem[i] == None || PowItem[i].bDeleteMe)
			continue;
		// While it sleeps, LatentFloat is what is left of its Sleep (the game's bots use it too).
		if (!PowItem[i].IsInState('Sleeping'))
			PowBack[i] = 0;
		else
			PowBack[i] = Level.TimeSeconds + FMax(PowItem[i].LatentFloat, 0.1);
	}
}

function int PowIndex(Inventory Itm)
{
	local int i;
	for (i = 0; i < PowCount; i++)
		if (PowItem[i] == Itm)
			return i;
	return -1;
}

function float PowValue(Bot B, Inventory Itm)
{
	if (UDamage(Itm) != None)
		return 3.0;
	if (B.FindInventoryType(Itm.Class) != None)
		return 0; // has one of these
	if (UT_ShieldBelt(Itm) != None)
		return 2.5;
	if (Armor2(Itm) != None)
		return 2.0;
	return 1.0;
}

// Item controller. True: the bot heads for an item or waits next to it.
function bool ItemControl(Bot B, int c)
{
	local int i, Best;
	local float Now, D, Eta, Rest, Value, BestValue;
	local Inventory Itm;

	Now = Level.TimeSeconds;
	if (B.Enemy != None && B.LineOfSightTo(B.Enemy))
		return false;
	if (!bPowDone)
		FindPowerItems();
	if (CfgItem[c] != None)
	{
		Itm = CfgItem[c];
		i = PowIndex(Itm);
		if (i < 0 || Itm.bDeleteMe || Itm.Owner != None || Now > CfgItemUntil[c] || (PowBack[i] > 0 && PowBack[i] - Now > 20))
		{
			// Gone, too late, or somebody else took it (back only in a while).
			CfgItem[c] = None;
			CfgItemNext[c] = Now + 5;
			return false;
		}
		D = VSize(Itm.Location - B.Location);
		if (PowBack[i] > 0 && D < 200 && Abs(Itm.Location.Z - B.Location.Z) < B.CollisionHeight + 48 && B.FastTrace(Itm.Location))
		{
			if (!B.bCamping)
			{
				BotLog(BName(B) $ ": item controller waits" @ int(PowBack[i] - Now + 1) @ "s at" @ Itm.Name);
				CampHere(B, FClamp(PowBack[i] - Now + 0.6, 1, 8));
			}
			return true;
		}
		if (PowBack[i] == 0 && D < 60)
		{
			CfgItem[c] = None; // it touches it now
			CfgItemNext[c] = Now + 3;
			return false;
		}
		if (B.bCamping)
			return true;
		if (!SteerTo(B, Itm))
		{
			CfgItem[c] = None;
			CfgItemNext[c] = Now + 10;
			return false;
		}
		return true;
	}
	if (Now < CfgItemNext[c] || B.bCamping || (!B.IsInState('Roaming') && !B.IsInState('Wandering')))
		return false;
	Best = -1;
	for (i = 0; i < PowCount; i++)
	{
		Itm = PowItem[i];
		if (Itm == None || Itm.bDeleteMe || Itm.Owner != None)
			continue;
		Value = PowValue(B, Itm);
		if (Value <= 0)
			continue;
		D = VSize(Itm.Location - B.Location);
		if (D > 4000)
			continue;
		Eta = D / FMax(B.GroundSpeed, 200) + 1.5;
		Rest = 0;
		if (PowBack[i] > 0)
			Rest = PowBack[i] - Now;
		if (Rest > Eta + 4 || Rest > 20)
			continue;
		Value -= D / 2000;
		if (Best >= 0 && Value <= BestValue)
			continue;
		Best = i;
		BestValue = Value;
	}
	CfgItemNext[c] = Now + 3;
	if (Best < 0)
		return false;
	Itm = PowItem[Best];
	if (!SteerTo(B, Itm))
		return false;
	CfgItem[c] = Itm;
	Rest = 0;
	if (PowBack[Best] > 0)
		Rest = PowBack[Best] - Now;
	CfgItemUntil[c] = Now + VSize(Itm.Location - B.Location) / FMax(B.GroundSpeed, 200) + Rest + 10;
	BotLog(BName(B) $ ": item controller heads for" @ Itm.Name $ ", back in" @ int(Rest) @ "s");
	return true;
}

function string TReplace(string S, string From, string To)
{
	local string R;
	local int i;
	R = "";
	i = InStr(S, From);
	while (i >= 0)
	{
		R = R $ Left(S, i) $ To;
		S = Mid(S, i + Len(From));
		i = InStr(S, From);
	}
	return R $ S;
}

// A line needs the names its placeholders stand for.
function bool LineFits(int c, string T, string Victim, string Killer)
{
	if (CfgBetPick[c] == "" && InStr(T, "{pick}") >= 0)
		return false;
	if (Victim == "" && InStr(T, "{victim}") >= 0)
		return false;
	if (Killer == "" && InStr(T, "{killer}") >= 0)
		return false;
	return true;
}

// A random line of bot c for the occasion, placeholders filled ("" = none).
function string PickLine(int c, string Kind, string Victim, string Killer)
{
	local int i, n, k;
	local string T;

	n = 0;
	for (i = 0; i < SayCount; i++)
		if (SayCfg[i] == c && SayKind[i] == Kind && LineFits(c, SayText[i], Victim, Killer))
			n++;
	if (n == 0)
		return "";
	k = Rand(n);
	for (i = 0; i < SayCount; i++)
		if (SayCfg[i] == c && SayKind[i] == Kind && LineFits(c, SayText[i], Victim, Killer))
		{
			if (k == 0)
			{
				T = SayText[i];
				break;
			}
			k--;
		}
	T = TReplace(T, "{me}", CfgName[c]);
	T = TReplace(T, "{victim}", Victim);
	T = TReplace(T, "{killer}", Killer);
	T = TReplace(T, "{map}", CurrentMapName());
	T = TReplace(T, "{amount}", string(CfgBetAmt[c]));
	T = TReplace(T, "{pick}", CfgBetPick[c]);
	return T;
}

// Bot c says a line of the occasion with Chance percent (bForce: no cooldown, no gap).
function bool BotTalk(int c, string Kind, string Victim, string Killer, int Chance, bool bForce)
{
	local string Msg;

	if (c < 0 || Rand(100) >= Chance)
		return false;
	if (!bForce && (Level.TimeSeconds < CfgSayAt[c] || Level.TimeSeconds < NextBotSay))
		return false;
	Msg = PickLine(c, Kind, Victim, Killer);
	return BotSay(c, Msg);
}

// Bot c says Msg now (no chance, no cooldown check).
function bool BotSay(int c, string Msg)
{
	local Bot B;
	local Pawn P;

	if (Msg == "")
		return false;
	B = FindBotPawn(CfgName[c]);
	if (B == None || B.PlayerReplicationInfo == None)
		return false;
	CfgSayAt[c] = Level.TimeSeconds + SAYCOOLDOWN;
	NextBotSay = Level.TimeSeconds + SAYGAP;
	// As PlayerPawn.Say: to the players and the messaging spectators (web admin, chat listener).
	for (P = Level.PawnList; P != None; P = P.NextPawn)
		if (P.bIsPlayer || P.IsA('MessagingSpectator'))
		{
			if (Game.MessageMutator != None)
			{
				if (Game.MessageMutator.MutatorTeamMessage(B, P, B.PlayerReplicationInfo, Msg, 'Say', true))
					P.TeamMessage(B.PlayerReplicationInfo, Msg, 'Say', true);
			}
			else
				P.TeamMessage(B.PlayerReplicationInfo, Msg, 'Say', true);
		}
	// Mod 0.12.0: the line also goes to the website (kill feed of the match page).
	if (MatchId != "")
	{
		OutMsg.Begin("bs");
		OutMsg.AddStr("mid", MatchId);
		OutMsg.AddInt("g", GameNo);
		OutMsg.AddStr("n", OutMsg.FitWire(FeedName(B), 32));
		OutMsg.AddInt("sd", FeedSide(B));
		OutMsg.AddStr("x", OutMsg.FitWire(Msg, 130));
		Send();
	}
	return true;
}

// Neuro shop: bot c may say the dedication of player Who for the occasion (kill: c fragged Who,
// death: Who fragged c). Placeholders {me} {victim} {killer} {map}.
function bool BotTalkDed(int c, string Kind, string Who, string Victim, string Killer)
{
	local int i;
	local string T;

	if (DedCount == 0 || Rand(100) >= DEDCHANCE)
		return false;
	if (Level.TimeSeconds < CfgSayAt[c] || Level.TimeSeconds < NextBotSay)
		return false;
	for (i = 0; i < DedCount; i++)
		if (DedKind[i] == Kind && Caps(DedTo[i]) == Caps(Who))
		{
			T = DedText[i];
			break;
		}
	if (T == "")
		return false;
	T = TReplace(T, "{me}", CfgName[c]);
	T = TReplace(T, "{victim}", Victim);
	T = TReplace(T, "{killer}", Killer);
	T = TReplace(T, "{map}", CurrentMapName());
	return BotSay(c, T);
}

// From CountKill: the killer may brag, the victim may complain (more often about a rival).
function BotTalkKill(Pawn Killer, Pawn Other)
{
	local int c;
	local string KName, VName;

	if (CfgCount == 0 || (SayCount == 0 && DedCount == 0) || Killer == None || Other == None || Killer == Other)
		return;
	if (Killer.PlayerReplicationInfo == None || Other.PlayerReplicationInfo == None)
		return;
	if ((TeamSize > 1 || Game.bTeamGame) && Killer.PlayerReplicationInfo.Team == Other.PlayerReplicationInfo.Team)
		return;
	KName = Killer.PlayerReplicationInfo.PlayerName;
	VName = Other.PlayerReplicationInfo.PlayerName;
	if (Bot(Killer) != None)
	{
		c = FindCfg(KName, false);
		if (c >= 0 && Bot(Other) == None && BotTalkDed(c, "kill", VName, VName, KName))
			c = -1;
		if (c >= 0 && !(RivalLevelOf(c, VName) > 0 && BotTalk(c, "rkill", VName, KName, Min(100, 2 * CfgTalk[c]), false)))
			BotTalk(c, "kill", VName, KName, CfgTalk[c], false);
	}
	if (Bot(Other) != None)
	{
		c = FindCfg(VName, false);
		if (c >= 0 && Bot(Killer) == None && BotTalkDed(c, "death", KName, VName, KName))
			c = -1;
		if (c >= 0 && !(RivalLevelOf(c, KName) > 0 && BotTalk(c, "rdeath", VName, KName, Min(100, 2 * CfgTalk[c]), false)))
			BotTalk(c, "death", VName, KName, CfgTalk[c], false);
	}
}

// End of a game: one bot of the winners and one of the losers may say something.
function BotTalkEnd(int WinSide)
{
	local int i, j, c, n;
	local bool bWinSaid, bLossSaid;

	n = BotCount;
	if (CfgCount == 0 || SayCount == 0 || n == 0)
		return;
	j = Rand(n);
	for (i = 0; i < n; i++)
	{
		c = FindCfg(BotName[(i + j) % n], false);
		if (c < 0)
			continue;
		if (BotSide[(i + j) % n] == WinSide)
		{
			if (!bWinSaid)
				bWinSaid = BotTalk(c, "win", "", "", CfgTalk[c], true);
		}
		else if (!bLossSaid)
			bLossSaid = BotTalk(c, "loss", "", "", CfgTalk[c], true);
	}
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
	class'TournamentConfig'.default.CachedTeamSize = TeamSize;
	class'TournamentConfig'.default.CachedFF = MatchFF;
	class'TournamentConfig'.default.CachedSkillCurve = 0;
	if (bSkillCurve)
		class'TournamentConfig'.default.CachedSkillCurve = 1;
	class'TournamentConfig'.default.CachedBotCount = BotCount;
	for (i = 0; i < MAXBOTS; i++)
	{
		class'TournamentConfig'.default.CachedBotName[i] = BotName[i];
		class'TournamentConfig'.default.CachedBotSkill[i] = BotSkill[i];
		class'TournamentConfig'.default.CachedBotCls[i] = BotCls[i];
		class'TournamentConfig'.default.CachedBotSide[i] = BotSide[i];
	}
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
	TeamSize = Max(1, class'TournamentConfig'.default.CachedTeamSize);
	MatchFF = class'TournamentConfig'.default.CachedFF;
	bSkillCurve = class'TournamentConfig'.default.CachedSkillCurve != 0;
	BotCount = Clamp(class'TournamentConfig'.default.CachedBotCount, 0, MAXBOTS);
	for (i = 0; i < BotCount; i++)
	{
		BotName[i] = class'TournamentConfig'.default.CachedBotName[i];
		BotSkill[i] = class'TournamentConfig'.default.CachedBotSkill[i];
		BotCls[i] = class'TournamentConfig'.default.CachedBotCls[i];
		BotSide[i] = class'TournamentConfig'.default.CachedBotSide[i];
	}
	Phase = "lobby";
}

//=============================================================================
// Unreal Dream Team: game traits of website bots (btrt, mod 0.9.0)
//=============================================================================

// Values traits (mod 0.14.0): "ee,wd" -> bits of CfgVal (edges on the skill curve); unknown
// codes are ignored.
function int ParseValueTraits(string S)
{
	local int Bits, p;
	local string Code;
	Bits = 0;
	while (S != "")
	{
		p = InStr(S, ",");
		if (p < 0)
		{
			Code = S;
			S = "";
		}
		else
		{
			Code = Left(S, p);
			S = Mid(S, p + 1);
		}
		if (Code == "sh")
			Bits = Bits | 1;
		else if (Code == "wd")
			Bits = Bits | 2;
		else if (Code == "ss")
			Bits = Bits | 4;
		else if (Code == "ph")
			Bits = Bits | 8;
		else if (Code == "ee")
			Bits = Bits | 16;
		else if (Code == "ar")
			Bits = Bits | 32;
		else if (Code == "dd")
			Bits = Bits | 64;
		else if (Code == "bo")
			Bits = Bits | 128;
	}
	return Bits;
}

// "px,vp" -> bits of CfgBody; unknown codes are ignored.
function int ParseGameTraits(string S)
{
	local int Bits, p;
	local string Code;
	Bits = 0;
	while (S != "")
	{
		p = InStr(S, ",");
		if (p < 0)
		{
			Code = S;
			S = "";
		}
		else
		{
			Code = Left(S, p);
			S = Mid(S, p + 1);
		}
		if (Code == "sa")
			Bits = Bits | 1;
		else if (Code == "tf")
			Bits = Bits | 2;
		else if (Code == "ad")
			Bits = Bits | 4;
		else if (Code == "gc")
			Bits = Bits | 8;
		else if (Code == "vp")
			Bits = Bits | 16;
		else if (Code == "px")
			Bits = Bits | 32;
	}
	return Bits;
}

// Mod 0.17.0: the Monster Hunt focus of a website bot (btrt "mf"): -2 hunter .. 0 .. 2 sprinter.
function int MHFocus(Pawn P)
{
	local int c;
	if (P == None || P.PlayerReplicationInfo == None || CfgCount == 0)
		return 0;
	c = FindCfg(P.PlayerReplicationInfo.PlayerName, false);
	if (c < 0)
		return 0;
	return CfgFocus[c];
}

// The configuration of a website bot with game traits (-1: none).
function int GameTraitCfg(Pawn P)
{
	local int c;
	if (P == None || CfgCount == 0 || Bot(P) == None || P.PlayerReplicationInfo == None)
		return -1;
	c = FindCfg(P.PlayerReplicationInfo.PlayerName, false);
	if (c >= 0 && CfgBody[c] == 0 && CfgBeh[c] == 0)
		return -1;
	return c;
}

// A new game: the phoenix can rise again, no boost is left over.
function ResetGameTraits()
{
	local int c;
	for (c = 0; c < CfgCount; c++)
	{
		CfgPhoenix[c] = 0;
		CfgAdrUntil[c] = 0;
		CfgAggr[c] = 0;
		CfgAvenge[c] = "";
		CfgNest[c] = None;
		CfgLastNest[c] = None;
		CfgNestNext[c] = 0;
		CfgItem[c] = None;
		CfgItemNext[c] = 0;
		CfgPhxAt[c] = 0;
	}
	for (c = 0; c < 240; c++)
	{
		TrOn[c] = 0;
		TrSince[c] = 0;
		TrSec[c] = 0;
		TrAct[c] = 0;
		TrKills[c] = 0;
		TrDeaths[c] = 0;
		TrVal[c] = 0;
		TrVal2[c] = 0;
		TrEpK[c] = 0;
		TrStartSec[c] = 0;
		TrLast[c] = 0;
	}
}

// From the damage mutator, after armour: glass cannon (+20 % dealt and taken), thick skin
// (-10 % taken), vampire (15 % of the damage dealt as health, up to 100), phoenix (one lethal hit
// per game leaves 50 health).
function OnTakeDamage(out int ActualDamage, Pawn Victim, Pawn InstigatedBy, name DamageType)
{
	local int cv, ci, Heal, ms, Before;
	if (ActualDamage <= 0 || Victim == None)
		return;
	if (Curve != None)
		Curve.OnHit(Victim, InstigatedBy, ActualDamage);
	if (Bot(InstigatedBy) != None && InstigatedBy != Victim)
	{
		ms = IdleSlot(Bot(InstigatedBy));
		if (ms >= 0)
			MeleeHit[ms] = Level.TimeSeconds;
	}
	cv = GameTraitCfg(Victim);
	ci = -1;
	if (InstigatedBy != Victim)
		ci = GameTraitCfg(InstigatedBy);
	if (cv < 0 && ci < 0)
		return;
	if (ci >= 0 && (CfgBody[ci] & 8) != 0)
	{
		Before = ActualDamage;
		ActualDamage = int(ActualDamage * 1.2 + 0.5);
		TrCount(ci, 12, ActualDamage - Before, 0);
	}
	if (cv >= 0 && (CfgBody[cv] & 8) != 0)
	{
		Before = ActualDamage;
		ActualDamage = int(ActualDamage * 1.2 + 0.5);
		TrCount(cv, 12, 0, ActualDamage - Before);
	}
	if (cv >= 0 && (CfgBody[cv] & 2) != 0)
	{
		Before = ActualDamage;
		ActualDamage = Max(1, int(ActualDamage * 0.9 + 0.5));
		TrCount(cv, 10, Before - ActualDamage, 0);
	}
	if (ci >= 0 && (CfgBody[ci] & 16) != 0 && InstigatedBy.Health > 0 && InstigatedBy.Health < 100)
	{
		Heal = int(Min(ActualDamage, Max(Victim.Health, 0)) * 0.15 + 0.5);
		Heal = Min(Heal, 100 - InstigatedBy.Health);
		if (Heal > 0)
		{
			InstigatedBy.Health = InstigatedBy.Health + Heal;
			TrCount(ci, 13, Heal, 0);
		}
	}
	if (cv >= 0 && (CfgBody[cv] & 32) != 0 && CfgPhoenix[cv] == 0 && bGameLive && Victim.Health > 0 && ActualDamage >= Victim.Health && DamageType != 'Suicided')
	{
		CfgPhoenix[cv] = 1;
		if (Victim.Health <= 50)
		{
			ActualDamage = 0;
			Victim.Health = 50;
		}
		else
			ActualDamage = Victim.Health - 50;
		Game.BroadcastMessage(CfgName[cv] @ "rises from the ashes!", false);
		Log("game trait phoenix:" @ CfgName[cv] @ "survives", 'UTTourney');
		CfgPhxAt[cv] = Level.TimeSeconds;
		TrStart(cv, 14, None);
	}
}

// From the mutator's ModifyPlayer at every spawn: start armour (25), the boost ends.
function OnModifyPlayer(Pawn P)
{
	local int c;
	local Pickup A;
	c = GameTraitCfg(P);
	if (c < 0)
		return;
	if (CfgAdrUntil[c] > 0)
	{
		P.GroundSpeed = CfgAdrSpeed[c];
		CfgAdrUntil[c] = 0;
	}
	if ((CfgBody[c] & 1) != 0 && P.FindInventoryType(class'Botpack.ThighPads') == None)
	{
		A = Spawn(class'Botpack.ThighPads', P,, P.Location);
		if (A != None)
		{
			A.RespawnTime = 0.0;
			A.Charge = 25;
			A.bHeldItem = true;
			A.GiveTo(P);
			TrCount(c, 9, 25, 0);
		}
	}
}

// Adrenaline: 30 % faster for 3 s after a kill. Revenant: remembers its killer, forgets him
// once it got him.
function GameTraitKill(Pawn Killer, Pawn Other)
{
	local int c;
	TraitKillStats(Killer, Other);
	c = GameTraitCfg(Other);
	if (c >= 0 && (CfgBeh[c] & 8) != 0 && Killer != None && Killer != Other && Killer.PlayerReplicationInfo != None && !SameTeam(Killer, Other))
		CfgAvenge[c] = Killer.PlayerReplicationInfo.PlayerName;
	if (Killer == None || Killer == Other || Killer.Health <= 0)
		return;
	c = GameTraitCfg(Killer);
	if (c >= 0 && CfgAvenge[c] != "" && Other != None && Other.PlayerReplicationInfo != None && SameBotName(CfgAvenge[c], Other.PlayerReplicationInfo.PlayerName))
		CfgAvenge[c] = "";
	if (c < 0 || (CfgBody[c] & 4) == 0)
		return;
	if (CfgAdrUntil[c] <= 0)
		CfgAdrSpeed[c] = Killer.GroundSpeed;
	Killer.GroundSpeed = CfgAdrSpeed[c] * 1.3;
	CfgAdrUntil[c] = Level.TimeSeconds + 3.0;
	TrStart(c, 11, Killer);
}

// Once a second: boosts that ran out.
function AdrenalineTick()
{
	local int c;
	local Bot B;
	for (c = 0; c < CfgCount; c++)
		if (CfgAdrUntil[c] > 0 && Level.TimeSeconds >= CfgAdrUntil[c])
		{
			B = FindBotPawn(CfgName[c]);
			if (B != None)
				B.GroundSpeed = CfgAdrSpeed[c];
			CfgAdrUntil[c] = 0;
		}
}

// "aa,kz" -> bits of CfgBeh (behaviour traits, mod 0.10.0); unknown codes are ignored.
function int ParseBehaviourTraits(string S)
{
	local int Bits, p;
	local string Code;
	Bits = 0;
	while (S != "")
	{
		p = InStr(S, ",");
		if (p < 0)
		{
			Code = S;
			S = "";
		}
		else
		{
			Code = Left(S, p);
			S = Mid(S, p + 1);
		}
		if (Code == "aa")
			Bits = Bits | 1;
		else if (Code == "kz")
			Bits = Bits | 2;
		else if (Code == "bs")
			Bits = Bits | 4;
		else if (Code == "rg")
			Bits = Bits | 8;
		else if (Code == "bh")
			Bits = Bits | 16;
		else if (Code == "sn")
			Bits = Bits | 32;
		else if (Code == "tp")
			Bits = Bits | 64;
		else if (Code == "sd")
			Bits = Bits | 128;
		else if (Code == "ic")
			Bits = Bits | 256;
	}
	return Bits;
}

// Two pawns on the same team (team games only).
function bool SameTeam(Pawn A, Pawn B)
{
	if (A == None || B == None || A.PlayerReplicationInfo == None || B.PlayerReplicationInfo == None)
		return false;
	if (TeamSize <= 1 && !Game.bTeamGame)
		return false;
	return A.PlayerReplicationInfo.Team == B.PlayerReplicationInfo.Team;
}

// At the spawn, after the play style: kamikaze (flak as favourite weapon unless one is set,
// charges more), berserker (a little more aggressive).
function ApplyBehaviourTraits(Bot B, int c)
{
	if (B == None || c < 0 || CfgBeh[c] == 0)
		return;
	if ((CfgBeh[c] & 2) != 0)
	{
		if (CfgWeapon[c] == "")
			B.FavoriteWeapon = class'Botpack.UT_FlakCannon';
		B.CombatStyle = FMin(1.0, B.CombatStyle + 0.5);
		B.BaseAggressiveness = FMin(1.0, B.BaseAggressiveness + 0.3);
	}
	if ((CfgBeh[c] & 4) != 0)
		B.BaseAggressiveness = FMin(1.0, B.BaseAggressiveness + 0.2);
	if ((CfgBeh[c] & 32) != 0 && (CfgBeh[c] & 2) == 0 && CfgWeapon[c] == "")
		B.FavoriteWeapon = class'Botpack.SniperRifle';
	if ((CfgBeh[c] & 128) != 0)
		B.StrafingAbility = FMin(1.0, B.StrafingAbility + 0.5);
	B.Aggressiveness = B.BaseAggressiveness;
}

// The opponent of B with the highest score (bounty hunter), None while nobody has scored.
function Pawn LeaderFor(Bot B)
{
	local Pawn P, Best;
	local float S;
	S = 0;
	for (P = Level.PawnList; P != None; P = P.NextPawn)
		if (P != B && P.bIsPlayer && !P.bDeleteMe && P.Health > 0 && P.PlayerReplicationInfo != None
			&& !P.PlayerReplicationInfo.bIsSpectator && !SameTeam(P, B) && P.PlayerReplicationInfo.Score > S)
		{
			Best = P;
			S = P.PlayerReplicationInfo.Score;
		}
	return Best;
}

// Once a second while the game runs: vulture (hurt: cautious, so it retreats to health and
// armour), berserker (hurt: no retreat), revenant and bounty hunter (deathmatch games: without
// an enemy they hunt their last killer or the leader, like a nemesis).
function BehaviourTick()
{
	local int c;
	local Bot B;
	local Pawn N;
	local float A;
	if (bPowDone)
		PowerItemTick();
	for (c = 0; c < CfgCount; c++)
	{
		if (CfgBeh[c] == 0)
			continue;
		B = FindBotPawn(CfgName[c]);
		if (B == None || B.Health <= 0 || B.PlayerReplicationInfo == None)
			continue;
		A = B.BaseAggressiveness;
		if ((CfgBeh[c] & 1) != 0 && B.Health < 50)
			A -= 0.6;
		if ((CfgBeh[c] & 4) != 0 && B.Health < 40)
			A += 0.6;
		if (A != B.BaseAggressiveness)
		{
			B.Aggressiveness = FClamp(A, -1.0, 1.5);
			CfgAggr[c] = 1;
		}
		else if (CfgAggr[c] == 1)
		{
			B.Aggressiveness = B.BaseAggressiveness;
			CfgAggr[c] = 0;
		}
		if ((CfgBeh[c] & 128) != 0)
			ShuffleDance(B, c);
		if (AntiIdleAllowed() && (B.Orders == '' || B.Orders == 'FreeLance' || B.Orders == 'Attack'))
		{
			if ((CfgBeh[c] & 64) != 0 && TeamPlay(B))
				continue;
			if ((CfgBeh[c] & 32) != 0 && SniperNest(B, c))
				continue;
			if ((CfgBeh[c] & 256) != 0 && ItemControl(B, c))
				continue;
		}
		else if (CfgNest[c] != None || CfgItem[c] != None)
			DropTraitErrand(B, 0);
		if (B.bCamping && (CfgBeh[c] & (32 | 256)) != 0)
			continue; // in its nest or waiting for an item
		if (!AntiIdleAllowed() || B.Enemy != None || (!B.IsInState('Roaming') && !B.IsInState('Wandering')))
			continue;
		N = None;
		if ((CfgBeh[c] & 8) != 0 && CfgAvenge[c] != "")
			N = FindOpponent(B, CfgAvenge[c]);
		if (N == None && (CfgBeh[c] & 16) != 0)
			N = LeaderFor(B);
		if (N != None)
			ForceHunt(B, N);
	}
}

// The game's GameThreatAdd: revenants prefer their last killer, bounty hunters the leader.
function float BehaviourThreat(Bot B, Pawn Other)
{
	local int c;
	local float F;
	if (B == None || Other == None || CfgCount == 0 || Other.PlayerReplicationInfo == None)
		return 0;
	c = GameTraitCfg(B);
	if (c < 0 || CfgBeh[c] == 0)
		return 0;
	F = 0;
	if ((CfgBeh[c] & 8) != 0 && CfgAvenge[c] != "" && SameBotName(CfgAvenge[c], Other.PlayerReplicationInfo.PlayerName))
		F += 0.6;
	if ((CfgBeh[c] & 16) != 0 && LeaderFor(B) == Other)
		F += 0.5;
	if ((CfgBeh[c] & 64) != 0 && MateTarget(B, Other))
		F += 0.5;
	return F;
}

//=============================================================================
// Mod 0.17.0: trait log. What the game traits of website bots did: episodes of the traits
// that switch on and off (a "tv" line each, live; a log line each) and per game the counters
// of every trait ("pt" lines before "pse", with the statistics). Tracked traits t: 0 vulture,
// 1 kamikaze, 2 berserker, 3 revenant, 4 bounty hunter, 5 sniper's nest, 6 team player,
// 7 shuffle dancer, 8 item controller (behaviour bits), 9 starter armour, 10 thick skin,
// 11 adrenaline, 12 glass cannon, 13 vampire, 14 phoenix (body bits). Values traits act on the
// skill curve all the time: they are listed as passive (only the seconds in the game).
//=============================================================================

function string TrCode(int t)
{
	switch (t)
	{
		case 0: return "aa";
		case 1: return "kz";
		case 2: return "bs";
		case 3: return "rg";
		case 4: return "bh";
		case 5: return "sn";
		case 6: return "tp";
		case 7: return "sd";
		case 8: return "ic";
		case 9: return "sa";
		case 10: return "tf";
		case 11: return "ad";
		case 12: return "gc";
		case 13: return "vp";
		case 14: return "px";
	}
	return "";
}

function string TrName(int t)
{
	switch (t)
	{
		case 0: return "vulture";
		case 1: return "kamikaze";
		case 2: return "berserker";
		case 3: return "revenant";
		case 4: return "bounty-hunter";
		case 5: return "snipers-nest";
		case 6: return "team-player";
		case 7: return "shuffle-dancer";
		case 8: return "item-controller";
		case 9: return "starter-armour";
		case 10: return "thick-skin";
		case 11: return "adrenaline";
		case 12: return "glass-cannon";
		case 13: return "vampire";
		case 14: return "phoenix";
	}
	return "?";
}

// Values traits (CfgVal bits 1-128) for the passive lines.
function string TrValCode(int b)
{
	switch (b)
	{
		case 0: return "sh";
		case 1: return "wd";
		case 2: return "ss";
		case 3: return "ph";
		case 4: return "ee";
		case 5: return "ar";
		case 6: return "dd";
		case 7: return "bo";
	}
	return "";
}

function bool TrHas(int c, int t)
{
	if (t <= 8)
		return (CfgBeh[c] & (1 << t)) != 0;
	return (CfgBody[c] & (1 << (t - 9))) != 0;
}

// The statistics slot of a bot configuration (-1: not in this game).
function int TrStatIdx(int c)
{
	local int i;
	for (i = 0; i < StCount; i++)
		if (StKey[i] == "" && SameBotName(StBot[i], CfgName[c]))
			return i;
	return -1;
}

// A counted use: dodges, heals, hits, armour (Amount and Amount2 add to the values).
function TrCount(int c, int t, int Amount, int Amount2)
{
	local int x;
	if (c < 0 || !bGameLive)
		return;
	x = c * 15 + t;
	TrAct[x]++;
	TrVal[x] += Amount;
	TrVal2[x] += Amount2;
}

// P: the bot for the log (None: no health in the line).
function TrStart(int c, int t, Pawn P)
{
	local int x;
	local string S;
	if (c < 0 || !bGameLive)
		return;
	x = c * 15 + t;
	TrLast[x] = Level.TimeSeconds;
	if (TrOn[x] != 0)
		return;
	TrOn[x] = 1;
	TrSince[x] = Level.TimeSeconds;
	TrStartSec[x] = StGameSec;
	TrAct[x]++;
	TrEpK[x] = 0;
	S = "trait" @ TrName(t) @ "on:" @ CfgName[c] @ "at" @ StGameSec $ "s";
	if (P != None)
		S = S $ ", health" @ P.Health;
	Log(S, 'UTTourney');
}

// An episode ends now: Died = 1 when the bot died in it.
function TrEnd(int c, int t, int Died)
{
	TrEndAt(c, t, Died, Level.TimeSeconds);
}

// An episode ends at EndAt (a flickering condition: when it last held). Sends the "tv" line.
function TrEndAt(int c, int t, int Died, float EndAt)
{
	local int x, i, Dur;
	local string S;
	if (c < 0)
		return;
	x = c * 15 + t;
	if (TrOn[x] == 0)
		return;
	TrOn[x] = 0;
	EndAt = FMax(EndAt, TrSince[x]);
	TrSec[x] += EndAt - TrSince[x];
	Dur = int(EndAt - TrSince[x] + 0.5);
	S = "trait" @ TrName(t) @ "off:" @ CfgName[c] @ "after" @ Dur $ "s," @ TrEpK[x] @ "kills";
	if (Died != 0)
		S = S $ ", died";
	Log(S, 'UTTourney');
	i = TrStatIdx(c);
	if (i < 0)
		return;
	LiveHead("tv", i);
	OutMsg.AddStr("c", TrCode(t));
	OutMsg.AddInt("s", TrStartSec[x]);
	OutMsg.AddInt("d", Dur);
	OutMsg.AddInt("k", TrEpK[x]);
	OutMsg.AddInt("x", Died);
	if (bTrFinal)
		SendStat(); // with the statistics: sent again after a reconnect
	else
		Send();
}

// A soft pause ends the running episodes (the game clock stops, Level.TimeSeconds does not).
function TrPauseEnd()
{
	local int c, t;
	for (c = 0; c < CfgCount; c++)
		for (t = 0; t < 15; t++)
			TrEnd(c, t, 0);
}

// From GameTraitKill: the victim's running episodes end (died), the killer's count the kill;
// kamikaze counts its flak kills.
function TraitKillStats(Pawn Killer, Pawn Other)
{
	local int c, t, x;
	c = GameTraitCfg(Other);
	if (c >= 0)
		for (t = 0; t < 15; t++)
		{
			x = c * 15 + t;
			if (TrOn[x] != 0)
			{
				TrDeaths[x]++;
				TrEnd(c, t, 1);
			}
		}
	if (Killer == None || Killer == Other)
		return;
	c = GameTraitCfg(Killer);
	if (c < 0)
		return;
	for (t = 0; t < 15; t++)
	{
		x = c * 15 + t;
		if (TrOn[x] != 0)
		{
			TrKills[x]++;
			TrEpK[x]++;
		}
	}
	if ((CfgBeh[c] & 2) != 0 && Killer.Weapon != None && Killer.Weapon.IsA('UT_FlakCannon'))
		TrCount(c, 1, 1, 0);
}

// Once a second after BehaviourTick: which episodes run now.
function TraitTelemetryTick()
{
	local int c, x;
	local Bot B;
	local bool bOn;
	for (c = 0; c < CfgCount; c++)
	{
		if (CfgBeh[c] == 0 && CfgBody[c] == 0)
			continue;
		B = FindBotPawn(CfgName[c]);
		if (B == None || B.Health <= 0 || B.PlayerReplicationInfo == None)
			continue;
		if ((CfgBeh[c] & 1) != 0)
			TrSample(c, 0, B.Health < 50, B);
		if ((CfgBeh[c] & 4) != 0)
			TrSample(c, 2, B.Health < 40, B);
		if ((CfgBeh[c] & 8) != 0)
			TrSample(c, 3, CfgAvenge[c] != "", B);
		// These three switch often: an episode ends when the condition was off for 3 s.
		if ((CfgBeh[c] & 16) != 0)
		{
			bOn = B.Enemy != None && B.Enemy == LeaderFor(B);
			TrSampleLate(c, 4, bOn, B);
		}
		if ((CfgBeh[c] & 32) != 0)
		{
			bOn = CfgNest[c] != None || (B.bCamping && HasSniper(B));
			TrSampleLate(c, 5, bOn, B);
		}
		if ((CfgBeh[c] & 64) != 0)
		{
			bOn = B.Enemy != None && MateTarget(B, B.Enemy);
			TrSampleLate(c, 6, bOn, B);
		}
		if ((CfgBeh[c] & 256) != 0)
			TrSample(c, 8, CfgItem[c] != None, B);
		if ((CfgBody[c] & 4) != 0)
			TrSample(c, 11, CfgAdrUntil[c] > 0, B);
		// The phoenix starts when it rises (OnTakeDamage) and counts 20 s of its second life.
		x = c * 15 + 14;
		if (TrOn[x] != 0 && Level.TimeSeconds - CfgPhxAt[c] >= 20)
			TrEnd(c, 14, 0);
	}
}

function TrSample(int c, int t, bool bOn, Pawn P)
{
	if (bOn)
		TrStart(c, t, P);
	else
		TrEnd(c, t, 0);
}

// Like TrSample, but off only after 3 s without the condition (ends when it last held).
function TrSampleLate(int c, int t, bool bOn, Pawn P)
{
	local int x;
	x = c * 15 + t;
	if (bOn)
		TrStart(c, t, P);
	else if (TrOn[x] != 0 && Level.TimeSeconds - TrLast[x] >= 3)
		TrEndAt(c, t, 0, TrLast[x]);
}

// Before "pse": open episodes end with the game, then one "pt" line per trait of every bot.
function SendTraitStats(int N)
{
	local int c, t, x, i, b;
	bTrFinal = true;
	for (c = 0; c < CfgCount; c++)
	{
		if (CfgBeh[c] == 0 && CfgBody[c] == 0 && CfgVal[c] == 0)
			continue;
		i = TrStatIdx(c);
		for (t = 0; t < 15; t++)
		{
			if (!TrHas(c, t))
				continue;
			TrEnd(c, t, 0);
			if (i < 0)
				continue;
			x = c * 15 + t;
			TraitStatLine(N, i, TrCode(t), TrAct[x], int(TrSec[x] + 0.5), TrKills[x], TrDeaths[x], TrVal[x], TrVal2[x]);
			Log("trait summary:" @ CfgName[c] @ TrName(t) @ "uses" @ TrAct[x] @ "active" @ int(TrSec[x] + 0.5) $ "s kills"
				@ TrKills[x] @ "deaths" @ TrDeaths[x] @ "value" @ TrVal[x] @ TrVal2[x], 'UTTourney');
		}
		if (i < 0)
			continue;
		for (b = 0; b < 8; b++)
			if ((CfgVal[c] & (1 << b)) != 0)
				TraitStatLine(N, i, TrValCode(b), 0, StSec[i], 0, 0, 0, 0);
	}
	bTrFinal = false;
}

function TraitStatLine(int N, int i, string Code, int A, int S, int K, int D, int V, int W)
{
	OutMsg.Begin("pt");
	OutMsg.AddStr("mid", MatchId);
	OutMsg.AddInt("g", GameNo);
	OutMsg.AddInt("n", N);
	OutMsg.AddInt("i", i);
	OutMsg.AddStr("c", Code);
	OutMsg.AddInt("a", A);
	OutMsg.AddInt("s", S);
	OutMsg.AddInt("k", K);
	OutMsg.AddInt("d", D);
	OutMsg.AddInt("v", V);
	OutMsg.AddInt("w", W);
	SendStat();
}

defaultproperties
{
	RemoteRole=ROLE_None
	bHidden=True
	bGameRelevant=True
}
