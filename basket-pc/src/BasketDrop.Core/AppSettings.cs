namespace BasketDrop;

/// <summary>Small user choices kept next to the queue. Nothing secret lives here.</summary>
public sealed class AppSettings
{
    /// <summary>Start with Windows. On by default; the user's choice from the tray menu is kept.</summary>
    public bool AutoStart { get; set; } = true;

    /// <summary>False until the first run has applied the default, so a later "off" is never undone.</summary>
    public bool AutoStartDecided { get; set; }

    /// <summary>
    /// True once the first run after the four send entrances (hotkey, paste window, right-click Send to, corner box, desktop tile)
    /// were removed has deleted what older versions left on this PC. See <see cref="LegacyEntries"/>.
    /// </summary>
    public bool LegacyEntriesCleaned { get; set; }

    /// <summary>'Web2에서 이 PC 보기': the 127.0.0.1 door for the Web2 [파일] screen. Off by default (decision D1); only the tray menu turns it on.</summary>
    public bool WebDoor { get; set; }
}

public sealed class SettingsStore
{
    private readonly string _path;

    public SettingsStore(string path) { _path = path; }

    public AppSettings Load() => AtomicFile.ReadJson<AppSettings>(_path) ?? new AppSettings();

    public void Save(AppSettings settings) => AtomicFile.WriteJson(_path, settings);
}
