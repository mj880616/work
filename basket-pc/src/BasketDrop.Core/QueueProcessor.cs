namespace BasketDrop;

public enum FinishKind { Sent, NeedsCheck, Rejected }

public sealed record ItemFinished(FinishKind Kind, int FileCount, string Code);

/// <summary>
/// Sends queued memos one file at a time. Rules (design 7.1):
/// connection-before-send failures retry with backoff; "unknown" results are never resent automatically;
/// a state of "Sending" is saved before each request so a crash can only ever land on "Unknown".
/// </summary>
public sealed class QueueProcessor
{
    private readonly QueueStore _store;
    private readonly HistoryStore _history;
    private readonly IBasketApi _api;
    private readonly IAuthProvider _auth;
    private readonly ILog _log;
    private readonly Func<DateTimeOffset> _clock;
    private readonly SemaphoreSlim _run = new(1, 1);
    private int _notReachedStreak;

    public event Action? Changed;
    public event Action<ItemFinished>? Finished;

    public QueueProcessor(QueueStore store, HistoryStore history, IBasketApi api, IAuthProvider auth, ILog? log = null, Func<DateTimeOffset>? clock = null)
    {
        _store = store;
        _history = history;
        _api = api;
        _auth = auth;
        _log = log ?? new NullLog();
        _clock = clock ?? (() => DateTimeOffset.Now);
    }

    /// <summary>Delay before the next automatic try after the server was not reached: 15 s doubling up to 10 min.</summary>
    public static TimeSpan Backoff(int streak) =>
        TimeSpan.FromSeconds(Math.Min(600, 15 * Math.Pow(2, Math.Max(0, Math.Min(streak, 10) - 1))));

    private static bool Eligible(QueueItem i) => i.State is ItemState.Pending or ItemState.NotReached or ItemState.LoginRequired;

    /// <summary>Runs one pass over the queue. Returns the delay for an automatic retry, or null when none is needed.</summary>
    public async Task<TimeSpan?> RunOnceAsync(CancellationToken ct)
    {
        if (!await _run.WaitAsync(0, ct).ConfigureAwait(false)) return null;
        try
        {
            foreach (var queued in _store.List().Where(Eligible))
            {
                var item = queued;
                var token = await _auth.GetAccessTokenAsync(ct).ConfigureAwait(false);
                if (token == null)
                {
                    MarkLoginRequired();
                    return null;
                }
                var step = await SendItemAsync(item, token, ct).ConfigureAwait(false);
                if (step == Step.NotReached)
                {
                    _notReachedStreak++;
                    return Backoff(_notReachedStreak);
                }
                if (step == Step.LoginRequired) return null;
                _notReachedStreak = 0;
            }
            return null;
        }
        finally
        {
            _run.Release();
        }
    }

    private enum Step { Next, NotReached, LoginRequired }

    private void MarkLoginRequired()
    {
        var any = false;
        foreach (var item in _store.List().Where(i => Eligible(i) && i.State != ItemState.LoginRequired))
        {
            item.State = ItemState.LoginRequired;
            item.ErrorCode = "session_required";
            _store.Save(item);
            any = true;
        }
        _log.Write(LogCode.LoginRequired);
        if (any) Changed?.Invoke();
    }

    private async Task<Step> SendItemAsync(QueueItem item, string token, CancellationToken ct)
    {
        item.Attempts++;
        if (item.TextOnly)
        {
            Persist(item, ItemState.Sending, "");
            var r = await CallAsync(() => _api.CreateNoteAsync(token, item.NoteId!.Value, item.RawText, ct), ct).ConfigureAwait(false);
            if (r.Outcome is ApiOutcome.Ok or ApiOutcome.AlreadySaved) { Complete(item, 0); return Step.Next; }
            return Handle(item, r);
        }

        foreach (var file in item.Files.Where(f => f.State == FileState.Pending).ToList())
        {
            Persist(item, ItemState.Sending, "");
            var path = _store.FilePath(item, file);
            var text = item.NoteId == null ? item.RawText : null;
            var r = await CallAsync(() => _api.UploadFileAsync(token, path, file, text, item.NoteId, ct), ct).ConfigureAwait(false);
            if (r.Outcome != ApiOutcome.Ok) return Handle(item, r);
            item.NoteId = r.NoteId;
            file.State = FileState.Done;
            TryDelete(path);
            _store.Save(item);
        }
        Complete(item, item.Files.Count);
        return Step.Next;
    }

    /// <summary>A shutdown cancel during a request means we cannot know what the server did.</summary>
    private static async Task<ApiResult> CallAsync(Func<Task<ApiResult>> call, CancellationToken ct)
    {
        try
        {
            return await call().ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            return new ApiResult(ApiOutcome.Unknown, "interrupted");
        }
    }

    private Step Handle(QueueItem item, ApiResult r)
    {
        switch (r.Outcome)
        {
            case ApiOutcome.LoginRequired:
                Persist(item, ItemState.LoginRequired, r.Code);
                _log.Write(LogCode.LoginRequired);
                return Step.LoginRequired;
            case ApiOutcome.NotReached:
                Persist(item, ItemState.NotReached, r.Code);
                _log.Write(LogCode.SendNotReached);
                return Step.NotReached;
            case ApiOutcome.Unknown:
                Persist(item, ItemState.Unknown, r.Code);
                _log.Write(LogCode.SendUnknown);
                Finished?.Invoke(new ItemFinished(FinishKind.NeedsCheck, item.Files.Count, r.Code));
                return Step.Next;
            default:
                Persist(item, ItemState.Rejected, r.Code);
                _log.Write(LogCode.SendRejected);
                Finished?.Invoke(new ItemFinished(FinishKind.Rejected, item.Files.Count, r.Code));
                return Step.Next;
        }
    }

    private void Persist(QueueItem item, ItemState state, string code)
    {
        item.State = state;
        item.ErrorCode = code;
        _store.Save(item);
        Changed?.Invoke();
    }

    private void Complete(QueueItem item, int fileCount)
    {
        _history.Add(new HistoryEntry
        {
            At = _clock(),
            NoteId = item.NoteId ?? Guid.Empty,
            FileCount = fileCount,
            TotalBytes = item.Files.Sum(f => f.SizeBytes),
            FileKeys = item.Files.Select(f => HistoryStore.Key(f.Sha256, f.SizeBytes)).ToList(),
        });
        _store.Remove(item.Id);
        _log.Write(LogCode.SendOk, fileCount);
        Finished?.Invoke(new ItemFinished(FinishKind.Sent, fileCount, "ok"));
        Changed?.Invoke();
    }

    private static void TryDelete(string path)
    {
        try { File.Delete(path); } catch (IOException) { }
    }

    // --- user actions ---

    /// <summary>[다시 보내기] after "Unknown" or "Rejected". The user has accepted that a file may appear twice.</summary>
    public void Resend(Guid itemId)
    {
        var item = _store.List().FirstOrDefault(i => i.Id == itemId);
        if (item == null || item.State is not (ItemState.Unknown or ItemState.Rejected)) return;
        item.State = ItemState.Pending;
        item.ErrorCode = "";
        _store.Save(item);
        Changed?.Invoke();
    }

    public void Discard(Guid itemId)
    {
        _store.Remove(itemId);
        Changed?.Invoke();
    }
}
