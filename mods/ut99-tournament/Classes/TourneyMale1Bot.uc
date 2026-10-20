//=============================================================================
// TourneyMale1Bot (mod 0.13.0)
// Botpack.TMale1Bot (male commando) as the tournament spawns it with the skill curve: the same
// bot, only its aim error drifts (TourneySkillCurve.AimDrift) instead of jumping with every
// shot. Without the curve (or before it is set) the game's own aim.
//=============================================================================
class TourneyMale1Bot extends TMale1Bot;

var TourneySkillCurve Curve;

function rotator AdjustAim(float projSpeed, vector projStart, int aimerror, bool leadTarget, bool warnTarget)
{
	local float Spread;
	local rotator R;
	if (Curve == None || Curve.bDeleteMe || !Curve.bOn)
		return Super.AdjustAim(projSpeed, projStart, aimerror, leadTarget, warnTarget);
	Spread = Curve.AimSpread(self, projSpeed, aimerror);
	R = Super.AdjustAim(projSpeed, projStart, 0, leadTarget, warnTarget);
	return Curve.AimDrift(self, R, Spread, projStart);
}

defaultproperties
{
}
