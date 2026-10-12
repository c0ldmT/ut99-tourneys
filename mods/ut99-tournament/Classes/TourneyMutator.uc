//=============================================================================
// TourneyMutator
// Console commands: mutate tourney ready | vote 3 1 5 | bracket | standings
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
