using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;

namespace BasketDrop;

public sealed class PortsBusyException : Exception
{
    public PortsBusyException() : base("no free loopback port") { }
}

public enum CallbackKind { Code, Denied }

public sealed record CallbackResult(CallbackKind Kind, string? Code);

/// <summary>
/// Receives the browser's return to http://127.0.0.1:port/basket-drop/{state}?code=... (RFC 8252 loopback redirect).
/// Listens on 127.0.0.1 only, accepts exactly one valid request, then closes. A wrong state, wrong host name or wrong
/// path is answered with an error and ignored. The state travels in the path (not the query) so the single
/// allowed Redirect URL entry per port can end in a one-segment wildcard.
/// </summary>
public sealed class LoopbackReceiver : IDisposable
{
    public const string PathPrefix = "/basket-drop/";
    /// <summary>The few ports the Supabase Redirect URLs list must contain (docs/design/basket-pc-drop.md 4.2 A).</summary>
    public static readonly int[] DefaultPorts = { 47615, 47616, 47617 };
    private const int MaxHeadBytes = 8192;

    private readonly TcpListener _listener;
    private readonly string _state;
    private readonly TaskCompletionSource<CallbackResult> _done = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly CancellationTokenSource _stop = new();
    private int _used;

    public int Port { get; }

    /// <summary>The value for redirect_to. Contains the one-time state, so it is never logged.</summary>
    public string RedirectUri => $"http://127.0.0.1:{Port}{PathPrefix}{_state}";

    private LoopbackReceiver(TcpListener listener, int port, string state)
    {
        _listener = listener;
        Port = port;
        _state = state;
        _ = Task.Run(AcceptLoop);
    }

    public static LoopbackReceiver Start(string state, IEnumerable<int>? ports = null)
    {
        foreach (var port in ports ?? DefaultPorts)
        {
            var listener = new TcpListener(IPAddress.Loopback, port) { ExclusiveAddressUse = true };
            try
            {
                listener.Start(4);
                return new LoopbackReceiver(listener, ((IPEndPoint)listener.LocalEndpoint).Port, state);
            }
            catch (SocketException)
            {
                listener.Stop();
            }
        }
        throw new PortsBusyException();
    }

    /// <summary>Waits for the one valid return. Returns null on timeout; the listener is closed either way.</summary>
    public async Task<CallbackResult?> WaitAsync(TimeSpan timeout, CancellationToken ct)
    {
        try
        {
            return await _done.Task.WaitAsync(timeout, ct).ConfigureAwait(false);
        }
        catch (TimeoutException)
        {
            return null;
        }
        finally
        {
            Dispose();
        }
    }

    public void Dispose()
    {
        _stop.Cancel();
        _listener.Stop();
    }

    private async Task AcceptLoop()
    {
        while (!_stop.IsCancellationRequested)
        {
            TcpClient client;
            try { client = await _listener.AcceptTcpClientAsync(_stop.Token).ConfigureAwait(false); }
            catch (Exception e) when (e is OperationCanceledException or ObjectDisposedException or SocketException) { return; }
            // One at a time: this is a one-shot listener, not a server.
            await HandleAsync(client).ConfigureAwait(false);
        }
    }

    private async Task HandleAsync(TcpClient client)
    {
        using var c = client;
        try
        {
            using var limit = CancellationTokenSource.CreateLinkedTokenSource(_stop.Token);
            limit.CancelAfter(TimeSpan.FromSeconds(5));
            var stream = c.GetStream();
            var head = await ReadHeadAsync(stream, limit.Token).ConfigureAwait(false);
            if (head == null) { await RespondAsync(stream, 400, "bad request").ConfigureAwait(false); return; }

            var (status, result) = Evaluate(head);
            if (result != null && Interlocked.Exchange(ref _used, 1) == 0)
            {
                await RespondAsync(stream, 200, result.Kind == CallbackKind.Code
                    ? "로그인됐어요. 이 창은 닫아도 돼요."
                    : "로그인하지 않았어요. 이 창은 닫아도 돼요.").ConfigureAwait(false);
                _done.TrySetResult(result);
                // Single use: stop listening so a replayed request finds nothing.
                _listener.Stop();
                _stop.Cancel();
                return;
            }
            await RespondAsync(stream, result != null ? 400 : status, "요청을 처리하지 못했어요.").ConfigureAwait(false);
        }
        catch (Exception e) when (e is IOException or OperationCanceledException or ObjectDisposedException or SocketException) { }
    }

    private (int Status, CallbackResult? Result) Evaluate(string head)
    {
        var lines = head.Split("\r\n");
        var first = lines[0].Split(' ');
        if (first.Length != 3 || first[0] != "GET") return (405, null);

        // Rebinding guard: the request must have been addressed to exactly this loopback address.
        string? host = null;
        foreach (var l in lines.Skip(1))
        {
            var i = l.IndexOf(':');
            if (i > 0 && l[..i].Equals("Host", StringComparison.OrdinalIgnoreCase)) host = l[(i + 1)..].Trim();
        }
        if (host != $"127.0.0.1:{Port}") return (400, null);

        var target = first[1];
        var q = target.IndexOf('?');
        var path = q < 0 ? target : target[..q];
        var query = q < 0 ? "" : target[(q + 1)..];
        if (!path.StartsWith(PathPrefix, StringComparison.Ordinal)) return (404, null);
        var given = Encoding.ASCII.GetBytes(path[PathPrefix.Length..]);
        var expected = Encoding.ASCII.GetBytes(_state);
        if (given.Length != expected.Length || !CryptographicOperations.FixedTimeEquals(given, expected)) return (404, null);

        string? code = null;
        var denied = false;
        foreach (var pair in query.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var eq = pair.IndexOf('=');
            var key = eq < 0 ? pair : pair[..eq];
            var value = eq < 0 ? "" : Uri.UnescapeDataString(pair[(eq + 1)..].Replace('+', ' '));
            if (key == "code") code = value;
            else if (key == "error") denied = true;
        }
        if (denied) return (200, new CallbackResult(CallbackKind.Denied, null));
        if (!string.IsNullOrEmpty(code) && code.Length <= 2048) return (200, new CallbackResult(CallbackKind.Code, code));
        return (400, null);
    }

    private static async Task<string?> ReadHeadAsync(NetworkStream stream, CancellationToken ct)
    {
        var buf = new byte[MaxHeadBytes];
        var n = 0;
        while (n < buf.Length)
        {
            var r = await stream.ReadAsync(buf.AsMemory(n), ct).ConfigureAwait(false);
            if (r == 0) return null;
            n += r;
            var text = Encoding.ASCII.GetString(buf, 0, n);
            var end = text.IndexOf("\r\n\r\n", StringComparison.Ordinal);
            if (end >= 0) return text[..end];
        }
        return null;
    }

    /// <summary>The page never echoes the query, so the code is not reflected back into the browser.</summary>
    private static async Task RespondAsync(NetworkStream stream, int status, string message)
    {
        var body = Encoding.UTF8.GetBytes(
            "<!doctype html><meta charset=\"utf-8\"><title>바구니 PC드롭</title>"
            + "<p style=\"font:16px sans-serif;margin:2em\">" + message + "</p>");
        var head = $"HTTP/1.1 {status} X\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {body.Length}\r\n"
            + "Cache-Control: no-store\r\nReferrer-Policy: no-referrer\r\n"
            + "Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\nConnection: close\r\n\r\n";
        await stream.WriteAsync(Encoding.ASCII.GetBytes(head)).ConfigureAwait(false);
        await stream.WriteAsync(body).ConfigureAwait(false);
    }
}
