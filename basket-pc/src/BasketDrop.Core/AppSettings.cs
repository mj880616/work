namespace BasketDrop;

/// <summary>Small user choices kept next to the queue. Nothing secret lives here.</summary>
public sealed class AppSettings
{
    public string Hotkey { get; set; } = HotkeyChoice.Default.Id;

    /// <summary>Start with Windows. On by default; the user's choice from the tray menu is kept.</summary>
    public bool AutoStart { get; set; } = true;

    /// <summary>False until the first run has applied the default, so a later "off" is never undone.</summary>
    public bool AutoStartDecided { get; set; }
}

public sealed class SettingsStore
{
    private readonly string _path;

    public SettingsStore(string path) { _path = path; }

    public AppSettings Load() => AtomicFile.ReadJson<AppSettings>(_path) ?? new AppSettings();

    public void Save(AppSettings settings) => AtomicFile.WriteJson(_path, settings);
}
