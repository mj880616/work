using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace BasketDrop;

public enum WebUserOutcome { Ok, Rejected, Unavailable }

public sealed record WebUserResult(WebUserOutcome Outcome, string? UserId);

/// <summary>Asks the auth server who a Web2 sign-in token belongs to. The server decides, not the token's own text.</summary>
public interface IWebUserVerifier
{
    Task<WebUserResult> VerifyAsync(string accessToken, CancellationToken ct);
}

/// <summary>Supabase <c>auth/v1/user</c> with the public key only. The token is sent there and nowhere else, and never stored.</summary>
public sealed class HttpWebUserVerifier : IWebUserVerifier, IDisposable
{
    private readonly string _baseUrl;
    private readonly string _key;
    private readonly HttpClient _http = new(new SocketsHttpHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(15) };

    public HttpWebUserVerifier(string baseUrl = HttpBasketApi.DefaultBaseUrl, string key = HttpBasketApi.DefaultPublishableKey)
    {
        var uri = new Uri(baseUrl);
        if (uri.Scheme != Uri.UriSchemeHttps && !(uri.Scheme == Uri.UriSchemeHttp && uri.IsLoopback))
            throw new ArgumentException("HTTPS is required.", nameof(baseUrl));
        _baseUrl = baseUrl.TrimEnd('/');
        _key = key;
    }

    public void Dispose() => _http.Dispose();

    public async Task<WebUserResult> VerifyAsync(string accessToken, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, _baseUrl + "/auth/v1/user");
        req.Headers.TryAddWithoutValidation("apikey", _key);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        int code;
        string text;
        try
        {
            using var resp = await _http.SendAsync(req, ct).ConfigureAwait(false);
            code = (int)resp.StatusCode;
            text = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        }
        catch (Exception e) when (e is HttpRequestException or IOException || (e is OperationCanceledException && !ct.IsCancellationRequested))
        {
            return new WebUserResult(WebUserOutcome.Unavailable, null);
        }
        if (code is 401 or 403) return new WebUserResult(WebUserOutcome.Rejected, null);
        if (code is < 200 or >= 300) return new WebUserResult(WebUserOutcome.Unavailable, null);
        try
        {
            using var doc = JsonDocument.Parse(text);
            if (doc.RootElement.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String && !string.IsNullOrEmpty(id.GetString()))
                return new WebUserResult(WebUserOutcome.Ok, id.GetString());
        }
        catch (JsonException) { }
        return new WebUserResult(WebUserOutcome.Unavailable, null);
    }
}

/// <summary>
/// Remembers a confirmed answer for a few minutes so every folder click is not a round trip.
/// Kept in memory only, keyed by a hash of the token (the token itself is not kept), and small.
/// Only "this token is user X" is remembered; refusals and failures are asked again next time.
/// </summary>
public sealed class CachedWebUserVerifier : IWebUserVerifier
{
    public static readonly TimeSpan Keep = TimeSpan.FromMinutes(5);
    private const int MaxEntries = 16;
    private readonly IWebUserVerifier _inner;
    private readonly Func<DateTimeOffset> _clock;
    private readonly Dictionary<string, (string UserId, DateTimeOffset Until)> _known = new();
    private readonly object _gate = new();

    public CachedWebUserVerifier(IWebUserVerifier inner, Func<DateTimeOffset>? clock = null)
    {
        _inner = inner;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    public int Count { get { lock (_gate) return _known.Count; } }

    public async Task<WebUserResult> VerifyAsync(string accessToken, CancellationToken ct)
    {
        var key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(accessToken)));
        var now = _clock();
        lock (_gate)
        {
            if (_known.TryGetValue(key, out var hit) && hit.Until > now) return new WebUserResult(WebUserOutcome.Ok, hit.UserId);
            _known.Remove(key);
        }
        var result = await _inner.VerifyAsync(accessToken, ct).ConfigureAwait(false);
        if (result.Outcome == WebUserOutcome.Ok && result.UserId != null)
        {
            lock (_gate)
            {
                foreach (var old in _known.Where(p => p.Value.Until <= now).Select(p => p.Key).ToList()) _known.Remove(old);
                if (_known.Count >= MaxEntries) _known.Clear();
                _known[key] = (result.UserId, now + Keep);
            }
        }
        return result;
    }

    public void Clear() { lock (_gate) _known.Clear(); }
}
