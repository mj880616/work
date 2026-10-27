using System.Security.Cryptography;

namespace BasketDrop;

/// <summary>One thing the user dropped: a file on disk or in-memory bytes (a clipboard picture).</summary>
public sealed record DropSource(string? Path, byte[]? Bytes, string DisplayName)
{
    public static DropSource FromPath(string path)
    {
        var clean = FileNames.CleanPath(path);
        // A Windows file name cannot contain '"', so a quote left at either end of a path is stray text, not part of the name.
        return new(clean, null, FileNames.Clean(clean.Trim('"')));
    }

    public static DropSource FromBytes(byte[] bytes, string displayName) => new(null, bytes, FileNames.Clean(displayName));
}

public enum ProblemKind { Folder, Missing, Empty, TooLarge, NameTooLong, TextTooLong, NothingToSend, QueueFull }

public sealed record DropProblem(ProblemKind Kind, string Name);

public sealed class PlannedFile
{
    public required DropSource Source { get; init; }
    public long SizeBytes { get; init; }
    public required string Sha256 { get; init; }
}

public sealed class DropPlan
{
    public List<PlannedFile> Files { get; } = new();
    public List<DropProblem> Problems { get; } = new();
    /// <summary>Display names already sent before (same hash and size).</summary>
    public List<string> Duplicates { get; } = new();
    /// <summary>Display names of program-like files; the UI asks once before sending these.</summary>
    public List<string> Risky { get; } = new();
    public string Text { get; init; } = "";
    public bool CanCommit => Files.Count > 0 || Text.Trim().Length > 0;
}

public sealed class DropService
{
    private readonly QueueStore _store;
    private readonly HistoryStore _history;
    private readonly Func<DateTimeOffset> _clock;

    public DropService(QueueStore store, HistoryStore history, Func<DateTimeOffset>? clock = null)
    {
        _store = store;
        _history = history;
        _clock = clock ?? (() => DateTimeOffset.Now);
    }

    public DropPlan Inspect(IEnumerable<DropSource> sources, string text)
    {
        var plan = new DropPlan { Text = text };
        if (Limits.TextLength(text) > Limits.MaxTextChars) plan.Problems.Add(new(ProblemKind.TextTooLong, ""));
        var budget = Limits.MaxQueueBytes - _store.PendingBytes();

        foreach (var src in sources)
        {
            var name = src.DisplayName;
            if (name.Length > Limits.MaxFileNameChars) { plan.Problems.Add(new(ProblemKind.NameTooLong, name)); continue; }
            long size;
            string sha = "";
            if (src.Bytes != null)
            {
                size = src.Bytes.LongLength;
                if (size > 0) sha = Convert.ToHexString(SHA256.HashData(src.Bytes));
            }
            else
            {
                var path = src.Path!;
                if (Directory.Exists(path)) { plan.Problems.Add(new(ProblemKind.Folder, name)); continue; }
                if (!File.Exists(path)) { plan.Problems.Add(new(ProblemKind.Missing, name)); continue; }
                size = new FileInfo(path).Length;
                if (size > 0 && size <= Limits.MaxFileBytes)
                {
                    try
                    {
                        using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                        sha = Convert.ToHexString(SHA256.HashData(fs));
                    }
                    catch (IOException) { plan.Problems.Add(new(ProblemKind.Missing, name)); continue; }
                }
            }
            if (size == 0) { plan.Problems.Add(new(ProblemKind.Empty, name)); continue; }
            if (size > Limits.MaxFileBytes) { plan.Problems.Add(new(ProblemKind.TooLarge, name)); continue; }
            if (size > budget) { plan.Problems.Add(new(ProblemKind.QueueFull, name)); continue; }
            budget -= size;

            plan.Files.Add(new PlannedFile { Source = src, SizeBytes = size, Sha256 = sha });
            if (_history.IsDuplicate(sha, size)) plan.Duplicates.Add(name);
            if (ExecutableCheck.IsRisky(name)) plan.Risky.Add(name);
        }
        if (!plan.CanCommit && plan.Problems.Count == 0) plan.Problems.Add(new(ProblemKind.NothingToSend, ""));
        return plan;
    }

    /// <summary>Copies the planned files into the queue (20 per memo; text goes with the first memo).</summary>
    public IReadOnlyList<QueueItem> Commit(DropPlan plan)
    {
        var items = new List<QueueItem>();
        if (!plan.CanCommit) return items;
        var now = _clock();
        var text = plan.Text.Trim().Length == 0 ? "" : plan.Text;

        if (plan.Files.Count == 0)
        {
            // A text-only memo gets its id now; a repeated insert with the same id is refused as a duplicate.
            var item = new QueueItem { Id = Guid.NewGuid(), CreatedAt = now, RawText = text, NoteId = Guid.NewGuid() };
            _store.Save(item);
            return new[] { item };
        }

        var chunk = 0;
        foreach (var group in plan.Files.Chunk(Limits.MaxFilesPerNote))
        {
            var item = new QueueItem
            {
                Id = Guid.NewGuid(),
                CreatedAt = now.AddTicks(chunk),
                RawText = chunk == 0 ? text : "",
            };
            chunk++;
            Directory.CreateDirectory(_store.ItemDir(item.Id));
            try
            {
                var n = 0;
                foreach (var pf in group)
                {
                    var file = new QueueFile
                    {
                        StoredName = $"f{n++}",
                        DisplayName = pf.Source.DisplayName,
                        MimeType = MimeTypes.For(pf.Source.DisplayName),
                        SizeBytes = pf.SizeBytes,
                        Sha256 = pf.Sha256,
                    };
                    var dest = _store.FilePath(item, file);
                    if (pf.Source.Bytes != null) File.WriteAllBytes(dest, pf.Source.Bytes);
                    else File.Copy(pf.Source.Path!, dest, true);
                    item.Files.Add(file);
                }
                _store.Save(item);
                items.Add(item);
            }
            catch
            {
                _store.Remove(item.Id);
                throw;
            }
        }
        return items;
    }
}

public static class MimeTypes
{
    private static readonly Dictionary<string, string> Map = new(StringComparer.OrdinalIgnoreCase)
    {
        [".png"] = "image/png", [".jpg"] = "image/jpeg", [".jpeg"] = "image/jpeg", [".gif"] = "image/gif",
        [".webp"] = "image/webp", [".bmp"] = "image/bmp", [".pdf"] = "application/pdf", [".txt"] = "text/plain",
        [".csv"] = "text/csv", [".md"] = "text/markdown", [".json"] = "application/json", [".zip"] = "application/zip",
        [".hwp"] = "application/x-hwp", [".hwpx"] = "application/hwp+zip",
        [".docx"] = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        [".xlsx"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        [".pptx"] = "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        [".mp3"] = "audio/mpeg", [".mp4"] = "video/mp4", [".wav"] = "audio/wav",
    };

    /// <summary>Always "type/subtype", the only shape the server checks.</summary>
    public static string For(string fileName) =>
        Map.TryGetValue(Path.GetExtension(fileName), out var mime) ? mime : "application/octet-stream";
}
