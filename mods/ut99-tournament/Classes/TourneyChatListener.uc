//=============================================================================
// TourneyChatListener
// Invisible, server-only spectator that receives every chat line (like the
// WebAdmin spectator). Players' Say arrives as TeamMessage; spectators' Say
// arrives as a broadcast "Name:text" (Spectator.Say -> BroadcastMessage).
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
	local int i;
	if (Game == None || Type != 'Event')
		return;
	i = InStr(S, ":!");
	if (i > 0)
		Game.HandleSpectatorChat(Left(S, i), Mid(S, i + 2));
}

defaultproperties
{
	RemoteRole=ROLE_None
	bHidden=True
}
