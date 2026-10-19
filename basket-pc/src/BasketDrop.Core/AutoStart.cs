namespace BasketDrop;

/// <summary>The current user's Run entry (no administrator rights). Kept behind an interface so the rules can be tested.</summary>
public interface IStartupRegistry
{
    string? GetRunValue();
    void SetRunValue(string command);
    void RemoveRunValue();

    /// <summary>The user switched this entry off in Windows Settings (Apps &gt; Startup).</summary>
    bool IsDisabledByWindows();
}

public enum AutoStartState { On, Off, DisabledInWindows, NotInstalled }

/// <summary>
/// Start with Windows. Runs only for the installed copy: a development build must never register itself.
/// Every start re-points the entry at the running program, so a moved or updated install never leaves a broken path.
/// </summary>
public sealed class AutoStartManager
{
    private readonly IStartupRegistry _registry;
    private readonly SettingsStore _settings;
    private readonly string? _installedExe;

    public AutoStartManager(IStartupRegistry registry, SettingsStore settings, string? installedExe)
    {
        _registry = registry;
        _settings = settings;
        _installedExe = installedExe;
    }

    public static string CommandFor(string exePath) => "\"" + exePath + "\"";

    public AutoStartState Sync()
    {
        if (_installedExe == null) return AutoStartState.NotInstalled;
        var s = _settings.Load();
        if (!s.AutoStartDecided)
        {
            s.AutoStart = true;
            s.AutoStartDecided = true;
            _settings.Save(s);
        }
        if (!s.AutoStart)
        {
            if (_registry.GetRunValue() != null) _registry.RemoveRunValue();
            return AutoStartState.Off;
        }
        var command = CommandFor(_installedExe);
        if (_registry.GetRunValue() != command) _registry.SetRunValue(command);
        return _registry.IsDisabledByWindows() ? AutoStartState.DisabledInWindows : AutoStartState.On;
    }

    public AutoStartState SetEnabled(bool on)
    {
        if (_installedExe == null) return AutoStartState.NotInstalled;
        var s = _settings.Load();
        s.AutoStart = on;
        s.AutoStartDecided = true;
        _settings.Save(s);
        return Sync();
    }
}
