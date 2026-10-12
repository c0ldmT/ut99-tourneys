//=============================================================================
// TourneyClient
// One per player, owned by the player's pawn and replicated only to that
// player. On the client it is a HUD mutator: it draws the match banner, the
// ready and vote panels, the bracket and the standings, and opens the vote
// window. It also carries the calls between that client and the game.
//=============================================================================
class TourneyClient extends Mutator;

// --- server side ------------------------------------------------------------
var TournamentDM Game;
var bool bHasHud;          // the client registered its HUD (server skips the text fallbacks)
var bool bAutoFollow;      // spectators: follow the match players automatically
var bool bVoteOpened;      // the vote window was opened for the current vote

// --- replicated to the owner ------------------------------------------------
var string MyRole;         // a, b or s (role on this level)
var string MyVote;         // what this player voted (shown in the panel)
var bool bVoter;           // this player votes in the current map vote
var bool bFirstPerson;     // spectators: watch through the player's eyes

// --- client side ------------------------------------------------------------
var bool bRegistered;
var TourneyGRI GRI;
var float BracketUntil;    // show the bracket until (Level.TimeSeconds)
var float StandUntil;      // show the standings until
var bool bBracketHidden;   // player closed the automatic bracket with !bracket
var bool bPendingVote;     // open the vote window as soon as the player stops typing
var float NextGRIScan;
var float NextParse;
var Actor LastViewTarget;

// Parsed bracket (re-parsed when GRI.BracketRev changes).
var int ParsedRev;
var int MCount;
var string MSide[64], MA[64], MB[64], MSA[64], MSB[64], MSt[64], MW[64];
var byte MRound[64], MIndex[64];
var int CountW[8], CountL[8];
var int RoundsW, RoundsL, CountGF;

// Layout cache (recomputed when the bracket or the resolution changes).
var float LayoutClipX, LayoutClipY;
var int LayoutRev;
var float BX[64], BY[64];
var float BoxW, BoxH, RowH;
var string FA[64], FB[64];
var font BracketFont;

replication
{
	reliable if (Role == ROLE_Authority && bNetOwner)
		MyRole, MyVote, bVoter, bFirstPerson;
	reliable if (Role == ROLE_Authority)
		ClientShowBracket, ClientShowStandings, ClientOpenVote, ClientCloseVote, ClientViewMode;
	reliable if (Role < ROLE_Authority)
		ServerHello, ServerVote;
}

//=============================================================================
// Server
//=============================================================================

function ServerHello()
{
	bHasHud = true;
	// The vote may have started before this client was ready for the window.
	if (Game != None && !bVoteOpened && Game.IsVoter(PlayerPawn(Owner)))
	{
		bVoteOpened = true;
		ClientOpenVote();
	}
}

function ServerVote(string M1, string M2, string M3)
{
	if (Game != None && PlayerPawn(Owner) != None)
		Game.VoteByName(PlayerPawn(Owner), M1, M2, M3);
}

//=============================================================================
// Client: setup and commands from the server
//=============================================================================

simulated function Tick(float Delta)
{
	local PlayerPawn P;

	if (Level.NetMode == NM_DedicatedServer)
	{
		Disable('Tick');
		return;
	}
	P = PlayerPawn(Owner);
	if (P == None || P.Player == None)
		return; // not the local player (e.g. the copy a spectator gets of the player it follows)
	if (!bRegistered)
	{
		if (P.myHUD == None)
			return;
		RegisterHUDMutator();
		bRegistered = true;
		ServerHello();
	}
	if (bPendingVote)
		TryOpenVote();
	// FIRE (next player) switches spectators to third person; keep the chosen view.
	if (Spectator(P) != None && P.ViewTarget != None && P.ViewTarget != LastViewTarget)
	{
		LastViewTarget = P.ViewTarget;
		P.bBehindView = !bFirstPerson;
		Spectator(P).bChaseCam = !bFirstPerson;
	}
	else if (P.ViewTarget == None)
		LastViewTarget = None;
}

simulated function ClientShowBracket()
{
	if (AutoBracket())
	{
		bBracketHidden = !bBracketHidden;
		return;
	}
	if (BracketUntil > Level.TimeSeconds)
		BracketUntil = 0;
	else
		BracketUntil = Level.TimeSeconds + 20;
}

simulated function ClientShowStandings()
{
	if (StandUntil > Level.TimeSeconds)
		StandUntil = 0;
	else
		StandUntil = Level.TimeSeconds + 12;
}

simulated function ClientViewMode(bool bBehind)
{
	local PlayerPawn P;
	P = PlayerPawn(Owner);
	if (P == None)
		return;
	P.bBehindView = bBehind;
	if (Spectator(P) != None)
		Spectator(P).bChaseCam = bBehind;
}

simulated function ClientOpenVote()
{
	bPendingVote = true;
	TryOpenVote();
}

// Opens the vote window in full UWindow mode (like the Esc menu): mouse cursor, keyboard and
// Esc go to the window. The "quick key" mode is keyboard-only (speech menu) and must not be
// used. While the player is typing a chat line the window waits.
simulated function TryOpenVote()
{
	local PlayerPawn P;
	local WindowConsole WC;

	P = PlayerPawn(Owner);
	if (P == None || P.Player == None)
		return;
	WC = WindowConsole(P.Player.Console);
	if (WC == None)
	{
		bPendingVote = false;
		return;
	}
	if (WC.bTyping)
		return; // Tick tries again
	// No check of GRI.Phase here: the reliable call arrives before the replicated phase.
	// The server closes the window (ClientCloseVote) when the vote ends.
	bPendingVote = false;
	if (!WC.bCreatedRoot || WC.Root == None)
		WC.CreateRootWindow(None);
	if (WC.Root == None)
		return;
	WC.bQuickKeyEnable = false;
	WC.LaunchUWindow();
	WC.bNoDrawWorld = false; // keep the game visible even with ShowDesktop=True (menu background)
	if (UMenuRootWindow(WC.Root) != None && UMenuRootWindow(WC.Root).MenuBar != None)
		UMenuRootWindow(WC.Root).MenuBar.HideWindow();
	WC.Root.CreateWindow(class'TourneyVoteWindow', 100, 100, 380, 320, None, true);
}

simulated function ClientCloseVote()
{
	local PlayerPawn P;
	local WindowConsole WC;
	local UWindowWindow W;

	bPendingVote = false;
	P = PlayerPawn(Owner);
	if (P == None || P.Player == None)
		return;
	WC = WindowConsole(P.Player.Console);
	if (WC == None || WC.Root == None)
		return;
	W = WC.Root.FindChildWindow(class'TourneyVoteWindow', true);
	if (W != None && W.bWindowVisible)
		W.Close();
}

// Something left UWindow mode without closing our window (console key, speech menu):
// close it properly so the menu bar comes back and nothing is left half open.
simulated function CloseStaleVoteWindow()
{
	local PlayerPawn P;
	local WindowConsole WC;
	local UWindowWindow W;

	P = PlayerPawn(Owner);
	if (P == None || P.Player == None)
		return;
	WC = WindowConsole(P.Player.Console);
	if (WC == None || WC.Root == None || WC.IsInState('UWindow'))
		return;
	W = WC.Root.FindChildWindow(class'TourneyVoteWindow', true);
	if (W != None && W.bWindowVisible)
		W.Close();
}

simulated function bool VoteWindowOpen()
{
	local PlayerPawn P;
	local WindowConsole WC;
	local UWindowWindow W;

	P = PlayerPawn(Owner);
	if (P == None || P.Player == None)
		return false;
	WC = WindowConsole(P.Player.Console);
	if (WC == None || WC.Root == None || !WC.IsInState('UWindow'))
		return false;
	W = WC.Root.FindChildWindow(class'TourneyVoteWindow', true);
	return W != None && W.bWindowVisible;
}

//=============================================================================
// Client: HUD
//=============================================================================

simulated function PostRender(Canvas C)
{
	local PlayerPawn P;
	local TourneyGRI G;

	P = PlayerPawn(Owner);
	if ((GRI == None || GRI.bDeleteMe) && Level.TimeSeconds >= NextGRIScan)
	{
		NextGRIScan = Level.TimeSeconds + 1;
		GRI = None;
		foreach AllActors(class'TourneyGRI', G)
		{
			GRI = G;
			break;
		}
	}
	CloseStaleVoteWindow();
	if (P != None && GRI != None && GRI.Phase != "")
	{
		DrawTourney(C, P);
		C.Style = ERenderStyle.STY_Normal;
		C.DrawColor.R = 255;
		C.DrawColor.G = 255;
		C.DrawColor.B = 255;
	}
	if (NextHUDMutator != None)
		NextHUDMutator.PostRender(C);
}

simulated function bool AutoBracket()
{
	return GRI != None && (GRI.Phase == "lobby" || GRI.Phase == "post" || GRI.Phase == "finished");
}

simulated function DrawTourney(Canvas C, PlayerPawn P)
{
	local bool bBracket, bStand;

	if (GRI.Phase == "ready" || GRI.Phase == "countdown" || GRI.Phase == "live" || GRI.Phase == "paused")
		DrawBanner(C);
	if (GRI.bPaused)
		DrawCentered(C, "PAUSED:" @ GRI.PauseReason, C.ClipY * 0.30, 255, 200, 60, BigFont(C));

	bStand = GRI.Phase == "finished" || StandUntil > Level.TimeSeconds;
	bBracket = (AutoBracket() && !bBracketHidden) || BracketUntil > Level.TimeSeconds;
	if (GRI.Phase == "vote")
	{
		if (!VoteWindowOpen())
			DrawVotePanel(C);
	}
	else if (bBracket && GRI.LineCount > 0)
		DrawBracket(C, bStand);
	if (bStand && GRI.StandCount > 0)
		DrawStandings(C, bBracket && GRI.Phase != "vote");
	if (GRI.Phase == "ready")
		DrawReadyPanel(C);
	if (Spectator(P) != None && Pawn(P.ViewTarget) != None && Pawn(P.ViewTarget).PlayerReplicationInfo != None)
		DrawFollowHint(C, Pawn(P.ViewTarget).PlayerReplicationInfo.PlayerName);
	if (GRI.Phase == "finished" && GRI.PhaseSec > 0)
		DrawCentered(C, "The tournament is over. The server shuts down in" @ GRI.PhaseSec @ "s", C.ClipY * 0.92, 240, 163, 43, SmallFont(C));
}

// --- drawing helpers ----------------------------------------------------------

simulated function font SmallFont(Canvas C)
{
	return class'FontInfo'.static.GetStaticSmallFont(C.ClipX);
}

simulated function font MediumFont(Canvas C)
{
	return class'FontInfo'.static.GetStaticMediumFont(C.ClipX);
}

simulated function font BigFont(Canvas C)
{
	return class'FontInfo'.static.GetStaticBigFont(C.ClipX);
}

simulated function SetColor(Canvas C, byte R, byte G, byte B)
{
	C.DrawColor.R = R;
	C.DrawColor.G = G;
	C.DrawColor.B = B;
}

simulated function FillBox(Canvas C, float X, float Y, float W, float H, byte R, byte G, byte B)
{
	C.Style = ERenderStyle.STY_Normal;
	SetColor(C, R, G, B);
	C.SetPos(X, Y);
	C.DrawTile(Texture'UWindow.WhiteTexture', W, H, 0, 0, 1, 1);
}

// A dark panel with a thin border.
simulated function Panel(Canvas C, float X, float Y, float W, float H)
{
	FillBox(C, X - 2, Y - 2, W + 4, H + 4, 60, 70, 84);
	FillBox(C, X, Y, W, H, 16, 20, 27);
}

simulated function PutText(Canvas C, coerce string S, float X, float Y, byte R, byte G, byte B)
{
	C.Style = ERenderStyle.STY_Normal;
	SetColor(C, R, G, B);
	C.SetPos(X, Y);
	C.DrawText(S, false);
}

simulated function TextRight(Canvas C, coerce string S, float X, float Y, byte R, byte G, byte B)
{
	local float XL, YL;
	C.StrLen(S, XL, YL);
	PutText(C, S, X - XL, Y, R, G, B);
}

simulated function DrawCentered(Canvas C, coerce string S, float Y, byte R, byte G, byte B, font F)
{
	local float XL, YL;
	C.Font = F;
	C.StrLen(S, XL, YL);
	FillBox(C, (C.ClipX - XL) / 2 - 12, Y - 6, XL + 24, YL + 12, 16, 20, 27);
	PutText(C, S, (C.ClipX - XL) / 2, Y, R, G, B);
}

simulated function string Fit(Canvas C, string S, float MaxW)
{
	local float XL, YL;
	C.StrLen(S, XL, YL);
	while (XL > MaxW && Len(S) > 1)
	{
		S = Left(S, Len(S) - 1);
		C.StrLen(S $ ".", XL, YL);
	}
	return S;
}

simulated function string Piece(string S, int N)
{
	local int i, p;
	for (i = 0; i < N; i++)
	{
		p = InStr(S, "|");
		if (p < 0)
			return "";
		S = Mid(S, p + 1);
	}
	p = InStr(S, "|");
	if (p >= 0)
		return Left(S, p);
	return S;
}

// --- banner, ready, vote, follow ------------------------------------------------

simulated function DrawBanner(Canvas C)
{
	local string S, Info;
	local float XL, YL;

	S = GRI.NameA $ "   " $ GRI.ScoreA @ ":" @ GRI.ScoreB $ "   " $ GRI.NameB;
	Info = GRI.MatchId;
	if (GRI.BestOf > 1)
		Info = Info @ "- game" @ GRI.GameNo @ "- Bo" $ GRI.BestOf @ "(" $ GRI.WinsA $ ":" $ GRI.WinsB $ ")";
	if (GRI.MapName != "")
		Info = Info @ "-" @ GRI.MapName;
	DrawCentered(C, S, 6, 240, 163, 43, MediumFont(C));
	C.StrLen(S, XL, YL);
	DrawCentered(C, Info, 6 + YL + 16, 160, 170, 185, SmallFont(C));
}

simulated function DrawReadyPanel(Canvas C)
{
	local float W, H, X, Y, XL, YL;
	local string A, B, Hint;

	C.Font = MediumFont(C);
	C.StrLen("Ag", XL, YL);
	W = C.ClipX * 0.5;
	H = YL * 4.2;
	X = (C.ClipX - W) / 2;
	Y = C.ClipY * 0.62;
	Panel(C, X, Y, W, H);
	A = GRI.NameA;
	B = GRI.NameB;
	PutText(C, A, X + 16, Y + YL * 0.4, 230, 237, 243);
	TextRight(C, B, X + W - 16, Y + YL * 0.4, 230, 237, 243);
	if (GRI.ReadyA != 0)
		PutText(C, "READY", X + 16, Y + YL * 1.5, 63, 185, 80);
	else
		PutText(C, "not ready", X + 16, Y + YL * 1.5, 139, 152, 168);
	if (GRI.ReadyB != 0)
		TextRight(C, "READY", X + W - 16, Y + YL * 1.5, 63, 185, 80);
	else
		TextRight(C, "not ready", X + W - 16, Y + YL * 1.5, 139, 152, 168);
	C.Font = SmallFont(C);
	if ((MyRole == "a" && GRI.ReadyA == 0) || (MyRole == "b" && GRI.ReadyB == 0))
		Hint = "Press FIRE or type !ready when you are ready";
	else if (MyRole == "a" || MyRole == "b")
		Hint = "You are ready. Waiting for your opponent...";
	else
		Hint = "Waiting for both players to get ready";
	if (GRI.PhaseSec > 0)
		Hint = Hint @ "(" $ GRI.PhaseSec $ "s)";
	C.StrLen(Hint, XL, YL);
	PutText(C, Hint, X + (W - XL) / 2, Y + H - YL - 8, 240, 163, 43);
}

simulated function DrawVotePanel(Canvas C)
{
	local float W, H, X, Y, XL, YL, ColW;
	local int i, Cols, Rows, Col, Row;
	local string Title, Foot;

	C.Font = MediumFont(C);
	C.StrLen("Ag", XL, YL);
	Cols = 2;
	if (GRI.VoteCount > 8)
		Cols = 3;
	Rows = (GRI.VoteCount + Cols - 1) / Cols;
	W = C.ClipX * 0.6;
	H = YL * (Rows + 4.5);
	X = (C.ClipX - W) / 2;
	Y = C.ClipY * 0.22;
	Panel(C, X, Y, W, H);
	Title = "MAP VOTE" @ GRI.MatchId $ ":" @ GRI.NameA @ "vs" @ GRI.NameB;
	if (GRI.PhaseSec >= 0)
		Title = Title @ "-" @ GRI.PhaseSec $ "s";
	PutText(C, Title, X + 16, Y + YL * 0.4, 240, 163, 43);
	ColW = (W - 32) / Cols;
	for (i = 0; i < GRI.VoteCount; i++)
	{
		Col = i / Rows;
		Row = i % Rows;
		PutText(C, (i + 1) $ ")" @ GRI.VoteMaps[i], X + 16 + Col * ColW, Y + YL * (1.8 + Row), 230, 237, 243);
	}
	C.Font = SmallFont(C);
	if (!bVoter)
		Foot = "The players are choosing the map.";
	else if (MyVote != "")
		Foot = "Your vote:" @ MyVote $ "   (vote again to change)";
	else
		Foot = "Type  !vote  for the vote window (mouse), or  !vote 2 1 3  (up to 3 numbers, best first)";
	C.StrLen(Foot, XL, YL);
	PutText(C, Foot, X + 16, Y + H - YL - 8, 139, 152, 168);
}

simulated function DrawFollowHint(Canvas C, string Who)
{
	local string S;
	S = "Following" @ Who @ "-  FIRE: next player   !fp: first/third person   !follow off";
	C.Font = SmallFont(C);
	DrawCentered(C, S, C.ClipY * 0.86, 200, 205, 215, SmallFont(C));
}

// --- standings -------------------------------------------------------------------

simulated function DrawStandings(Canvas C, bool bSide)
{
	local float W, H, X, Y, XL, YL;
	local int i, N;
	local string S, Pl, Title;

	C.Font = SmallFont(C);
	C.StrLen("Ag", XL, YL);
	N = Min(GRI.StandCount, 16);
	W = C.ClipX * 0.24;
	H = YL * (N + 2.6);
	if (bSide)
		X = C.ClipX * 0.74;
	else
		X = (C.ClipX - W) / 2;
	Y = C.ClipY * 0.14;
	Panel(C, X, Y, W, H);
	Title = "STANDINGS";
	if (GRI.Phase == "finished")
		Title = "FINAL STANDINGS";
	PutText(C, Title, X + 10, Y + YL * 0.4, 240, 163, 43);
	for (i = 0; i < N; i++)
	{
		S = GRI.Stand[i];
		Pl = Piece(S, 0);
		if (Pl == "0")
			Pl = "-";
		if (i == 0 && GRI.Phase == "finished")
			PutText(C, Pl $ "." @ Piece(S, 1), X + 10, Y + YL * (1.6 + i), 240, 163, 43);
		else
			PutText(C, Pl $ "." @ Piece(S, 1), X + 10, Y + YL * (1.6 + i), 230, 237, 243);
		TextRight(C, Piece(S, 2) $ "-" $ Piece(S, 3), X + W - 10, Y + YL * (1.6 + i), 139, 152, 168);
	}
}

// --- bracket ----------------------------------------------------------------------

simulated function ParseBracket()
{
	local int i, r;
	local string S;

	ParsedRev = GRI.BracketRev;
	MCount = Min(GRI.LineCount, 64);
	RoundsW = 0;
	RoundsL = 0;
	CountGF = 0;
	for (i = 0; i < 8; i++)
	{
		CountW[i] = 0;
		CountL[i] = 0;
	}
	for (i = 0; i < MCount; i++)
	{
		S = GRI.Lines[i];
		MSide[i] = Piece(S, 0);
		r = Clamp(int(Piece(S, 1)), 1, 8);
		MRound[i] = r;
		MIndex[i] = Max(1, int(Piece(S, 2)));
		MA[i] = Piece(S, 4);
		MB[i] = Piece(S, 5);
		MSA[i] = Piece(S, 6);
		MSB[i] = Piece(S, 7);
		MSt[i] = Piece(S, 8);
		MW[i] = Piece(S, 9);
		if (MA[i] == "")
			MA[i] = "-";
		if (MB[i] == "")
			MB[i] = "-";
		if (MSA[i] == "-1")
			MSA[i] = "";
		if (MSB[i] == "-1")
			MSB[i] = "";
		if (MSide[i] == "W")
		{
			CountW[r - 1]++;
			RoundsW = Max(RoundsW, r);
		}
		else if (MSide[i] == "L")
		{
			CountL[r - 1]++;
			RoundsL = Max(RoundsL, r);
		}
		else
			CountGF++;
	}
	LayoutRev = -1;
}

simulated function LayoutBracket(Canvas C, float PX, float PY, float PW, float PH)
{
	local int i, Cols, n;
	local float WTop, WH, LTop, LH, ColW, Slot, MinSlot, XL, YL, CY;

	LayoutRev = ParsedRev;
	LayoutClipX = C.ClipX;
	LayoutClipY = C.ClipY;
	Cols = Max(RoundsW, RoundsL) + CountGF;
	if (Cols == 0)
		return;
	ColW = PW / Cols;
	BoxW = ColW * 0.86;
	WTop = PY;
	if (RoundsL > 0)
	{
		WH = PH * 0.62;
		LTop = PY + WH + PH * 0.04;
		LH = PH - WH - PH * 0.04;
	}
	else
		WH = PH;
	// Rows must fit the busiest column.
	MinSlot = WH / Max(1, CountW[0]);
	if (RoundsL > 0)
		for (i = 0; i < RoundsL; i++)
			if (CountL[i] > 0)
				MinSlot = FMin(MinSlot, LH / CountL[i]);
	BracketFont = SmallFont(C);
	C.Font = BracketFont;
	C.StrLen("Ag", XL, YL);
	if (YL * 2 + 6 > MinSlot * 0.92)
	{
		BracketFont = class'FontInfo'.static.GetStaticSmallestFont(C.ClipX);
		C.Font = BracketFont;
		C.StrLen("Ag", XL, YL);
	}
	RowH = YL + 2;
	BoxH = FMin(RowH * 2 + 2, MinSlot * 0.92);
	for (i = 0; i < MCount; i++)
	{
		if (MSide[i] == "W")
		{
			n = Max(1, CountW[MRound[i] - 1]);
			Slot = WH / n;
			BX[i] = PX + (MRound[i] - 1) * ColW;
			BY[i] = WTop + (MIndex[i] - 1) * Slot + (Slot - BoxH) / 2;
		}
		else if (MSide[i] == "L")
		{
			n = Max(1, CountL[MRound[i] - 1]);
			Slot = LH / n;
			BX[i] = PX + (MRound[i] - 1) * ColW;
			BY[i] = LTop + (MIndex[i] - 1) * Slot + (Slot - BoxH) / 2;
		}
		else
		{
			CY = WTop + (WH - BoxH) / 2;
			BX[i] = PX + (Max(RoundsW, RoundsL) + MRound[i] - 1) * ColW;
			BY[i] = CY;
		}
		FA[i] = Fit(C, MA[i], BoxW * 0.72);
		FB[i] = Fit(C, MB[i], BoxW * 0.72);
	}
}

simulated function DrawBracket(Canvas C, bool bStandingsBeside)
{
	local float PX, PY, PW, PH, XL, YL;
	local int i;
	local string Title;

	// Properties can arrive in any order: re-read once a second while the bracket is shown.
	if (ParsedRev != GRI.BracketRev || Level.TimeSeconds >= NextParse)
	{
		NextParse = Level.TimeSeconds + 1;
		ParseBracket();
	}
	PX = C.ClipX * 0.03;
	PY = C.ClipY * 0.14;
	PW = C.ClipX * 0.94;
	if (bStandingsBeside)
		PW = C.ClipX * 0.69;
	PH = C.ClipY * 0.74;
	Panel(C, PX - 8, PY - 30, PW + 16, PH + 38);
	C.Font = SmallFont(C);
	Title = GRI.TName;
	if (Title == "")
		Title = "Tournament";
	PutText(C, Title @ "-  !bracket to hide", PX, PY - 26, 240, 163, 43);
	if (LayoutRev != ParsedRev || LayoutClipX != C.ClipX || LayoutClipY != C.ClipY)
		LayoutBracket(C, PX, PY, PW, PH);
	C.Font = BracketFont;
	C.StrLen("Ag", XL, YL);
	for (i = 0; i < MCount; i++)
		DrawMatch(C, i, YL);
}

simulated function DrawMatch(Canvas C, int i, float YL)
{
	local float X, Y, PadY;
	local byte R, G, B;

	X = BX[i];
	Y = BY[i];
	if (MSt[i] == "l")
		FillBox(C, X - 2, Y - 2, BoxW + 4, BoxH + 4, 63, 185, 80);
	else
		FillBox(C, X - 1, Y - 1, BoxW + 2, BoxH + 2, 42, 51, 64);
	FillBox(C, X, Y, BoxW, BoxH, 22, 27, 34);
	if (MSt[i] == "v")
		return;
	PadY = (BoxH / 2 - YL) / 2;
	// side a
	RowColor(MW[i], "a", MSt[i], R, G, B);
	PutText(C, FA[i], X + 4, Y + PadY, R, G, B);
	TextRight(C, MSA[i], X + BoxW - 4, Y + PadY, R, G, B);
	// side b
	RowColor(MW[i], "b", MSt[i], R, G, B);
	PutText(C, FB[i], X + 4, Y + BoxH / 2 + PadY, R, G, B);
	TextRight(C, MSB[i], X + BoxW - 4, Y + BoxH / 2 + PadY, R, G, B);
}

simulated function RowColor(string Winner, string Side, string St, out byte R, out byte G, out byte B)
{
	if (Winner == Side)
	{
		R = 240; G = 163; B = 43;
	}
	else if (Winner != "")
	{
		R = 110; G = 120; B = 134;
	}
	else if (St == "w")
	{
		R = 139; G = 152; B = 168;
	}
	else
	{
		R = 230; G = 237; B = 243;
	}
}

defaultproperties
{
	bAutoFollow=True
	bFirstPerson=True
	RemoteRole=ROLE_SimulatedProxy
	bHidden=True
	bAlwaysRelevant=False
	NetPriority=1.5
}
