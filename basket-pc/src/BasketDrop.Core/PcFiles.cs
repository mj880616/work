namespace BasketDrop;

public sealed record PcDrive(string Root, string Label, string Kind, long Total, long Free);

public sealed record PcEntry(string Name, bool Dir, long Size, DateTimeOffset Modified);

public enum PcLookup { Ok, BadPath, Blocked, NotFound, NotFolder }

public sealed record PcListing(PcLookup Result, IReadOnlyList<PcEntry> Entries, bool Truncated);

public enum PcItemKind { None, File, Folder }

/// <summary>What the door may read from this PC. Read-only: nothing here writes, moves or deletes.</summary>
public interface IPcFiles
{
    IReadOnlyList<PcDrive> Drives();
    PcListing List(string? path);
    (PcLookup Result, PcItemKind Kind, string? FullPath) Find(string? path);
}

/// <summary>
/// The real disk, behind the <see cref="PcPath"/> rules. Every folder on the way to the asked path is checked again
/// on disk: a link (junction, symbolic link, mount point) is never followed, and hidden or system items are never
/// shown, so a path cannot escape into a blocked folder through another name.
/// Cloud placeholders (OneDrive "online only" files) are not links and stay visible.
/// </summary>
public sealed class PcFiles : IPcFiles
{
    public const int MaxEntries = 5000;
    private readonly string? _ownDataFolder;

    public PcFiles(string? ownDataFolder) { _ownDataFolder = ownDataFolder; }

    public IReadOnlyList<PcDrive> Drives()
    {
        var list = new List<PcDrive>();
        foreach (var d in DriveInfo.GetDrives())
        {
            try
            {
                if (d.DriveType is not (DriveType.Fixed or DriveType.Removable) || !d.IsReady) continue;
                var segs = PcPath.Parse(d.Name);
                if (segs == null) continue;
                list.Add(new PcDrive(PcPath.Join(segs), d.VolumeLabel ?? "", d.DriveType == DriveType.Removable ? "removable" : "fixed",
                    d.TotalSize, d.AvailableFreeSpace));
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
        }
        return list;
    }

    private static bool Hidden(FileAttributes a) => (a & (FileAttributes.Hidden | FileAttributes.System)) != 0;

    private static bool IsLink(FileSystemInfo info)
    {
        try { return info.LinkTarget != null; }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return true; }
    }

    /// <summary>Checks the drive and every folder on the way down, then the item itself.</summary>
    public (PcLookup Result, PcItemKind Kind, string? FullPath) Find(string? path)
    {
        var segs = PcPath.Parse(path);
        if (segs == null) return (PcLookup.BadPath, PcItemKind.None, null);
        if (PcPath.IsBlocked(segs, _ownDataFolder)) return (PcLookup.Blocked, PcItemKind.None, null);
        var root = PcPath.Join(segs.Take(1).ToArray());
        if (!Drives().Any(d => d.Root.Equals(root, StringComparison.OrdinalIgnoreCase))) return (PcLookup.NotFound, PcItemKind.None, null);
        try
        {
            for (var i = 2; i <= segs.Length; i++)
            {
                var here = PcPath.Join(segs.Take(i).ToArray());
                FileSystemInfo info = Directory.Exists(here) ? new DirectoryInfo(here) : new FileInfo(here);
                if (!info.Exists) return (PcLookup.NotFound, PcItemKind.None, null);
                if (Hidden(info.Attributes) || IsLink(info)) return (PcLookup.Blocked, PcItemKind.None, null);
                if (info is FileInfo && i < segs.Length) return (PcLookup.NotFound, PcItemKind.None, null);
                if (i == segs.Length) return (PcLookup.Ok, info is DirectoryInfo ? PcItemKind.Folder : PcItemKind.File, here);
            }
            return (PcLookup.Ok, PcItemKind.Folder, root);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Security.SecurityException)
        {
            return (PcLookup.NotFound, PcItemKind.None, null);
        }
    }

    public PcListing List(string? path)
    {
        var (result, kind, full) = Find(path);
        if (result != PcLookup.Ok) return new PcListing(result, Array.Empty<PcEntry>(), false);
        if (kind != PcItemKind.Folder || full == null) return new PcListing(PcLookup.NotFolder, Array.Empty<PcEntry>(), false);
        var parent = PcPath.Parse(full)!;
        var entries = new List<PcEntry>();
        var truncated = false;
        var options = new EnumerationOptions
        {
            IgnoreInaccessible = true,
            RecurseSubdirectories = false,
            AttributesToSkip = FileAttributes.Hidden | FileAttributes.System,
            ReturnSpecialDirectories = false,
        };
        try
        {
            foreach (var info in new DirectoryInfo(full).EnumerateFileSystemInfos("*", options))
            {
                if (IsLink(info)) continue;
                if (PcPath.IsBlocked(parent.Append(info.Name).ToArray(), _ownDataFolder)) continue;
                if (entries.Count >= MaxEntries) { truncated = true; break; }
                var dir = info is DirectoryInfo;
                entries.Add(new PcEntry(info.Name, dir, dir ? 0 : ((FileInfo)info).Length, new DateTimeOffset(info.LastWriteTimeUtc, TimeSpan.Zero)));
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Security.SecurityException)
        {
            return new PcListing(PcLookup.NotFound, Array.Empty<PcEntry>(), false);
        }
        entries.Sort((a, b) => a.Dir != b.Dir ? (a.Dir ? -1 : 1) : StringComparer.CurrentCultureIgnoreCase.Compare(a.Name, b.Name));
        return new PcListing(PcLookup.Ok, entries, truncated);
    }
}
