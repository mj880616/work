namespace BasketDrop;

/// <summary>Fixed codes only. The API takes no free text, so tokens, file names and memo text cannot reach the log.</summary>
public enum LogCode
{
    Started, Stopped, HotkeyFailed, HotkeyOk, Enqueued, SendOk, SendNotReached, SendUnknown,
    SendRejected, LoginRequired, QueueFull, QueueRecovered, UpdateCheck, Error,
}

public interface ILog
{
    void Write(LogCode code, int count = 0);
}

public sealed class FileLog : ILog
{
    private readonly string _path;
    private readonly object _gate = new();
    private const long MaxBytes = 256 * 1024;

    public FileLog(string path) { _path = path; }

    public void Write(LogCode code, int count = 0)
    {
        try
        {
            lock (_gate)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
                if (File.Exists(_path) && new FileInfo(_path).Length > MaxBytes)
                    File.Move(_path, _path + ".old", true);
                File.AppendAllText(_path, $"{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss} {code} {count}{Environment.NewLine}");
            }
        }
        catch { /* logging must never break sending */ }
    }
}

public sealed class NullLog : ILog { public void Write(LogCode code, int count = 0) { } }
