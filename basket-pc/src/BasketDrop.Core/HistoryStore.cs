namespace BasketDrop;

/// <summary>Record of what was sent: hashes, sizes, times and note ids only. No file names, no content.</summary>
public sealed class HistoryStore
{
    private readonly string _path;
    private readonly object _gate = new();

    public HistoryStore(string path) { _path = path; }

    public static string Key(string sha256, long size) => $"{sha256}:{size}";

    private List<HistoryEntry> Load() => AtomicFile.ReadJson<List<HistoryEntry>>(_path) ?? new();

    public void Add(HistoryEntry entry)
    {
        lock (_gate)
        {
            var all = Load();
            all.Add(entry);
            if (all.Count > Limits.HistoryKeep)
                all = all.OrderByDescending(e => e.At).Take(Limits.HistoryKeep).Reverse().ToList();
            AtomicFile.WriteJson(_path, all);
        }
    }

    public IReadOnlyList<HistoryEntry> Recent(int count)
    {
        lock (_gate) return Load().OrderByDescending(e => e.At).Take(count).ToList();
    }

    public bool IsDuplicate(string sha256, long size)
    {
        var key = Key(sha256, size);
        lock (_gate) return Load().Any(e => e.FileKeys.Contains(key));
    }
}
