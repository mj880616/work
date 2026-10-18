namespace BasketDrop;

public enum ItemState
{
    /// <summary>Waiting on this PC; will be sent.</summary>
    Pending,
    Sending,
    /// <summary>Server was not reached (offline); retried automatically.</summary>
    NotReached,
    /// <summary>Not signed in; resumes after sign-in.</summary>
    LoginRequired,
    /// <summary>Request may have been saved. Never resent automatically.</summary>
    Unknown,
    /// <summary>Server refused with a definite error. Needs the user.</summary>
    Rejected,
}

public enum FileState { Pending, Done }

public sealed class QueueFile
{
    public string StoredName { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string MimeType { get; set; } = "application/octet-stream";
    public long SizeBytes { get; set; }
    public string Sha256 { get; set; } = "";
    public FileState State { get; set; } = FileState.Pending;
}

public sealed class QueueItem
{
    public Guid Id { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string RawText { get; set; } = "";
    public List<QueueFile> Files { get; set; } = new();
    public ItemState State { get; set; } = ItemState.Pending;
    /// <summary>Fixed code only (never a server message). Empty when none.</summary>
    public string ErrorCode { get; set; } = "";
    public int Attempts { get; set; }
    /// <summary>For text-only items: client-made id so a repeated insert is rejected as a duplicate.
    /// For file items: the note id returned by the first successful upload.</summary>
    public Guid? NoteId { get; set; }
    public bool TextOnly => Files.Count == 0;
}

public sealed class HistoryEntry
{
    public DateTimeOffset At { get; set; }
    public Guid NoteId { get; set; }
    public int FileCount { get; set; }
    public long TotalBytes { get; set; }
    /// <summary>Hashes and sizes only; no names and no content.</summary>
    public List<string> FileKeys { get; set; } = new();
}
