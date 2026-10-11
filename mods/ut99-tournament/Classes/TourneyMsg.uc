//=============================================================================
// TourneyMsg
// Parser and writer for the bridge line protocol: one flat JSON object per
// line, values are strings, integers or booleans, ASCII only (\uXXXX escapes).
// See docs/protocol.md.
//=============================================================================
class TourneyMsg extends Info;

const MAXFIELDS = 24;

var string Keys[24];
var string Vals[24];
var int FieldCount;

var string OutText;

//-----------------------------------------------------------------------------
// Reading
//-----------------------------------------------------------------------------

function bool Parse(string S)
{
	local int i, L;
	local string C, K, V;

	FieldCount = 0;
	L = Len(S);
	i = SkipWs(S, 0);
	if (Mid(S, i, 1) != "{")
		return false;
	i++;
	while (i < L)
	{
		i = SkipWs(S, i);
		C = Mid(S, i, 1);
		if (C == "}")
			return true;
		if (C == ",")
		{
			i++;
			continue;
		}
		if (C != Chr(34))
			return false;
		if (!ReadString(S, i, K))
			return false;
		i = SkipWs(S, i);
		if (Mid(S, i, 1) != ":")
			return false;
		i = SkipWs(S, i + 1);
		if (Mid(S, i, 1) == Chr(34))
		{
			if (!ReadString(S, i, V))
				return false;
		}
		else
		{
			// number, true, false
			V = "";
			while (i < L)
			{
				C = Mid(S, i, 1);
				if (C == "," || C == "}" || C == " ")
					break;
				V = V $ C;
				i++;
			}
		}
		if (FieldCount < MAXFIELDS)
		{
			Keys[FieldCount] = K;
			Vals[FieldCount] = V;
			FieldCount++;
		}
	}
	return false;
}

function int SkipWs(string S, int i)
{
	while (i < Len(S) && (Mid(S, i, 1) == " " || Mid(S, i, 1) == Chr(9)))
		i++;
	return i;
}

// i points at the opening quote; on return it points behind the closing quote.
function bool ReadString(string S, out int i, out string Result)
{
	local string C;
	local int L;

	Result = "";
	L = Len(S);
	i++;
	while (i < L)
	{
		C = Mid(S, i, 1);
		if (C == Chr(34))
		{
			i++;
			return true;
		}
		if (C == Chr(92))
		{
			i++;
			C = Mid(S, i, 1);
			if (C == "n")
				Result = Result $ " ";
			else if (C == "t")
				Result = Result $ " ";
			else if (C == "r" || C == "b" || C == "f")
				Result = Result;
			else if (C == "u")
			{
				Result = Result $ Chr(HexToInt(Mid(S, i + 1, 4)));
				i += 4;
			}
			else
				Result = Result $ C; // \" \\ \/
		}
		else
			Result = Result $ C;
		i++;
	}
	return false;
}

function int HexToInt(string H)
{
	local int i, N, D;

	N = 0;
	for (i = 0; i < Len(H); i++)
	{
		D = InStr("0123456789ABCDEF", Caps(Mid(H, i, 1)));
		if (D < 0)
			return 63; // '?'
		N = N * 16 + D;
	}
	return N;
}

function bool Has(string K)
{
	local int i;
	for (i = 0; i < FieldCount; i++)
		if (Keys[i] == K)
			return true;
	return false;
}

function string Get(string K)
{
	local int i;
	for (i = 0; i < FieldCount; i++)
		if (Keys[i] == K)
			return Vals[i];
	return "";
}

function int GetInt(string K)
{
	return int(Get(K));
}

function bool GetBool(string K)
{
	return Get(K) == "true";
}

//-----------------------------------------------------------------------------
// Writing: Begin("join"); AddInt("pid", 3); AddStr("tk", Tok); Line = Finish();
//-----------------------------------------------------------------------------

function Begin(string T)
{
	OutText = "{" $ Quote("t") $ ":" $ Quote(T);
}

function AddStr(string K, string V)
{
	OutText = OutText $ "," $ Quote(K) $ ":" $ Quote(V);
}

function AddInt(string K, int V)
{
	OutText = OutText $ "," $ Quote(K) $ ":" $ string(V);
}

function AddBool(string K, bool V)
{
	if (V)
		OutText = OutText $ "," $ Quote(K) $ ":true";
	else
		OutText = OutText $ "," $ Quote(K) $ ":false";
}

function string Finish()
{
	return OutText $ "}";
}

function string Quote(string S)
{
	local int i, A;
	local string C, R;

	R = Chr(34);
	for (i = 0; i < Len(S); i++)
	{
		C = Mid(S, i, 1);
		A = Asc(C);
		if (A == 34 || A == 92)
			R = R $ Chr(92) $ C;
		else if (A < 32 || A > 126)
			R = R $ Chr(92) $ "u" $ Hex4(A);
		else
			R = R $ C;
	}
	return R $ Chr(34);
}

function string Hex4(int N)
{
	local string R;
	local int i;

	for (i = 0; i < 4; i++)
	{
		R = Mid("0123456789abcdef", N % 16, 1) $ R;
		N = N / 16;
	}
	return R;
}

// Cuts a string to at most MaxBytes after escaping (non-ASCII = 6 bytes, quote/backslash = 2).
function string FitWire(string S, int MaxBytes)
{
	local int i, A, Cost, Used;
	Used = 0;
	for (i = 0; i < Len(S); i++)
	{
		A = Asc(Mid(S, i, 1));
		if (A < 32 || A > 126)
			Cost = 6;
		else if (A == 34 || A == 92)
			Cost = 2;
		else
			Cost = 1;
		if (Used + Cost > MaxBytes)
			return Left(S, i);
		Used += Cost;
	}
	return S;
}

defaultproperties
{
	bHidden=True
	RemoteRole=ROLE_None
}
