//=============================================================================
// TourneyMale2Bot (mod 0.13.0, fire hold 0.14.0, leading 0.15.0)
// Botpack.TMale2Bot (male soldier) as the tournament spawns it with the skill curve: the same
// bot, only its aim error drifts (TourneySkillCurve.AimDrift) instead of jumping with every
// shot. Without the curve (or before it is set) the game's own aim.
//=============================================================================
class TourneyMale2Bot extends TMale2Bot;

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

defaultproperties
{
}
