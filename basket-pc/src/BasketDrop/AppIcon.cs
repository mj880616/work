namespace BasketDrop.App;

/// <summary>
/// The program icon (app.ico, many sizes) used by the .exe, the installer, the window title bars, the taskbar and the tray,
/// plus the three tray status pictures. All are built from basket-pc/icon/basket-icon.svg by tools/make-icon.py.
/// </summary>
internal static class AppIcon
{
    private const string ResourceName = "BasketDrop.app.ico";

    /// <summary>Title bar and taskbar: the whole multi-size icon, so Windows picks the frame for the current scaling.</summary>
    public static Icon ForWindow()
    {
        using var stream = Open(ResourceName);
        return new Icon(stream);
    }

    /// <summary>Notification area: the frame that matches the small-icon size of the screen (16 at 100%, 20 at 125%, 24 at 150%).</summary>
    public static Icon ForTray() => ForTray(TrayPicture.Normal);

    /// <summary>Notification area, for one of the four status pictures (same sizes as <see cref="ForTray()"/>).</summary>
    public static Icon ForTray(TrayPicture picture)
    {
        using var stream = Open(ResourceFor(picture));
        return new Icon(stream, SystemInformation.SmallIconSize);
    }

    /// <summary>The program icon at about <paramref name="pixels"/> square (the desktop tile draws it at the monitor's scale).</summary>
    public static Icon ForSize(int pixels)
    {
        using var stream = Open(ResourceName);
        return new Icon(stream, pixels, pixels);
    }

    public static string ResourceFor(TrayPicture picture) => picture switch
    {
        TrayPicture.Pending => "BasketDrop.tray-pending.ico",
        TrayPicture.SignedOut => "BasketDrop.tray-signedout.ico",
        TrayPicture.SignedOutPending => "BasketDrop.tray-signedout-pending.ico",
        _ => ResourceName,
    };

    private static Stream Open(string name) =>
        typeof(AppIcon).Assembly.GetManifestResourceStream(name)
        ?? throw new InvalidOperationException(name + " is not embedded");
}
