namespace BasketDrop;

/// <summary>
/// S63-09 PC도우미구분: the only command-line word this program understands. The start-with-Windows entry and the
/// restart after an update pass <see cref="Background"/> so the program goes straight to the tray. Any other start
/// (the user double-clicked the Start menu or desktop shortcut) opens the helper window that explains this is not
/// 노조+ itself and offers [노조+ 열기]. Nothing else is read: no paths, no tokens, no addresses.
/// </summary>
public static class LaunchArgs
{
    public const string Background = "--background";

    /// <summary>True only for exactly one argument equal to <see cref="Background"/>; everything else means "show the window".</summary>
    public static bool IsBackground(IReadOnlyList<string> args) => args.Count == 1 && string.Equals(args[0], Background, StringComparison.Ordinal);

    /// <summary>This process was started by the user (shortcut double-click), not by Windows start or an update restart.</summary>
    public static bool StartedByUser() => !IsBackground(Environment.GetCommandLineArgs().Skip(1).ToArray());
}

/// <summary>S63-09: where [노조+ 열기] goes. 노조+ itself is the web app in the browser (DOMAIN-nojoplus address); nothing is put in the address.</summary>
public static class NojoPlusWeb
{
    public const string AppUrl = "https://nojoplus.com/work/app/";
}
