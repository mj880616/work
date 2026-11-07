using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace BasketDrop;

/// <summary>Opens things with the PC's own programs. The door never runs anything itself (see <see cref="PcPath.CanOpenDirectly"/>).</summary>
public interface IPcShell
{
    /// <summary>Opens a document or a folder with its usual program on this PC.</summary>
    void Open(string fullPath);

    /// <summary>Shows the item in Explorer without opening it.</summary>
    void Reveal(string fullPath);

    /// <summary>Sends one file to the Windows recycle bin (never a permanent delete). False when Windows refused.</summary>
    bool Trash(string fullPath);
}

/// <summary>
/// 'Web2에서 이 PC 보기' (docs/design/files-pc-drive.md 3·4절, first step: look and open only).
/// A tiny HTTP door on 127.0.0.1 that only the Web2 page in this PC's browser can use:
/// <list type="bullet">
/// <item>listens on the loopback address only, so other devices on the network cannot reach it;</item>
/// <item>answers only requests addressed to 127.0.0.1:port (DNS rebinding) and coming from the Web2 address (Origin);</item>
/// <item>needs the Web2 sign-in token on every request, checks it with the auth server, and serves only the account
/// that is signed in to this app;</item>
/// <item>reads folders and opens files. Since FILES-내PC클라우드옮기기 it also reads and writes single files for copying
/// between this PC and the cloud (<see cref="IPcTransfer"/>: new files only, never replacing one) and sends a file to
/// the recycle bin after a move. Only what a person pressed on the screen arrives here. Names and paths never go to a
/// server or into the log.</item>
/// </list>
/// Off unless the tray menu turns it on, and closed while this app is signed out.
/// </summary>
public sealed class PcDoor : IDisposable
{
    /// <summary>Web2 addresses (same list as supabase/functions/_shared/web-cors.ts, minus the Pages preview host). Exact match only: no other scheme, host or port.</summary>
    public static readonly IReadOnlyList<string> AllowedOrigins = new[] { "https://bokdoong.com", "https://work.bokdoong.com", "https://desk.bokdoong.com" };

    public static bool IsAllowedOrigin(string? origin) => origin != null && AllowedOrigins.Contains(origin, StringComparer.Ordinal);
    /// <summary>Fixed candidates the Web2 page knocks on in order. Different from the sign-in ports (47615~47617).</summary>
    public static readonly int[] DefaultPorts = { 47620, 47621, 47622 };
    private const int MaxHeadBytes = 8192;
    private const int MaxBodyBytes = 4096;
    /// <summary>The one route whose body is file bytes rather than a small JSON object.</summary>
    public const string PiecePath = "/v1/write/piece";
    private const int MaxTokenLength = 8192;

    private readonly TcpListener _listener;
    private readonly IPcFiles _files;
    private readonly IPcShell _shell;
    private readonly IPcTransfer? _transfer;
    private readonly IPcPins? _pins;
    private readonly IWebUserVerifier _verifier;
    private readonly Func<CancellationToken, Task<string?>> _ownUserId;
    private readonly ILog _log;
    private readonly string _appVersion;
    private readonly CancellationTokenSource _stop = new();
    private readonly SemaphoreSlim _busy = new(4, 4);

    public int Port { get; }

    private PcDoor(TcpListener listener, IPcFiles files, IPcShell shell, IWebUserVerifier verifier,
        Func<CancellationToken, Task<string?>> ownUserId, ILog log, string appVersion, IPcTransfer? transfer, IPcPins? pins)
    {
        _transfer = transfer;
        _pins = pins;
        _listener = listener;
        Port = ((IPEndPoint)listener.LocalEndpoint).Port;
        _files = files;
        _shell = shell;
        _verifier = verifier;
        _ownUserId = ownUserId;
        _log = log;
        _appVersion = appVersion;
        _ = Task.Run(AcceptLoop);
    }

    /// <summary>Opens the door on the first free candidate port of 127.0.0.1. Throws <see cref="PortsBusyException"/> if none is free.</summary>
    public static PcDoor Open(IPcFiles files, IPcShell shell, IWebUserVerifier verifier,
        Func<CancellationToken, Task<string?>> ownUserId, ILog log, string appVersion, IEnumerable<int>? ports = null, IPcTransfer? transfer = null, IPcPins? pins = null)
    {
        foreach (var port in ports ?? DefaultPorts)
        {
            var listener = new TcpListener(IPAddress.Loopback, port) { ExclusiveAddressUse = true };
            try
            {
                listener.Start(8);
                return new PcDoor(listener, files, shell, verifier, ownUserId, log, appVersion, transfer, pins);
            }
            catch (SocketException)
            {
                listener.Stop();
            }
        }
        throw new PortsBusyException();
    }

    /// <summary>The user id inside this app's own access token (a token it got from the auth server itself), or null when signed out.</summary>
    public static async Task<string?> OwnUserIdAsync(IAuthProvider auth, CancellationToken ct)
    {
        try
        {
            var token = await auth.GetAccessTokenAsync(ct).ConfigureAwait(false);
            return token == null ? null : Jwt.StringClaim(token, "sub");
        }
        catch (AuthUnavailableException) { return null; }
    }

    public void Dispose()
    {
        _stop.Cancel();
        _listener.Stop();
        (_transfer as IDisposable)?.Dispose();
    }

    private async Task AcceptLoop()
    {
        while (!_stop.IsCancellationRequested)
        {
            TcpClient client;
            try { client = await _listener.AcceptTcpClientAsync(_stop.Token).ConfigureAwait(false); }
            catch (Exception e) when (e is OperationCanceledException or ObjectDisposedException or SocketException) { return; }
            if (!await _busy.WaitAsync(0).ConfigureAwait(false))
            {
                client.Dispose(); // a few at a time is plenty for one screen
                continue;
            }
            _ = Task.Run(async () =>
            {
                try { await HandleAsync(client).ConfigureAwait(false); }
                finally { _busy.Release(); }
            });
        }
    }

    // ---- one request ----

    public sealed record Request(string Method, string Path, string Query, Dictionary<string, string> Headers, byte[] Body);

    private sealed record Answer(int Status, object? Json, bool Cors, bool Preflight = false, byte[]? Bytes = null, long Size = -1);

    private async Task HandleAsync(TcpClient client)
    {
        using var c = client;
        try
        {
            using var limit = CancellationTokenSource.CreateLinkedTokenSource(_stop.Token);
            limit.CancelAfter(TimeSpan.FromSeconds(10));
            var stream = c.GetStream();
            var request = await ReadAsync(stream, limit.Token).ConfigureAwait(false);
            var answer = request == null ? new Answer(400, Error("bad_request"), false) : await DecideAsync(request, limit.Token).ConfigureAwait(false);
            if (answer.Status >= 400) _log.Write(LogCode.DoorRefused, answer.Status);
            await WriteAsync(stream, answer, request != null && request.Headers.TryGetValue("origin", out var o) && IsAllowedOrigin(o) ? o : null, limit.Token).ConfigureAwait(false);
        }
        catch (Exception e) when (e is IOException or OperationCanceledException or ObjectDisposedException or SocketException) { }
    }

    private static object Error(string code) => new { error = code };

    private async Task<Answer> DecideAsync(Request r, CancellationToken ct)
    {
        // 1. Addressed to this loopback door by number (a rebound host name would carry another Host).
        if (!r.Headers.TryGetValue("host", out var host) || host != $"127.0.0.1:{Port}") return new Answer(400, Error("bad_host"), false);
        // 2. Only the Web2 page. Without the right Origin no CORS answer is given either, so other pages cannot read anything.
        if (!r.Headers.TryGetValue("origin", out var origin) || !IsAllowedOrigin(origin)) return new Answer(403, Error("bad_origin"), false);
        // 3. Browser preflight (and Chrome's private network question). Carries no token by design.
        if (r.Method == "OPTIONS")
        {
            r.Headers.TryGetValue("access-control-request-method", out var wanted);
            return wanted is "GET" or "POST" ? new Answer(204, null, true, true) : new Answer(405, Error("method"), true);
        }
        // 4. The Web2 sign-in of the same person who is signed in to this app.
        if (!r.Headers.TryGetValue("authorization", out var auth) || !auth.StartsWith("Bearer ", StringComparison.Ordinal)
            || auth.Length > MaxTokenLength + 7 || auth.Length <= 7)
            return new Answer(401, Error("no_token"), true);
        var own = await _ownUserId(ct).ConfigureAwait(false);
        if (own == null) return new Answer(409, Error("pc_signed_out"), true);
        var who = await _verifier.VerifyAsync(auth[7..], ct).ConfigureAwait(false);
        if (who.Outcome == WebUserOutcome.Rejected) return new Answer(401, Error("bad_token"), true);
        if (who.Outcome != WebUserOutcome.Ok || who.UserId == null) return new Answer(503, Error("auth_unavailable"), true);
        if (!string.Equals(who.UserId, own, StringComparison.Ordinal)) return new Answer(403, Error("other_user"), true);
        // 5. What to do.
        return (r.Method, r.Path) switch
        {
            ("GET", "/v1/hello") => new Answer(200, new { app = "basket-pc", version = _appVersion, door = 1, can = Can }, true),
            ("GET", "/v1/drives") => new Answer(200, new { drives = _files.Drives().Select(d => new { root = d.Root, label = d.Label, kind = d.Kind, total = d.Total, free = d.Free }) }, true),
            ("GET", "/v1/list") => ListAnswer(QueryValue(r.Query, "path")),
            ("POST", "/v1/open") => OpenAnswer(BodyPath(r.Body), reveal: false),
            ("POST", "/v1/reveal") => OpenAnswer(BodyPath(r.Body), reveal: true),
            ("GET", "/v1/read") when _transfer != null => ReadAnswer(r.Query),
            ("POST", "/v1/write/start") when _transfer != null => StartAnswer(r.Body),
            ("POST", PiecePath) when _transfer != null => PieceAnswer(r.Query, r.Body),
            ("POST", "/v1/write/finish") when _transfer != null => FinishAnswer(r.Body),
            ("POST", "/v1/write/cancel") when _transfer != null => CancelAnswer(r.Body),
            ("POST", "/v1/trash") when _transfer != null => TrashAnswer(BodyPath(r.Body)),
            ("GET", "/v1/pins") when _pins != null => new Answer(200, new { pins = _pins!.Load() }, true),
            ("POST", "/v1/pins") when _pins != null => PinsAnswer(r.Body),
            (_, "/v1/pins") when _pins != null => new Answer(405, Error("method"), true),
            (_, "/v1/hello" or "/v1/drives" or "/v1/list" or "/v1/open" or "/v1/reveal") => new Answer(405, Error("method"), true),
            (_, "/v1/read" or "/v1/write/start" or PiecePath or "/v1/write/finish" or "/v1/write/cancel" or "/v1/trash") when _transfer != null
                => new Answer(405, Error("method"), true),
            _ => new Answer(404, Error("not_found"), true),
        };
    }

    private static Answer Refusal(PcLookup result) => result switch
    {
        PcLookup.BadPath => new Answer(400, Error("bad_path"), true),
        PcLookup.Blocked => new Answer(403, Error("blocked"), true),
        PcLookup.NotFolder => new Answer(400, Error("not_folder"), true),
        _ => new Answer(404, Error("not_found"), true),
    };

    private Answer ListAnswer(string? path)
    {
        var listing = _files.List(path);
        if (listing.Result != PcLookup.Ok) return Refusal(listing.Result);
        return new Answer(200, new
        {
            path = PcPath.Join(PcPath.Parse(path)!),
            truncated = listing.Truncated,
            entries = listing.Entries.Select(e => new { name = e.Name, dir = e.Dir, size = e.Size, modified = e.Modified.ToString("o") }),
        }, true);
    }

    private Answer OpenAnswer(string? path, bool reveal)
    {
        var (result, kind, full) = _files.Find(path);
        if (result != PcLookup.Ok || full == null) return Refusal(result);
        if (PcPath.Parse(full)!.Length == 1 && reveal) return new Answer(400, Error("bad_path"), true);
        // Programs and unknown kinds are only shown in Explorer: a web page must never be able to start a program here.
        var done = reveal || (kind == PcItemKind.File && !PcPath.CanOpenDirectly(full)) ? "revealed" : "opened";
        try
        {
            if (done == "revealed") _shell.Reveal(full); else _shell.Open(full);
        }
        catch (Exception e) when (e is IOException or InvalidOperationException or System.ComponentModel.Win32Exception or UnauthorizedAccessException)
        {
            return new Answer(500, Error("open_failed"), true);
        }
        return new Answer(200, new { done }, true);
    }

    private string[] Can => new[] { "drives", "list", "open", "reveal" }
        .Concat(_transfer == null ? Array.Empty<string>() : new[] { "read", "write", "trash" })
        .Concat(_pins == null ? Array.Empty<string>() : new[] { "pins" }).ToArray();

    /// <summary>FILES-폴더고정: replaces this PC's pinned folders (paths only, kept on this PC).</summary>
    private Answer PinsAnswer(byte[] body)
    {
        if (BodyObject(body) is not { } o || !o.TryGetProperty("pins", out var arr) || arr.ValueKind != JsonValueKind.Array || arr.GetArrayLength() > PcPins.Max)
            return new Answer(400, Error("bad_request"), true);
        var list = new List<string?>();
        foreach (var e in arr.EnumerateArray())
        {
            if (e.ValueKind != JsonValueKind.String) return new Answer(400, Error("bad_request"), true);
            list.Add(e.GetString());
        }
        return _pins!.Save(list) ? new Answer(200, new { pins = _pins.Load() }, true) : new Answer(400, Error("bad_path"), true);
    }

    private static Answer StepRefusal(PcStep step) => step switch
    {
        PcStep.BadPath => new Answer(400, Error("bad_path"), true),
        PcStep.Blocked => new Answer(403, Error("blocked"), true),
        PcStep.NotFolder => new Answer(400, Error("not_folder"), true),
        PcStep.NotFile => new Answer(400, Error("not_file"), true),
        PcStep.BadRange => new Answer(400, Error("bad_range"), true),
        PcStep.Exists => new Answer(409, Error("exists"), true),
        PcStep.Risky => new Answer(403, Error("risky_kind"), true),
        PcStep.TooBig => new Answer(413, Error("too_big"), true),
        PcStep.NoSpace => new Answer(507, Error("no_space"), true),
        PcStep.BadPiece => new Answer(409, Error("bad_piece"), true),
        PcStep.Busy => new Answer(429, Error("busy"), true),
        PcStep.Failed => new Answer(500, Error("write_failed"), true),
        _ => new Answer(404, Error("not_found"), true),
    };

    private static long? QueryLong(string query, string name) =>
        long.TryParse(QueryValue(query, name), System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var v) ? v : null;

    private Answer ReadAnswer(string query)
    {
        var at = QueryLong(query, "at");
        var len = QueryLong(query, "len");
        if (at == null || len == null || len <= 0 || len > PcTransfer.MaxPiece) return new Answer(400, Error("bad_range"), true);
        var read = _transfer!.Read(QueryValue(query, "path"), at.Value, (int)len.Value);
        if (read.Result != PcStep.Ok) return StepRefusal(read.Result);
        return new Answer(200, null, true, Bytes: read.Bytes, Size: read.Size);
    }

    private Answer StartAnswer(byte[] body)
    {
        var json = BodyObject(body);
        if (json is not { } o || !o.TryGetProperty("size", out var sz) || sz.ValueKind != JsonValueKind.Number || !sz.TryGetInt64(out var size))
            return new Answer(400, Error("bad_request"), true);
        var (step, id) = _transfer!.Begin(StringProp(o, "dir"), StringProp(o, "name"), size);
        return step == PcStep.Ok ? new Answer(200, new { id }, true) : StepRefusal(step);
    }

    private Answer PieceAnswer(string query, byte[] body)
    {
        var at = QueryLong(query, "at");
        if (at == null) return new Answer(400, Error("bad_range"), true);
        var step = _transfer!.Piece(QueryValue(query, "id"), at.Value, body);
        return step == PcStep.Ok ? new Answer(200, new { at = at.Value + body.Length }, true) : StepRefusal(step);
    }

    private Answer FinishAnswer(byte[] body)
    {
        if (BodyObject(body) is not { } o) return new Answer(400, Error("bad_request"), true);
        var numbered = o.TryGetProperty("numbered", out var n) && n.ValueKind == JsonValueKind.True;
        var (step, name) = _transfer!.Finish(StringProp(o, "id"), numbered);
        if (step != PcStep.Ok) return StepRefusal(step);
        _log.Write(LogCode.DoorWrote);
        return new Answer(200, new { name }, true);
    }

    private Answer CancelAnswer(byte[] body)
    {
        if (BodyObject(body) is not { } o) return new Answer(400, Error("bad_request"), true);
        _transfer!.Cancel(StringProp(o, "id"));
        return new Answer(200, new { done = "cancelled" }, true);
    }

    /// <summary>After a move: the original goes to the recycle bin (files only, never a folder, never a permanent delete).</summary>
    private Answer TrashAnswer(string? path)
    {
        var (result, kind, full) = _files.Find(path);
        if (result != PcLookup.Ok || full == null) return Refusal(result);
        if (kind != PcItemKind.File) return new Answer(400, Error("not_file"), true);
        try
        {
            if (!_shell.Trash(full)) return new Answer(500, Error("trash_failed"), true);
        }
        catch (Exception e) when (e is IOException or InvalidOperationException or System.ComponentModel.Win32Exception or UnauthorizedAccessException)
        {
            return new Answer(500, Error("trash_failed"), true);
        }
        _log.Write(LogCode.DoorTrashed);
        return new Answer(200, new { done = "trashed" }, true);
    }

    private static JsonElement? BodyObject(byte[] body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            return doc.RootElement.ValueKind == JsonValueKind.Object ? doc.RootElement.Clone() : null;
        }
        catch (JsonException) { return null; }
    }

    private static string? StringProp(JsonElement o, string name) =>
        o.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;

    public static string? QueryValue(string query, string name)
    {
        string? found = null;
        foreach (var pair in query.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var eq = pair.IndexOf('=');
            if ((eq < 0 ? pair : pair[..eq]) != name) continue;
            if (found != null) return null; // asked twice: ambiguous, refuse
            try { found = Uri.UnescapeDataString((eq < 0 ? "" : pair[(eq + 1)..]).Replace('+', ' ')); }
            catch (UriFormatException) { return null; }
        }
        return found;
    }

    private static string? BodyPath(byte[] body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            return doc.RootElement.ValueKind == JsonValueKind.Object && doc.RootElement.TryGetProperty("path", out var p) && p.ValueKind == JsonValueKind.String
                ? p.GetString() : null;
        }
        catch (JsonException) { return null; }
    }

    // ---- wire ----

    public static async Task<Request?> ReadAsync(Stream stream, CancellationToken ct)
    {
        var buf = new byte[MaxHeadBytes];
        var n = 0;
        var headEnd = -1;
        while (headEnd < 0)
        {
            if (n >= MaxHeadBytes) return null;
            var r = await stream.ReadAsync(buf.AsMemory(n, MaxHeadBytes - n), ct).ConfigureAwait(false);
            if (r == 0) return null;
            n += r;
            headEnd = IndexOf(buf, n, "\r\n\r\n"u8);
        }
        var lines = Encoding.ASCII.GetString(buf, 0, headEnd).Split("\r\n");
        var first = lines[0].Split(' ');
        if (first.Length != 3 || first[2] != "HTTP/1.1" || first[0].Any(ch => ch is < 'A' or > 'Z')) return null;
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in lines.Skip(1))
        {
            var i = line.IndexOf(':');
            if (i <= 0) return null;
            var key = line[..i].Trim();
            // The headers this door decides on must appear once; two of them would be a smuggling trick.
            if (!headers.TryAdd(key, line[(i + 1)..].Trim())) return null;
        }
        if (headers.ContainsKey("transfer-encoding")) return null;
        var target = first[1];
        if (!target.StartsWith('/')) return null;
        var q = target.IndexOf('?');
        var path = q < 0 ? target : target[..q];
        // Only a piece of a file being written may be large; every other body is a small JSON object.
        var max = first[0] == "POST" && path == PiecePath ? PcTransfer.MaxPiece : MaxBodyBytes;
        var length = 0;
        if (headers.TryGetValue("content-length", out var len) && (!int.TryParse(len, out length) || length < 0 || length > max)) return null;
        var body = new byte[length];
        var bodyStart = headEnd + 4;
        var have = Math.Min(n - bodyStart, length);
        Array.Copy(buf, bodyStart, body, 0, have);
        while (have < length)
        {
            var r = await stream.ReadAsync(body.AsMemory(have, length - have), ct).ConfigureAwait(false);
            if (r == 0) return null;
            have += r;
        }
        return new Request(first[0], path, q < 0 ? "" : target[(q + 1)..], headers, body);
    }

    private static int IndexOf(byte[] buf, int count, ReadOnlySpan<byte> what) => buf.AsSpan(0, count).IndexOf(what);

    private static async Task WriteAsync(Stream stream, Answer a, string? origin, CancellationToken ct)
    {
        var body = a.Bytes ?? (a.Json == null ? Array.Empty<byte>() : JsonSerializer.SerializeToUtf8Bytes(a.Json));
        var head = new StringBuilder();
        head.Append($"HTTP/1.1 {a.Status} {(a.Status < 400 ? "OK" : "Refused")}\r\n");
        if (a.Cors && origin != null)
        {
            head.Append($"Access-Control-Allow-Origin: {origin}\r\nVary: Origin\r\n");
            if (a.Bytes != null) head.Append("Access-Control-Expose-Headers: X-Pc-Size\r\n");
            if (a.Preflight)
                head.Append("Access-Control-Allow-Methods: GET, POST\r\nAccess-Control-Allow-Headers: authorization, content-type\r\n"
                    + "Access-Control-Allow-Private-Network: true\r\nAccess-Control-Max-Age: 600\r\n");
        }
        if (a.Bytes != null) head.Append($"Content-Type: application/octet-stream\r\nX-Pc-Size: {a.Size}\r\n");
        else if (body.Length > 0) head.Append("Content-Type: application/json; charset=utf-8\r\n");
        head.Append($"Content-Length: {body.Length}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n");
        await stream.WriteAsync(Encoding.ASCII.GetBytes(head.ToString()), ct).ConfigureAwait(false);
        if (body.Length > 0) await stream.WriteAsync(body, ct).ConfigureAwait(false);
    }
}
