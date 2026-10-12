//=============================================================================
// TourneyVoteWindow
// Map vote dialog (UWindow), opened on the client by TourneyClient when a map
// vote for the player's match starts. Closing it returns the mouse to the game.
//=============================================================================
class TourneyVoteWindow extends UWindowFramedWindow;

var bool bCentered;

function Created()
{
	bSizable = false;
	Super.Created();
}

function BeforePaint(Canvas C, float X, float Y)
{
	if (!bCentered && Root.WinWidth > 0)
	{
		WinLeft = Int((Root.WinWidth - WinWidth) / 2);
		WinTop = Int((Root.WinHeight - WinHeight) / 3);
		bCentered = true;
	}
	Super.BeforePaint(C, X, Y);
}

function Close(optional bool bByParent)
{
	Super.Close(bByParent);
	if (bByParent)
		return;
	if (UMenuRootWindow(Root) != None && UMenuRootWindow(Root).MenuBar != None)
		UMenuRootWindow(Root).MenuBar.ShowWindow();
	Root.Console.CloseUWindow();
}

// The level and its actors go away: drop every reference to them.
function NotifyBeforeLevelChange()
{
	Super.NotifyBeforeLevelChange();
	if (bWindowVisible)
		Close();
	bCentered = false;
}

defaultproperties
{
	ClientClass=Class'TourneyVoteClient'
	WindowTitle="Map vote"
}
