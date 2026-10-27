using System.Text;
using Velopack;
using Velopack.Sources;

namespace BasketDrop.App;

internal enum UpdateOutcome { NotInstalled, UpToDate, Downloaded, Failed }

/// <summary>
/// Looks for a newer release at start (and every 12 hours), downloads it and leaves it for the next start.
/// Which release and which addresses are trusted is decided in <see cref="UpdatePolicy"/>; this class only wires
/// that to Velopack. A failure anywhere leaves the installed version untouched.
/// </summary>
internal sealed class UpdateService
{
    private const long ListMaxBytes = 4 * 1024 * 1024;
    private const long PackageMaxBytes = 600L * 1024 * 1024;
    private readonly ILog _log;
    private UpdateManager? _manager;
    private VelopackAsset? _pending;

    public UpdateService(ILog log) { _log = log; }

    /// <summary>True when the program was started from a Velopack install (not from a development build).</summary>
    public static bool IsInstalled => new UpdateManager(AppContext.BaseDirectory).IsInstalled;

    public string? PendingVersion => _pending?.Version.ToString();

    public async Task<UpdateOutcome> CheckAsync(CancellationToken ct)
    {
        if (!IsInstalled) return UpdateOutcome.NotInstalled;
        _log.Write(LogCode.UpdateCheck);
        try
        {
            string? tag;
            using (var listFetcher = new TrustedFetcher(null))
            {
                var bytes = await listFetcher.GetBytesAsync(UpdatePolicy.ReleaseListUri, ListMaxBytes, ct).ConfigureAwait(false);
                tag = UpdatePolicy.PickTag(Encoding.UTF8.GetString(bytes));
            }
            if (tag == null) return UpdateOutcome.UpToDate;

            using var fetcher = new TrustedFetcher(tag);
            var source = new SimpleWebSource(UpdatePolicy.ReleaseBase(tag), new TrustedDownloader(fetcher, PackageMaxBytes));
            var manager = new UpdateManager(source, new UpdateOptions { AllowVersionDowngrade = false });
            var info = await manager.CheckForUpdatesAsync().ConfigureAwait(false);
            if (info == null) return UpdateOutcome.UpToDate;

            await manager.DownloadUpdatesAsync(info, null, ct).ConfigureAwait(false);
            _manager = manager;
            _pending = info.TargetFullRelease;
            _log.Write(LogCode.UpdateDownloaded);
            return UpdateOutcome.Downloaded;
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            // Network trouble, a refused address, a wrong hash: the installed version simply stays.
            _log.Write(LogCode.UpdateFailed);
            return UpdateOutcome.Failed;
        }
    }

    /// <summary>User asked to switch now. Starts the new version after this program has exited.</summary>
    public void ApplyAndRestart()
    {
        if (_manager != null && _pending != null) _manager.ApplyUpdatesAndRestart(_pending);
    }
}

/// <summary>Velopack's download hook, backed by <see cref="TrustedFetcher"/> so every address is checked.</summary>
internal sealed class TrustedDownloader : IFileDownloader
{
    private const long TextMaxBytes = 4 * 1024 * 1024;
    private readonly TrustedFetcher _fetcher;
    private readonly long _fileMaxBytes;

    public TrustedDownloader(TrustedFetcher fetcher, long fileMaxBytes)
    {
        _fetcher = fetcher;
        _fileMaxBytes = fileMaxBytes;
    }

    public Task DownloadFile(string url, string targetFile, Action<int> progress, IDictionary<string, string>? headers = null, double timeout = 30, CancellationToken cancelToken = default) =>
        _fetcher.DownloadFileAsync(new Uri(url), targetFile, _fileMaxBytes, progress, cancelToken);

    public Task<byte[]> DownloadBytes(string url, IDictionary<string, string>? headers = null, double timeout = 30) =>
        _fetcher.GetBytesAsync(new Uri(url), TextMaxBytes, CancellationToken.None);

    public async Task<string> DownloadString(string url, IDictionary<string, string>? headers = null, double timeout = 30) =>
        Encoding.UTF8.GetString(await DownloadBytes(url, headers, timeout).ConfigureAwait(false));
}
