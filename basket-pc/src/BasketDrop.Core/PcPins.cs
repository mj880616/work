namespace BasketDrop;

/// <summary>
/// '고정한 폴더' of this PC for the Web2 [파일] screen (FILES-폴더고정). PC folder paths stay on this PC: the screen asks this
/// app for them through the door, and they never go to a server (cloud pins are kept in the web profile instead).
/// Only plain drive paths outside the blocked places are kept, at most <see cref="Max"/>, in the order the person chose.
/// </summary>
public interface IPcPins
{
    IReadOnlyList<string> Load();

    /// <summary>Replaces the list. False (and nothing saved) when any path is not a plain, allowed folder path or the list is too long.</summary>
    bool Save(IReadOnlyList<string?> pins);
}

/// <summary>A small JSON file in this app's own data folder (written atomically). Never logged.</summary>
public sealed class PcPins : IPcPins
{
    public const int Max = 12;
    private readonly string _path;
    private readonly string? _ownDataFolder;
    private readonly object _gate = new();

    public PcPins(string path, string? ownDataFolder) { _path = path; _ownDataFolder = ownDataFolder; }

    /// <summary>The kept form of one path, or null when it may not be pinned.</summary>
    public static string? Clean(string? path, string? ownDataFolder)
    {
        var segs = PcPath.Parse(path);
        return segs == null || PcPath.IsBlocked(segs, ownDataFolder) ? null : PcPath.Join(segs);
    }

    public IReadOnlyList<string> Load()
    {
        lock (_gate)
        {
            var list = AtomicFile.ReadJson<List<string>>(_path) ?? new List<string>();
            return list.Select(p => Clean(p, _ownDataFolder)).OfType<string>().Distinct(StringComparer.OrdinalIgnoreCase).Take(Max).ToList();
        }
    }

    public bool Save(IReadOnlyList<string?> pins)
    {
        if (pins.Count > Max) return false;
        var clean = new List<string>();
        foreach (var p in pins)
        {
            var c = Clean(p, _ownDataFolder);
            if (c == null || clean.Contains(c, StringComparer.OrdinalIgnoreCase)) return false;
            clean.Add(c);
        }
        try
        {
            lock (_gate) AtomicFile.WriteJson(_path, clean);
            return true;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return false; }
    }
}
