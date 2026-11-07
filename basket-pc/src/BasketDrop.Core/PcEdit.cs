namespace BasketDrop;

/// <summary>
/// FILES-내PC쓰기: changes inside this PC that a person pressed on the Web2 [파일] screen — rename, new folder,
/// move and copy. Every path goes through <see cref="IPcFiles.Find"/> first (the same rules as looking), so blocked,
/// hidden, linked and system places stay out of reach, and every new name goes through <see cref="PcTransfer.NameCheck"/>
/// (one plain name, not a program). Nothing here ever replaces or deletes an item: a taken name is refused, or with
/// <c>numbered</c> becomes "name (2)". Sending to the recycle bin stays in <see cref="IPcShell.Trash"/>.
/// Names and paths are never logged.
/// </summary>
public interface IPcEdit
{
    /// <summary>Gives a file or folder (not a drive) a new name in the same folder. Answers the new full path.</summary>
    (PcStep Result, string? Path) Rename(string? path, string? name);

    /// <summary>Makes one new, empty folder. Answers its full path.</summary>
    (PcStep Result, string? Path) MakeFolder(string? dir, string? name);

    /// <summary>Moves a file or folder into another folder (folders only within the same drive). Answers the new full path.</summary>
    (PcStep Result, string? Path) Move(string? path, string? dir, bool numbered);

    /// <summary>Copies one file into a folder as a new file. Answers the new full path.</summary>
    (PcStep Result, string? Path) Copy(string? path, string? dir, bool numbered);
}

public sealed class PcEdit : IPcEdit
{
    private readonly IPcFiles _files;
    private readonly string? _ownDataFolder;

    public PcEdit(IPcFiles files, string? ownDataFolder)
    {
        _files = files;
        _ownDataFolder = ownDataFolder;
    }

    private static PcStep FromLookup(PcLookup r) => r switch
    {
        PcLookup.BadPath => PcStep.BadPath,
        PcLookup.Blocked => PcStep.Blocked,
        PcLookup.NotFolder => PcStep.NotFolder,
        _ => PcStep.NotFound,
    };

    private static bool Taken(string full) => File.Exists(full) || Directory.Exists(full);

    /// <summary>An item that is not a drive root (a drive is never renamed, moved or copied).</summary>
    private (PcStep Result, PcItemKind Kind, string[] Segs, string Full) Item(string? path)
    {
        var (result, kind, full) = _files.Find(path);
        if (result != PcLookup.Ok || full == null) return (FromLookup(result), PcItemKind.None, Array.Empty<string>(), "");
        var segs = PcPath.Parse(full)!;
        if (segs.Length < 2) return (PcStep.BadPath, PcItemKind.None, Array.Empty<string>(), "");
        return (PcStep.Ok, kind, segs, full);
    }

    private (PcStep Result, string[] Segs, string Full) Folder(string? dir)
    {
        var (result, kind, full) = _files.Find(dir);
        if (result != PcLookup.Ok || full == null) return (FromLookup(result), Array.Empty<string>(), "");
        if (kind != PcItemKind.Folder) return (PcStep.NotFolder, Array.Empty<string>(), "");
        return (PcStep.Ok, PcPath.Parse(full)!, full);
    }

    public (PcStep Result, string? Path) Rename(string? path, string? name)
    {
        var item = Item(path);
        if (item.Result != PcStep.Ok) return (item.Result, null);
        var parent = item.Segs[..^1];
        var check = PcTransfer.NameCheck(parent, name, _ownDataFolder);
        if (check != PcStep.Ok) return (check, null);
        var target = PcPath.Join(parent.Append(name!).ToArray());
        if (string.Equals(target, item.Full, StringComparison.Ordinal)) return (PcStep.Ok, target);
        // Only the letter case changes ("a.txt" → "A.txt"): the same item, so it is not "taken".
        var sameItem = string.Equals(target, item.Full, StringComparison.OrdinalIgnoreCase);
        if (!sameItem && Taken(target)) return (PcStep.Exists, null);
        return Shift(item.Kind, item.Full, target) ? (PcStep.Ok, target) : (Taken(target) && !sameItem ? PcStep.Exists : PcStep.Failed, null);
    }

    public (PcStep Result, string? Path) MakeFolder(string? dir, string? name)
    {
        var folder = Folder(dir);
        if (folder.Result != PcStep.Ok) return (folder.Result, null);
        var check = PcTransfer.NameCheck(folder.Segs, name, _ownDataFolder);
        if (check != PcStep.Ok) return (check, null);
        var target = PcPath.Join(folder.Segs.Append(name!).ToArray());
        if (Taken(target)) return (PcStep.Exists, null);
        try
        {
            Directory.CreateDirectory(target);
            return (PcStep.Ok, target);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Security.SecurityException)
        {
            return (PcStep.Failed, null);
        }
    }

    /// <summary>The first free name in <paramref name="dirSegs"/> ("name", then "name (2)" …), or null when taken and not numbered.</summary>
    private (PcStep Result, string? Target) FreeName(string[] dirSegs, string name, bool numbered)
    {
        for (var n = 1; n <= 99; n++)
        {
            var candidate = n == 1 ? name : PcTransfer.Numbered(name, n);
            var check = PcTransfer.NameCheck(dirSegs, candidate, _ownDataFolder);
            if (check != PcStep.Ok) return (check, null);
            var target = PcPath.Join(dirSegs.Append(candidate).ToArray());
            if (!Taken(target)) return (PcStep.Ok, target);
            if (!numbered) return (PcStep.Exists, null);
        }
        return (PcStep.Exists, null);
    }

    public (PcStep Result, string? Path) Move(string? path, string? dir, bool numbered)
    {
        var item = Item(path);
        if (item.Result != PcStep.Ok) return (item.Result, null);
        var folder = Folder(dir);
        if (folder.Result != PcStep.Ok) return (folder.Result, null);
        var into = folder.Segs;
        // Already there: nothing to do.
        if (into.Length == item.Segs.Length - 1 && into.Zip(item.Segs).All(p => string.Equals(p.First, p.Second, StringComparison.OrdinalIgnoreCase)))
            return (PcStep.Ok, item.Full);
        if (item.Kind == PcItemKind.Folder)
        {
            // Never into itself or one of its own folders, and folders stay on their drive (Windows cannot move them across).
            if (into.Length >= item.Segs.Length && item.Segs.Zip(into).All(p => string.Equals(p.First, p.Second, StringComparison.OrdinalIgnoreCase)))
                return (PcStep.BadPath, null);
            if (!string.Equals(into[0], item.Segs[0], StringComparison.OrdinalIgnoreCase)) return (PcStep.OtherDrive, null);
        }
        var (free, target) = FreeName(into, item.Segs[^1], numbered);
        if (free != PcStep.Ok || target == null) return (free, null);
        return Shift(item.Kind, item.Full, target) ? (PcStep.Ok, target) : (Taken(target) ? PcStep.Exists : PcStep.Failed, null);
    }

    public (PcStep Result, string? Path) Copy(string? path, string? dir, bool numbered)
    {
        var item = Item(path);
        if (item.Result != PcStep.Ok) return (item.Result, null);
        if (item.Kind != PcItemKind.File) return (PcStep.NotFile, null);
        var folder = Folder(dir);
        if (folder.Result != PcStep.Ok) return (folder.Result, null);
        var sameFolder = folder.Segs.Length == item.Segs.Length - 1
            && folder.Segs.Zip(item.Segs).All(p => string.Equals(p.First, p.Second, StringComparison.OrdinalIgnoreCase));
        // A copy into its own folder always gets a number (it can never take the original's name).
        var (free, target) = FreeName(folder.Segs, item.Segs[^1], numbered || sameFolder);
        if (free != PcStep.Ok || target == null) return (free, null);
        try
        {
            var size = new FileInfo(item.Full).Length;
            if (new DriveInfo(folder.Segs[0]).AvailableFreeSpace < size + 64L * 1024 * 1024) return (PcStep.NoSpace, null);
            File.Copy(item.Full, target, overwrite: false);
            return (PcStep.Ok, target);
        }
        catch (IOException) when (Taken(target)) { return (PcStep.Exists, null); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Security.SecurityException or ArgumentException)
        {
            return (PcStep.Failed, null);
        }
    }

    /// <summary>Renames or moves without ever replacing: both calls refuse a taken target.</summary>
    private static bool Shift(PcItemKind kind, string from, string to)
    {
        try
        {
            if (kind == PcItemKind.Folder) Directory.Move(from, to);
            else File.Move(from, to, overwrite: false);
            return true;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Security.SecurityException)
        {
            return false;
        }
    }
}
