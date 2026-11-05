namespace BasketDrop;

/// <summary>
/// Rules for the paths the Web2 [파일] screen may ask the PC door about (docs/design/files-pc-drive.md 4-2).
/// Pure string rules, decided before the disk is touched: a path must be a plain absolute drive path
/// ("C:\" or "C:\a\b"), with no "..", no device or UNC form, no alternate data stream and no wildcard.
/// Windows and program folders, every user's AppData, the recycle bin and system volume folders are never shown,
/// even when asked for directly.
/// </summary>
public static class PcPath
{
    /// <summary>Folders right under a drive root that are never listed or opened.</summary>
    private static readonly HashSet<string> BlockedAtRoot = new(StringComparer.OrdinalIgnoreCase)
    {
        "Windows", "Program Files", "Program Files (x86)", "ProgramData", "$Recycle.Bin", "System Volume Information",
        "Recovery", "$WinREAgent", "$Windows.~BT", "$Windows.~WS", "$SysReset", "Config.Msi", "Documents and Settings",
        "PerfLogs", "MSOCache", "Boot",
    };

    /// <summary>Names Windows treats as devices, whatever the extension ("NUL.txt" is still the device).</summary>
    private static readonly HashSet<string> Devices = new(StringComparer.OrdinalIgnoreCase)
    {
        "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    };

    private static readonly char[] Bad = { '<', '>', '"', '|', '?', '*', ':', '/' };

    /// <summary>
    /// Turns the screen's path into its segments: [0] is the drive ("C:"), the rest are folder and file names.
    /// Returns null for anything that is not a plain absolute drive path. Never resolves against the current folder.
    /// </summary>
    public static string[]? Parse(string? input)
    {
        if (string.IsNullOrEmpty(input) || input.Length > 1024) return null;
        if (input.Length < 2 || !char.IsAsciiLetter(input[0]) || input[1] != ':') return null;
        if (input.Length > 2 && input[2] != '\\') return null; // "C:foo" is relative to a hidden current folder
        var rest = input.Length > 3 ? input[3..] : "";
        if (rest.EndsWith('\\')) rest = rest[..^1];
        var segs = new List<string> { char.ToUpperInvariant(input[0]) + ":" };
        if (rest.Length == 0) return segs.ToArray();
        foreach (var seg in rest.Split('\\'))
        {
            if (seg.Length == 0 || seg.Length > 255) return null;          // "C:\\a" or "\\?\" forms
            if (seg == "." || seg == "..") return null;                    // no walking up
            if (seg.EndsWith('.') || seg.EndsWith(' ')) return null;       // Windows trims these: two names, one file
            if (seg.IndexOfAny(Bad) >= 0) return null;                     // ":" would be an alternate data stream
            if (seg.Any(ch => ch < 32)) return null;
            var dot = seg.IndexOf('.');
            if (Devices.Contains((dot < 0 ? seg : seg[..dot]).TrimEnd())) return null;
            segs.Add(seg);
        }
        return segs.ToArray();
    }

    public static string Join(IReadOnlyList<string> segs) =>
        segs.Count == 1 ? segs[0] + "\\" : string.Join('\\', segs);

    /// <summary>True when the path, or a folder it is inside, must never be shown.</summary>
    public static bool IsBlocked(IReadOnlyList<string> segs, string? ownDataFolder = null)
    {
        if (segs.Count >= 2 && BlockedAtRoot.Contains(segs[1])) return true;
        // C:\Users\<anyone>\AppData (and the "Default"/"All Users" profiles' copies of it)
        if (segs.Count >= 4 && segs[1].Equals("Users", StringComparison.OrdinalIgnoreCase)
            && segs[3].Equals("AppData", StringComparison.OrdinalIgnoreCase)) return true;
        if (segs.Count >= 3 && segs[1].Equals("Users", StringComparison.OrdinalIgnoreCase)
            && (segs[2].Equals("All Users", StringComparison.OrdinalIgnoreCase) || segs[2].Equals("Default User", StringComparison.OrdinalIgnoreCase))) return true;
        if (ownDataFolder != null)
        {
            var own = Parse(ownDataFolder);
            if (own != null && own.Length <= segs.Count && own.Select((s, i) => s.Equals(segs[i], StringComparison.OrdinalIgnoreCase)).All(x => x))
                return true;
        }
        return false;
    }

    /// <summary>File kinds the door opens with the PC's own program. Anything else is only shown in Explorer, never run.</summary>
    private static readonly HashSet<string> Openable = new(StringComparer.OrdinalIgnoreCase)
    {
        ".pdf", ".hwp", ".hwpx", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp", ".rtf",
        ".txt", ".csv", ".md", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic", ".tif", ".tiff",
        ".mp4", ".mov", ".avi", ".mkv", ".wmv", ".mp3", ".m4a", ".wav", ".aac", ".flac",
    };

    public static bool CanOpenDirectly(string fileName) =>
        Openable.Contains(Path.GetExtension(fileName)) && !ExecutableCheck.IsRisky(fileName);
}
