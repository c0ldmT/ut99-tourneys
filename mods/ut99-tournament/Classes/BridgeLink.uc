//=============================================================================
// BridgeLink
// TCP client to the bridge on the same machine. Lives for one level; the game
// spawns a new one after every map change or when the connection drops.
//=============================================================================
class BridgeLink extends TcpLink;

var TourneyCore Game;
var TourneyMsg InMsg;
var string LineBuffer;
var bool bOpen;
var float ConnectStarted;
var int HeartbeatTicks;

function Init(TourneyCore G)
{
	Game = G;
	InMsg = Spawn(class'TourneyMsg');
	LinkMode = MODE_Text;
	ReceiveMode = RMODE_Event;
	ConnectStarted = Level.TimeSeconds;
	Resolve(class'TournamentConfig'.default.BridgeHost);
	SetTimer(1.0, true);
}

event Resolved(IpAddr Addr)
{
	Addr.Port = class'TournamentConfig'.default.BridgePort;
	if (BindPort() == 0)
	{
		Log("BindPort failed", 'UTTourney');
		Destroy();
		return;
	}
	Open(Addr);
}

event ResolveFailed()
{
	Log("cannot resolve bridge host" @ class'TournamentConfig'.default.BridgeHost, 'UTTourney');
	Destroy();
}

event Opened()
{
	bOpen = true;
	Log("connected to bridge", 'UTTourney');
	Game.OnBridgeOpened();
}

event Closed()
{
	if (bOpen)
		Log("bridge connection closed", 'UTTourney');
	bOpen = false;
	Destroy();
}

event Timer()
{
	// Give up a connection attempt that hangs; the game will spawn a new link.
	if (!bOpen && Level.TimeSeconds - ConnectStarted > 5.0)
	{
		Destroy();
		return;
	}
	// Heartbeat lives here, not in the game: this actor keeps ticking while the game is paused.
	if (bOpen && ++HeartbeatTicks >= 5)
	{
		HeartbeatTicks = 0;
		SendLine("{" $ Chr(34) $ "t" $ Chr(34) $ ":" $ Chr(34) $ "hb" $ Chr(34) $ "," $ Chr(34) $ "up" $ Chr(34) $ ":" $ int(Level.TimeSeconds) $ "}");
	}
}

event ReceivedText(string Text)
{
	local int P;
	local string Line;

	LineBuffer = LineBuffer $ Text;
	P = InStr(LineBuffer, Chr(10));
	while (P >= 0)
	{
		Line = Left(LineBuffer, P);
		LineBuffer = Mid(LineBuffer, P + 1);
		if (Right(Line, 1) == Chr(13))
			Line = Left(Line, Len(Line) - 1);
		if (Line != "")
		{
			if (InMsg.Parse(Line))
				Game.HandleBridgeMessage(InMsg);
			else
				Log("bad line from bridge:" @ Line, 'UTTourney');
		}
		P = InStr(LineBuffer, Chr(10));
	}
	if (Len(LineBuffer) > 4096)
		LineBuffer = "";
}

function SendLine(string S)
{
	if (bOpen)
		SendText(S $ Chr(10));
}

event Destroyed()
{
	if (InMsg != None)
		InMsg.Destroy();
	if (Game != None && Game.Link == self)
		Game.Link = None;
	Super.Destroyed();
}

defaultproperties
{
	// Keep receiving bridge messages (e.g. "unpause") while the level is paused.
	bAlwaysTick=True
}
