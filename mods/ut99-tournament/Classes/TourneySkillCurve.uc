//=============================================================================
// TourneySkillCurve (mod 0.13.0)
// One skill curve for all tournament bots instead of UT's novice switch. UT runs
// the levels Novice..Skilled as "novice" bots (half speed, narrow view, no dodging,
// no leading, random waiting, less damage against players) and Adept..Godlike as
// the full AI with skill 0-3. Here every bot runs the full AI; the level (0-7)
// sets how fast, how far it sees and hears, how often it dodges and how well it
// aims (aim error drifts instead of jumping with every shot, see AimDrift).
// The same for deathmatch, team deathmatch and Monster Hunt (one per level, owned
// by the core). Website setting "skill curve" (match line "sc", 0 = UT's own).
//
// - Base values at the spawn: internal skill max(0, level-4), accuracy (curve plus
//   the bot's trait), field of view via BaseAlertness, hearing.
// - Every 0.1 s: speed and turn rate (the game resets them), dodge window (bCanDuck
//   for dodging projectiles), dodges in fights below Masterful, dodges while running,
//   no blind fire at walls for long, a hit from out of view turns the bot.
// - Hits: fewer flinches (the hit animation that stops the bot).
// - SmartStockBots: its MoveWithDodge (it sets bCanDuck every 0.1 s) and
//   FixMinigun (doubles the minigun's aim error) are switched off at run time;
//   the ini stays untouched, everything else of it keeps working.
// Every step that changes a bot's plan goes to the server log ("bot [...]").
//=============================================================================
class TourneySkillCurve extends Info;

const MAXC = 32;

var TourneyCore Core;
var bool bOn;                     // the curve is used (website setting)
var bool bSsbDone;                // SmartStockBots looked at (found and set, or not there)
var float NextSsbCheck;
var Mutator Ssb;
var string SsbDodgeWas, SsbMinigunWas; // its values before (restored when the curve goes off)

// Per bot.
var Bot CBot[32];
var byte CLv[32];                 // level 0..7 (Novice..Godlike)
var float CTraitAcc[32];          // accuracy, alertness and jumpy from the bot's traits
var float CTraitAlert[32];
var byte CTraitJumpy[32];
var float CWindowAt[32];          // next roll of the dodge windows
var float CNoiseY[32], CNoiseP[32], CGoalY[32], CGoalP[32], CPickAt[32], CAimAt[32];
var Pawn CHitBy[32];              // hit from out of view: turns to it at CTurnAt
var float CTurnAt[32];
var byte CTurnTries[32];
var float CDodgeAt[32];           // no dodge while running before this time
var byte CInTact[32];             // 1: in the current fighting move (TacticalMove) already rolled
var float CBlindLog[32];

// The curve, index = level 0..7 (Novice, Average, Experienced, Skilled, Adept, Masterful,
// Inhuman, Godlike). See docs/decisions.md 149.
var float TSpeed[8];              // MaxDesiredSpeed
var int TYaw[8];                  // RotationRate.Yaw
var float TFov[8];                // field of view in degrees (both sides)
var float TAcc[8];                // accuracy before traits (Adept and up: the game's own skill)
var float THear[8];               // hearing, relative
var float TFlinch[8];             // share of the game's optional flinches that stay
var float TDuck[8];               // chance to dodge a projectile it sees coming
var float TTact[8];               // chance of a dodge when it picks a fighting move
var float TRunDodge[8];           // seconds between two dodges while running at least
var float TReact[8];              // seconds until it turns to a hit from out of view
var float TRight[8];              // chance it turns the right way then
var float TDriftHz[8];            // aim error: how often it picks a new direction
var float TLag[8];                // aim: seconds it is behind a moving target
var float TBlind[8];              // seconds it fires at a target it no longer sees
var float TBlindSplash[8];        // extra seconds with splash weapons near the last seen spot

function Init(TourneyCore C)
{
	Core = C;
	if (bOn && Core != None && Core.Game != None)
		Core.Game.bNoviceMode = false;
	SetTimer(0.1, true);
}

function CLog(string S)
{
	if (Core != None)
		Core.BotLog(S);
}

// The website setting (match line). Off: bots spawned with the curve go back to UT's own.
function SetOn(bool bNew)
{
	local int s;
	if (bNew == bOn)
		return;
	bOn = bNew;
	Log("skill curve" @ bOn, 'UTTourney');
	if (bOn)
	{
		bSsbDone = false;
		NextSsbCheck = 0;
		if (Core != None && Core.Game != None)
			Core.Game.bNoviceMode = false;
		for (s = 0; s < MAXC; s++)
			if (CBot[s] != None && !CBot[s].bDeleteMe)
				ApplyBase(CBot[s], s);
		return;
	}
	RestoreSsb();
	for (s = 0; s < MAXC; s++)
		if (CBot[s] != None && !CBot[s].bDeleteMe)
			Revert(s);
}

function int Slot(Bot B, bool bCreate)
{
	local int s, Free;
	if (B == None)
		return -1;
	Free = -1;
	for (s = 0; s < MAXC; s++)
	{
		if (CBot[s] == B)
			return s;
		if (Free < 0 && (CBot[s] == None || CBot[s].bDeleteMe))
			Free = s;
	}
	if (!bCreate || Free < 0)
		return -1;
	CBot[Free] = B;
	CHitBy[Free] = None;
	CTurnTries[Free] = 0;
	CDodgeAt[Free] = 0;
	CInTact[Free] = 0;
	CWindowAt[Free] = 0;
	CNoiseY[Free] = 0;
	CNoiseP[Free] = 0;
	CPickAt[Free] = 0;
	CAimAt[Free] = 0;
	CBlindLog[Free] = 0;
	return Free;
}

// The class a bot of class BC is spawned as: the stock classes as the tournament's own
// subclasses (their aim error drifts), others as they are.
function class<Bot> BotClassFor(class<Bot> BC)
{
	if (!bOn || BC == None)
		return BC;
	if (BC == class'Botpack.TMale1Bot')
		return class'TourneyMale1Bot';
	if (BC == class'Botpack.TMale2Bot')
		return class'TourneyMale2Bot';
	if (BC == class'Botpack.TFemale1Bot')
		return class'TourneyFemale1Bot';
	if (BC == class'Botpack.TFemale2Bot')
		return class'TourneyFemale2Bot';
	if (BC == class'Botpack.TBossBot')
		return class'TourneyBossBot';
	return BC;
}

// Before the core applies a bot's traits again: the trait values back on the bot.
function TraitValues(Bot B)
{
	local int s;
	s = Slot(B, false);
	if (s < 0)
		return;
	B.Accuracy = CTraitAcc[s];
	B.BaseAlertness = CTraitAlert[s];
	B.bJumpy = CTraitJumpy[s] == 1;
}

// After InitializeSkill and the bot's traits (the core's ApplyBotConfig). Lv: tournament
// skill 0..7, -1 = as before (a new bot: from its game skill).
function Setup(Bot B, int Lv)
{
	local int s;
	local bool bNew;
	bNew = Slot(B, false) < 0;
	s = Slot(B, true);
	if (s < 0)
		return;
	if (Lv < 0 && bNew)
	{
		Lv = int(B.Skill);
		if (!B.bNovice)
			Lv += 4;
	}
	if (Lv >= 0)
		CLv[s] = Clamp(Lv, 0, 7);
	CTraitAcc[s] = B.Accuracy;
	CTraitAlert[s] = B.BaseAlertness;
	CTraitJumpy[s] = 0;
	if (B.bJumpy)
		CTraitJumpy[s] = 1;
	SetCurve(B);
	if (bOn)
		ApplyBase(B, s);
}

// The tournament's bot classes ask the curve for their aim.
function SetCurve(Bot B)
{
	if (TourneyMale1Bot(B) != None)
		TourneyMale1Bot(B).Curve = self;
	else if (TourneyMale2Bot(B) != None)
		TourneyMale2Bot(B).Curve = self;
	else if (TourneyFemale1Bot(B) != None)
		TourneyFemale1Bot(B).Curve = self;
	else if (TourneyFemale2Bot(B) != None)
		TourneyFemale2Bot(B).Curve = self;
	else if (TourneyBossBot(B) != None)
		TourneyBossBot(B).Curve = self;
}

// The game's peripheral vision for the full AI at skill S (Bot.SetPeripheralVision).
function float GamePV(float S)
{
	if (S >= 3)
		return -0.2;
	return 0.65 - 0.33 * S;
}

function ApplyBase(Bot B, int s)
{
	local int L;
	local float PV;
	L = CLv[s];
	B.bNovice = false;
	B.bThreePlus = false;
	B.Skill = FMax(0, L - 4);
	PV = Cos(TFov[L] * Pi / 360.0);
	// SetPeripheralVision (also from the respawn's ReSetSkill) takes GamePV - BaseAlertness: this gives the curve's
	// view, the trait's alertness widens or narrows it as before.
	B.BaseAlertness = GamePV(B.Skill) - PV + CTraitAlert[s];
	// What ReSetSkill does for the full AI, without PreSetMovement (that would disturb a bot in
	// the middle of a fighting move; speed and turn rate are set below and every 0.1 s).
	B.bLeadTarget = true;
	B.ReFireRate = B.default.ReFireRate * (1 - 0.25 * B.Skill);
	B.SetPeripheralVision();
	B.Accuracy = TAcc[L] + CTraitAcc[s];
	B.HearingThreshold = FMax(0.05, B.default.HearingThreshold + 0.5 * (1.0 - THear[L]));
	B.MaxDesiredSpeed = TSpeed[L];
	B.RotationRate.Yaw = TYaw[L];
	CWindowAt[s] = 0;
}

// Back to UT's own levels (curve switched off).
function Revert(int s)
{
	local Bot B;
	B = CBot[s];
	B.Accuracy = CTraitAcc[s];
	B.BaseAlertness = CTraitAlert[s];
	B.bJumpy = CTraitJumpy[s] == 1;
	B.HearingThreshold = B.default.HearingThreshold;
	B.InitializeSkill(CLv[s]);
}

//-----------------------------------------------------------------------------
// SmartStockBots: two of its options would work against the curve.
//-----------------------------------------------------------------------------

function CheckSsb()
{
	local Mutator M;
	local string V;
	if (Ssb == None)
	{
		foreach AllActors(class'Mutator', M)
		{
			if (M.IsA('SmartStockBots'))
			{
				Ssb = M;
				break;
			}
		}
	}
	if (Ssb == None)
	{
		if (Level.TimeSeconds > 30)
			bSsbDone = true; // not on this server (it comes as a server actor at the start)
		return;
	}
	V = Ssb.GetPropertyText("MoveWithDodge");
	if (V == "")
	{
		Log("SmartStockBots: option MoveWithDodge not found (other version?), left as it is", 'UTTourney');
		bSsbDone = true;
		return;
	}
	if (SsbDodgeWas == "")
	{
		SsbDodgeWas = V;
		SsbMinigunWas = Ssb.GetPropertyText("FixMinigun");
	}
	Ssb.SetPropertyText("MoveWithDodge", "False");
	if (SsbMinigunWas != "")
		Ssb.SetPropertyText("FixMinigun", "False");
	Log("SmartStockBots: MoveWithDodge" @ Ssb.GetPropertyText("MoveWithDodge") @ "(was" @ SsbDodgeWas $ "), FixMinigun"
		@ Ssb.GetPropertyText("FixMinigun") @ "(was" @ SsbMinigunWas $ "), for the skill curve; the ini is unchanged", 'UTTourney');
	bSsbDone = true;
}

function RestoreSsb()
{
	if (Ssb == None || Ssb.bDeleteMe || SsbDodgeWas == "")
		return;
	Ssb.SetPropertyText("MoveWithDodge", SsbDodgeWas);
	if (SsbMinigunWas != "")
		Ssb.SetPropertyText("FixMinigun", SsbMinigunWas);
	Log("SmartStockBots: MoveWithDodge and FixMinigun back to" @ SsbDodgeWas @ "/" @ SsbMinigunWas, 'UTTourney');
}

//-----------------------------------------------------------------------------
// Every 0.1 s.
//-----------------------------------------------------------------------------

function Timer()
{
	local int s;
	local Bot B;
	if (!bOn)
		return;
	if (!bSsbDone && Level.TimeSeconds >= NextSsbCheck)
	{
		NextSsbCheck = Level.TimeSeconds + 2;
		CheckSsb();
	}
	if (Core != None && Core.Game != None && Core.Game.bNoviceMode)
		Core.Game.bNoviceMode = false;
	if (Level.Game != None && Level.Game.bGameEnded)
		return;
	for (s = 0; s < MAXC; s++)
	{
		B = CBot[s];
		if (B == None)
			continue;
		if (B.bDeleteMe)
		{
			CBot[s] = None;
			continue;
		}
		if (B.Health <= 0 || B.IsInState('Dying') || B.IsInState('GameEnded'))
		{
			CHitBy[s] = None;
			CWindowAt[s] = 0; // the respawn's ReSetSkill sets bCanDuck: roll anew at once
			CInTact[s] = 0;
			continue;
		}
		BotStep(B, s);
	}
}

function BotStep(Bot B, int s)
{
	local int L;
	local float Now, P;
	local bool bDuck;

	L = CLv[s];
	Now = Level.TimeSeconds;
	// Something (a skill adjustment, ReSetSkill) made it a novice again.
	if (B.bNovice)
	{
		CLog(BName(B) $ ": novice again, skill curve applied anew");
		ApplyBase(B, s);
	}
	if (B.MaxDesiredSpeed != TSpeed[L] && !B.IsInState('ImpactJumping'))
		B.MaxDesiredSpeed = TSpeed[L];
	if (B.RotationRate.Yaw != TYaw[L])
		B.RotationRate.Yaw = TYaw[L];
	// The game's minigun aim error (SmartStockBots doubled it before it was switched off).
	if (minigun2(B.Weapon) != None && B.Weapon.AimError != B.Weapon.default.AimError)
		B.Weapon.AimError = B.Weapon.default.AimError;
	// Dodge window, rolled once a second: the game dodges a projectile (WarnTarget) only with
	// bCanDuck, then with 0.33 + 0.22 * skill.
	if (Now >= CWindowAt[s])
	{
		CWindowAt[s] = Now + 1.0;
		P = 0.33 + 0.22 * B.Skill;
		bDuck = FRand() * P < TDuck[L];
		B.bCanDuck = bDuck;
	}
	FightDodge(B, s);
	BlindFire(B, s);
	TurnToHit(B, s);
	RunDodge(B, s);
}

// Dodges in fights: the game dodges when it picks a fighting move (TacticalMove) with 35 % if
// the bot is "jumpy" or by skill (none at skill 0, 21 % at 1). Below Masterful the curve does it
// instead, once per fighting move with TTact; bJumpy stays the trait's (it also makes the bot hop).
function FightDodge(Bot B, int s)
{
	local vector Y;
	if (!B.IsInState('TacticalMove'))
	{
		CInTact[s] = 0;
		return;
	}
	if (CInTact[s] == 1)
		return;
	CInTact[s] = 1;
	if (B.Skill >= 1 || CTraitJumpy[s] == 1 || B.Enemy == None || B.Physics != PHYS_Walking)
		return;
	if (B.Weapon != None && B.Weapon.bRecommendSplashDamage)
		return;
	if (FRand() >= TTact[CLv[s]])
		return;
	Y = Normal(B.Enemy.Location - B.Location) Cross vect(0,0,1);
	Y.Z = 0;
	if (VSize(Y) < 0.1)
		return;
	if (FRand() < 0.5)
		B.TryToDuck(-Y, true);
	else
		B.TryToDuck(Y, false);
}

// No fire at a wall for long: a bot that has not seen its target for TBlind seconds stops
// firing (splash weapons a bit longer when the target was close to where it was last seen);
// in StakeOut it goes hunting instead (except snipers and bots at a post: they only stop firing).
function BlindFire(Bot B, int s)
{
	local float Limit, Blind;
	local Pawn E;
	E = B.Enemy;
	if (E == None || (B.bFire == 0 && B.bAltFire == 0 && !B.IsInState('StakeOut')))
		return;
	if (B.LineOfSightTo(E))
		return;
	Blind = Level.TimeSeconds - B.LastSeenTime;
	Limit = TBlind[CLv[s]];
	if (B.Weapon != None && (B.Weapon.bSplashDamage || B.Weapon.bRecommendSplashDamage)
		&& VSize(E.Location - B.LastSeenPos) < 600)
		Limit += TBlindSplash[CLv[s]];
	if (Blind < Limit)
		return;
	B.bFire = 0;
	B.bAltFire = 0;
	// Snipers and bots on hold, defend or follow orders stay at their post (StakeOut on purpose).
	if (B.bSniping || B.AmbushSpot != None || B.Orders == 'Hold' || B.Orders == 'Defend' || B.Orders == 'Follow')
		return;
	if (B.IsInState('StakeOut'))
	{
		if (Level.TimeSeconds - CBlindLog[s] > 10)
		{
			CBlindLog[s] = Level.TimeSeconds;
			CLog(BName(B) $ ": has not seen" @ BName(E) @ "for" @ int(Blind) @ "s, stops firing at" @ Where(B.LastSeenPos) $ ", hunts");
		}
		B.GotoState('Hunting');
	}
}

// A hit from out of view: after the reaction time the bot turns to the attacker (or, by
// chance, the wrong way first) and takes it as its enemy when it sees no other one.
function TurnToHit(Bot B, int s)
{
	local Pawn P, Old;
	local rotator R;
	local int L;
	P = CHitBy[s];
	if (P == None || Level.TimeSeconds < CTurnAt[s])
		return;
	CHitBy[s] = None;
	if (P.bDeleteMe || P.Health <= 0)
		return;
	L = CLv[s];
	if (CTurnTries[s] == 0 && FRand() >= TRight[L])
	{
		// The wrong way: it looks 50-100 degrees off, then once more.
		R = rotator(P.Location - B.Location);
		if (FRand() < 0.5)
			R.Yaw += 9000 + Rand(9000);
		else
			R.Yaw -= 9000 + Rand(9000);
		R.Pitch = 0;
		B.DesiredRotation = R;
		CHitBy[s] = P;
		CTurnTries[s] = 1;
		CTurnAt[s] = Level.TimeSeconds + TReact[L];
		return;
	}
	CTurnTries[s] = 0;
	if (B.Enemy == P && B.LineOfSightTo(P))
		return;
	R = rotator(P.Location - B.Location);
	R.Pitch = 0;
	B.DesiredRotation = R;
	if (B.Enemy != P && (B.Enemy == None || !B.LineOfSightTo(B.Enemy)))
	{
		Old = B.Enemy;
		B.Enemy = None;
		if (B.SetEnemy(P))
		{
			if (Old != None && Old != P)
				B.OldEnemy = Old;
			CLog(BName(B) $ ": hit from out of view by" @ BName(P) $ ", turns to it");
		}
		else
			B.Enemy = Old;
	}
}

// From the core's damage mutator, before the game plays the hit (PlayHit).
function OnHit(Pawn Victim, Pawn By, int Damage)
{
	local Bot B;
	local int s, L;
	local vector D;
	B = Bot(Victim);
	if (!bOn || B == None || Damage <= 0)
		return;
	s = Slot(B, false);
	if (s < 0)
		return;
	L = CLv[s];
	// The game's optional flinch (skill below 2) needs 0.3 + 0.25 * skill s since the last one:
	// a fresh LastPainTime skips it (the aim is as off as right after a flinch for 0.15 s).
	if (B.Skill < 2 && FRand() >= TFlinch[L])
		B.LastPainTime = Level.TimeSeconds;
	if (By == None || By == B || By.bDeleteMe || CHitBy[s] != None)
		return;
	if (Core != None && Core.SameTeam(B, By))
		return;
	D = By.Location - B.Location;
	if (VSize(D) < 1 || (Normal(D) Dot vector(B.Rotation)) >= B.PeripheralVision)
		return; // in view: the game turns it
	CHitBy[s] = By;
	CTurnTries[s] = 0;
	CTurnAt[s] = Level.TimeSeconds + TReact[L] * (0.8 + 0.4 * FRand());
}

// Dodges while running (as players do): along a straight, flat stretch to the next path
// point, at least TRunDodge seconds apart (with some chance more), never into a hole.
function RunDodge(Bot B, int s)
{
	local vector Dir, Land, HitLoc, HitNorm, Ext;
	local float D, Speed, Air;
	local Actor Goal, HitA;
	local int L;

	L = CLv[s];
	if (Level.TimeSeconds < CDodgeAt[s] || B.Physics != PHYS_Walking || B.Region.Zone.bWaterZone)
		return;
	if (!B.IsInState('Roaming') && !B.IsInState('Wandering') && !B.IsInState('Hunting'))
		return;
	Goal = B.MoveTarget;
	if (Goal == None || B.SpecialPause > 0 || Mover(B.Base) != None || B.bCamping)
		return;
	if (LiftCenter(Goal) != None || LiftExit(Goal) != None || JumpSpot(Goal) != None || Teleporter(Goal) != None)
		return;
	if (B.Region.Zone.ZoneGravity.Z != B.Region.Zone.default.ZoneGravity.Z || B.Region.Zone.ZoneGravity.Z > -100)
		return;
	Dir = Goal.Location - B.Location;
	if (Abs(Dir.Z) > 40)
		return;
	Dir.Z = 0;
	D = VSize(Dir);
	if (D < 520)
		return;
	Dir = Dir / D;
	if (VSize(B.Velocity) < 0.8 * B.GroundSpeed * B.MaxDesiredSpeed || (Normal(Flat(B.Velocity)) Dot Dir) < 0.95)
		return;
	// Not every chance: about one in three checks once the pause is over.
	CDodgeAt[s] = Level.TimeSeconds + 0.3;
	if (FRand() > 0.35)
		return;
	Speed = 1.5 * B.GroundSpeed * B.MaxDesiredSpeed;
	Air = 2 * 210 / Abs(B.Region.Zone.ZoneGravity.Z);
	Land = B.Location + Dir * (Speed * Air + 40);
	Ext.X = B.CollisionRadius;
	Ext.Y = B.CollisionRadius;
	Ext.Z = B.CollisionHeight - B.MaxStepHeight;
	HitA = B.Trace(HitLoc, HitNorm, Land + vect(0,0,24), B.Location + vect(0,0,24), true, Ext);
	if (HitA != None)
		return;
	if (!FloorNear(B, Land) || !FloorNear(B, B.Location + Dir * (0.5 * Speed * Air)))
		return;
	CDodgeAt[s] = Level.TimeSeconds + TRunDodge[L] * (1.0 + 0.5 * FRand());
	B.SetFall();
	B.Velocity = Dir * Speed;
	B.Velocity.Z = 210;
	B.Acceleration = vect(0,0,0);
	if (B.HasAnim('DodgeF'))
		B.TweenAnim('DodgeF', 0.25);
	else
		B.PlayDodge(FRand() < 0.5);
	if (B.JumpSound != None)
		B.PlaySound(B.JumpSound, SLOT_Talk, 1.0, true, 800, 1.0);
	B.SetPhysics(PHYS_Falling);
	B.GotoState('FallingState', 'Ducking');
}

// Floor at V within a step (no drop into a hole).
function bool FloorNear(Bot B, vector V)
{
	local vector HitLoc, HitNorm;
	return B.Trace(HitLoc, HitNorm, V - vect(0,0,1) * (B.CollisionHeight + B.MaxStepHeight + 8), V, false) != None;
}

//-----------------------------------------------------------------------------
// Aim (the tournament's bot classes call these from AdjustAim).
//-----------------------------------------------------------------------------

// How far off the game would aim (the spread its AdjustAim draws from per shot), with the
// accuracy also for projectiles. Before the game's AdjustAim (it resets LastAcquireTime).
function float AimSpread(Bot B, float ProjSpeed, int AimError)
{
	local Actor T;
	local float E, D;
	T = B.Target;
	if (T == None)
		T = B.Enemy;
	if (T == None || !T.bIsPawn)
		return 0;
	D = VSize(T.Location - B.Location);
	if (D < 1)
		return 0;
	E = AimError * (11 - 10 * ((T.Location - B.Location) / D
		Dot Normal((T.Location + 1.25 * T.Velocity) - (B.Location + B.Velocity))));
	if (T == B.Enemy && B.Enemy.Weapon != None && B.Enemy.Weapon.bMeleeWeapon && D < 700)
		E *= 0.5;
	if (ProjSpeed == 0 || ProjSpeed >= 1000000)
		E *= 0.5 + 0.19 * B.Skill;
	E *= 1.7 - 0.4 * (B.Skill + 0.5);
	if (B.Skill < 2 && (Level.TimeSeconds - B.LastPainTime < 0.15 || B.Physics == PHYS_Falling || T.Physics == PHYS_Falling))
		E *= 1.2;
	if (B.LastAcquireTime > Level.TimeSeconds - 2.5 + B.Skill)
		E *= 2;
	E *= FMax(0, 1 - B.Accuracy);
	return E;
}

// R: the game's aim without error. Adds the error as a slowly drifting offset (it swings past
// the target instead of jumping with every shot), a little spread per shot and a lag behind
// moving targets.
function rotator AimDrift(Bot B, rotator R, float E, vector ProjStart)
{
	local int s, L, DY;
	local float Now, Dt, K, Yaw, Pitch;
	local Actor T;
	local vector V0, V1;
	local rotator R2, Q0, Q1;

	s = Slot(B, false);
	T = B.Target;
	if (s < 0 || T == None || !T.bIsPawn || E <= 0)
		return R;
	L = CLv[s];
	Now = Level.TimeSeconds;
	Dt = FClamp(Now - CAimAt[s], 0, 1);
	CAimAt[s] = Now;
	if (Now >= CPickAt[s])
	{
		CGoalY[s] = 2 * FRand() - 1;
		CGoalP[s] = 2 * FRand() - 1;
		CPickAt[s] = Now + (0.5 + FRand()) / TDriftHz[L];
	}
	K = FMin(1, Dt * TDriftHz[L] * 2.5);
	CNoiseY[s] += (CGoalY[s] - CNoiseY[s]) * K;
	CNoiseP[s] += (CGoalP[s] - CNoiseP[s]) * K;
	Yaw = 1.1 * CNoiseY[s] * E + (2 * FRand() - 1) * 0.1 * E;
	Pitch = 0.2 * CNoiseP[s] * E;
	if (TLag[L] > 0 && VSize(T.Velocity) > 50)
	{
		V0 = T.Location - ProjStart;
		V1 = V0 - T.Velocity * TLag[L];
		Q0 = rotator(V0);
		Q1 = rotator(V1);
		DY = (Q1.Yaw - Q0.Yaw) & 65535;
		if (DY > 32768)
			DY -= 65536;
		Yaw += DY;
	}
	R2 = R;
	R2.Yaw = (R.Yaw + int(Yaw)) & 65535;
	R2.Pitch = (R.Pitch + int(Pitch)) & 65535;
	// Not into a wall right in front (as the game does): the other side.
	if (!B.FastTrace(ProjStart + vector(R2) * FMin(400, VSize(T.Location - ProjStart)), ProjStart))
		R2.Yaw = (R.Yaw - int(Yaw)) & 65535;
	B.ViewRotation = R2;
	return R2;
}

//-----------------------------------------------------------------------------

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

function vector Flat(vector V)
{
	V.Z = 0;
	return V;
}

defaultproperties
{
	RemoteRole=ROLE_None
	bOn=True
	TSpeed(0)=0.70
	TSpeed(1)=0.77
	TSpeed(2)=0.83
	TSpeed(3)=0.90
	TSpeed(4)=1.0
	TSpeed(5)=1.0
	TSpeed(6)=1.0
	TSpeed(7)=1.0
	TYaw(0)=34000
	TYaw(1)=38000
	TYaw(2)=42000
	TYaw(3)=46000
	TYaw(4)=50000
	TYaw(5)=58000
	TYaw(6)=68000
	TYaw(7)=100000
	TFov(0)=100
	TFov(1)=110
	TFov(2)=120
	TFov(3)=130
	TFov(4)=140
	TFov(5)=155
	TFov(6)=180
	TFov(7)=200
	TAcc(0)=-1.2
	TAcc(1)=-0.9
	TAcc(2)=-0.6
	TAcc(3)=-0.35
	TAcc(4)=0
	TAcc(5)=0
	TAcc(6)=0
	TAcc(7)=0
	THear(0)=0.8
	THear(1)=0.85
	THear(2)=0.9
	THear(3)=0.95
	THear(4)=1.0
	THear(5)=1.05
	THear(6)=1.1
	THear(7)=1.2
	TFlinch(0)=0.5
	TFlinch(1)=0.4
	TFlinch(2)=0.3
	TFlinch(3)=0.2
	TFlinch(4)=0.15
	TFlinch(5)=0.1
	TFlinch(6)=0
	TFlinch(7)=0
	TDuck(0)=0.10
	TDuck(1)=0.15
	TDuck(2)=0.22
	TDuck(3)=0.30
	TDuck(4)=0.33
	TDuck(5)=0.55
	TDuck(6)=0.77
	TDuck(7)=0.95
	TTact(0)=0.05
	TTact(1)=0.08
	TTact(2)=0.12
	TTact(3)=0.16
	TTact(4)=0.20
	TTact(5)=0.24
	TTact(6)=0.28
	TTact(7)=0.30
	TRunDodge(0)=6.0
	TRunDodge(1)=5.0
	TRunDodge(2)=4.0
	TRunDodge(3)=3.0
	TRunDodge(4)=2.2
	TRunDodge(5)=1.5
	TRunDodge(6)=0.8
	TRunDodge(7)=0.4
	TReact(0)=0.70
	TReact(1)=0.60
	TReact(2)=0.50
	TReact(3)=0.40
	TReact(4)=0.30
	TReact(5)=0.25
	TReact(6)=0.18
	TReact(7)=0.12
	TRight(0)=0.70
	TRight(1)=0.75
	TRight(2)=0.80
	TRight(3)=0.85
	TRight(4)=0.90
	TRight(5)=0.95
	TRight(6)=1.0
	TRight(7)=1.0
	TDriftHz(0)=0.8
	TDriftHz(1)=1.0
	TDriftHz(2)=1.2
	TDriftHz(3)=1.4
	TDriftHz(4)=1.7
	TDriftHz(5)=2.0
	TDriftHz(6)=2.4
	TDriftHz(7)=3.0
	TLag(0)=0.10
	TLag(1)=0.08
	TLag(2)=0.07
	TLag(3)=0.06
	TLag(4)=0.04
	TLag(5)=0.03
	TLag(6)=0.02
	TLag(7)=0.01
	TBlind(0)=1.5
	TBlind(1)=1.3
	TBlind(2)=1.1
	TBlind(3)=1.0
	TBlind(4)=0.9
	TBlind(5)=0.8
	TBlind(6)=0.7
	TBlind(7)=0.6
	TBlindSplash(0)=1.0
	TBlindSplash(1)=1.0
	TBlindSplash(2)=1.0
	TBlindSplash(3)=1.0
	TBlindSplash(4)=1.2
	TBlindSplash(5)=1.2
	TBlindSplash(6)=1.5
	TBlindSplash(7)=1.5
}
