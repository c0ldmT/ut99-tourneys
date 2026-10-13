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
// 4. Stuck bots: 3 s without progress -> jump to the side, 8 s -> detour over a
//    nearby path point, 20 s -> penalty-free respawn (moved to a start spot, no
//    death counted).
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

var Mover Lifts[32];            // movers with a LiftCenter that turn back or stop on contact
var int NumLifts;
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
	SStill[k] = 0;
	ClearHold(k);
}

function ClearHold(int k)
{
	if (SHoldMover[k] != None)
	{
		SCoolMover[k] = SHoldMover[k];
		SCoolUntil[k] = Level.TimeSeconds + 10;
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
	local int k;

	if (aBot != None && aBot.Health > 0)
	{
		k = FindSlot(aBot);
		if (k >= 0 && SHoldKind[k] != 0 && HoldBot(aBot, k))
			return true;
	}
	return Super.FindSpecialAttractionFor(aBot);
}

function bool FindNextWaypoint(Bot aBot)
{
	local int i, lastVisited, k;
	local Actor Hop, AT;
	local byte bJump;

	lastVisited = -1;
	k = Slot(aBot);

	if ((aBot.Orders == 'Attack') || ((aBot.Orders == 'Freelance') && (FRand() > 0.2)))
	{
		for (i = 0; i < NumPoints; i++)
		{
			if (waypoints[i].bVisited)
				lastVisited = i;

			if (!waypoints[i].bVisited && waypoints[i].bEnabled)
			{
				Hop = PathTo(aBot, waypoints[i], bJump);
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
// at the JumpSpot (JumpSpot.PendingJump -> Bot.BigJump, next tick) is a normal jump.
function Actor PathTo(Bot B, Actor Goal, out byte bJump)
{
	local Actor A;
	local float OldJumpZ;

	bJump = 0;
	if (B.ActorReachable(Goal))
		return Goal;
	A = B.FindPathToward(Goal);
	if (A != None)
		return A;
	OldJumpZ = B.JumpZ;
	B.JumpZ = FMax(OldJumpZ, 1.6 * B.Default.JumpZ);
	A = B.FindPathToward(Goal);
	B.JumpZ = OldJumpZ;
	if (A == None)
		return None;
	// A jump higher than a normal jump can reach is left out (it is meant for a translocator).
	if (JumpSpot(A) != None && A.Location.Z - B.Location.Z
		> Square(B.JumpZ) / (2 * FMax(1, Abs(B.Region.Zone.ZoneGravity.Z))) + B.MaxStepHeight)
	{
		JumpSpot(A).PendingBot = None;
		return None;
	}
	bJump = 1;
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
		LogMovers();
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
	if (bSecond)
		LogVisited();
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
function bool Cooling(Bot B, Mover M)
{
	local int k;
	k = FindSlot(B);
	return k >= 0 && SCoolMover[k] == M && Level.TimeSeconds < SCoolUntil[k];
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

function LogMovers()
{
	local Mover M;
	local int n;
	local string S;

	bMoversLogged = true;
	foreach AllActors(class'Mover', M)
	{
		if (!Guards(M))
			continue;
		n++;
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
	BotLog("movers watched:" @ n $ ", lifts:" @ NumLifts);
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
	M = MoverAhead(B, Danger);
	if (M != None)
		StartHold(B, k, M, 2, Danger);
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
		if (M == None || M.myMarker == None || B.Base == M || Cooling(B, M))
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
		if (Mover(A) != None && A != B.Base && Guards(Mover(A)) && !Cooling(B, Mover(A)) && MoverBusy(Mover(A)))
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

	if (Kind == 1)
	{
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

defaultproperties
{
}
