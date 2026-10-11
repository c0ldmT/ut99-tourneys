//=============================================================================
// TourneyMutator
// Chat and console commands:  !ready  !vote 3 1 5  !bracket  !standings  !help
// Console alternative:        mutate tourney ready   (bindable to a key)
//=============================================================================
class TourneyMutator extends Mutator;

var TournamentDM Game;

function bool MutatorTeamMessage(Actor Sender, Pawn Receiver, PlayerReplicationInfo PRI, coerce string S, name Type, optional bool bBeep)
{
	// Say is delivered once per receiver; react only to the copy for the sender itself.
	if (Sender == Receiver && PlayerPawn(Sender) != None && Left(S, 1) == "!" && Game != None)
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
