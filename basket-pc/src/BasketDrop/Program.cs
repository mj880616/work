using Velopack;

namespace BasketDrop.App;

internal static class Program
{
    private const string MutexName = @"Local\BasketDrop.SingleInstance.v1";

    [STAThread]
    private static void Main()
    {
        // Must come first: the installer starts this program with special arguments (install, update, uninstall).
        VelopackApp.Build().OnBeforeUninstallFastCallback(_ => CleanUpForUninstall()).Run();

        // No paths or tokens come in on the command line (the old right-click Send to entrance is gone). The only word read is
        // LaunchArgs.Background (Windows start, update restart). S63-09: a start by the user while a copy already runs asks that
        // copy to open the helper window, then exits.
        using var mutex = new Mutex(true, MutexName, out var isFirst);
        if (!isFirst)
        {
            if (LaunchArgs.StartedByUser()) HelperSignal.Ring();
            return;
        }

        ApplicationConfiguration.Initialize();
        using var app = new TrayApp();
        Application.ThreadException += (_, _) => app.LogError();
        Application.Run(app);
    }

    /// <summary>
    /// Uninstall removes what the program put outside its own folder: the start-with-Windows entry, a leftover
    /// right-click Send to shortcut and old-name ("BasketDrop") shortcuts of older versions, and the saved login. The waiting queue and history folder is kept
    /// so a reinstall can pick it up. Each step is independent; one failing must not block the uninstall.
    /// </summary>
    private static void CleanUpForUninstall()
    {
        try { new RegistryStartup().RemoveRunValue(); } catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Security.SecurityException) { }
        try { LegacyEntries.RemoveSendTo(); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
        try { RenamedShortcuts.RemoveOld(LegacyEntries.ShortcutFolders); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
        try { new CredentialManagerTokenStore().Delete(); } catch (TokenStoreException) { }
    }
}
