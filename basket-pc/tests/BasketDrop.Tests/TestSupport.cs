using System.Net;
using System.Net.Sockets;
using System.Text;

namespace BasketDrop.Tests;

/// <summary>Temp folder that is removed when the test ends.</summary>
public sealed class TempDir : IDisposable
{
    public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "basketdrop-test-" + Guid.NewGuid().ToString("N"));

    public TempDir() { Directory.CreateDirectory(Path); }

    public string Sub(string name) => System.IO.Path.Combine(Path, name);

    public string WriteFile(string name, string content)
    {
        var p = Sub(name);
        File.WriteAllText(p, content);
        return p;
    }

    public void Dispose()
    {
        try { Directory.Delete(Path, true); } catch (IOException) { }
    }
}

public sealed class FixedAuth : IAuthProvider
{
    private readonly string? _token;
    public FixedAuth(string? token) { _token = token; }
    public Task<string?> GetAccessTokenAsync(CancellationToken ct) => Task.FromResult(_token);
    public int Rejected { get; private set; }
    public void MarkAccessTokenRejected() => Rejected++;
}

public sealed class MemoryTokenStore : ITokenStore
{
    private string? _value;
    public int Saves { get; private set; }
    public MemoryTokenStore(string? initial = null) { _value = initial; }
    public string? Load() => _value;
    public bool FailSave { get; set; }
    public bool FailDelete { get; set; }
    public void Save(string refreshToken)
    {
        if (FailSave) throw new TokenStoreException("save failed");
        _value = refreshToken;
        Saves++;
    }
    public void Delete()
    {
        if (FailDelete) throw new TokenStoreException("delete failed");
        _value = null;
    }
}

public static class FakeJwts
{
    /// <summary>JWT-shaped made-up values (not credentials). session_id can be left out to test the logout guard.</summary>
    public static string Make(string label, bool withSession = true)
    {
        var json = "{\"sub\":\"11111111-2222-3333-4444-555555555555\"" + (withSession ? ",\"session_id\":\"sess-" + label + "\"" : "") + ",\"label\":\"" + label + "\"}";
        return "h." + Convert.ToBase64String(Encoding.UTF8.GetBytes(json)).TrimEnd('=').Replace('+', '-').Replace('/', '_') + ".sig";
    }
}

/// <summary>Scriptable fake of the basket API. Counts every call so tests can prove nothing was resent.</summary>
public sealed class FakeApi : IBasketApi
{
    public Queue<ApiResult> Script { get; } = new();
    public ApiResult Default { get; set; } = new(ApiOutcome.Ok, "ok", null);
    public List<(string File, string? Text, Guid? NoteId)> Uploads { get; } = new();
    public List<(Guid Id, string Text)> Notes { get; } = new();
    public Guid NoteToReturn { get; set; } = Guid.NewGuid();
    public ApiResult Owner { get; set; } = new(ApiOutcome.Ok, "ok");
    public int OwnerChecks { get; private set; }

    /// <summary>Runs inside the owner check, e.g. to cancel the caller halfway.</summary>
    public Action<CancellationToken>? OwnerHook { get; set; }

    public Task<ApiResult> CheckOwnerAsync(string token, CancellationToken ct)
    {
        OwnerChecks++;
        OwnerHook?.Invoke(ct);
        return Task.FromResult(Owner);
    }
    public int Calls => Uploads.Count + Notes.Count;

    public Task<ApiResult> UploadFileAsync(string token, string filePath, QueueFile file, string? rawText, Guid? noteId, CancellationToken ct)
    {
        Uploads.Add((file.DisplayName, rawText, noteId));
        var r = Script.Count > 0 ? Script.Dequeue() : Default;
        if (r.Outcome == ApiOutcome.Ok) r = r with { NoteId = noteId ?? NoteToReturn };
        return Task.FromResult(r);
    }

    public Task<ApiResult> CreateNoteAsync(string token, Guid id, string rawText, CancellationToken ct)
    {
        Notes.Add((id, rawText));
        var r = Script.Count > 0 ? Script.Dequeue() : Default;
        return Task.FromResult(r with { NoteId = id });
    }
}

public sealed record Captured(string RequestLine, Dictionary<string, string> Headers, byte[] Body);

public sealed class Reply
{
    public int Status { get; init; } = 200;
    public string Body { get; init; } = "{}";
    /// <summary>Extra response header line, e.g. "Location: http://..." for a redirect.</summary>
    public string? ExtraHeader { get; init; }
    /// <summary>Accept the request, read it, then close without answering (a connection that drops after sending).</summary>
    public bool DropAfterRead { get; init; }
}

/// <summary>Tiny loopback HTTP server so the real HttpClient path is exercised without any production call.</summary>
public sealed class FakeServer : IDisposable
{
    private readonly TcpListener _listener = new(IPAddress.Loopback, 0);
    private readonly Func<Captured, Reply> _handler;
    private readonly CancellationTokenSource _stop = new();
    public List<Captured> Requests { get; } = new();
    public string BaseUrl => $"http://127.0.0.1:{((IPEndPoint)_listener.LocalEndpoint).Port}";

    public FakeServer(Func<Captured, Reply> handler)
    {
        _handler = handler;
        _listener.Start();
        _ = Task.Run(AcceptLoop);
    }

    public static int UnusedPort()
    {
        var l = new TcpListener(IPAddress.Loopback, 0);
        l.Start();
        var port = ((IPEndPoint)l.LocalEndpoint).Port;
        l.Stop();
        return port;
    }

    private async Task AcceptLoop()
    {
        while (!_stop.IsCancellationRequested)
        {
            try
            {
                var client = await _listener.AcceptTcpClientAsync(_stop.Token);
                _ = Task.Run(() => Serve(client));
            }
            catch { return; }
        }
    }

    private async Task Serve(TcpClient client)
    {
        using var c = client;
        try
        {
            var stream = c.GetStream();
            var captured = await ReadRequest(stream);
            if (captured == null) return;
            lock (Requests) Requests.Add(captured);
            var reply = _handler(captured);
            if (reply.DropAfterRead) return;
            var body = Encoding.UTF8.GetBytes(reply.Body);
            var head = $"HTTP/1.1 {reply.Status} X\r\nContent-Type: application/json\r\n{(reply.ExtraHeader == null ? "" : reply.ExtraHeader + "\r\n")}Content-Length: {body.Length}\r\nConnection: close\r\n\r\n";
            await stream.WriteAsync(Encoding.ASCII.GetBytes(head));
            await stream.WriteAsync(body);
        }
        catch (IOException) { }
    }

    private static async Task<Captured?> ReadRequest(NetworkStream stream)
    {
        var buf = new List<byte>();
        var one = new byte[1];
        while (true)
        {
            if (await stream.ReadAsync(one) == 0) return null;
            buf.Add(one[0]);
            var n = buf.Count;
            if (n >= 4 && buf[n - 4] == '\r' && buf[n - 3] == '\n' && buf[n - 2] == '\r' && buf[n - 1] == '\n') break;
        }
        var lines = Encoding.ASCII.GetString(buf.ToArray()).Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var l in lines.Skip(1))
        {
            var i = l.IndexOf(':');
            if (i > 0) headers[l[..i]] = l[(i + 1)..].Trim();
        }
        var body = new byte[headers.TryGetValue("Content-Length", out var len) ? int.Parse(len) : 0];
        var read = 0;
        while (read < body.Length)
        {
            var r = await stream.ReadAsync(body.AsMemory(read));
            if (r == 0) break;
            read += r;
        }
        return new Captured(lines[0], headers, body);
    }

    public void Dispose()
    {
        _stop.Cancel();
        _listener.Stop();
    }
}
