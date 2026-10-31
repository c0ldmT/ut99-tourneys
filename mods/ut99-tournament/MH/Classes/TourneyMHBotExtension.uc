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
//    keeps its distance while such a mover closes or waits to move in front of
//    it, and while a lift is above it, and goes on when the mover is ready (lift
//    on its level). Opening doors are not waited for (they move away).
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
// 8. Shielded targets: a monster the bots shoot at for seconds without hurting it (in a cage,
//    behind bars or a wall, e.g. MH-NaliVillage, MH-Forbidden) is left alone for a while; the
//    bots follow the waypoints and objectives, and when a mover (cage, gate) is in the way they
//    go to what opens it (as in 6). It counts again as soon as it takes damage or the mover
//    opens.
// 9. Empty weapons: a bot whose weapon has no ammo switches weapons; when no weapon has ammo
//    any more it fetches ammo or a weapon lying around instead of dodging about.
// 10. Focus (mod 0.17.0, Dream Team): the manager's Monster Hunt focus per bot (btrt "mf").
//    -2 hunter: big monsters are fought instead of feared, hostile monsters in sight within
//    1500 units are attacked; -1 thorough: the same while healthy (> 60), within 900 units.
//    1 brisk: monsters further than 1200 units are ignored, a fight with one monster that
//    lasts 8 s is broken off (that monster is left alone for 12 s unless it comes within 350
//    units); 2 sprinter: 600 units, 3 s, 20 s. Monsters whose death opens the way (key
//    monsters) and shielded targets keep their own rules (6, 8); behaviour traits keep acting
//    (a hurt vulture still retreats). 0: Monster Hunt's own behaviour.
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
var Pawn SEngaged[32];          // the monster the bot fights, since when, its health then
var float SEngagedSince[32];
var int SEngagedHealth[32];
var byte SEngagedFired[32];     // 1 = the bot fired at it since then
var Inventory SAmmoGoal[32];    // ammo or weapon the bot fetches (no weapon with ammo left)
var float SAmmoSince[32];
var float SAmmoLogAt[32];
var Inventory SAmmoSkip[32];    // item the last ammo run failed on, left out until SAmmoSkipUntil
var float SAmmoSkipUntil[32];
var Pawn SFightMon[32];         // 10. focus: the monster the bot fights, since when
var float SFightSince[32];
var Pawn SDropMon[32];          // the monster it broke off from, left alone until SDropUntil
var float SDropUntil[32];
var byte SFocusLogged[32];
var byte SFocus[32];            // the bot's focus + 3 (0: not looked up yet), refreshed once a second
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
var ScriptedPawn Shielded[16];  // monsters out of reach for now (cage, bars, wall)
var Mover ShieldMover[16];      // the mover in the way (None: level geometry)
var float ShieldUntil[16];
var int ShieldHealth[16];
var byte ShieldKey[16];         // the mover's key when it was marked
var int NumShielded;
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
	SEngaged[k] = None;
	SAmmoGoal[k] = None;
	SAmmoSkip[k] = None;
	SFightMon[k] = None;
	SDropMon[k] = None;
	SFocusLogged[k] = 0;
	SFocus[k] = 0;
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
		if (k >= 0 && SAmmoGoal[k] != None && AmmoRun(aBot, k))
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

		// the last reached waypoint has a target to attack (not while it is out of reach)
		if (lastVisited > -1 && waypoints[lastVisited].ArrivalTarget != None
			&& ShieldIndex(waypoints[lastVisited].ArrivalTarget) < 0)
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
				SEngaged[k] = None;
				SAmmoGoal[k] = None;
				SFightMon[k] = None;
			}
			continue;
		}
		if (B.PlayerReplicationInfo == None || B.PlayerReplicationInfo.Team != 0 || B.PlayerReplicationInfo.bIsSpectator)
			continue;
		k = Slot(B);
		if (k < 0)
			continue;
		GuardBot(B, k);
		WatchFire(B, k);
		if (bSecond)
		{
			StuckCheck(B, k);
			ShieldCheck(B, k);
			AmmoCheck(B, k);
			FocusCheck(B, k);
		}
	}
	if (bSecond)
		UpdateShields();
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

// A threat for a bot in front of it: closing, or waiting to move (DelayTime). A door that is
// opening moves away from the bot; waiting at a distance would only make a proximity door
// (TriggerControl) close again. Any mover of its return group near M counts.
function bool MoverThreat(Mover M)
{
	local Mover L;
	local int n;

	L = M.Leader;
	if (L == None)
		L = M;
	while (L != None && n < 64)
	{
		if ((L.bDelaying || (L.bInterpolating && !L.bOpening)) && VSize(L.Location - M.Location) < 1024)
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
		// TriggerControl/TriggerToggle/TriggerPound movers change direction on purpose
		if (M.MoveTime >= 0.5 && Level.TimeSeconds - WFlip[i] < M.MoveTime - 0.1 && M.InitialState != 'TriggerControl'
			&& M.InitialState != 'TriggerToggle' && M.InitialState != 'TriggerPound')
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
		if (Mover(A) != None && A != B.Base && Guards(Mover(A)) && !Cooling(B, Mover(A), 2) && MoverThreat(Mover(A)))
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
		BotLog(BName(B) $ ":" @ M.Name @ "(" $ M.Tag $ ") closes or is about to move in front of it at"
			@ Where(B.Location) $ ", waits at" @ N.Name);
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
	if (SHoldKind[k] == 2)
	{
		if (MoverThreat(M))
			return;
		BotLog(BName(B) $ ":" @ M.Name @ "no longer closes on it after" @ int(Level.TimeSeconds - SHoldSince[k])
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

	SResolveAt[k] = Level.TimeSeconds;
	M = ClosedMoverAhead(B);
	if (M == None)
		return false;
	return MoverErrand(B, k, M, "stuck at closed");
}

// Sends the bot to what opens closed mover M (Why: "stuck at closed", "target behind").
function bool MoverErrand(Bot B, int k, Mover M, string Why)
{
	local Actor T;
	local string Chain;
	local int Budget;

	if (SErrandMover[k] == M && SErrandCount[k] >= 2)
		return false; // tried twice for this door: leave it to jumps, detours and the respawn
	Budget = 12;
	T = FindOpener(B, k, M, M.Tag, 0, Chain, Budget);
	if (T == None)
	{
		BotLog(BName(B) $ ":" @ Why @ M.Name @ "(" $ M.Tag $ ") at" @ Where(B.Location)
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
	BotLog(BName(B) $ ":" @ Why @ M.Name @ "(" $ M.Tag $ ") at" @ Where(B.Location) $ ", opened by:" @ Chain
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
	local int i, k;

	if (ScriptedPawn(Other) != None && ShieldIndex(Other) >= 0)
		return 2; // Ignore (Bot.AttitudeTo: 0 fear, 1 hate, 2 ignore, 3 friendly): out of reach for now (see 8)
	k = FindSlot(aBot);
	if (k >= 0 && SAmmoGoal[k] != None && ScriptedPawn(Other) != None && VSize(Other.Location - aBot.Location) > 300)
		return 2; // Ignore: fetching ammo, only what comes close is fought
	if (ScriptedPawn(Other) != None && Other.Health > 0 && Huntable(ScriptedPawn(Other), aBot))
		for (i = 0; i < NumKeyMonsters; i++)
			if (KeyMonsters[i] == Other)
			{
				if (aBot.LineOfSightTo(Other))
					return 1; // ATTITUDE_Hate
				break;
			}
	if (ScriptedPawn(Other) != None && Other.Health > 0 && Huntable(ScriptedPawn(Other), aBot) && !IsKeyMonster(Other))
		return FocusAttitude(aBot, k, Other);
	return Super.AssessBotAttitude(aBot, Other);
}

//-----------------------------------------------------------------------------
// 10. Focus

function int BotFocus(Bot B)
{
	local TourneyCoreMH C;
	C = Core();
	if (C == None)
		return 0;
	return C.MHFocus(B);
}

function bool IsKeyMonster(Pawn P)
{
	local int i;
	for (i = 0; i < NumKeyMonsters; i++)
		if (KeyMonsters[i] == P)
			return true;
	return false;
}

// The attitude to a hostile monster by the bot's focus (k: its slot or -1).
function byte FocusAttitude(Bot B, int k, Pawn Other)
{
	local int F;
	local byte A;
	local float D;

	// Looked up once a second (FocusCheck); the game asks for attitudes many times a second.
	if (k >= 0 && SFocus[k] != 0)
		F = SFocus[k] - 3;
	else
		F = BotFocus(B);
	A = Super.AssessBotAttitude(B, Other);
	if (F == 0)
		return A;
	if (F < 0)
	{
		// Hunters fight big monsters instead of fleeing (thorough: while healthy).
		if (A == 0 && (F <= -2 || B.Health > 60))
			return 1;
		return A;
	}
	D = VSize(Other.Location - B.Location);
	if (k >= 0 && SDropMon[k] == Other && Level.TimeSeconds < SDropUntil[k] && D > 350)
		return 2; // broken off: left alone for a while
	if (F >= 2 && D > 600)
		return 2;
	if (D > 1200)
		return 2;
	return A;
}

// Once a second per bot: hunters look for monsters in sight, brisk bots and sprinters break
// off a fight that takes too long.
function FocusCheck(Bot B, int k)
{
	local int F;
	local Pawn P, Best;
	local float D, BestD, Limit;
	local ScriptedPawn E;

	F = BotFocus(B);
	SFocus[k] = byte(F + 3);
	if (F == 0)
		return;
	if (SFocusLogged[k] == 0)
	{
		SFocusLogged[k] = 1;
		BotLog(BName(B) $ ": focus" @ F);
	}
	if (F < 0)
	{
		if (B.Enemy != None || !B.IsInState('Roaming') || SErrand[k] != None || SAmmoGoal[k] != None)
			return;
		if (F == -1 && B.Health <= 60)
			return;
		BestD = 1500;
		if (F == -1)
			BestD = 900;
		for (P = Level.PawnList; P != None; P = P.NextPawn)
		{
			E = ScriptedPawn(P);
			if (E == None || E.Health <= 0 || E.bDeleteMe || !Huntable(E, B) || ShieldIndex(E) >= 0)
				continue;
			if (int(E.AttitudeToPlayer) >= 5)
				continue; // friendly or following
			D = VSize(E.Location - B.Location);
			if (D >= BestD || !B.LineOfSightTo(E))
				continue;
			Best = E;
			BestD = D;
		}
		// SetEnemy starts the attack itself (WhatToDoNext would bring back the old enemy, none).
		if (Best != None && B.SetEnemy(Best))
		{
			if (B.bNovice)
			{
				B.OldEnemy = Best; // as KeepHunting: novices give up in Acquisition otherwise
				B.bMustHunt = true;
			}
			BotLog(BName(B) $ ": focus" @ F @ "- attacks" @ What(Best));
		}
		return;
	}
	E = ScriptedPawn(B.Enemy);
	if (E == None || E.Health <= 0 || IsKeyMonster(E))
	{
		SFightMon[k] = None;
		return;
	}
	if (SFightMon[k] != E)
	{
		SFightMon[k] = E;
		SFightSince[k] = Level.TimeSeconds;
		return;
	}
	Limit = 8;
	if (F >= 2)
		Limit = 3;
	if (Level.TimeSeconds - SFightSince[k] < Limit || VSize(E.Location - B.Location) < 350)
		return;
	SDropMon[k] = E;
	SDropUntil[k] = Level.TimeSeconds + 12;
	if (F >= 2)
		SDropUntil[k] = Level.TimeSeconds + 20;
	SFightMon[k] = None;
	BotLog(BName(B) $ ": focus" @ F @ "- breaks off from" @ What(E) @ "and moves on");
	if (B.OldEnemy == E)
		B.OldEnemy = None;
	// WhatToDoNext takes up the old enemy: not a monster this bot ignores now.
	if (ScriptedPawn(B.OldEnemy) != None && FocusAttitude(B, k, B.OldEnemy) == 2)
		B.OldEnemy = None;
	B.Enemy = None;
	B.WhatToDoNext('', '');
}

//-----------------------------------------------------------------------------
// 8. Shielded targets

function int ShieldIndex(Actor A)
{
	local int i;
	if (A == None)
		return -1;
	for (i = 0; i < NumShielded; i++)
		if (Shielded[i] == A)
			return i;
	return -1;
}

// Once a second: a monster that took damage, died, or whose mover opened counts again; after
// 30 s the bots try it again anyway.
function UpdateShields()
{
	local int i;
	local string Why;

	i = 0;
	while (i < NumShielded)
	{
		Why = "";
		if (Shielded[i] == None || Shielded[i].bDeleteMe || Shielded[i].Health <= 0)
			Why = "is gone";
		else if (Shielded[i].Health < ShieldHealth[i])
			Why = "takes damage";
		else if (ShieldMover[i] != None && (ShieldMover[i].KeyNum != ShieldKey[i] || ShieldMover[i].bInterpolating))
			Why = "is free (" $ ShieldMover[i].Name $ " moves)";
		else if (Level.TimeSeconds > ShieldUntil[i])
			Why = "is tried again";
		else if (Level.TimeSeconds > ShieldUntil[i] - 25 && Bot(Shielded[i].Enemy) != None
			&& Shielded[i].LineOfSightTo(Shielded[i].Enemy)
			&& VSize(Shielded[i].Enemy.Location - Shielded[i].Location) < 1200)
			Why = "attacks" @ BName(Shielded[i].Enemy);
		if (Why == "")
		{
			i++;
			continue;
		}
		BotLog("target" @ What(Shielded[i]) @ Why);
		NumShielded--;
		Shielded[i] = Shielded[NumShielded];
		ShieldMover[i] = ShieldMover[NumShielded];
		ShieldUntil[i] = ShieldUntil[NumShielded];
		ShieldHealth[i] = ShieldHealth[NumShielded];
		ShieldKey[i] = ShieldKey[NumShielded];
		Shielded[NumShielded] = None;
		ShieldMover[NumShielded] = None;
	}
}

// Every tick (0.25 s): notes when the bot first fires at the monster it fights; the time without
// damage counts from then.
function WatchFire(Bot B, int k)
{
	if (SEngaged[k] == None || SEngaged[k] != B.Enemy || SEngagedFired[k] != 0)
		return;
	if (B.bFire != 0 || B.bAltFire != 0)
	{
		SEngagedFired[k] = 1;
		SEngagedSince[k] = Level.TimeSeconds;
	}
}

// Once a second per bot: does it hurt the monster it fights? 5 s of fire without any damage
// while a mover or the level is in the line of fire, and the monster is out of reach for now.
function ShieldCheck(Bot B, int k)
{
	local ScriptedPawn E;
	local Actor HitA;
	local vector HitLoc, HitNorm, Eye;

	E = ScriptedPawn(B.Enemy);
	if (E == None || E.Health <= 0 || ShieldIndex(E) >= 0)
	{
		SEngaged[k] = None;
		return;
	}
	if (SEngaged[k] != E || E.Health < SEngagedHealth[k])
	{
		SEngaged[k] = E;
		SEngagedSince[k] = Level.TimeSeconds;
		SEngagedHealth[k] = E.Health;
		SEngagedFired[k] = 0;
		return;
	}
	if (SEngagedFired[k] == 0 || Level.TimeSeconds - SEngagedSince[k] < 5)
		return;
	Eye = B.Location + vect(0,0,1) * B.BaseEyeHeight;
	HitA = B.Trace(HitLoc, HitNorm, E.Location, Eye, true);
	// Nothing in the way (the bot just misses) or another pawn in the line: not shielded.
	if (HitA == None || HitA == E || Pawn(HitA) != None)
		return;
	MarkShielded(E, Mover(HitA), B, HitA);
}

function MarkShielded(ScriptedPawn E, Mover M, Bot By, Actor HitA)
{
	local Pawn P;
	local Bot B;
	local int k;
	local string Blocker;

	if (NumShielded >= 16 || ShieldIndex(E) >= 0)
		return;
	Shielded[NumShielded] = E;
	ShieldMover[NumShielded] = M;
	ShieldUntil[NumShielded] = Level.TimeSeconds + 30;
	ShieldHealth[NumShielded] = E.Health;
	if (M != None)
		ShieldKey[NumShielded] = M.KeyNum;
	NumShielded++;
	if (M != None)
		Blocker = "mover" @ M.Name @ "(" $ M.Tag $ ")";
	else
		Blocker = string(HitA.Name);
	BotLog(BName(By) $ ": target" @ What(E) @ "takes no damage (in the way:" @ Blocker
		$ "), bots leave it for now and follow the waypoints");
	// Every bot fighting it lets go; with a closed mover in the way they look for its opener.
	for (P = Level.PawnList; P != None; P = P.NextPawn)
	{
		B = Bot(P);
		if (B == None || B.Health <= 0)
			continue;
		if (B.OldEnemy == E)
			B.OldEnemy = None;
		if (B.Enemy != E)
			continue;
		k = FindSlot(B);
		B.Enemy = None;
		if (k >= 0)
		{
			SEngaged[k] = None;
			if (M != None && M.KeyNum == 0 && !M.bInterpolating && !M.bDelaying && SErrand[k] == None)
				MoverErrand(B, k, M, "target" @ E.Name @ "behind");
		}
		B.WhatToDoNext('', '');
	}
}

//-----------------------------------------------------------------------------
// 9. Empty weapons

// A weapon the bot can fight with: ammo left, or none needed (Impact Hammer, chainsaw).
function bool CanShoot(Weapon W)
{
	return W != None && (W.AmmoType == None || W.AmmoType.AmmoAmount > 0);
}

// Any weapon with ammo (not counting the ones that need none).
function bool HasRangedAmmo(Bot B)
{
	local Inventory I;
	for (I = B.Inventory; I != None; I = I.Inventory)
		if (Weapon(I) != None && Weapon(I).AmmoType != None && Weapon(I).AmmoType.AmmoAmount > 0)
			return true;
	return false;
}

// Once a second per bot: an empty weapon in hand is changed; with no ammo for any weapon the bot
// fetches some.
function AmmoCheck(Bot B, int k)
{
	local Inventory I;

	if (SAmmoGoal[k] != None)
	{
		AmmoRunOver(B, k);
		return;
	}
	if (B.Weapon == None || !CanShoot(B.Weapon))
	{
		if (B.PendingWeapon == None || !CanShoot(B.PendingWeapon))
		{
			B.SwitchToBestWeapon();
			if (Level.TimeSeconds - SAmmoLogAt[k] > 10)
			{
				SAmmoLogAt[k] = Level.TimeSeconds;
				BotLog(BName(B) $ ": no ammo for" @ What(B.Weapon) $ ", switches to" @ What(B.PendingWeapon));
			}
		}
	}
	if (HasRangedAmmo(B))
		return;
	I = FindAmmo(B, k);
	if (I == None)
		return;
	SAmmoGoal[k] = I;
	SAmmoSince[k] = Level.TimeSeconds;
	BotLog(BName(B) $ ": no weapon with ammo left, fetches" @ What(I) @ "at" @ Where(I.Location));
	if (B.OldEnemy != None && VSize(B.OldEnemy.Location - B.Location) > 300)
		B.OldEnemy = None;
	if (B.Enemy != None && VSize(B.Enemy.Location - B.Location) > 300)
	{
		B.Enemy = None;
		B.WhatToDoNext('', '');
	}
}

// The nearest ammo for a weapon the bot carries, else the nearest weapon it does not carry yet,
// lying ready and reachable. Only the 5 nearest are checked for a route.
function Inventory FindAmmo(Bot B, int k)
{
	local Inventory I;
	local Inventory Cand[5];
	local float CandD[5];
	local float D;
	local int n, j;
	local byte bJump;
	local bool bAmmo;

	foreach AllActors(class'Inventory', I)
	{
		if (I.Owner != None || I.bHidden || !I.IsInState('Pickup'))
			continue;
		if (I == SAmmoSkip[k] && Level.TimeSeconds < SAmmoSkipUntil[k])
			continue;
		bAmmo = Ammo(I) != None && FitsWeapon(B, Ammo(I));
		if (!bAmmo && (Weapon(I) == None || (B.FindInventoryType(I.Class) != None && WeaponStay())))
			continue;
		D = VSize(I.Location - B.Location);
		if (!bAmmo)
			D += 2000; // ammo that fits comes first
		if (D > 6000)
			continue;
		// insert sorted by distance, keep the 5 nearest
		j = n;
		if (j == 5)
		{
			if (D >= CandD[4])
				continue;
			j = 4;
		}
		else
			n++;
		while (j > 0 && CandD[j - 1] > D)
		{
			Cand[j] = Cand[j - 1];
			CandD[j] = CandD[j - 1];
			j--;
		}
		Cand[j] = I;
		CandD[j] = D;
	}
	for (j = 0; j < n; j++)
		if (PathTo(B, Cand[j], bJump) != None)
			return Cand[j];
	return None;
}

// Weapons stay: a weapon the bot carries cannot be picked up again (no ammo from it).
function bool WeaponStay()
{
	return DeathMatchPlus(Level.Game) != None && DeathMatchPlus(Level.Game).bMultiWeaponStay;
}

function bool FitsWeapon(Bot B, Ammo A)
{
	local Inventory I;
	for (I = B.Inventory; I != None; I = I.Inventory)
		if (Weapon(I) != None && Weapon(I).AmmoName != None && ClassIsChildOf(A.Class, Weapon(I).AmmoName))
			return true;
	return false;
}

// Ends the ammo run when the bot has ammo again, the item is taken or after 30 s (true: over).
// A failed item is left out for a minute.
function bool AmmoRunOver(Bot B, int k)
{
	local Inventory I;

	I = SAmmoGoal[k];
	if (HasRangedAmmo(B))
	{
		BotLog(BName(B) $ ": has ammo again");
		SAmmoGoal[k] = None;
		B.SwitchToBestWeapon();
		return true;
	}
	if (I == None || I.bDeleteMe || I.Owner != None || I.bHidden || Level.TimeSeconds - SAmmoSince[k] > 30)
	{
		if (I != None && Level.TimeSeconds - SAmmoSince[k] > 30)
		{
			SAmmoSkip[k] = I;
			SAmmoSkipUntil[k] = Level.TimeSeconds + 60;
		}
		SAmmoGoal[k] = None;
		return true;
	}
	return false;
}

// While the bot fetches ammo: go there.
function bool AmmoRun(Bot B, int k)
{
	local Actor Hop;
	local byte bJump;

	if (AmmoRunOver(B, k))
		return false;
	Hop = PathTo(B, SAmmoGoal[k], bJump);
	if (Hop == None)
	{
		SAmmoSkip[k] = SAmmoGoal[k];
		SAmmoSkipUntil[k] = Level.TimeSeconds + 10;
		SAmmoGoal[k] = None;
		return false;
	}
	B.LastAttractCheck = Level.TimeSeconds;
	B.MoveTarget = Hop;
	SetAttractionStateFor(B);
	return true;
}

defaultproperties
{
}
