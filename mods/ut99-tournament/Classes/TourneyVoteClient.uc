//=============================================================================
// TourneyVoteClient
// Content of the vote window: one button per map. Click up to three maps in
// the order you prefer them, then "Vote". The vote goes to the server through
// the player's TourneyClient.
//=============================================================================
class TourneyVoteClient extends UWindowDialogClientWindow;

const MAXMAPS = 16;

var UWindowSmallButton MapButton[16];
var string MapName[16];
var int MapCount;
var UWindowSmallButton ClearButton, VoteButton;
var UWindowLabelControl InfoLabel, PickLabel;
var string Pick[3];
var int PickCount;

// No actor references are kept in UWindow objects: a closed window is no longer reachable
// through NotifyBeforeLevelChange, and a reference would keep the old level alive.

function Created()
{
	Super.Created();
	InfoLabel = UWindowLabelControl(CreateControl(class'UWindowLabelControl', 10, 6, WinWidth - 20, 14));
	PickLabel = UWindowLabelControl(CreateControl(class'UWindowLabelControl', 10, WinHeight - 46, WinWidth - 20, 14));
	ClearButton = UWindowSmallButton(CreateControl(class'UWindowSmallButton', 10, WinHeight - 24, 64, 16));
	ClearButton.SetText("Clear");
	VoteButton = UWindowSmallButton(CreateControl(class'UWindowSmallButton', WinWidth - 94, WinHeight - 24, 84, 16));
	VoteButton.SetText("Vote");
}

function FindActors(out TourneyGRI GRI, out TourneyClient TC)
{
	local PlayerPawn P;
	local TourneyGRI G;
	local TourneyClient T;

	GRI = None;
	TC = None;
	P = GetPlayerOwner();
	if (P == None)
		return;
	foreach P.AllActors(class'TourneyGRI', G)
	{
		GRI = G;
		break;
	}
	foreach P.AllActors(class'TourneyClient', T)
		if (T.Owner == P)
		{
			TC = T;
			break;
		}
}

// Creates the map buttons once the map list has arrived (and again if it changes).
function SyncMaps(TourneyGRI GRI)
{
	local int i, Cols, Rows, Col, Row;
	local bool bSame;
	local float BW, BH, Top;

	if (GRI == None)
		return;
	bSame = GRI.VoteCount == MapCount;
	for (i = 0; bSame && i < MapCount; i++)
		bSame = GRI.VoteMaps[i] == MapName[i];
	if (bSame)
		return;
	for (i = 0; i < MAXMAPS; i++)
		if (MapButton[i] != None)
		{
			MapButton[i].Close();
			MapButton[i] = None;
		}
	MapCount = Min(GRI.VoteCount, MAXMAPS);
	PickCount = 0;
	Cols = 2;
	Rows = (MapCount + Cols - 1) / Cols;
	BW = (WinWidth - 30) / Cols;
	BH = 16;
	Top = 26;
	for (i = 0; i < MapCount; i++)
	{
		MapName[i] = GRI.VoteMaps[i];
		Col = i / Max(1, Rows);
		Row = i % Max(1, Rows);
		MapButton[i] = UWindowSmallButton(CreateControl(class'UWindowSmallButton', 10 + Col * (BW + 10), Top + Row * (BH + 4), BW, BH));
		MapButton[i].SetText(MapName[i]);
	}
}

function BeforePaint(Canvas C, float X, float Y)
{
	local int i, k;
	local string S;
	local TourneyGRI GRI;
	local TourneyClient TC;

	Super.BeforePaint(C, X, Y);
	FindActors(GRI, TC);
	SyncMaps(GRI);
	if (GRI != None)
	{
		S = GRI.MatchId $ ":" @ GRI.NameA @ "vs" @ GRI.NameB;
		if (GRI.PhaseSec >= 0)
			S = S @ "-" @ GRI.PhaseSec $ "s left";
		InfoLabel.SetText(S);
	}
	for (i = 0; i < MapCount; i++)
	{
		S = MapName[i];
		for (k = 0; k < PickCount; k++)
			if (Pick[k] == MapName[i])
				S = (k + 1) $ ". " $ MapName[i];
		MapButton[i].SetText(S);
	}
	if (PickCount == 0)
	{
		if (TC != None && TC.MyVote != "")
			PickLabel.SetText("Your vote: " $ TC.MyVote);
		else
			PickLabel.SetText("Click up to 3 maps, best first.");
	}
	else
	{
		S = "Your picks:";
		for (k = 0; k < PickCount; k++)
			S = S @ (k + 1) $ "." @ Pick[k];
		PickLabel.SetText(S);
	}
	VoteButton.bDisabled = PickCount == 0;
}

function Toggle(string M)
{
	local int k, j;

	for (k = 0; k < PickCount; k++)
		if (Pick[k] == M)
		{
			for (j = k; j < PickCount - 1; j++)
				Pick[j] = Pick[j + 1];
			PickCount--;
			Pick[PickCount] = "";
			return;
		}
	if (PickCount < 3)
		Pick[PickCount++] = M;
}

function Notify(UWindowDialogControl C, byte E)
{
	local int i;
	local TourneyGRI GRI;
	local TourneyClient TC;

	Super.Notify(C, E);
	if (E != DE_Click)
		return;
	if (C == ClearButton)
	{
		PickCount = 0;
		return;
	}
	if (C == VoteButton)
	{
		if (PickCount == 0)
			return;
		FindActors(GRI, TC);
		if (TC != None)
			TC.ServerVote(Pick[0], Pick[1], Pick[2]);
		ParentWindow.Close();
		return;
	}
	for (i = 0; i < MapCount; i++)
		if (C == MapButton[i])
			Toggle(MapName[i]);
}

function NotifyBeforeLevelChange()
{
	Super.NotifyBeforeLevelChange();
	MapCount = 0;
	PickCount = 0;
}

defaultproperties
{
}
