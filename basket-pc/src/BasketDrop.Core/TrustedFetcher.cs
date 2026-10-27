using System.Net;

namespace BasketDrop;

public sealed class UpdateFetchException : Exception
{
    public UpdateFetchException(string message) : base(message) { }
}

/// <summary>
/// Fetches update files. Redirects are followed by hand so every hop is checked against <see cref="UpdatePolicy"/>;
/// nothing is sent to or accepted from any other address, and nothing but HTTPS is used.
/// </summary>
public sealed class TrustedFetcher : IDisposable
{
    private const int MaxHops = 5;
    private readonly HttpClient _http;
    private readonly string? _tag;

    /// <param name="tag">The chosen release; null while only the release list may be asked for.</param>
    /// <param name="handler">For tests. The default handler never follows redirects on its own.</param>
    public TrustedFetcher(string? tag, HttpMessageHandler? handler = null)
    {
        _tag = tag;
        _http = new HttpClient(handler ?? new SocketsHttpHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromMinutes(10) };
        _http.DefaultRequestHeaders.UserAgent.ParseAdd("BasketDrop-Updater");
        _http.DefaultRequestHeaders.Accept.ParseAdd("application/octet-stream, application/json, */*");
    }

    private bool FirstHopAllowed(Uri url) =>
        _tag == null ? UpdatePolicy.IsReleaseListRequest(url) : UpdatePolicy.IsReleaseFileRequest(url, _tag);

    private async Task<HttpResponseMessage> GetAsync(Uri url, CancellationToken ct)
    {
        if (!FirstHopAllowed(url)) throw new UpdateFetchException("address not allowed");
        for (var hop = 0; hop <= MaxHops; hop++)
        {
            var response = await _http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
            if (response.StatusCode is HttpStatusCode.Moved or HttpStatusCode.Redirect or HttpStatusCode.RedirectKeepVerb or HttpStatusCode.PermanentRedirect)
            {
                var next = response.Headers.Location;
                response.Dispose();
                if (next == null) throw new UpdateFetchException("redirect without address");
                if (!next.IsAbsoluteUri) next = new Uri(url, next);
                if (!UpdatePolicy.IsAllowedRedirect(next, _tag)) throw new UpdateFetchException("redirect not allowed");
                url = next;
                continue;
            }
            if (!response.IsSuccessStatusCode)
            {
                var code = (int)response.StatusCode;
                response.Dispose();
                throw new UpdateFetchException("status " + code);
            }
            return response;
        }
        throw new UpdateFetchException("too many redirects");
    }

    public async Task<byte[]> GetBytesAsync(Uri url, long maxBytes, CancellationToken ct)
    {
        using var response = await GetAsync(url, ct).ConfigureAwait(false);
        if (response.Content.Headers.ContentLength > maxBytes) throw new UpdateFetchException("too large");
        await using var stream = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
        using var buffer = new MemoryStream();
        await CopyLimitedAsync(stream, buffer, maxBytes, null, response.Content.Headers.ContentLength, ct).ConfigureAwait(false);
        return buffer.ToArray();
    }

    public async Task DownloadFileAsync(Uri url, string targetFile, long maxBytes, Action<int>? progress, CancellationToken ct)
    {
        using var response = await GetAsync(url, ct).ConfigureAwait(false);
        if (response.Content.Headers.ContentLength > maxBytes) throw new UpdateFetchException("too large");
        await using var stream = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
        await using var file = File.Create(targetFile);
        await CopyLimitedAsync(stream, file, maxBytes, progress, response.Content.Headers.ContentLength, ct).ConfigureAwait(false);
    }

    private static async Task CopyLimitedAsync(Stream from, Stream to, long maxBytes, Action<int>? progress, long? total, CancellationToken ct)
    {
        var buf = new byte[81920];
        long done = 0;
        int n;
        while ((n = await from.ReadAsync(buf, ct).ConfigureAwait(false)) > 0)
        {
            done += n;
            if (done > maxBytes) throw new UpdateFetchException("too large");
            await to.WriteAsync(buf.AsMemory(0, n), ct).ConfigureAwait(false);
            if (total is > 0) progress?.Invoke((int)(done * 100 / total.Value));
        }
        progress?.Invoke(100);
    }

    public void Dispose() => _http.Dispose();
}
