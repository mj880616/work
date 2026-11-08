namespace BasketDrop.App;

/// <summary>
/// What older versions of this program left on the PC for the send entrances that no longer exist (right-click Send to,
/// clipboard hotkey and paste window, screen-corner box, desktop tile). The hotkey, corner box and desktop tile lived only
/// while the program ran, so on disk only the Send to shortcut and some settings values remain.
/// Only things this program made are touched, by exact path.
/// </summary>
internal static class LegacyEntries
{
    /// <summary>The shortcut older versions put in the user's SendTo folder.</summary>
    public static string SendToLinkPath =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.SendTo), "바구니 PC드롭.lnk");

    /// <summary>Deletes the Send to shortcut if it is there. Safe to call any time (also used by uninstall).</summary>
    public static void RemoveSendTo()
    {
        var path = SendToLinkPath;
        if (File.Exists(path)) File.Delete(path);
    }

    /// <summary>
    /// Once per PC (remembered in the settings file): removes the Send to shortcut and, when nothing is waiting in the
    /// queue, the old sent-history file (it only fed the "already sent" question of the removed entrances).
    /// The old hotkey/corner/tile values drop out of the settings file by themselves on its next save.
    /// A step that fails is retried at the next start; nothing waiting in the queue is ever deleted.
    /// </summary>
    public static void CleanOnce(SettingsStore settings, QueueStore queue, string historyPath, ILog log)
    {
        var s = settings.Load();
        if (s.LegacyEntriesCleaned) return;
        try
        {
            RemoveSendTo();
            if (queue.List().Count == 0 && File.Exists(historyPath)) File.Delete(historyPath);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            log.Write(LogCode.Error);
            return;
        }
        s.LegacyEntriesCleaned = true;
        try { settings.Save(s); }
        catch (IOException) { log.Write(LogCode.Error); }
    }
}
