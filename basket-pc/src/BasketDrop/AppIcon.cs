namespace BasketDrop.App;

/// <summary>The one program icon (app.ico, many sizes) used by the .exe, the window title bars, the taskbar and the tray.</summary>
internal static class AppIcon
{
    private const string ResourceName = "BasketDrop.app.ico";

    /// <summary>Title bar and taskbar: the whole multi-size icon, so Windows picks the frame for the current scaling.</summary>
    public static Icon ForWindow()
    {
        using var stream = Open();
        return new Icon(stream);
    }

    /// <summary>Notification area: the frame that matches the small-icon size of the screen (16 at 100%, 20 at 125%, 24 at 150%).</summary>
    public static Icon ForTray()
    {
        using var stream = Open();
        return new Icon(stream, SystemInformation.SmallIconSize);
    }

    private static Stream Open() =>
        typeof(AppIcon).Assembly.GetManifestResourceStream(ResourceName)
        ?? throw new InvalidOperationException("app.ico is not embedded");
}
