//=============================================================================
// TourneyChatListener
// Invisible, server-only spectator that receives every chat line (like the
// WebAdmin spectator). Needed because spectators' Say does not go through the
// game's message mutator, and during map votes all players are spectators.
//=============================================================================
class TourneyChatListener extends MessagingSpectator;

var TournamentDM Game;

event TeamMessage(PlayerReplicationInfo PRI, coerce string S, name Type, optional bool bBeep)
{
	if (Game != None && PRI != None && Left(S, 1) == "!")
		Game.HandleChatCommand(PRI, Mid(S, 1));
}

function ClientMessage(coerce string S, optional name Type, optional bool bBeep)
{
}

defaultproperties
{
	RemoteRole=ROLE_None
	bHidden=True
}
