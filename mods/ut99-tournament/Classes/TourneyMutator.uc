//=============================================================================
// TourneyMutator
// Console commands: mutate tourney ready | vote 3 1 5 | bracket | standings
// Also the damage mutator and ModifyPlayer for the Dream Team game traits, and the pickup
// query for the live data.
// (bindable to a key). Chat commands (!ready, !vote ...) arrive via TourneyChatListener.
//=============================================================================
class TourneyMutator extends Mutator;

var TourneyCore Game;

// Team chat ("TeamSay" in team games only reaches the team, not the chat listener), and the
// fallback for all chat when the chat listener could not be spawned (players only).
function bool MutatorTeamMessage(Actor Sender, Pawn Receiver, PlayerReplicationInfo PRI, coerce string S, name Type, optional bool bBeep)
{
	if (Game != None && (Game.ChatListener == None || Type == 'TeamSay') && Sender == Receiver && PlayerPawn(Sender) != None && Left(S, 1) == "!")
		Game.HandleCommand(PlayerPawn(Sender), Mid(S, 1));
	if (NextMessageMutator != None)
		return NextMessageMutator.MutatorTeamMessage(Sender, Receiver, PRI, S, Type, bBeep);
	return true;
}

// Dream Team game traits (mod 0.9.0): damage of and against website bots with body traits.
function MutatorTakeDamage(out int ActualDamage, Pawn Victim, Pawn InstigatedBy, out Vector HitLocation, out Vector Momentum, name DamageType)
{
	if (Game != None)
		Game.OnTakeDamage(ActualDamage, Victim, InstigatedBy, DamageType);
	if (NextDamageMutator != None)
		NextDamageMutator.MutatorTakeDamage(ActualDamage, Victim, InstigatedBy, HitLocation, Momentum, DamageType);
	// mod 0.16.0: damage counters with the damage after all damage mutators
	if (Game != None)
		Game.CountDamage(ActualDamage, Victim, InstigatedBy);
}

// Mod 0.16.0: items taken (live data); the decision stays with the next mutators and the game.
function bool HandlePickupQuery(Pawn Other, Inventory Item, out byte bAllowPickup)
{
	if (Game != None)
		Game.OnPickupQuery(Other, Item);
	if (NextMutator != None)
		return NextMutator.HandlePickupQuery(Other, Item, bAllowPickup);
	return false;
}

// Every spawn: start armour of website bots with that trait.
function ModifyPlayer(Pawn Other)
{
	if (Game != None)
		Game.OnModifyPlayer(Other);
	if (NextMutator != None)
		NextMutator.ModifyPlayer(Other);
}

function Mutate(string MutateString, PlayerPawn Sender)
{
	if (Game != None && Left(MutateString, 8) ~= "tourney ")
		Game.HandleCommand(Sender, Mid(MutateString, 8));
	if (NextMutator != None)
		NextMutator.Mutate(MutateString, Sender);
}

defaultproperties
{
}
