namespace BasketDrop;

/// <summary>
/// On-disk queue: one folder per memo (item.json + copied files). No token or secret is ever written here.
/// All access goes through one lock; the program is the only writer.
/// </summary>
public sealed class QueueStore
{
    private readonly string _root;
    private readonly object _gate = new();

    public QueueStore(string root)
    {
        _root = root;
        Directory.CreateDirectory(ItemsDir);
    }

    private string ItemsDir => Path.Combine(_root, "items");
    public string ItemDir(Guid id) => Path.Combine(ItemsDir, id.ToString("N"));
    private string JsonPath(Guid id) => Path.Combine(ItemDir(id), "item.json");
    public string FilePath(QueueItem item, QueueFile file) => Path.Combine(ItemDir(item.Id), file.StoredName);

    public IReadOnlyList<QueueItem> List()
    {
        lock (_gate)
        {
            var result = new List<QueueItem>();
            foreach (var dir in Directory.EnumerateDirectories(ItemsDir))
            {
                var item = AtomicFile.ReadJson<QueueItem>(Path.Combine(dir, "item.json"));
                if (item != null) result.Add(item);
            }
            return result.OrderBy(i => i.CreatedAt).ThenBy(i => i.Id).ToList();
        }
    }

    public void Save(QueueItem item)
    {
        lock (_gate) AtomicFile.WriteJson(JsonPath(item.Id), item);
    }

    public void Remove(Guid id)
    {
        lock (_gate)
        {
            var dir = ItemDir(id);
            if (Directory.Exists(dir)) Directory.Delete(dir, true);
        }
    }

    /// <summary>Bytes still held on disk by files that have not been sent.</summary>
    public long PendingBytes() =>
        List().Sum(i => i.Files.Where(f => f.State == FileState.Pending).Sum(f => f.SizeBytes));

    /// <summary>A crash or restart during a request leaves "Sending": the result is unknown, never resend automatically.</summary>
    public int RecoverInterrupted()
    {
        var n = 0;
        foreach (var item in List().Where(i => i.State == ItemState.Sending))
        {
            item.State = ItemState.Unknown;
            item.ErrorCode = "interrupted";
            Save(item);
            n++;
        }
        return n;
    }

    public IReadOnlyList<QueueItem> Stale(DateTimeOffset now) =>
        List().Where(i => now - i.CreatedAt > Limits.StaleAfter).ToList();
}
