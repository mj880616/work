namespace BasketDrop;

/// <summary>Same limits as the web basket (app/basket-upload.js) and the basket-files function.</summary>
public static class Limits
{
    public const long MaxFileBytes = 104_857_600; // 100 MiB
    public const int MaxFilesPerNote = 20;
    public const int MaxTextChars = 20_000;
    public const int MaxFileNameChars = 255;
    public const long MaxQueueBytes = 2L * 1024 * 1024 * 1024; // 2 GiB queue cap (design D5)
    public static readonly TimeSpan StaleAfter = TimeSpan.FromDays(7);
    public const int HistoryKeep = 200;

    /// <summary>Counts Unicode characters after CRLF normalisation, like validateBatch in the web code.</summary>
    public static int TextLength(string text)
    {
        var normalized = text.Replace("\r\n", "\n").Replace('\r', '\n').Replace("\n", "\r\n");
        var count = 0;
        foreach (var _ in normalized.EnumerateRunes()) count++;
        return count;
    }

    /// <summary>Upload response budget: 90 s + 4 s per started MiB, at most 10 min (web code).</summary>
    public static TimeSpan UploadTimeout(long sizeBytes)
    {
        var mib = (sizeBytes + 1_048_575) / 1_048_576;
        var ms = Math.Min(600_000L, 90_000L + mib * 4_000L);
        return TimeSpan.FromMilliseconds(ms);
    }
}
