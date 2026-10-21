using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace BasketDrop;

public enum ApiOutcome
{
    Ok,
    /// <summary>Text note: the same id was already inserted, so it is saved.</summary>
    AlreadySaved,
    LoginRequired,
    /// <summary>Server never reached (DNS, connect). Safe to retry automatically.</summary>
    NotReached,
    /// <summary>Request may have been processed. Never retried automatically.</summary>
    Unknown,
    /// <summary>Definite refusal.</summary>
    Rejected,
}

/// <param name="Code">Short fixed code (letters, digits, underscore); never a server message.</param>
public sealed record ApiResult(ApiOutcome Outcome, string Code, Guid? NoteId = null);

public interface IBasketApi
{
    Task<ApiResult> UploadFileAsync(string token, string filePath, QueueFile file, string? rawText, Guid? noteId, CancellationToken ct);
    Task<ApiResult> CreateNoteAsync(string token, Guid id, string rawText, CancellationToken ct);
    /// <summary>
    /// Reads the signed-in user's owner membership. Ok = owner; Rejected = not the Web2 owner (no row visible).
    /// A courtesy check for a clear message after sign-in; the server still decides every real request.
    /// </summary>
    Task<ApiResult> CheckOwnerAsync(string token, CancellationToken ct);
}

public sealed class ConnectFailedException : Exception
{
    public ConnectFailedException(Exception inner) : base("connect failed", inner) { }
}

/// <summary>
/// Calls the existing basket path exactly like the web app: POST functions/v1/basket-files (multipart, one file per
/// request) and REST app_notes for text-only memos. The server decides ownership; nothing here is trusted for access.
/// The publishable key is the public value that already ships in app/runtime-client.js; no server key exists here.
/// </summary>
public sealed class HttpBasketApi : IBasketApi, IDisposable
{
    public const string DefaultBaseUrl = "https://xmlkxfjeagycwttklxjw.supabase.co";
    public const string DefaultPublishableKey = "sb_publishable_X-0lXJztIQUriUidBZ1PLQ_QemTRSpA";
    private static readonly TimeSpan ConnectTimeout = TimeSpan.FromSeconds(15);
    private static readonly Regex SafeCode = new("^[A-Za-z0-9_]{1,64}$", RegexOptions.Compiled);

    private readonly string _baseUrl;
    private readonly string _key;
    private readonly HttpClient _http;
    private string? _workspaceId;

    public HttpBasketApi(string baseUrl = DefaultBaseUrl, string key = DefaultPublishableKey)
    {
        var uri = new Uri(baseUrl);
        // HTTPS only; plain http is allowed solely for the loopback fake server used by tests.
        if (uri.Scheme != Uri.UriSchemeHttps && !(uri.Scheme == Uri.UriSchemeHttp && uri.IsLoopback))
            throw new ArgumentException("HTTPS is required.", nameof(baseUrl));
        _baseUrl = baseUrl.TrimEnd('/');
        _key = key;
        var handler = new SocketsHttpHandler
        {
            // A redirect is never followed (it would resend the upload and the apikey header elsewhere); it counts as a refusal.
            AllowAutoRedirect = false,
            ConnectCallback = async (ctx, ct) =>
            {
                var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
                try
                {
                    using var limit = CancellationTokenSource.CreateLinkedTokenSource(ct);
                    limit.CancelAfter(ConnectTimeout);
                    await socket.ConnectAsync(ctx.DnsEndPoint, limit.Token).ConfigureAwait(false);
                    return new NetworkStream(socket, true);
                }
                catch (Exception e)
                {
                    socket.Dispose();
                    // Anything that goes wrong before a connection exists means nothing was sent.
                    throw new ConnectFailedException(e);
                }
            },
        };
        _http = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
    }

    public void Dispose() => _http.Dispose();

    public async Task<ApiResult> UploadFileAsync(string token, string filePath, QueueFile file, string? rawText, Guid? noteId, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(Limits.UploadTimeout(file.SizeBytes));
        try
        {
            using var stream = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read);
            using var form = new MultipartFormDataContent
            {
                // Part headers as UTF-8 like a browser; the default (Latin-1) would turn Korean into '?'.
                HeaderEncodingSelector = (_, _) => Encoding.UTF8,
            };
            var part = new StreamContent(stream);
            part.Headers.ContentType = MediaTypeHeaderValue.Parse(file.MimeType);
            // Not form.Add(part, "file", name): that writes non-ASCII names as "=?utf-8?B?...?=", which the
            // server's form parser reads as a single '"' (see FileNames).
            part.Headers.TryAddWithoutValidation("Content-Disposition", FileNames.ContentDisposition("file", file.DisplayName));
            form.Add(part);
            if (noteId != null) form.Add(new StringContent(noteId.Value.ToString()), "note_id");
            else if (!string.IsNullOrEmpty(rawText)) form.Add(new StringContent(NormalizeNewlines(rawText), Encoding.UTF8), "raw_text");

            using var req = new HttpRequestMessage(HttpMethod.Post, _baseUrl + "/functions/v1/basket-files") { Content = form };
            Authorize(req, token);
            using var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, timeout.Token).ConfigureAwait(false);
            var body = await resp.Content.ReadAsStringAsync(timeout.Token).ConfigureAwait(false);
            return ClassifyUpload(resp.StatusCode, body, noteId);
        }
        catch (Exception e) when (IsTransport(e, ct))
        {
            return TransportResult(e);
        }
    }

    public async Task<ApiResult> CreateNoteAsync(string token, Guid id, string rawText, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(60));
        try
        {
            if (_workspaceId == null)
            {
                var found = await FindWorkspaceAsync(token, timeout.Token).ConfigureAwait(false);
                if (found.Result != null) return found.Result;
                _workspaceId = found.Id;
            }
            var json = JsonSerializer.Serialize(new { id, workspace_id = _workspaceId, raw_text = rawText });
            using var req = new HttpRequestMessage(HttpMethod.Post, _baseUrl + "/rest/v1/app_notes")
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json"),
            };
            Authorize(req, token);
            req.Headers.TryAddWithoutValidation("Prefer", "return=minimal");
            using var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, timeout.Token).ConfigureAwait(false);
            var body = await resp.Content.ReadAsStringAsync(timeout.Token).ConfigureAwait(false);
            return ClassifyNote(resp.StatusCode, body, id);
        }
        catch (Exception e) when (IsTransport(e, ct))
        {
            return TransportResult(e);
        }
    }

    public async Task<ApiResult> CheckOwnerAsync(string token, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        try
        {
            // Always re-read: a cached workspace id from a previous account must never be reused after a new sign-in.
            _workspaceId = null;
            var found = await FindWorkspaceAsync(token, timeout.Token).ConfigureAwait(false);
            if (found.Result != null) return found.Result;
            _workspaceId = found.Id;
            return new ApiResult(ApiOutcome.Ok, "ok");
        }
        catch (Exception e) when (IsTransport(e, ct))
        {
            var r = TransportResult(e);
            // Nothing was written, so "unknown" has no meaning here: treat it as not reached.
            return r with { Outcome = ApiOutcome.NotReached };
        }
    }

    /// <summary>Reads the owner workspace like the web loader does. Nothing is written yet, so a failure here is never "unknown".</summary>
    private async Task<(string? Id, ApiResult? Result)> FindWorkspaceAsync(string token, CancellationToken ct)
    {
        var sub = TokenSubject(token);
        if (sub == null) return (null, new ApiResult(ApiOutcome.LoginRequired, "session_required"));
        var url = _baseUrl + "/rest/v1/app_workspace_members?select=workspace_id&role=eq.owner&user_id=eq." + Uri.EscapeDataString(sub) + "&limit=1";
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        Authorize(req, token);
        using var resp = await _http.SendAsync(req, ct).ConfigureAwait(false);
        var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (resp.StatusCode == HttpStatusCode.Unauthorized) return (null, new ApiResult(ApiOutcome.LoginRequired, "session_required"));
        if ((int)resp.StatusCode >= 500) return (null, new ApiResult(ApiOutcome.NotReached, "workspace_unavailable"));
        if (!resp.IsSuccessStatusCode) return (null, new ApiResult(ApiOutcome.Rejected, "workspace_forbidden"));
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.ValueKind == JsonValueKind.Array && doc.RootElement.GetArrayLength() == 1
                && doc.RootElement[0].TryGetProperty("workspace_id", out var ws) && ws.ValueKind == JsonValueKind.String)
                return (ws.GetString(), null);
        }
        catch (JsonException) { }
        return (null, new ApiResult(ApiOutcome.Rejected, "workspace_not_found"));
    }

    private void Authorize(HttpRequestMessage req, string token)
    {
        req.Headers.TryAddWithoutValidation("apikey", _key);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
    }

    private static string NormalizeNewlines(string text) =>
        text.Replace("\r\n", "\n").Replace('\r', '\n').Replace("\n", "\r\n");

    /// <summary>Reads the "sub" claim only to filter the membership query; the server's row security still decides access.</summary>
    internal static string? TokenSubject(string token)
    {
        return Jwt.StringClaim(token, "sub");
    }

    // Anything that happens after a connection exists is "unknown"; a user/shutdown cancel is not caught here
    // because the caller must see it, except that the processor turns it into "unknown" too.
    private static bool IsTransport(Exception e, CancellationToken callerCt) =>
        e is HttpRequestException or IOException or TimeoutException or ConnectFailedException
        || (e is OperationCanceledException && !callerCt.IsCancellationRequested);

    private static ApiResult TransportResult(Exception e)
    {
        for (var inner = e; inner != null; inner = inner.InnerException)
            if (inner is ConnectFailedException) return new ApiResult(ApiOutcome.NotReached, "not_reached");
        return new ApiResult(ApiOutcome.Unknown, e is OperationCanceledException ? "timeout" : "note_save_result_unknown");
    }

    internal static ApiResult ClassifyUpload(HttpStatusCode status, string body, Guid? expectedNote)
    {
        var code = ErrorCode(body);
        if (status == HttpStatusCode.OK)
        {
            try
            {
                using var doc = JsonDocument.Parse(body);
                var root = doc.RootElement;
                if (root.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.True
                    && root.TryGetProperty("note_id", out var n) && n.ValueKind == JsonValueKind.String
                    && Guid.TryParse(n.GetString(), out var id)
                    && root.TryGetProperty("attachments", out var a) && a.ValueKind == JsonValueKind.Array
                    && (expectedNote == null || expectedNote == id))
                    return new ApiResult(ApiOutcome.Ok, "ok", id);
            }
            catch (JsonException) { }
            // 200 but not the expected shape: do not guess, same as the web code.
            return new ApiResult(ApiOutcome.Unknown, "note_save_result_unknown");
        }
        return ClassifyError(status, code);
    }

    internal static ApiResult ClassifyNote(HttpStatusCode status, string body, Guid id)
    {
        if ((int)status is >= 200 and < 300) return new ApiResult(ApiOutcome.Ok, "ok", id);
        if (status == HttpStatusCode.Conflict && ErrorCode(body) == "23505") return new ApiResult(ApiOutcome.AlreadySaved, "already_saved", id);
        return ClassifyError(status, ErrorCode(body));
    }

    private static ApiResult ClassifyError(HttpStatusCode status, string? code)
    {
        var n = (int)status;
        if (status == HttpStatusCode.Unauthorized) return new ApiResult(ApiOutcome.LoginRequired, "session_required");
        if (n >= 500) return new ApiResult(ApiOutcome.Unknown, code ?? "http_" + n);
        return new ApiResult(ApiOutcome.Rejected, code ?? "http_" + n);
    }

    private static string? ErrorCode(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.ValueKind == JsonValueKind.Object && doc.RootElement.TryGetProperty("code", out var c)
                && c.ValueKind == JsonValueKind.String && c.GetString() is { } s && SafeCode.IsMatch(s))
                return s;
        }
        catch (JsonException) { }
        return null;
    }
}
