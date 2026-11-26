namespace BasketDrop;

/// <summary>Small user choices kept next to the queue. Nothing secret lives here.</summary>
public sealed class AppSettings
{
    /// <summary>Start with Windows. On by default; the user's choice from the tray menu is kept.</summary>
    public bool AutoStart { get; set; } = true;

    /// <summary>False until the first run has applied the default, so a later "off" is never undone.</summary>
    public bool AutoStartDecided { get; set; }

    /// <summary>
    /// True once the first run after the removed send entrances (hotkey, paste window, right-click Send to; S54-13)
    /// has deleted what older versions left on this PC. See <see cref="LegacyEntries"/>.
    /// </summary>
    public bool LegacyEntriesCleaned { get; set; }

    /// <summary>Screen corner that opens the drop box: TopRight (default), BottomRight or Off. See <see cref="CornerChoices"/>.</summary>
    public string Corner { get; set; } = CornerChoices.Default.ToString();

    /// <summary>The small "WORK ON+로" tile on the desktop that stays after Win+D. On by default; the tray menu turns it off.</summary>
    public bool DesktopTile { get; set; } = true;

    /// <summary>Top-left corner of the desktop tile in physical screen pixels. Null until the user moves it (default: top right).</summary>
    public int? DesktopTileX { get; set; }

    public int? DesktopTileY { get; set; }

    /// <summary>
    /// S69-35: the tile's size at 100% scale after the user dragged its edges (null = never resized: the default size).
    /// Kept next to the place, so every monitor shows the same size for its own scale.
    /// </summary>
    public int? DesktopTileWidth96 { get; set; }

    public int? DesktopTileHeight96 { get; set; }

    /// <summary>
    /// S69-31: true once this PC has turned the corner box and the desktop tile on after they came back (사용자 11/24).
    /// They were removed in 0.6 (S54-13); a value saved before that ("Off", false) must not keep them hidden. See <see cref="DropBoxDefaults"/>.
    /// </summary>
    public bool DropBoxesRestored { get; set; }

    /// <summary>'Web2에서 이 PC 보기': the 127.0.0.1 door for the Web2 [파일] screen. Off by default (decision D1); only the tray menu turns it on.</summary>
    public bool WebDoor { get; set; }

    /// <summary>The program picture revision whose shortcut pictures this PC has refreshed (0 = never). See <see cref="IconRefresh"/>.</summary>
    public int IconRevision { get; set; }
}

/// <summary>
/// S69-31 (사용자 11/24 "화면 구석 칸 써"): the first start of a version that has the corner box and the desktop tile again
/// turns both on once, whatever an older version saved. After that the tray menu's choice is kept.
/// </summary>
public static class DropBoxDefaults
{
    /// <summary>Returns true when <paramref name="s"/> was changed and must be saved.</summary>
    public static bool RestoreOnce(AppSettings s)
    {
        if (s.DropBoxesRestored) return false;
        if (CornerChoices.FromId(s.Corner) == CornerChoice.Off) s.Corner = CornerChoices.Default.ToString();
        s.DesktopTile = true;
        s.DropBoxesRestored = true;
        return true;
    }
}

public sealed class SettingsStore
{
    private readonly string _path;

    public SettingsStore(string path) { _path = path; }

    public AppSettings Load() => AtomicFile.ReadJson<AppSettings>(_path) ?? new AppSettings();

    public void Save(AppSettings settings) => AtomicFile.WriteJson(_path, settings);
}
