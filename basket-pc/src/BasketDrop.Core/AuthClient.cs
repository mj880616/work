using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace BasketDrop;

public sealed record AuthTokens(string AccessToken, string RefreshToken, DateTimeOffset ExpiresAt);

/// <summary>The server definitely refused (bad or used code, dead refresh token). Retrying the same value is pointless.</summary>
public sealed class AuthRejectedException : Exception
{
    public AuthRejectedException() : base("auth rejected") { }
}

/// <summary>The auth server was not reached or had a temporary problem. Nothing is known to be wrong with the credentials.</summary>
public sealed class AuthUnavailableException : Exception
{
    public AuthUnavailableException() : base("auth unavailable") { }
}

public interface IAuthClient
{
    /// <summary>The address the browser opens. It carries the public challenge only, never the verifier.</summary>
    Uri BuildAuthorizeUrl(string redirectTo, string challenge);
    Task<AuthTokens> ExchangeCodeAsync(string code, string verifier, CancellationToken ct);
    Task<AuthTokens> RefreshAsync(string refreshToken, CancellationToken ct);
    /// <summary>Ends only the session the token belongs to (scope=local). Other devices and the reading app stay signed in.</summary>
    Task LogoutLocalAsync(string accessToken, CancellationToken ct);
}

/// <summary>Supabase Auth over HTTPS with the public key only (same value the web app ships).</summary>
public sealed class HttpAuthClient : IAuthClient, IDisposable
{
    private readonly string _baseUrl;
    private readonly string _key;
    // No redirects: a redirect could carry the code, refresh token or bearer header to another address.
    private readonly HttpClient _http = new(new SocketsHttpHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(30) };
    private readonly Func<DateTimeOffset> _clock;

    public HttpAuthClient(string baseUrl = HttpBasketApi.DefaultBaseUrl, string key = HttpBasketApi.DefaultPublishableKey, Func<DateTimeOffset>? clock = null)
    {
        var uri = new Uri(baseUrl);
        if (uri.Scheme != Uri.UriSchemeHttps && !(uri.Scheme == Uri.UriSchemeHttp && uri.IsLoopback))
            throw new ArgumentException("HTTPS is required.", nameof(baseUrl));
        _baseUrl = baseUrl.TrimEnd('/');
        _key = key;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    public void Dispose() => _http.Dispose();

    public Uri BuildAuthorizeUrl(string redirectTo, string challenge) =>
        new($"{_baseUrl}/auth/v1/authorize?provider=google&redirect_to={Uri.EscapeDataString(redirectTo)}"
            + $"&code_challenge={Uri.EscapeDataString(challenge)}&code_challenge_method=s256");

    public Task<AuthTokens> ExchangeCodeAsync(string code, string verifier, CancellationToken ct) =>
        PostTokenAsync("pkce", new { auth_code = code, code_verifier = verifier }, ct);

    public Task<AuthTokens> RefreshAsync(string refreshToken, CancellationToken ct) =>
        PostTokenAsync("refresh_token", new { refresh_token = refreshToken }, ct);

    public async Task LogoutLocalAsync(string accessToken, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, _baseUrl + "/auth/v1/logout?scope=local");
        req.Headers.TryAddWithoutValidation("apikey", _key);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        var (code, _) = await SendAsync(req, ct).ConfigureAwait(false);
        // 401/403: the session is already gone on the server, which is what we wanted.
        if (code is >= 200 and < 300 or 401 or 403) return;
        if (code == 429 || code >= 500) throw new AuthUnavailableException();
        throw new AuthRejectedException();
    }

    private async Task<AuthTokens> PostTokenAsync(string grant, object body, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}/auth/v1/token?grant_type={grant}")
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
        };
        req.Headers.TryAddWithoutValidation("apikey", _key);
        var (code, text) = await SendAsync(req, ct).ConfigureAwait(false);
        if (code is >= 200 and < 300) return Parse(text);
        if (code == 429 || code >= 500) throw new AuthUnavailableException();
        throw new AuthRejectedException();
    }

    private async Task<(int Code, string Body)> SendAsync(HttpRequestMessage req, CancellationToken ct)
    {
        try
        {
            using var resp = await _http.SendAsync(req, ct).ConfigureAwait(false);
            var text = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            return ((int)resp.StatusCode, text);
        }
        catch (Exception e) when (e is HttpRequestException or IOException || (e is OperationCanceledException && !ct.IsCancellationRequested))
        {
            throw new AuthUnavailableException();
        }
    }

    private AuthTokens Parse(string text)
    {
        try
        {
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;
            var access = root.GetProperty("access_token").GetString();
            var refresh = root.GetProperty("refresh_token").GetString();
            var seconds = root.TryGetProperty("expires_in", out var e) && e.TryGetInt32(out var s) ? s : 3600;
            if (!string.IsNullOrEmpty(access) && !string.IsNullOrEmpty(refresh))
                return new AuthTokens(access, refresh, _clock().AddSeconds(seconds));
        }
        catch (Exception e) when (e is JsonException or KeyNotFoundException or InvalidOperationException) { }
        // A 200 we cannot read says nothing about the credentials, so it must not delete them.
        throw new AuthUnavailableException();
    }
}
