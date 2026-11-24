using System.Runtime.InteropServices;

namespace BasketDrop.App;

/// <summary>
/// Tells Windows that the program picture changed (see <see cref="IconRefresh"/>), so the Start menu and desktop shortcuts
/// are drawn again from the new exe instead of the old cached picture. Runs once per picture revision on an installed PC.
/// </summary>
internal static class ShellIcons
{
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern void SHChangeNotify(int eventId, uint flags, string? item1, IntPtr item2);

    [DllImport("shell32.dll")]
    private static extern void SHChangeNotify(int eventId, uint flags, IntPtr item1, IntPtr item2);

    private const int ShcneUpdateItem = 0x00002000, ShcneAssocChanged = 0x08000000;
    private const uint ShcnfIdList = 0x0000, ShcnfPathW = 0x0005, ShcnfFlushNoWait = 0x3000;

    public static void RefreshOnce(SettingsStore settings, ILog log)
    {
        var s = settings.Load();
        if (!IconRefresh.Due(s)) return;
        try
        {
            foreach (var link in IconRefresh.Shortcuts(LegacyEntries.ShortcutFolders))
            {
                File.SetLastWriteTimeUtc(link, DateTime.UtcNow); // a newer time makes Explorer read the shortcut's picture again
                SHChangeNotify(ShcneUpdateItem, ShcnfPathW | ShcnfFlushNoWait, link, IntPtr.Zero);
            }
            if (Environment.ProcessPath is { } exe) SHChangeNotify(ShcneUpdateItem, ShcnfPathW | ShcnfFlushNoWait, exe, IntPtr.Zero);
            SHChangeNotify(ShcneAssocChanged, ShcnfIdList | ShcnfFlushNoWait, IntPtr.Zero, IntPtr.Zero); // drop cached pictures
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            log.Write(LogCode.Error);
            return; // tried again at the next start
        }
        s.IconRevision = IconRefresh.Revision;
        try { settings.Save(s); }
        catch (IOException) { log.Write(LogCode.Error); }
    }
}
