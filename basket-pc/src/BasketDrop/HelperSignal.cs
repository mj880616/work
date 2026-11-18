namespace BasketDrop.App;

/// <summary>
/// S63-09 PC도우미구분: when the user double-clicks the shortcut while the program already runs in the tray, the
/// second copy only rings this named event (same user session) and exits; the running copy opens the helper window.
/// Nothing is passed along, only "show the window".
/// </summary>
internal static class HelperSignal
{
    private const string Name = @"Local\BasketDrop.ShowHelper.v1";

    public static EventWaitHandle Create() => new(false, EventResetMode.AutoReset, Name);

    public static void Ring()
    {
        try
        {
            using var handle = EventWaitHandle.OpenExisting(Name);
            handle.Set();
        }
        catch (Exception e) when (e is WaitHandleCannotBeOpenedException or UnauthorizedAccessException or IOException) { }
    }
}
