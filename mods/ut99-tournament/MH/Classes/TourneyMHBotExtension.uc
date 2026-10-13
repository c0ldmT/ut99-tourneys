//=============================================================================
// TourneyMHBotExtension
// Monster Hunt's bot extension (MonsterHuntBotExtension, Monster Hunt 613) with
// the tournament's bot helpers. Used when the tournament rule botWaypointFix is
// on (TourneyCoreMH sets MonsterHunt.BotExtensionType, the official hook for
// custom bot behaviour). Everything not listed here is Monster Hunt's own code.
//
// 1. Waypoint order: the map's MonsterWaypoints are sorted correctly (MH's own
//    swap writes the wrong slot, waypoints get lost or repeated).
// 2. Jump routes: a waypoint that can only be reached over a JumpSpot (a jump
//    the map marks for bots, e.g. over lava on MH-Trials) is not skipped. Stock
//    bots only use JumpSpots with a translocator, jump boots or low gravity;
//    here the route search accepts them, the jump itself is a normal jump.
// 3. Movers (lifts, doors, gates) that turn back when they hit somebody: a bot
//    keeps its distance while such a mover moves or waits to move, and while a
//    lift is above it, and goes on when the mover is ready (lift on its level).
//    Bots that wait for a lift wait away from it, so they never block the way
//    out for a bot under it; bots standing close to such a lift make room.
// 4. Stuck bots: 3 s without progress -> jump to the side, 8 s -> detour over a
//    nearby path point, 20 s -> penalty-free respawn (moved to a start spot, no
//    death counted).
// 5. Map bug fix: a mover that opens only once and turns back when it hits a
//    pawn would stay closed for good after one touch (MH-Canyon's castle bars).
//    Such movers no longer turn back (they move on); each one is logged.
// 6. Closed doors: a bot stuck at a closed mover follows the map's events back
//    to what opens it - hunts the monster whose death opens it (MH-NaliVillage's
//    second titan), walks to an unused trigger (via counters and dispatchers,
//    MH-Trials' last switch) or bumps an unused button.
// 7. Waypoints without a route: when the route search finds no way to a waypoint,
//    the bot heads for the path point right next to it and walks the last bit.
// Debug log: also which pawn made a mover turn back, objectives and the death
// of monsters whose death triggers an event.
// Every step is written to the server log only (tag UTTourney, lines start
// with "bot [run time]"); nothing is shown in the game.
//=============================================================================
class TourneyMHBotExtension extends MonsterHuntBotExtension;

// Per bot (slot = index; a destroyed bot's slot is reused).
var Bot SBot[32];
var Actor SGoal[32];            // waypoint, exit or arrival target the bot heads for
var int SNoPath[32];            // waypoint position last logged as "no path" (-1 = none)
var int SJumpLog[32];           // waypoint position last logged as "route with a jump"
var vector SRefLoc[32];         // where the bot was when it last made progress
var int SStill[32];             // seconds without progress
var byte SJumpSide[32];
var Mover SHoldMover[32];       // mover the bot waits for
var NavigationPoint SHoldPoint[32];
var byte SHoldKind[32];         // 0 = none, 1 = lift above, 2 = mover in the way
var float SHoldSince[32], SRestSince[32], SNoPlaceLog[32];
var Mover SCoolMover[32];       // mover the bot waited for last: not again for 10 s after that
var float SCoolUntil[32];

var Actor SErrand[32];          // what the bot does to open a closed mover (monster, trigger, button)
var Mover SErrandFor[32];
var float SErrandSince[32];
var float SResolveAt[32];       // last time a closed mover was looked into for this bot
var Actor SFailOpener[32];      // opener that did not open SFailMover: not chosen again for 120 s
var Mover SFailMover[32];
var float SFailUntil[32];
var Mover SErrandMover[32];     // failed errands per mover: after 2 for the same mover, no more
var int SErrandCount[32];
var float SErrandUsedAt[32];    // when the target was first seen used (the door may open delayed)
var int SNearWP[32];            // waypoint tried via the path point next to it, since SNearSince
var float SNearSince[32];
var byte SCoolKind[32];
var int SNearLog[32];           // waypoint position last logged as "via the path point next to it"
var Actor NearGoal[16];         // PathNear cache: goal -> path point next to it
var NavigationPoint NearNode[16];
var int NumNear;

var Mover Lifts[32];            // movers with a LiftCenter that turn back or stop on contact
var int NumLifts;
var Mover Watched[64];          // movers that turn back on contact (for the "turned back" log)
var byte WOpening[64];
var float WFlip[64];
var int NumWatched;
var MonsterHuntObjective Objectives[32];
var byte ObjState[32];          // 0 inactive, 1 active, 2 completed
var int NumObjectives;
var ScriptedPawn KeyMonsters[32]; // monsters whose death triggers an event
var name KeyEvent[32];
var name KeyName[32];
var byte KeyDead[32];
var int NumKeyMonsters;
var bool bMoversLogged;
var byte VisitedLogged[128];
var int TickCount;

function PostBeginPlay()
{
	Super.PostBeginPlay();
	SetTimer(0.25, true);
}

//-----------------------------------------------------------------------------
// Log helpers

function TourneyCoreMH Core()
{
	if (TournamentMH(Level.Game) == None)
		return None;
	return TourneyCoreMH(TournamentMH(Level.Game).TCore);
}

function bool RunActive()
{
	local TourneyCoreMH C;
	C = Core();
	return C == None || C.RunActive();
}

function BotLog(string S)
{
	local TourneyCoreMH C;
	C = Core();
	if (C != None)
		Log("bot" @ C.RunStamp() @ S, 'UTTourney');
	else
		Log("bot" @ S, 'UTTourney');
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
	if (MonsterWaypoint(A) != None)
		return "waypoint" @ MonsterWaypoint(A).Position;
	if (MonsterEnd(A) != None)
		return "exit" @ A.Name;
	return string(A.Name);
}

function vector Flat(vector V)
{
	V.Z = 0;
	return V;
}

// For TourneyCoreMH's order confirmation: where the bot is heading.
function string GoalText(Bot B)
{
	local int k;

	k = FindSlot(B);
	if (k < 0)
		return "none yet, moving to" @ What(B.MoveTarget);
	if (SHoldKind[k] != 0 && SHoldMover[k] != None)
		return What(SGoal[k]) $ ", waiting for" @ SHoldMover[k].Name;
	if (SErrand[k] != None)
		return What(SGoal[k]) $ ", first" @ ErrandVerb(SErrand[k]) @ SErrand[k].Name @ "to open" @ What(SErrandFor[k]);
	return What(SGoal[k]) $ ", next path point" @ What(B.MoveTarget);
}

//-----------------------------------------------------------------------------
// Slots

function int FindSlot(Bot B)
{
	local int i;
	if (B == None)
		return -1;
	for (i = 0; i < 32; i++)
		if (SBot[i] == B)
			return i;
	return -1;
}

function int Slot(Bot B)
{
	local int i, Free;

	if (B == None)
		return -1;
	Free = -1;
	for (i = 0; i < 32; i++)
	{
		if (SBot[i] == B)
			return i;
		if (Free < 0 && (SBot[i] == None || SBot[i].bDeleteMe))
			Free = i;
	}
	if (Free < 0)
		return -1;
	ClearSlot(Free);
	SBot[Free] = B;
	SRefLoc[Free] = B.Location;
	return Free;
}

function ClearSlot(int k)
{
	SBot[k] = None;
	SGoal[k] = None;
	SNoPath[k] = -1;
	SJumpLog[k] = -1;
	SNearLog[k] = -1;
	SNearWP[k] = -1;
	SStill[k] = 0;
	SErrand[k] = None;
	SErrandFor[k] = None;
	SFailOpener[k] = None;
	SErrandMover[k] = None;
	SErrandCount[k] = 0;
	ClearHold(k);
}

function ClearHold(int k)
{
	if (SHoldMover[k] != None)
	{
		SCoolMover[k] = SHoldMover[k];
		SCoolUntil[k] = Level.TimeSeconds + 10;
		SCoolKind[k] = SHoldKind[k];
	}
	SHoldMover[k] = None;
	SHoldPoint[k] = None;
	SHoldKind[k] = 0;
}

//-----------------------------------------------------------------------------
// 1. Waypoint order

function FindWaypoints()
{
	local int i, j;
	local MonsterWaypoint WP;
	local MonsterEnd EP;
	local string Order;

	NumPoints = 0;
	NumEndPoints = 0;
	foreach AllActors(class'MonsterWaypoint', WP)
	{
		if (NumPoints > 127)
			break;
		waypoints[NumPoints] = WP;
		NumPoints++;
	}
	foreach AllActors(class'MonsterEnd', EP)
	{
		if (NumEndPoints > 7)
			break;
		endPoints[NumEndPoints] = EP;
		NumEndPoints++;
	}

	// Insertion sort by Position (stable: equal positions keep the map's order).
	for (i = 1; i < NumPoints; i++)
	{
		WP = waypoints[i];
		j = i - 1;
		while (j >= 0 && waypoints[j].Position > WP.Position)
		{
			waypoints[j + 1] = waypoints[j];
			j--;
		}
		waypoints[j + 1] = WP;
	}

	for (i = 0; i < NumPoints && Len(Order) < 200; i++)
		Order = Order @ waypoints[i].Position;
	Log("bot waypoints (sorted):" $ Order $ ", exits:" @ NumEndPoints, 'UTTourney');
}

//-----------------------------------------------------------------------------
// 2. Waypoints with jump routes (Monster Hunt's FindNextWaypoint, same rules, plus PathTo and log lines)

function bool FindSpecialAttractionFor(Bot aBot)
{
	local int k, Errand;

	if (aBot != None && aBot.Health > 0)
	{
		k = FindSlot(aBot);
		if (k >= 0 && SHoldKind[k] != 0 && HoldBot(aBot, k))
			return true;
		if (k >= 0 && SErrand[k] != None)
		{
			Errand = DoErrand(aBot, k);
			if (Errand == 1)
				return true;
			if (Errand == 2)
				return false; // fighting the monster that opens the door
		}
	}
	return Super.FindSpecialAttractionFor(aBot);
}

function bool FindNextWaypoint(Bot aBot)
{
	local int i, lastVisited, k;
	local Actor Hop, AT;
	local byte bJump;
	local bool bFirst;

	lastVisited = -1;
	k = Slot(aBot);
	bFirst = true;

	if ((aBot.Orders == 'Attack') || ((aBot.Orders == 'Freelance') && (FRand() > 0.2)))
	{
		for (i = 0; i < NumPoints; i++)
		{
			if (waypoints[i].bVisited)
				lastVisited = i;

			if (!waypoints[i].bVisited && waypoints[i].bEnabled)
			{
				// only the next waypoint in line may be reached via the path point next to it, for 20 s
				Hop = PathTo(aBot, waypoints[i], bJump);
				if (Hop == None && bFirst && NearAllowed(aBot, k, waypoints[i]))
					Hop = PathNear(aBot, waypoints[i]);
				bFirst = false;
				// no path to the next waypoint in line: Monster Hunt tries the next one
				if (Hop == None)
				{
					aBot.MoveTarget = None;
					NoteNoPath(aBot, k, waypoints[i]);
					continue;
				}
				if (bJump != 0)
					NoteJump(aBot, k, waypoints[i], Hop);
				aBot.MoveTarget = Hop;
				NoteGoal(aBot, k, waypoints[i]);
				SetAttractionStateFor(aBot);
				return true;
			}

			// the next waypoint in line is not enabled, so stop here
			if (i > lastVisited && !waypoints[i].bEnabled)
				break;
		}

		// the last reached waypoint has a target to attack
		if (lastVisited > -1 && waypoints[lastVisited].ArrivalTarget != None)
		{
			AT = waypoints[lastVisited].ArrivalTarget;
			if (!aBot.CanSee(AT))
				aBot.MoveTarget = PathTo(aBot, AT, bJump);
			else
			{
				aBot.SetEnemy(waypoints[lastVisited].ArrivalTarget);
				aBot.SetOrders('Attack', None, false);
			}
			NoteGoal(aBot, k, AT);
			SetAttractionStateFor(aBot);
			return true;
		}

		// no waypoints left, or none reachable: head for an exit
		if (i >= NumPoints)
		{
			for (i = 0; i < NumEndPoints; i++)
			{
				Hop = PathTo(aBot, endPoints[i], bJump);
				if (Hop == None)
					continue;
				aBot.MoveTarget = Hop;
				NoteGoal(aBot, k, endPoints[i]);
				SetAttractionStateFor(aBot);
				return true;
			}
		}
	}

	return false;
}

// First path point toward Goal. When there is no normal route, the search is repeated with
// JumpSpots allowed (they cost too much for a bot without translocator, jump boots or low
// gravity). Only the search sees the higher JumpZ: it is restored right after, so the jump
// at the JumpSpot (JumpSpot.PendingJump -> Bot.BigJump, next tick) is a normal jump. Without
// any route, PathNear tries the path point next to Goal.
function Actor PathTo(Bot B, Actor Goal, out byte bJump, optional bool bNear)
{
	local Actor A;

	bJump = 0;
	if (B.ActorReachable(Goal))
		return Goal;
	A = B.FindPathToward(Goal);
	if (A != None)
		return A;
	A = PathWithJumps(B, Goal);
	if (A == None)
	{
		if (bNear)
			return PathNear(B, Goal);
		return None;
	}
	bJump = 1;
	return A;
}

// The path point next to a waypoint is tried for 20 s per bot and waypoint; after that Monster
// Hunt's rule (skip it) applies again.
function bool NearAllowed(Bot B, int k, MonsterWaypoint WP)
{
	if (k < 0)
		return false;
	if (SNearWP[k] != WP.Position)
	{
		SNearWP[k] = WP.Position;
		SNearSince[k] = Level.TimeSeconds;
		return true;
	}
	if (Level.TimeSeconds - SNearSince[k] <= 20)
		return true;
	if (SNearLog[k] == WP.Position)
	{
		SNearLog[k] = -1;
		BotLog(BName(B) $ ": did not reach waypoint" @ WP.Position @ "via the path point next to it in 20 s, skips it");
	}
	return false;
}

function Actor PathWithJumps(Bot B, Actor Goal)
{
	local Actor A;
	local float OldJumpZ;

	OldJumpZ = B.JumpZ;
	B.JumpZ = FMax(OldJumpZ, 1.6 * B.Default.JumpZ);
	A = B.FindPathToward(Goal);
	B.JumpZ = OldJumpZ;
	if (JumpSpot(A) != None && A.Location.Z - B.Location.Z
		> Square(B.JumpZ) / (2 * FMax(1, Abs(B.Region.Zone.ZoneGravity.Z))) + B.MaxStepHeight)
	{
		// higher than a normal jump can reach (meant for a translocator)
		JumpSpot(A).PendingBot = None;
		return None;
	}
	return A;
}

// The path point next to A (within 250 units, in sight), cached per goal.
function NavigationPoint NodeNear(Actor A)
{
	local int i;
	local NavigationPoint N, Best;
	local float D, BestD;

	for (i = 0; i < NumNear; i++)
		if (NearGoal[i] == A)
			return NearNode[i];
	for (N = Level.NavigationPointList; N != None; N = N.nextNavigationPoint)
	{
		if (LiftCenter(N) != None || Teleporter(N) != None)
			continue;
		D = VSize(N.Location - A.Location);
		if (D < 250 && (Best == None || D < BestD) && FastTrace(A.Location, N.Location))
		{
			Best = N;
			BestD = D;
		}
	}
	if (NumNear < 16)
	{
		NearGoal[NumNear] = A;
		NearNode[NumNear] = Best;
		NumNear++;
	}
	return Best;
}

// No route to Goal itself (a waypoint or trigger right at a switch, for example): head for the
// path point next to it; once there (or close and in sight), walk straight to Goal.
function Actor PathNear(Bot B, Actor Goal)
{
	local NavigationPoint Best;
	local float BestD;
	local Actor A;
	local int k;

	// close, in sight and on about the same height: walk straight there
	if (VSize(Goal.Location - B.Location) < 250 && FastTrace(Goal.Location, B.Location)
		&& Abs(Goal.Location.Z - B.Location.Z) < B.CollisionHeight + B.MaxStepHeight + 30)
		return Goal;
	Best = NodeNear(Goal);
	if (Best == None)
		return None;
	if (VSize(Best.Location - B.Location) < 48)
		return None; // standing on it and the goal is still out of reach
	BestD = VSize(Best.Location - Goal.Location);
	A = B.FindPathToward(Best);
	if (A == None)
		A = PathWithJumps(B, Best);
	k = FindSlot(B);
	if (k >= 0 && MonsterWaypoint(Goal) != None && SNearLog[k] != MonsterWaypoint(Goal).Position)
	{
		SNearLog[k] = MonsterWaypoint(Goal).Position;
		if (A != None)
			BotLog(BName(B) $ ": no route to" @ What(Goal) @ "itself, goes via" @ Best.Name @ "next to it ("
				$ int(BestD) @ "away)");
		else
			BotLog(BName(B) $ ": no route to" @ What(Goal) @ "and none to" @ Best.Name @ "next to it either, from"
				@ Where(B.Location));
	}
	return A;
}

function NoteGoal(Bot B, int k, Actor Goal)
{
	if (k < 0 || SGoal[k] == Goal)
		return;
	SGoal[k] = Goal;
	BotLog(BName(B) $ ": goal" @ What(Goal) @ "(" $ int(VSize(Goal.Location - B.Location)) @ "away), next path point"
		@ What(B.MoveTarget));
}

function NoteNoPath(Bot B, int k, MonsterWaypoint WP)
{
	if (k < 0 || SNoPath[k] == WP.Position)
		return;
	SNoPath[k] = WP.Position;
	BotLog(BName(B) $ ": no path to waypoint" @ WP.Position @ "from" @ Where(B.Location)
		$ ", skipped (Monster Hunt rule)");
}

function NoteJump(Bot B, int k, MonsterWaypoint WP, Actor Hop)
{
	if (k < 0 || SJumpLog[k] == WP.Position)
		return;
	SJumpLog[k] = WP.Position;
	BotLog(BName(B) $ ": waypoint" @ WP.Position @ "only with a jump (JumpSpot), next path point" @ What(Hop));
}

//-----------------------------------------------------------------------------
// Timer: mover guard every 0.25 s, stuck check and waypoint log every second

function Timer()
{
	local Pawn P;
	local Bot B;
	local int k;
	local bool bSecond;

	if (!bMoversLogged)
		InitMap();
	if (!RunActive())
	{
		// before the start, in a pause, after the end: nothing to watch, start fresh later
		for (k = 0; k < 32; k++)
		{
			SStill[k] = 0;
			if (SBot[k] != None)
				SRefLoc[k] = SBot[k].Location;
			ClearHold(k);
		}
		return;
	}
	TickCount++;
	bSecond = (TickCount % 4) == 0;
	WatchMovers();
	if (bSecond)
	{
		LogVisited();
		LogObjectives();
	}
	for (P = Level.PawnList; P != None; P = P.NextPawn)
	{
		B = Bot(P);
		if (B == None)
			continue;
		if (B.bDeleteMe || B.Health <= 0)
		{
			k = FindSlot(B);
			if (k >= 0)
			{
				ClearHold(k);
				SStill[k] = 0;
			}
			continue;
		}
		if (B.PlayerReplicationInfo == None || B.PlayerReplicationInfo.Team != 0 || B.PlayerReplicationInfo.bIsSpectator)
			continue;
		k = Slot(B);
		if (k < 0)
			continue;
		GuardBot(B, k);
		if (bSecond)
			StuckCheck(B, k);
	}
}

function LogVisited()
{
	local int i;

	for (i = 0; i < NumPoints; i++)
		if (waypoints[i] != None && waypoints[i].bVisited && VisitedLogged[i] == 0)
		{
			VisitedLogged[i] = 1;
			BotLog("waypoint" @ waypoints[i].Position @ "reached, nearest hunter" @ BName(NearestHunter(waypoints[i].Location)));
		}
}

function Pawn NearestHunter(vector V)
{
	local Pawn P, Best;
	local float D, BestD;

	for (P = Level.PawnList; P != None; P = P.NextPawn)
		if (P.bIsPlayer && P.Health > 0 && P.PlayerReplicationInfo != None && P.PlayerReplicationInfo.Team == 0
			&& !P.PlayerReplicationInfo.bIsSpectator && !P.IsA('ScriptedPawn'))
		{
			D = VSize(P.Location - V);
			if (Best == None || D < BestD)
			{
				Best = P;
				BestD = D;
			}
		}
	return Best;
}

//-----------------------------------------------------------------------------
// 3. Movers

// After waiting for M (or giving up), the bot does not wait for it again for 10 s - movers that
// never rest (pounding, looping) cannot hold a bot forever, and the stuck check can take over.
// Making room at a lift (kind 3) does not keep the bot from stepping away from under it (kind 1).
function bool Cooling(Bot B, Mover M, byte Kind)
{
	local int k;
	k = FindSlot(B);
	if (k < 0 || SCoolMover[k] != M || Level.TimeSeconds >= SCoolUntil[k])
		return false;
	return Kind != 1 || SCoolKind[k] == 1;
}

// Movers that turn back (or stop) when they hit somebody; the others (crush, ignore) are left alone.
function bool Guards(Mover M)
{
	return M != None && int(M.MoverEncroachType) < 2; // 0 = ME_StopWhenEncroach, 1 = ME_ReturnWhenEncroach
}

// Moving, or triggered and waiting to move (DelayTime) - any mover of its return group.
function bool MoverBusy(Mover M)
{
	local Mover L;
	local int n;

	L = M.Leader;
	if (L == None)
		L = M;
	// Movers without an own tag share the default ReturnGroup across the whole map: only the
	// members close to M count.
	while (L != None && n < 64)
	{
		if ((L.bInterpolating || L.bDelaying) && VSize(L.Location - M.Location) < 1024)
			return true;
		L = L.Follower;
		n++;
	}
	return false;
}

// Where the lift's LiftCenter is now (the lift's position plus the map's offset).
function vector LiftSpot(Mover M)
{
	if (LiftCenter(M.myMarker) != None)
		return M.Location + LiftCenter(M.myMarker).LiftOffset;
	return M.myMarker.Location;
}

// Once, right at the level start (before the countdown): map bug fix, then the movers, objectives
// and key monsters to watch.
function InitMap()
{
	local Mover M;
	local MonsterHuntObjective O;
	local ScriptedPawn SP;
	local int n, Fixed;
	local string S;

	bMoversLogged = true;
	foreach AllActors(class'Mover', M)
	{
		if (OnceOnlyTurnsBack(M))
		{
			// After turning back it waits for its trigger again, which fired already (once only).
			M.SetPropertyText("MoverEncroachType", "ME_IgnoreWhenEncroach");
			Fixed++;
			BotLog("map fix:" @ M.Name @ "tag" @ M.Tag @ "state" @ M.InitialState
				@ "opens only once and would stay closed after a touch: it no longer turns back");
			continue;
		}
		if (!Guards(M))
			continue;
		n++;
		if (NumWatched < 64)
		{
			Watched[NumWatched] = M;
			WOpening[NumWatched] = 0;
			if (M.bOpening)
				WOpening[NumWatched] = 1;
			WFlip[NumWatched] = -100;
			NumWatched++;
		}
		S = "";
		if (LiftCenter(M.myMarker) != None)
		{
			S = ", lift";
			if (NumLifts < 32)
			{
				Lifts[NumLifts] = M;
				NumLifts++;
			}
		}
		if (n <= 60)
			BotLog("mover" @ M.Name @ "tag" @ M.Tag @ "state" @ M.InitialState @ "group" @ M.ReturnGroup $ S
				$ ": turns back on contact, bots keep their distance while it moves");
	}
	BotLog("movers watched:" @ n $ ", lifts:" @ NumLifts $ ", map fixes:" @ Fixed);

	foreach AllActors(class'MonsterHuntObjective', O)
		if (NumObjectives < 32)
		{
			Objectives[NumObjectives] = O;
			ObjState[NumObjectives] = ObjectiveState(O);
			NumObjectives++;
		}
	foreach AllActors(class'ScriptedPawn', SP)
		if (SP.Event != '' && SP.Health > 0 && NumKeyMonsters < 32 && !SP.IsA('Nali') && !SP.IsA('Cow'))
		{
			KeyMonsters[NumKeyMonsters] = SP;
			KeyEvent[NumKeyMonsters] = SP.Event;
			KeyName[NumKeyMonsters] = SP.Name;
			NumKeyMonsters++;
			BotLog("key monster:" @ SP.Name @ "- its death triggers" @ SP.Event);
		}
}

// The map bug pattern: a TriggerOpenTimed mover that opens once (bTriggerOnceOnly) and turns back
// when it hits a pawn (Mover's default). After turning back it waits for a trigger that already
// fired. Movers that hurt (EncroachDamage, traps) keep their behaviour; bump and stand movers can
// simply be opened again.
function bool OnceOnlyTurnsBack(Mover M)
{
	return M.bTriggerOnceOnly && int(M.MoverEncroachType) == 1 && M.EncroachDamage <= 0
		&& M.InitialState == 'TriggerOpenTimed';
}

function byte ObjectiveState(MonsterHuntObjective O)
{
	if (O.bCompleted)
		return 2;
	if (O.bActive)
		return 1;
	return 0;
}

function LogObjectives()
{
	local int i;
	local byte St;

	for (i = 0; i < NumObjectives; i++)
	{
		if (Objectives[i] == None)
			continue;
		St = ObjectiveState(Objectives[i]);
		if (St == ObjState[i])
			continue;
		ObjState[i] = St;
		if (St == 2)
			BotLog("objective completed:" @ Objectives[i].Message);
		else if (St == 1)
			BotLog("objective active:" @ Objectives[i].Message);
	}
	for (i = 0; i < NumKeyMonsters; i++)
		if (KeyDead[i] == 0 && (KeyMonsters[i] == None || KeyMonsters[i].bDeleteMe || KeyMonsters[i].Health <= 0))
		{
			KeyDead[i] = 1;
			BotLog("key monster dead:" @ KeyName[i] @ "- triggers" @ KeyEvent[i]);
		}
}

// Logs a mover that changes direction before its move is done (it hit somebody), with the
// nearest pawn - a bot, a player or a monster.
function WatchMovers()
{
	local int i;
	local Mover M;
	local byte Op;
	local Pawn P;
	local float D;
	local string S;

	for (i = 0; i < NumWatched; i++)
	{
		M = Watched[i];
		if (M == None)
			continue;
		Op = 0;
		if (M.bOpening)
			Op = 1;
		if (Op == WOpening[i])
			continue;
		if (M.MoveTime >= 0.5 && Level.TimeSeconds - WFlip[i] < M.MoveTime - 0.1)
		{
			P = NearestPawn(M.Location, D);
			if (Op == 0)
				S = "while opening";
			else
				S = "while closing";
			BotLog("mover" @ M.Name @ "(" $ M.Tag $ ") turned back" @ S $ ", nearest pawn" @ PawnText(P) @ int(D)
				@ "away");
		}
		WOpening[i] = Op;
		WFlip[i] = Level.TimeSeconds;
	}
}

function Pawn NearestPawn(vector V, out float BestD)
{
	local Pawn P, Best;
	local float D;

	for (P = Level.PawnList; P != None; P = P.NextPawn)
	{
		if (P.Health <= 0 || P.IsA('Spectator')
			|| (P.PlayerReplicationInfo != None && P.PlayerReplicationInfo.bIsSpectator))
			continue;
		D = VSize(P.Location - V);
		if (Best == None || D < BestD)
		{
			Best = P;
			BestD = D;
		}
	}
	return Best;
}

function string PawnText(Pawn P)
{
	if (P == None)
		return "none";
	if (ScriptedPawn(P) != None)
		return "monster" @ P.Name;
	if (Bot(P) != None)
		return "bot" @ BName(P);
	return "player" @ BName(P);
}

function GuardBot(Bot B, int k)
{
	local Mover M;
	local vector Danger;

	if (SHoldKind[k] != 0)
	{
		CheckRelease(B, k);
		return;
	}
	if (B.Physics != PHYS_Walking)
		return;
	M = LiftAbove(B);
	if (M != None)
	{
		Danger = LiftSpot(M);
		Danger.Z = B.Location.Z;
		StartHold(B, k, M, 1, Danger);
		return;
	}
	M = LiftCrowded(B, k);
	if (M != None)
	{
		Danger = LiftSpot(M);
		Danger.Z = B.Location.Z;
		StartHold(B, k, M, 3, Danger);
		return;
	}
	M = MoverAhead(B, Danger);
	if (M != None)
		StartHold(B, k, M, 2, Danger);
}

// Another bot is held under lift M and wants out; this bot stands close to the lift (e.g. waiting
// at its exit) and could block the way: it makes room.
function Mover LiftCrowded(Bot B, int k)
{
	local int i;
	local Mover M;

	for (i = 0; i < NumLifts; i++)
	{
		M = Lifts[i];
		if (M == None || B.Base == M || Cooling(B, M, 3))
			continue;
		if (VSize(Flat(LiftSpot(M) - B.Location)) < 180 && SomeoneUnder(M, k))
			return M;
	}
	return None;
}

// A bot (other than slot k) held because lift M is above it, still in the lift's shaft.
function bool SomeoneUnder(Mover M, int k)
{
	local int j;

	for (j = 0; j < 32; j++)
		if (j != k && SHoldKind[j] == 1 && SHoldMover[j] == M && SBot[j] != None && SBot[j].Health > 0
			&& VSize(Flat(LiftSpot(M) - SBot[j].Location)) < 130)
			return true;
	return false;
}

// A lift right above the bot that can come down on it: it moves, or the bot wants to ride it.
function Mover LiftAbove(Bot B)
{
	local int i;
	local Mover M;
	local Actor A;
	local vector Start, HitLoc, HitNorm;
	local bool bRelevant;

	for (i = 0; i < NumLifts; i++)
	{
		M = Lifts[i];
		if (M == None || M.myMarker == None || B.Base == M || Cooling(B, M, 1))
			continue;
		if (VSize(Flat(LiftSpot(M) - B.Location)) > 400)
			continue;
		bRelevant = MoverBusy(M) || B.MoveTarget == M.myMarker
			|| (LiftExit(B.MoveTarget) != None && LiftExit(B.MoveTarget).LiftTag == M.Tag);
		if (!bRelevant)
			continue;
		Start = B.Location + vect(0,0,1) * (B.CollisionHeight + 2);
		A = B.Trace(HitLoc, HitNorm, Start + vect(0,0,1200), Start, true);
		if (A == M)
			return M;
	}
	return None;
}

// A mover that moves or waits to move right in front of the bot (two heights).
function Mover MoverAhead(Bot B, out vector Danger)
{
	local vector Dir, Start, HitLoc, HitNorm;
	local Actor A;
	local int i;

	Dir = Flat(B.Velocity);
	if (VSize(Dir) < 40)
		Dir = Flat(B.Destination - B.Location);
	if (VSize(Dir) < 1)
		return None;
	Dir = Normal(Dir);
	for (i = 0; i < 2; i++)
	{
		Start = B.Location + vect(0,0,1) * ((i - 0.5) * B.CollisionHeight);
		A = B.Trace(HitLoc, HitNorm, Start + Dir * (B.CollisionRadius + 48), Start, true);
		if (Mover(A) != None && A != B.Base && Guards(Mover(A)) && !Cooling(B, Mover(A), 2) && MoverBusy(Mover(A)))
		{
			Danger = HitLoc;
			return Mover(A);
		}
	}
	return None;
}

function StartHold(Bot B, int k, Mover M, byte Kind, vector Danger)
{
	local NavigationPoint N;

	N = FindHoldPoint(B, M, Kind, Danger);
	if (N == None)
	{
		if (Level.TimeSeconds - SNoPlaceLog[k] > 10)
		{
			SNoPlaceLog[k] = Level.TimeSeconds;
			BotLog(BName(B) $ ": too close to" @ M.Name @ "at" @ Where(B.Location) $ ", but no place to wait found");
		}
		return;
	}
	SHoldMover[k] = M;
	SHoldPoint[k] = N;
	SHoldKind[k] = Kind;
	SHoldSince[k] = Level.TimeSeconds;
	SRestSince[k] = -1;
	if (Kind == 1)
		BotLog(BName(B) $ ": under lift" @ M.Name @ "(" $ M.Tag $ ") at" @ Where(B.Location) $ ", waits at" @ N.Name
			@ "until it is on this level");
	else if (Kind == 3)
		BotLog(BName(B) $ ": makes room at lift" @ M.Name @ "(" $ M.Tag $ ") for a bot under it, waits at" @ N.Name);
	else
		BotLog(BName(B) $ ":" @ M.Name @ "(" $ M.Tag $ ") moves in front of it at" @ Where(B.Location) $ ", waits at"
			@ N.Name @ "until it has stopped");
	MoveBot(B, N);
}

// Where to wait: for a lift one of its exits on the bot's level, otherwise the nearest path point
// at least 160 units from the mover, on the bot's side of it.
function NavigationPoint FindHoldPoint(Bot B, Mover M, byte Kind, vector Danger)
{
	local NavigationPoint N, Best;
	local float D, BestD;
	local vector Away;

	if (Kind == 1 || Kind == 3)
	{
		// first choice: a free path point on this level, 250-700 units from the lift, so nobody
		// waiting there blocks the way out of the shaft
		for (N = Level.NavigationPointList; N != None; N = N.nextNavigationPoint)
		{
			if (LiftCenter(N) != None || Teleporter(N) != None || HoldPointTaken(N))
				continue;
			D = VSize(N.Location - B.Location);
			if (D > 700 || Abs(N.Location.Z - B.Location.Z) > 80 || VSize(Flat(N.Location - Danger)) < 250)
				continue;
			if (!FastTrace(N.Location, B.Location))
				continue;
			if (Best == None || D < BestD)
			{
				Best = N;
				BestD = D;
			}
		}
		if (Best != None)
			return Best;
		for (N = Level.NavigationPointList; N != None; N = N.nextNavigationPoint)
			if (LiftExit(N) != None && LiftExit(N).LiftTag == M.Tag && Abs(N.Location.Z - B.Location.Z) < 80)
			{
				D = VSize(N.Location - B.Location);
				if (Best == None || D < BestD)
				{
					Best = N;
					BestD = D;
				}
			}
		if (Best != None)
			return Best;
	}
	Away = Flat(B.Location - Danger);
	if (VSize(Away) < 1)
		Away = -Flat(B.Destination - B.Location);
	if (VSize(Away) < 1)
		return None;
	Away = Normal(Away);
	for (N = Level.NavigationPointList; N != None; N = N.nextNavigationPoint)
	{
		if (LiftCenter(N) != None || Teleporter(N) != None)
			continue;
		D = VSize(N.Location - B.Location);
		if (D > 700 || Abs(N.Location.Z - B.Location.Z) > 120)
			continue;
		if (VSize(Flat(N.Location - Danger)) < 160 || (Flat(N.Location - Danger) Dot Away) <= 0)
			continue;
		if (!FastTrace(N.Location, B.Location))
			continue;
		if (Best == None || D < BestD)
		{
			Best = N;
			BestD = D;
		}
	}
	return Best;
}

function bool HoldPointTaken(NavigationPoint N)
{
	local int j;
	for (j = 0; j < 32; j++)
		if (SHoldKind[j] != 0 && SHoldPoint[j] == N)
			return true;
	return false;
}

// While held: walk to the waiting point, then stand there (re-checked twice a second).
function bool HoldBot(Bot B, int k)
{
	if (SHoldPoint[k] == None)
	{
		ClearHold(k);
		return false;
	}
	B.LastAttractCheck = Level.TimeSeconds;
	if (VSize(Flat(B.Location - SHoldPoint[k].Location)) < 48)
	{
		B.MoveTarget = SHoldPoint[k];
		B.SpecialPause = 0.5;
	}
	else if (B.ActorReachable(SHoldPoint[k]))
		B.MoveTarget = SHoldPoint[k];
	else
	{
		B.MoveTarget = B.FindPathToward(SHoldPoint[k]);
		if (B.MoveTarget == None)
			B.MoveTarget = SHoldPoint[k];
	}
	SetAttractionStateFor(B);
	return true;
}

function CheckRelease(Bot B, int k)
{
	local Mover M;
	local bool bReady;
	local string Why;

	M = SHoldMover[k];
	if (M == None)
	{
		ClearHold(k);
		return;
	}
	if (Level.TimeSeconds - SHoldSince[k] > 30)
	{
		BotLog(BName(B) $ ": stops waiting for" @ M.Name @ "after 30 s");
		ClearHold(k);
		return;
	}
	if (SHoldKind[k] == 3)
	{
		if (SomeoneUnder(M, k))
			return;
		BotLog(BName(B) $ ": nobody under lift" @ M.Name @ "any more after" @ int(Level.TimeSeconds - SHoldSince[k])
			@ "s, goes on");
		ClearHold(k);
		B.SpecialPause = 0;
		SRefLoc[k] = B.Location;
		return;
	}
	if (MoverBusy(M))
	{
		SRestSince[k] = -1;
		return;
	}
	if (SHoldKind[k] == 1)
	{
		if (Abs(LiftSpot(M).Z - B.Location.Z) < B.CollisionHeight + 24)
		{
			bReady = true;
			Why = "is on this level";
		}
		else if (SRestSince[k] < 0)
			SRestSince[k] = Level.TimeSeconds;
		else if (Level.TimeSeconds - SRestSince[k] >= 6)
		{
			bReady = true;
			Why = "stays on the other level";
		}
	}
	else
	{
		bReady = true;
		Why = "has stopped";
	}
	if (!bReady)
		return;
	BotLog(BName(B) $ ":" @ M.Name @ Why @ "after" @ int(Level.TimeSeconds - SHoldSince[k]) @ "s, goes on");
	ClearHold(k);
	B.SpecialPause = 0;
	SRefLoc[k] = B.Location;
}

// Sends the bot to N now (MoveTarget alone would wait until its current move ends).
function MoveBot(Bot B, Actor N)
{
	B.MoveTarget = N;
	B.SpecialPause = 0;
	if (!B.IsInState('Roaming') && !B.IsInState('Wandering') && !B.IsInState('FallBack'))
		return; // fighting etc.: the next attraction check picks it up
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
}

//-----------------------------------------------------------------------------
// 4. Stuck bots

function StuckCheck(Bot B, int k)
{
	if (VSize(B.Location - SRefLoc[k]) > 150)
	{
		if (SStill[k] >= 3)
			BotLog(BName(B) $ ": moves again after" @ SStill[k] @ "s");
		SStill[k] = 0;
		SRefLoc[k] = B.Location;
		return;
	}
	// In the air (also after our own jump), waiting or fighting: not counted, but not reset either.
	if (B.Physics == PHYS_Falling || !MayBeStuck(B, k))
		return;
	SStill[k]++;
	if (SStill[k] == 3 && SErrand[k] == None && Level.TimeSeconds - SResolveAt[k] > 10 && ClosedDoorErrand(B, k))
		return;
	if (SStill[k] == 3 || SStill[k] == 5)
		JumpAside(B, k);
	else if (SStill[k] == 8 || SStill[k] == 14)
		Detour(B, k);
	else if (SStill[k] >= 20)
		FreeRespawn(B, k);
}

function bool MayBeStuck(Bot B, int k)
{
	if (SHoldKind[k] != 0 || B.SpecialPause > 0 || B.MoveTarget == None)
		return false;
	if (B.bCamping || VSize(B.Acceleration) < 1 || B.Orders == 'Hold' || B.Orders == 'Follow' || B.IsInState('StakeOut'))
		return false; // standing still on purpose
	if (Mover(B.Base) != None)
		return false; // riding a mover
	if (B.Enemy != None && B.LineOfSightTo(B.Enemy))
		return false; // fighting
	if (LiftCenter(B.MoveTarget) != None && JumpSpot(B.MoveTarget) == None)
		return false; // waiting for a lift (a JumpSpot is a LiftCenter too, but nothing comes there)
	if (LiftExit(B.MoveTarget) != None && VSize(B.Location - B.MoveTarget.Location) < 60)
		return false;
	return !B.IsInState('GameEnded') && !B.IsInState('Dying');
}

function vector MoveDir(Bot B)
{
	local vector Dir;

	Dir = Flat(B.MoveTarget.Location - B.Location);
	if (VSize(Dir) < 1)
		Dir = Flat(vector(B.Rotation));
	return Normal(Dir);
}

function JumpAside(Bot B, int k)
{
	local vector Dir, Side;
	local string S;

	Dir = MoveDir(B);
	Side = Normal(Dir Cross vect(0,0,1));
	S = "right";
	if (SJumpSide[k] != 0)
	{
		Side = -Side;
		S = "left";
	}
	SJumpSide[k] = 1 - SJumpSide[k];
	if (!FloorAt(B, B.Location + Side * 150 + Dir * 100))
	{
		Side = -Side;
		if (S == "right")
			S = "left";
		else
			S = "right";
		if (!FloorAt(B, B.Location + Side * 150 + Dir * 100))
		{
			BotLog(BName(B) $ ": stuck for" @ SStill[k] @ "s at" @ Where(B.Location) $ ", heading for"
				@ What(B.MoveTarget) $ ": no floor beside it, does not jump");
			return;
		}
	}
	BotLog(BName(B) $ ": stuck for" @ SStill[k] @ "s at" @ Where(B.Location) $ ", heading for" @ What(B.MoveTarget)
		$ " (goal" @ What(SGoal[k]) $ "): jumps to the" @ S);
	B.Velocity = Side * 220 + Dir * 180;
	B.Velocity.Z = B.JumpZ;
	B.SetPhysics(PHYS_Falling);
	B.bJumpOffPawn = true;
	B.SetFall();
}

// Floor within a normal step down below V (no jump into a pit; lava cannot be told apart here).
function bool FloorAt(Bot B, vector V)
{
	local vector HitLoc, HitNorm;
	return B.Trace(HitLoc, HitNorm, V - vect(0,0,1) * (B.CollisionHeight + 120), V, false) != None;
}

// A reachable path point 150-900 units away, not the one it is stuck on, preferably to the side
// or behind; the bot walks there and then searches its route again.
function Detour(Bot B, int k)
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
		if (D < 150 || D > 900 || Abs(N.Location.Z - B.Location.Z) > 200)
			continue;
		Score = 1.5 - (Normal(Flat(N.Location - B.Location)) Dot Dir) + FRand();
		if (Best != None && Score <= BestScore)
			continue;
		Tried++;
		if (!B.ActorReachable(N))
			continue;
		Best = N;
		BestScore = Score;
	}
	if (Best == None)
	{
		BotLog(BName(B) $ ": stuck for" @ SStill[k] @ "s at" @ Where(B.Location) $ ", no detour found");
		return;
	}
	BotLog(BName(B) $ ": stuck for" @ SStill[k] @ "s at" @ Where(B.Location) $ ", heading for" @ What(B.MoveTarget)
		$ ": detour via" @ Best.Name);
	MoveBot(B, Best);
}

// Last resort: back to a start spot without dying (no death, no lost life, no score change).
function FreeRespawn(Bot B, int k)
{
	local NavigationPoint N;
	local vector Was;

	Was = B.Location;
	SStill[k] = 0;
	N = Level.Game.FindPlayerStart(B, 0);
	if (N == None || !B.SetLocation(N.Location))
	{
		BotLog(BName(B) $ ": stuck for 20 s at" @ Where(Was) $ ", respawn failed (no free start spot)");
		SRefLoc[k] = B.Location;
		return;
	}
	B.SetRotation(N.Rotation);
	B.Velocity = vect(0,0,0);
	B.Acceleration = vect(0,0,0);
	B.MoveTarget = None;
	B.SpecialPause = 0;
	SRefLoc[k] = B.Location;
	SGoal[k] = None;
	SNoPath[k] = -1;
	SJumpLog[k] = -1;
	BotLog(BName(B) $ ": stuck for 20 s at" @ Where(Was) $ ", penalty-free respawn at" @ N.Name @ "(no death counted)");
	if (B.IsInState('Roaming') || B.IsInState('Wandering') || B.IsInState('FallBack'))
		B.GotoState('Roaming', 'RunAway');
}

//-----------------------------------------------------------------------------
// 6. Closed doors: what opens them

// Called when a bot is stuck: a closed mover at rest right in front of it? The stuck count goes on
// (an errand that does not help still ends in the respawn).
function bool ClosedDoorErrand(Bot B, int k)
{
	local Mover M;
	local Actor T;
	local string Chain;
	local int Budget;

	SResolveAt[k] = Level.TimeSeconds;
	M = ClosedMoverAhead(B);
	if (M == None)
		return false;
	if (SErrandMover[k] == M && SErrandCount[k] >= 2)
		return false; // tried twice for this door: leave it to jumps, detours and the respawn
	Budget = 12;
	T = FindOpener(B, k, M, M.Tag, 0, Chain, Budget);
	if (T == None)
	{
		BotLog(BName(B) $ ": stuck at closed" @ M.Name @ "(" $ M.Tag $ ") at" @ Where(B.Location)
			$ ", nothing found that could still open it");
		return false;
	}
	if (SErrandMover[k] != M)
	{
		SErrandMover[k] = M;
		SErrandCount[k] = 0;
	}
	SErrandUsedAt[k] = -1;
	SErrand[k] = T;
	SErrandFor[k] = M;
	SErrandSince[k] = Level.TimeSeconds;
	BotLog(BName(B) $ ": stuck at closed" @ M.Name @ "(" $ M.Tag $ ") at" @ Where(B.Location) $ ", opened by:" @ Chain
		$ " ->" @ ErrandVerb(T) @ T.Name);
	return true;
}

function string ErrandVerb(Actor T)
{
	if (ScriptedPawn(T) != None)
		return "hunts";
	if (Mover(T) != None)
		return "bumps";
	return "goes to";
}

// A mover at rest in its closed position (first key) right in front of the bot.
function Mover ClosedMoverAhead(Bot B)
{
	local vector Dir, Start, HitLoc, HitNorm;
	local Actor A;
	local Mover M;
	local int i;

	Dir = MoveDir(B);
	for (i = 0; i < 2; i++)
	{
		Start = B.Location + vect(0,0,1) * ((i - 0.5) * B.CollisionHeight);
		A = B.Trace(HitLoc, HitNorm, Start + Dir * (B.CollisionRadius + 80), Start, true);
		M = Mover(A);
		if (M != None && M != B.Base && M.KeyNum == 0 && !M.bInterpolating && !M.bDelaying)
			return M;
	}
	return None;
}

// What can still open the movers with tag T, nearest to the bot: a living monster whose death
// triggers T, a trigger the bot can still fire, a button mover not pressed yet. Relays (counters,
// special events, closed movers that fire an event when open, dispatchers, round robins) are
// followed back, at most 4 steps and 12 actor scans in all.
function Actor FindOpener(Bot B, int k, Mover Door, name T, int Depth, out string Chain, out int Budget)
{
	local Actor A, R, Best;
	local Dispatcher Dsp;
	local RoundRobin RR;
	local float D, BestD;
	local string Sub, BestChain;
	local int i;

	if (T == '' || T == 'None' || Depth > 3 || Budget <= 0)
		return None;
	Budget--;
	foreach AllActors(class'Actor', A)
	{
		if (A.Event != T || A.bDeleteMe || A == Door)
			continue;
		R = None;
		Sub = "";
		if (ScriptedPawn(A) != None)
		{
			if (Pawn(A).Health > 0 && Huntable(ScriptedPawn(A), B))
				R = A;
		}
		else if (Trigger(A) != None)
		{
			if (A.bCollideActors && Trigger(A).IsRelevant(B))
				R = A;
		}
		else if (Mover(A) != None)
		{
			if (Mover(A).KeyNum == 0 && !Mover(A).bInterpolating)
			{
				if (A.IsInState('BumpOpenTimed') || A.IsInState('BumpButton') || A.IsInState('StandOpenTimed'))
					R = A;
				else
					R = FindOpener(B, k, Door, A.Tag, Depth + 1, Sub, Budget); // a door that opens a door
			}
		}
		else if (A.IsA('Counter') || A.IsA('SpecialEvent'))
			R = FindOpener(B, k, Door, A.Tag, Depth + 1, Sub, Budget);
		if (R == None || Failed(k, Door, R))
			continue;
		D = VSize(R.Location - B.Location);
		if (Best == None || D < BestD)
		{
			Best = R;
			BestD = D;
			if (Sub != "")
				BestChain = A.Name @ "<-" @ Sub;
			else
				BestChain = string(A.Name);
		}
	}
	if (Budget > 0)
		foreach AllActors(class'Dispatcher', Dsp)
			for (i = 0; i < 8; i++)
				if (Dsp.OutEvents[i] == T)
				{
					Sub = "";
					R = FindOpener(B, k, Door, Dsp.Tag, Depth + 1, Sub, Budget);
					if (R != None && !Failed(k, Door, R))
					{
						D = VSize(R.Location - B.Location);
						if (Best == None || D < BestD)
						{
							Best = R;
							BestD = D;
							BestChain = Dsp.Name @ "<-" @ Sub;
						}
					}
					break;
				}
	if (Budget > 0)
		foreach AllActors(class'RoundRobin', RR)
			for (i = 0; i < 16; i++)
				if (RR.OutEvents[i] == T)
				{
					Sub = "";
					R = FindOpener(B, k, Door, RR.Tag, Depth + 1, Sub, Budget);
					if (R != None && !Failed(k, Door, R))
					{
						D = VSize(R.Location - B.Location);
						if (Best == None || D < BestD)
						{
							Best = R;
							BestD = D;
							BestChain = RR.Name @ "<-" @ Sub;
						}
					}
					break;
				}
	Chain = BestChain;
	return Best;
}

function bool Failed(int k, Mover Door, Actor R)
{
	return SFailOpener[k] == R && SFailMover[k] == Door && Level.TimeSeconds < SFailUntil[k];
}

// The errand did not open the door: that opener is not chosen again for this door for 120 s.
function EndErrand(Bot B, int k, string Why, bool bFailed)
{
	BotLog(BName(B) $ ": errand for" @ What(SErrandFor[k]) @ "ends," @ Why);
	if (bFailed && SErrandMover[k] == SErrandFor[k])
		SErrandCount[k]++;
	if (bFailed && SErrand[k] != None && SErrandFor[k] != None)
	{
		SFailOpener[k] = SErrand[k];
		SFailMover[k] = SErrandFor[k];
		SFailUntil[k] = Level.TimeSeconds + 120;
	}
	SErrand[k] = None;
	SErrandFor[k] = None;
}

// While the bot has an errand: go there; a monster in sight is attacked.
// 0 = no errand (any more), 1 = the bot was sent, 2 = it fights the target (normal combat goes on).
function int DoErrand(Bot B, int k)
{
	local Actor T, Hop;
	local Mover M;
	local byte bJump;

	T = SErrand[k];
	M = SErrandFor[k];
	if (M == None || M.KeyNum != 0 || M.bInterpolating || M.bDelaying)
	{
		EndErrand(B, k, "the door opens", false);
		return 0;
	}
	if (T == None || T.bDeleteMe)
	{
		EndErrand(B, k, "its target is gone", false);
		return 0;
	}
	if (Pawn(T) != None && Pawn(T).Health <= 0)
	{
		EndErrand(B, k, T.Name @ "is dead", false);
		return 0;
	}
	if ((Trigger(T) != None && !T.bCollideActors)
		|| (Mover(T) != None && (Mover(T).KeyNum != 0 || Mover(T).bInterpolating)))
	{
		// used: give the door 5 s (delayed events), then it counts as a failure
		if (SErrandUsedAt[k] < 0)
			SErrandUsedAt[k] = Level.TimeSeconds;
		else if (Level.TimeSeconds - SErrandUsedAt[k] > 5)
		{
			EndErrand(B, k, T.Name @ "was used, the door stays closed", true);
			return 0;
		}
		B.LastAttractCheck = Level.TimeSeconds;
		B.MoveTarget = T;
		if (VSize(Flat(T.Location - B.Location)) < 60)
			B.SpecialPause = 0.5;
		SetAttractionStateFor(B);
		return 1;
	}
	if (Level.TimeSeconds - SErrandSince[k] > 90)
	{
		EndErrand(B, k, "no success after 90 s", true);
		return 0;
	}
	if (Pawn(T) != None && B.LineOfSightTo(T))
	{
		if (B.Enemy != T)
			B.SetEnemy(Pawn(T));
		if (B.Enemy == T)
		{
			if (B.IsInState('Roaming') || B.IsInState('Wandering') || B.IsInState('FallBack'))
			{
				B.GotoState('Attacking');
				return 1;
			}
			return 2;
		}
	}
	B.LastAttractCheck = Level.TimeSeconds;
	Hop = PathTo(B, T, bJump, true);
	if (Hop == None)
	{
		EndErrand(B, k, "no route to" @ T.Name @ "from" @ Where(B.Location), true);
		return 0;
	}
	B.MoveTarget = Hop;
	SetAttractionStateFor(B);
	return 1;
}

// Not friendly Nali or cows (unless Monster Hunt says they are evil), not sitting titan statues.
function bool Huntable(ScriptedPawn P, Bot B)
{
	if ((P.IsA('Nali') || P.IsA('Cow')) && (game == None || !game.MaybeEvilFriendlyPawn(P, B)))
		return false;
	return !(P.IsA('Titan') && P.GetStateName() == 'Sitting');
}

// Monster Hunt lets bots fear big monsters (75+ units tall). A monster whose death opens the way
// is hunted instead, or bot-only teams never get past it.
function byte AssessBotAttitude(Bot aBot, Pawn Other)
{
	local int i;

	if (ScriptedPawn(Other) != None && Other.Health > 0 && Huntable(ScriptedPawn(Other), aBot))
		for (i = 0; i < NumKeyMonsters; i++)
			if (KeyMonsters[i] == Other)
			{
				if (aBot.LineOfSightTo(Other))
					return 1; // ATTITUDE_Hate
				break;
			}
	return Super.AssessBotAttitude(aBot, Other);
}

defaultproperties
{
}
