namespace BasketDrop;

/// <summary>Which of the four tray pictures to show (basket-pc/icon/basket-icon.svg, built by tools/make-icon.py).</summary>
public enum TrayPicture
{
    /// <summary>Signed in, nothing waiting: the program icon (app.ico).</summary>
    Normal,
    /// <summary>Signed in, something waiting to be sent: small orange dot at the bottom right.</summary>
    Pending,
    /// <summary>Login needed: dim grey.</summary>
    SignedOut,
    /// <summary>Login needed and something waiting: dim grey with the orange dot.</summary>
    SignedOutPending,
}

/// <summary>
/// The tray's look, worked out from the queue items and the login state the program already keeps
/// (no state of its own). TrayApp.RefreshTray is the only caller and the only place that shows it.
/// </summary>
public sealed record TrayStatus(TrayPicture Picture, int Waiting, int NeedsCheck, string Tooltip)
{
    public const string Name = "바구니 PC드롭";

    /// <summary>Windows cuts the tray tooltip; keep it within the old, safe limit.</summary>
    public const int TooltipMax = 63;

    public static bool IsWaiting(ItemState s) => s is ItemState.Pending or ItemState.Sending or ItemState.NotReached or ItemState.LoginRequired;

    public static bool IsNeedsCheck(ItemState s) => s is ItemState.Unknown or ItemState.Rejected;

    public static TrayStatus From(IEnumerable<ItemState> states, AuthState auth)
    {
        var list = states.ToList();
        var waiting = list.Count(IsWaiting);
        var check = list.Count(IsNeedsCheck);
        var signedIn = auth == AuthState.SignedIn;
        var picture = signedIn
            ? (waiting > 0 ? TrayPicture.Pending : TrayPicture.Normal)
            : (waiting > 0 ? TrayPicture.SignedOutPending : TrayPicture.SignedOut);

        var lines = new List<string> { Name };
        if (!signedIn) lines.Add(auth == AuthState.ReloginNeeded ? "다시 로그인 필요" : "로그인 필요");
        if (waiting > 0) lines.Add($"보낼 것 {waiting}개 대기 중");
        if (check > 0) lines.Add($"확인 필요 {check}개");
        if (lines.Count == 1) lines.Add("로그인됨 · 보낼 것 없음");
        var text = string.Join("\n", lines);
        if (text.Length > TooltipMax) text = text[..TooltipMax];
        return new TrayStatus(picture, waiting, check, text);
    }
}
