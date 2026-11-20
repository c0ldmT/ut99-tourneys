//=============================================================================
// TourneyBossBot (mod 0.13.0, fire hold 0.14.0, leading 0.15.0)
// Botpack.TBossBot (boss) as the tournament spawns it with the skill curve: the same
// bot, only its aim error drifts (TourneySkillCurve.AimDrift) instead of jumping with every
// shot. Without the curve (or before it is set) the game's own aim.
//=============================================================================
class TourneyBossBot extends TBossBot;

var TourneySkillCurve Curve;

function rotator AdjustAim(float projSpeed, vector projStart, int aimerror, bool leadTarget, bool warnTarget)
{
	local float Spread;
	local rotator R;
	if (Curve == None || Curve.bDeleteMe || !Curve.bOn)
		return Super.AdjustAim(projSpeed, projStart, aimerror, leadTarget, warnTarget);
	Spread = Curve.AimSpread(self, projSpeed, aimerror);
	// Mod 0.15.0: bLeadTarget (the curve's TLeadOff) decides whether it leads this time.
	R = Super.AdjustAim(projSpeed, projStart, 0, leadTarget && bLeadTarget, warnTarget);
	return Curve.AimDrift(self, R, Spread, projStart);
}

// Mod 0.14.0: no shot while the bot takes in a new enemy or holds a fire pause (the curve's
// TSightReact / TFireDelay).
function FireWeapon()
{
	if (Curve != None && !Curve.bDeleteMe && Curve.HoldFire(self))
	{
		bFire = 0;
		bAltFire = 0;
		return;
	}
	Super.FireWeapon();
}

// Mod 0.19.1: the base AI of the level picks the weapon (safety distances, fewer switches in a
// fight, a switch before the last shot; TourneySkillCurve.BotSwitch).
function bool SwitchToBestWeapon()
{
	if (Curve != None && !Curve.bDeleteMe && Curve.bOn)
		return Curve.BotSwitch(self);
	return Super.SwitchToBestWeapon();
}

defaultproperties
{
}
