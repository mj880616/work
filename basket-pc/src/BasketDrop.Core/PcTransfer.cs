using System.Security.Cryptography;

namespace BasketDrop;

/// <summary>What happened to one read, write or trash step of the door (docs/design/files-pc-drive.md 6절 ③).</summary>
public enum PcStep { Ok, BadPath, Blocked, NotFound, NotFolder, NotFile, BadRange, Exists, Risky, TooBig, NoSpace, BadPiece, Busy, Failed }

public sealed record PcRead(PcStep Result, byte[] Bytes, long Size);

/// <summary>
/// Copying between this PC and the cloud through the Web2 [파일] screen (FILES-내PC클라우드옮기기).
/// The screen moves the bytes; this class only reads pieces of one file the screen asked for, or writes one new file
/// piece by piece. Every path goes through <see cref="IPcFiles.Find"/> first (the same rules as looking), so blocked,
/// hidden, linked and system places stay out of reach.
/// </summary>
public interface IPcTransfer
{
    /// <summary>One piece of a file (at most <see cref="PcTransfer.MaxPiece"/> bytes) and the file's whole size.</summary>
    PcRead Read(string? path, long at, int count);

    /// <summary>Starts a new file in a folder. Nothing appears under the real name until <see cref="Finish"/>.</summary>
    (PcStep Result, string? Id) Begin(string? dir, string? name, long size);

    /// <summary>Adds the next piece. Pieces must come in order, without gaps or overlap.</summary>
    PcStep Piece(string? id, long at, byte[] bytes);

    /// <summary>
    /// Gives the finished file its name. A file never replaces another one: with <paramref name="numbered"/> the name
    /// becomes "name (2).ext"; without it a taken name is refused and the screen asks first.
    /// </summary>
    (PcStep Result, string? Name) Finish(string? id, bool numbered);

    /// <summary>Drops an unfinished file (its hidden part file only).</summary>
    void Cancel(string? id);
}

/// <summary>
/// The real disk. A new file is written to a hidden part file "~basket-&lt;random&gt;.part" next to where it will live, and
/// only gets its name once every byte has arrived and the size matches. Existing files are never opened for writing,
/// replaced or deleted here; the only file this class removes is its own part file. Names and paths are never logged.
/// </summary>
public sealed class PcTransfer : IPcTransfer, IDisposable
{
    /// <summary>Largest piece one request may carry either way.</summary>
    public const int MaxPiece = 4 * 1024 * 1024;
    /// <summary>Largest file the screen may write (the screen holds the whole file in memory).</summary>
    public const long MaxFile = 2L * 1024 * 1024 * 1024;
    public const string PartPrefix = "~basket-";
    private const int MaxOpen = 8;
    private static readonly TimeSpan Idle = TimeSpan.FromMinutes(10);

    private sealed class Session
    {
        public required string Dir { get; init; }
        public required string Name { get; init; }
        public required string Part { get; init; }
        public required long Size { get; init; }
        public long Written { get; set; }
        public DateTimeOffset Touched { get; set; }
    }

    private readonly IPcFiles _files;
    private readonly string? _ownDataFolder;
    private readonly Func<DateTimeOffset> _now;
    private readonly Dictionary<string, Session> _open = new(StringComparer.Ordinal);
    private readonly object _gate = new();

    public PcTransfer(IPcFiles files, string? ownDataFolder, Func<DateTimeOffset>? now = null)
    {
        _files = files;
        _ownDataFolder = ownDataFolder;
        _now = now ?? (() => DateTimeOffset.UtcNow);
    }

    private static PcStep FromLookup(PcLookup r) => r switch
    {
        PcLookup.BadPath => PcStep.BadPath,
        PcLookup.Blocked => PcStep.Blocked,
        PcLookup.NotFolder => PcStep.NotFolder,
        _ => PcStep.NotFound,
    };

    public PcRead Read(string? path, long at, int count)
    {
        var (result, kind, full) = _files.Find(path);
        if (result != PcLookup.Ok || full == null) return new PcRead(FromLookup(result), Array.Empty<byte>(), 0);
        if (kind != PcItemKind.File) return new PcRead(PcStep.NotFile, Array.Empty<byte>(), 0);
        if (at < 0 || count <= 0 || count > MaxPiece) return new PcRead(PcStep.BadRange, Array.Empty<byte>(), 0);
        try
        {
            using var stream = new FileStream(full, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 81920);
            var size = stream.Length;
            if (at > size) return new PcRead(PcStep.BadRange, Array.Empty<byte>(), size);
            var want = (int)Math.Min(count, size - at);
            var bytes = new byte[want];
            stream.Seek(at, SeekOrigin.Begin);
            var got = 0;
            while (got < want)
            {
                var n = stream.Read(bytes, got, want - got);
                if (n == 0) break;
                got += n;
            }
            return new PcRead(PcStep.Ok, got == want ? bytes : bytes[..got], size);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Security.SecurityException)
        {
            return new PcRead(PcStep.Failed, Array.Empty<byte>(), 0);
        }
    }

    /// <summary>True when <paramref name="name"/> is one plain file name that may be written into <paramref name="dirSegs"/>.</summary>
    public static PcStep NameCheck(IReadOnlyList<string> dirSegs, string? name, string? ownDataFolder)
    {
        if (string.IsNullOrEmpty(name) || name.Contains('\\') || name.StartsWith(PartPrefix, StringComparison.OrdinalIgnoreCase)) return PcStep.BadPath;
        var target = PcPath.Parse(PcPath.Join(dirSegs.Append(name).ToArray()));
        if (target == null || target.Length != dirSegs.Count + 1) return PcStep.BadPath;
        if (PcPath.IsBlocked(target, ownDataFolder)) return PcStep.Blocked;
        // A web page must not be able to plant a program on this PC.
        if (ExecutableCheck.IsRisky(name)) return PcStep.Risky;
        return PcStep.Ok;
    }

    public (PcStep Result, string? Id) Begin(string? dir, string? name, long size)
    {
        var (result, kind, full) = _files.Find(dir);
        if (result != PcLookup.Ok || full == null) return (FromLookup(result), null);
        if (kind != PcItemKind.Folder) return (PcStep.NotFolder, null);
        var segs = PcPath.Parse(full)!;
        var check = NameCheck(segs, name, _ownDataFolder);
        if (check != PcStep.Ok) return (check, null);
        if (size < 0 || size > MaxFile) return (PcStep.TooBig, null);
        try
        {
            if (new DriveInfo(segs[0]).AvailableFreeSpace < size + 64L * 1024 * 1024) return (PcStep.NoSpace, null);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentException) { return (PcStep.Failed, null); }
        lock (_gate)
        {
            SweepLocked();
            if (_open.Count >= MaxOpen) return (PcStep.Busy, null);
            var id = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
            var part = Path.Combine(full, PartPrefix + id + ".part");
            try
            {
                using (new FileStream(part, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { }
                File.SetAttributes(part, FileAttributes.Hidden);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Security.SecurityException)
            {
                return (PcStep.Failed, null);
            }
            _open[id] = new Session { Dir = full, Name = name!, Part = part, Size = size, Touched = _now() };
            return (PcStep.Ok, id);
        }
    }

    private Session? Take(string? id)
    {
        if (string.IsNullOrEmpty(id)) return null;
        lock (_gate) return _open.TryGetValue(id, out var s) ? s : null;
    }

    public PcStep Piece(string? id, long at, byte[] bytes)
    {
        var s = Take(id);
        if (s == null) return PcStep.NotFound;
        lock (s)
        {
            if (bytes.Length == 0 || bytes.Length > MaxPiece || at != s.Written || s.Written + bytes.Length > s.Size) return PcStep.BadPiece;
            try
            {
                using var stream = new FileStream(s.Part, FileMode.Open, FileAccess.Write, FileShare.None);
                if (stream.Length != s.Written) return PcStep.BadPiece; // someone else touched the part file
                stream.Seek(at, SeekOrigin.Begin);
                stream.Write(bytes, 0, bytes.Length);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                return PcStep.Failed;
            }
            s.Written += bytes.Length;
            s.Touched = _now();
            return PcStep.Ok;
        }
    }

    /// <summary>"보고서.pdf" → "보고서 (2).pdf", "자료" → "자료 (2)".</summary>
    public static string Numbered(string name, int n)
    {
        var ext = Path.GetExtension(name);
        var stem = ext.Length > 0 && ext.Length < name.Length ? name[..^ext.Length] : name;
        if (stem.Length == name.Length) ext = "";
        return $"{stem} ({n}){ext}";
    }

    private static bool Taken(string full) => File.Exists(full) || Directory.Exists(full);

    public (PcStep Result, string? Name) Finish(string? id, bool numbered)
    {
        var s = Take(id);
        if (s == null) return (PcStep.NotFound, null);
        lock (s)
        {
            if (s.Written != s.Size) return (PcStep.BadPiece, null);
            try
            {
                if (new FileInfo(s.Part).Length != s.Size) return (PcStep.BadPiece, null);
                for (var n = 1; n <= 99; n++)
                {
                    var name = n == 1 ? s.Name : Numbered(s.Name, n);
                    var target = Path.Combine(s.Dir, name);
                    if (n > 1 && NameCheck(PcPath.Parse(s.Dir)!, name, _ownDataFolder) != PcStep.Ok) return (PcStep.BadPath, null);
                    if (Taken(target))
                    {
                        if (!numbered) return (PcStep.Exists, null);
                        continue;
                    }
                    try { File.Move(s.Part, target, overwrite: false); }
                    catch (IOException) when (Taken(target)) { if (!numbered) return (PcStep.Exists, null); continue; }
                    File.SetAttributes(target, File.GetAttributes(target) & ~FileAttributes.Hidden);
                    lock (_gate) _open.Remove(id!);
                    return (PcStep.Ok, name);
                }
                return (PcStep.Exists, null);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Security.SecurityException)
            {
                return (PcStep.Failed, null);
            }
        }
    }

    public void Cancel(string? id)
    {
        var s = Take(id);
        if (s == null) return;
        lock (_gate) _open.Remove(id!);
        DropPart(s);
    }

    private static void DropPart(Session s)
    {
        // Only this class's own hidden part file, never anything the screen named.
        if (!Path.GetFileName(s.Part).StartsWith(PartPrefix, StringComparison.Ordinal)) return;
        try { File.Delete(s.Part); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
    }

    private void SweepLocked()
    {
        var now = _now();
        foreach (var (key, s) in _open.Where(p => now - p.Value.Touched > Idle).ToList())
        {
            _open.Remove(key);
            DropPart(s);
        }
    }

    /// <summary>Unfinished files right now (for tests).</summary>
    public int OpenCount { get { lock (_gate) return _open.Count; } }

    public void Dispose()
    {
        List<Session> all;
        lock (_gate) { all = _open.Values.ToList(); _open.Clear(); }
        foreach (var s in all) DropPart(s);
    }
}
