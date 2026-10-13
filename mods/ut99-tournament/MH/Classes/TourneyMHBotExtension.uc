//=============================================================================
// TourneyMHBotExtension
// Monster Hunt's bot extension (MonsterHuntBotExtension, Monster Hunt 613) with
// one fix: the map's bot waypoints (MonsterWaypoint, Position 1, 2, 3, ...) are
// sorted correctly. The original swap writes the wrong slot, so on maps that
// list their waypoints out of order some waypoints are lost or repeated and
// bots head for the wrong ones. Everything else is Monster Hunt's own code.
// Used when the tournament rule botWaypointFix is on (TourneyCoreMH sets
// MonsterHunt.BotExtensionType, the official hook for custom bot behaviour).
//=============================================================================
class TourneyMHBotExtension extends MonsterHuntBotExtension;

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

defaultproperties
{
}
