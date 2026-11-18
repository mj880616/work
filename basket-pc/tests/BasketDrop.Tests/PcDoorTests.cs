using System.Net;
using System.Net.Sockets;
using System.Text;
using Xunit;

namespace BasketDrop.Tests;

/// <summary>'Web2에서 이 PC 보기' path rules (docs/design/files-pc-drive.md 4-2).</summary>
public class PcPathTests
{
    [Theory]
    [InlineData("C:", new[] { "C:" })]
    [InlineData("c:\\", new[] { "C:" })]
    [InlineData("D:\\자료\\2026", new[] { "D:", "자료", "2026" })]
    [InlineData("C:\\Users\\me\\Documents\\", new[] { "C:", "Users", "me", "Documents" })]
    [InlineData("C:\\a b\\보고서 (1).hwpx", new[] { "C:", "a b", "보고서 (1).hwpx" })]
    public void Plain_drive_paths_are_split_into_parts(string input, string[] expected)
    {
        Assert.Equal(expected, PcPath.Parse(input));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("C")]
    [InlineData("C:foo")]                       // relative to the drive's hidden current folder
    [InlineData("\\\\server\\share\\x")]        // network path
    [InlineData("\\\\?\\C:\\Windows")]          // device path
    [InlineData("\\\\.\\PhysicalDrive0")]
    [InlineData("C:/Users")]                    // only one kind of separator
    [InlineData("C:\\a\\..\\Windows")]          // walking up
    [InlineData("C:\\a\\.\\b")]
    [InlineData("C:\\a\\\\b")]
    [InlineData("C:\\a\\b.txt:secret")]         // alternate data stream
    [InlineData("C:\\a\\*")]
    [InlineData("C:\\a\\b?")]
    [InlineData("C:\\a\\\"x\"")]
    [InlineData("C:\\a\\name.")]                 // Windows drops the dot: two names for one file
    [InlineData("C:\\a\\name ")]
    [InlineData("C:\\a\\NUL")]
    [InlineData("C:\\a\\con.txt")]
    [InlineData("C:\\a\\COM1.log")]
    [InlineData("1:\\a")]
    public void Anything_else_is_refused_before_the_disk_is_touched(string? input)
    {
        Assert.Null(PcPath.Parse(input));
    }

    [Fact]
    public void Control_characters_and_very_long_paths_are_refused()
    {
        Assert.Null(PcPath.Parse("C:\\a\u0001b"));
        Assert.Null(PcPath.Parse("C:\\" + new string('a', 1100)));
    }

    [Theory]
    [InlineData("C:\\Windows")]
    [InlineData("C:\\windows\\System32\\drivers")]
    [InlineData("C:\\Program Files\\x")]
    [InlineData("D:\\Program Files (x86)")]
    [InlineData("C:\\ProgramData\\x")]
    [InlineData("C:\\$Recycle.Bin")]
    [InlineData("E:\\System Volume Information")]
    [InlineData("C:\\Recovery")]
    [InlineData("C:\\Users\\me\\AppData")]
    [InlineData("C:\\Users\\someone\\appdata\\Roaming\\x")]
    [InlineData("C:\\Users\\All Users")]
    [InlineData("C:\\Documents and Settings")]
    public void Windows_program_and_app_data_folders_are_blocked(string path)
    {
        Assert.True(PcPath.IsBlocked(PcPath.Parse(path)!));
    }

    [Theory]
    [InlineData("C:")]
    [InlineData("C:\\Users")]
    [InlineData("C:\\Users\\me")]
    [InlineData("C:\\Users\\me\\Documents\\Windows")] // a folder that only shares the name, deeper down
    [InlineData("D:\\자료\\Program Files 정리")]
    public void Ordinary_folders_are_shown(string path)
    {
        Assert.False(PcPath.IsBlocked(PcPath.Parse(path)!));
    }

    [Fact]
    public void The_apps_own_data_folder_is_blocked()
    {
        const string own = "E:\\Data\\BasketDrop";
        Assert.True(PcPath.IsBlocked(PcPath.Parse("E:\\Data\\BasketDrop")!, own));
        Assert.True(PcPath.IsBlocked(PcPath.Parse("e:\\data\\basketdrop\\queue")!, own));
        Assert.False(PcPath.IsBlocked(PcPath.Parse("E:\\Data")!, own));
        Assert.False(PcPath.IsBlocked(PcPath.Parse("E:\\Data\\BasketDropOld")!, own));
    }

    [Theory]
    [InlineData("a.pdf", true)]
    [InlineData("보고서.HWPX", true)]
    [InlineData("사진.jpg", true)]
    [InlineData("setup.exe", false)]
    [InlineData("run.bat", false)]
    [InlineData("x.ps1", false)]
    [InlineData("x.lnk", false)]
    [InlineData("x.js", false)]
    [InlineData("x.hta", false)]
    [InlineData("x.url", false)]
    [InlineData("x.zip", false)]
    [InlineData("noextension", false)]
    public void Only_known_document_kinds_open_with_their_program(string name, bool opens)
    {
        Assert.Equal(opens, PcPath.CanOpenDirectly(name));
    }
}

public class WebUserVerifierTests
{
    [Fact]
    public async Task The_auth_server_decides_who_the_token_belongs_to()
    {
        using var server = new FakeServer(_ => new Reply { Body = "{\"id\":\"user-a\",\"email\":\"x\"}" });
        using var v = new HttpWebUserVerifier(server.BaseUrl, "PUBLIC-KEY");
        var r = await v.VerifyAsync("TOKEN", default);
        Assert.Equal(WebUserOutcome.Ok, r.Outcome);
        Assert.Equal("user-a", r.UserId);
        var req = Assert.Single(server.Requests);
        Assert.StartsWith("GET /auth/v1/user ", req.RequestLine);
        Assert.Equal("Bearer TOKEN", req.Headers["Authorization"]);
        Assert.Equal("PUBLIC-KEY", req.Headers["apikey"]);
    }

    [Theory]
    [InlineData(401, WebUserOutcome.Rejected)]
    [InlineData(403, WebUserOutcome.Rejected)]
    [InlineData(500, WebUserOutcome.Unavailable)]
    [InlineData(302, WebUserOutcome.Unavailable)]
    public async Task Refusals_and_failures_are_told_apart(int status, WebUserOutcome expected)
    {
        using var server = new FakeServer(_ => new Reply { Status = status, ExtraHeader = status == 302 ? "Location: http://127.0.0.1:1/" : null });
        using var v = new HttpWebUserVerifier(server.BaseUrl, "K");
        Assert.Equal(expected, (await v.VerifyAsync("T", default)).Outcome);
    }

    [Fact]
    public void Plain_http_to_another_host_is_refused()
    {
        Assert.Throws<ArgumentException>(() => new HttpWebUserVerifier("http://example.com", "K"));
    }

    private sealed class Counting : IWebUserVerifier
    {
        public int Calls;
        public WebUserResult Next = new(WebUserOutcome.Ok, "user-a");
        public Task<WebUserResult> VerifyAsync(string accessToken, CancellationToken ct) { Calls++; return Task.FromResult(Next); }
    }

    [Fact]
    public async Task A_confirmed_token_is_remembered_for_a_few_minutes_only()
    {
        var now = DateTimeOffset.Parse("2026-11-05T10:00:00Z");
        var inner = new Counting();
        var cache = new CachedWebUserVerifier(inner, () => now);
        await cache.VerifyAsync("T", default);
        await cache.VerifyAsync("T", default);
        Assert.Equal(1, inner.Calls);
        now += CachedWebUserVerifier.Keep + TimeSpan.FromSeconds(1);
        await cache.VerifyAsync("T", default);
        Assert.Equal(2, inner.Calls);
        cache.Clear();
        Assert.Equal(0, cache.Count);
    }

    [Fact]
    public async Task Refusals_are_never_remembered()
    {
        var inner = new Counting { Next = new(WebUserOutcome.Rejected, null) };
        var cache = new CachedWebUserVerifier(inner);
        await cache.VerifyAsync("T", default);
        await cache.VerifyAsync("T", default);
        Assert.Equal(2, inner.Calls);
        Assert.Equal(0, cache.Count);
    }
}

public class PcDoorTests
{
    private const string Origin = "https://desk.bokdoong.com";

    private sealed class FakeFiles : IPcFiles
    {
        public IReadOnlyList<PcDrive> Drives() => new[] { new PcDrive("C:\\", "", "fixed", 100, 40) };

        public (PcLookup Result, PcItemKind Kind, string? FullPath) Find(string? path)
        {
            var segs = PcPath.Parse(path);
            if (segs == null) return (PcLookup.BadPath, PcItemKind.None, null);
            if (PcPath.IsBlocked(segs)) return (PcLookup.Blocked, PcItemKind.None, null);
            var full = PcPath.Join(segs);
            return full switch
            {
                "C:\\" or "C:\\Docs" => (PcLookup.Ok, PcItemKind.Folder, full),
                "C:\\Docs\\a.pdf" or "C:\\Docs\\setup.exe" => (PcLookup.Ok, PcItemKind.File, full),
                _ => (PcLookup.NotFound, PcItemKind.None, null),
            };
        }

        public PcListing List(string? path)
        {
            var (r, kind, _) = Find(path);
            if (r != PcLookup.Ok) return new PcListing(r, Array.Empty<PcEntry>(), false);
            if (kind != PcItemKind.Folder) return new PcListing(PcLookup.NotFolder, Array.Empty<PcEntry>(), false);
            return new PcListing(PcLookup.Ok, new[] { new PcEntry("a.pdf", false, 5, DateTimeOffset.UnixEpoch) }, false);
        }
    }

    private sealed class FakeShell : IPcShell
    {
        public List<string> Opened { get; } = new();
        public List<string> Revealed { get; } = new();
        public List<string> Trashed { get; } = new();
        public void Open(string fullPath) => Opened.Add(fullPath);
        public void Reveal(string fullPath) => Revealed.Add(fullPath);
        public bool Trash(string fullPath) { Trashed.Add(fullPath); return true; }
    }

    private sealed class FakePins : IPcPins
    {
        public List<string> Saved { get; } = new();
        public IReadOnlyList<string> Load() => Saved.ToList();
        public bool Save(IReadOnlyList<string?> pins)
        {
            var clean = pins.Select(p => PcPins.Clean(p, null)).ToList();
            if (clean.Any(c => c == null)) return false;
            Saved.Clear();
            Saved.AddRange(clean.OfType<string>());
            return true;
        }
    }

    /// <summary>Records what the door asked for; holds one file being written in memory.</summary>
    private sealed class FakeTransfer : IPcTransfer
    {
        public List<string> Calls { get; } = new();
        public MemoryStream Written { get; } = new();
        public long Size;
        public PcRead Read(string? path, long at, int count)
        {
            Calls.Add($"read {path} {at} {count}");
            if (path != "C:\\Docs\\a.pdf") return new PcRead(PcStep.NotFound, Array.Empty<byte>(), 0);
            var all = Encoding.ASCII.GetBytes("HELLO");
            return at > all.Length ? new PcRead(PcStep.BadRange, Array.Empty<byte>(), 5) : new PcRead(PcStep.Ok, all.Skip((int)at).Take(count).ToArray(), all.Length);
        }
        public (PcStep Result, string? Id) Begin(string? dir, string? name, long size)
        {
            Calls.Add($"begin {dir} {name} {size}");
            if (name == "run.exe") return (PcStep.Risky, null);
            if (dir != "C:\\Docs") return (PcStep.NotFound, null);
            Size = size;
            return (PcStep.Ok, "id1");
        }
        public PcStep Piece(string? id, long at, byte[] bytes)
        {
            Calls.Add($"piece {id} {at} {bytes.Length}");
            if (id != "id1" || at != Written.Length) return PcStep.BadPiece;
            Written.Write(bytes);
            return PcStep.Ok;
        }
        public (PcStep Result, string? Name) Finish(string? id, bool numbered)
        {
            Calls.Add($"finish {id} {numbered}");
            if (Written.Length != Size) return (PcStep.BadPiece, null);
            return numbered ? (PcStep.Ok, "b (2).txt") : (PcStep.Exists, null);
        }
        public void Cancel(string? id) => Calls.Add($"cancel {id}");
    }

    /// <summary>FILES-내PC쓰기: records what the door asked for and answers like the real rules would for C:\Docs.</summary>
    private sealed class FakeEdit : IPcEdit
    {
        public List<string> Calls { get; } = new();
        public (PcStep Result, string? Path) Rename(string? path, string? name)
        {
            Calls.Add($"rename {path} {name}");
            if (name == "run.exe") return (PcStep.Risky, null);
            if (name == "taken.pdf") return (PcStep.Exists, null);
            return path == "C:\\Docs\\a.pdf" ? (PcStep.Ok, "C:\\Docs\\" + name) : (PcStep.NotFound, null);
        }
        public (PcStep Result, string? Path) MakeFolder(string? dir, string? name)
        {
            Calls.Add($"mkdir {dir} {name}");
            return dir == "C:\\Docs" ? (PcStep.Ok, "C:\\Docs\\" + name) : (PcStep.Blocked, null);
        }
        public (PcStep Result, string? Path) Move(string? path, string? dir, bool numbered)
        {
            Calls.Add($"move {path} {dir} {numbered}");
            return dir == "D:\\" ? (PcStep.OtherDrive, null) : numbered ? (PcStep.Ok, dir + "\\a (2).pdf") : (PcStep.Exists, null);
        }
        public (PcStep Result, string? Path) Copy(string? path, string? dir, bool numbered)
        {
            Calls.Add($"copy {path} {dir} {numbered}");
            return (PcStep.Ok, dir + "\\a (2).pdf");
        }
    }

    private sealed class FakeVerifier : IWebUserVerifier
    {
        public int Calls;
        public Task<WebUserResult> VerifyAsync(string accessToken, CancellationToken ct)
        {
            Interlocked.Increment(ref Calls);
            return Task.FromResult(accessToken switch
            {
                "web-a" => new WebUserResult(WebUserOutcome.Ok, "user-a"),
                "web-b" => new WebUserResult(WebUserOutcome.Ok, "user-b"),
                "down" => new WebUserResult(WebUserOutcome.Unavailable, null),
                _ => new WebUserResult(WebUserOutcome.Rejected, null),
            });
        }
    }

    private sealed class Rig : IDisposable
    {
        public FakeShell Shell { get; } = new();
        public FakeVerifier Verifier { get; } = new();
        public string? Own { get; set; } = "user-a";
        public FakeTransfer Transfer { get; } = new();
        public PcDoor Door { get; }
        public int Port => Door.Port;

        public FakePins Pins { get; } = new();
        public FakeEdit Edit { get; } = new();

        public Rig(bool canWrite = false, bool canEdit = false)
        {
            Door = PcDoor.Open(new FakeFiles(), Shell, Verifier, _ => Task.FromResult<string?>(Own), new NullLog(), "9.9.9", new[] { FakeServer.UnusedPort() },
                canWrite || canEdit ? Transfer : null, canWrite || canEdit ? Pins : null, canEdit ? Edit : null);
        }

        public void Dispose() => Door.Dispose();

        public Task<(int Status, string Head, string Body)> Get(string target, string? token = "web-a", string? origin = Origin, string? host = null) =>
            Raw($"GET {target} HTTP/1.1\r\nHost: {host ?? $"127.0.0.1:{Port}"}\r\n"
                + (origin == null ? "" : $"Origin: {origin}\r\n")
                + (token == null ? "" : $"Authorization: Bearer {token}\r\n") + "\r\n");

        public Task<(int Status, string Head, string Body)> Post(string target, string json, string token = "web-a")
        {
            var body = Encoding.UTF8.GetByteCount(json);
            return Raw($"POST {target} HTTP/1.1\r\nHost: 127.0.0.1:{Port}\r\nOrigin: {Origin}\r\nAuthorization: Bearer {token}\r\n"
                + $"Content-Type: application/json\r\nContent-Length: {body}\r\n\r\n{json}");
        }

        public Task<(int Status, string Head, string Body)> PostBytes(string target, byte[] bytes, string token = "web-a", int? claimed = null) =>
            RawBytes(Encoding.UTF8.GetBytes($"POST {target} HTTP/1.1\r\nHost: 127.0.0.1:{Port}\r\nOrigin: {Origin}\r\nAuthorization: Bearer {token}\r\n"
                + $"Content-Type: application/octet-stream\r\nContent-Length: {claimed ?? bytes.Length}\r\n\r\n").Concat(bytes).ToArray());

        public Task<(int Status, string Head, string Body)> Raw(string request) => RawBytes(Encoding.UTF8.GetBytes(request));

        public async Task<(int Status, string Head, string Body)> RawBytes(byte[] request)
        {
            using var client = new TcpClient();
            await client.ConnectAsync(IPAddress.Loopback, Port);
            var stream = client.GetStream();
            await stream.WriteAsync(request);
            using var ms = new MemoryStream();
            await stream.CopyToAsync(ms);
            var text = Encoding.UTF8.GetString(ms.ToArray());
            var split = text.IndexOf("\r\n\r\n", StringComparison.Ordinal);
            var head = split < 0 ? text : text[..split];
            var status = int.Parse(head.Split(' ')[1]);
            return (status, head, split < 0 ? "" : text[(split + 4)..]);
        }
    }

    [Fact]
    public void The_door_listens_on_the_loopback_address_only()
    {
        using var rig = new Rig();
        // Every port it may use is outside the sign-in ports, and the listener is bound to 127.0.0.1.
        Assert.Empty(PcDoor.DefaultPorts.Intersect(LoopbackReceiver.DefaultPorts));
        var sources = File.ReadAllText(Path.Combine(SourceRoot(), "src", "BasketDrop.Core", "PcDoor.cs"));
        Assert.Contains("new TcpListener(IPAddress.Loopback, port)", sources);
        Assert.DoesNotContain("IPAddress.Any", sources);
        Assert.DoesNotContain("IPv6Any", sources);
    }

    [Fact]
    public async Task The_signed_in_owner_can_list_a_folder()
    {
        using var rig = new Rig();
        var (status, head, body) = await rig.Get("/v1/list?path=C%3A%5CDocs");
        Assert.Equal(200, status);
        Assert.Contains($"Access-Control-Allow-Origin: {Origin}", head);
        Assert.Contains("Cache-Control: no-store", head);
        Assert.Contains("\"name\":\"a.pdf\"", body);
        Assert.Contains("\"path\":\"C:\\\\Docs\"", body);
    }

    [Fact]
    public async Task Hello_and_drives_answer_for_the_owner()
    {
        using var rig = new Rig();
        var hello = await rig.Get("/v1/hello");
        Assert.Equal(200, hello.Status);
        Assert.Contains("\"version\":\"9.9.9\"", hello.Body);
        var drives = await rig.Get("/v1/drives");
        Assert.Equal(200, drives.Status);
        Assert.Contains("\"root\":\"C:\\\\\"", drives.Body);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("https://evil.example")]
    [InlineData("http://desk.bokdoong.com")]
    [InlineData("https://desk.bokdoong.com.evil.example")]
    [InlineData("https://desk.bokdoong.com:8443")]
    [InlineData("null")]
    public async Task Other_pages_are_refused_without_a_cors_answer(string? origin)
    {
        using var rig = new Rig();
        var (status, head, _) = await rig.Get("/v1/list?path=C%3A%5CDocs", origin: origin);
        Assert.Equal(403, status);
        Assert.DoesNotContain("Access-Control-Allow-Origin", head);
        Assert.Equal(0, rig.Verifier.Calls); // refused before the token is even looked at
    }

    [Theory]
    [InlineData("localhost")]
    [InlineData("evil.example")]
    [InlineData("127.0.0.1")]
    [InlineData("127.0.0.1:1")]
    public async Task A_rebound_host_name_is_refused(string host)
    {
        using var rig = new Rig();
        var (status, head, _) = await rig.Get("/v1/hello", host: host);
        Assert.Equal(400, status);
        Assert.DoesNotContain("Access-Control-Allow-Origin", head);
    }

    [Fact]
    public async Task The_preflight_allows_the_web2_page_and_the_private_network_question()
    {
        using var rig = new Rig();
        var (status, head, _) = await rig.Raw($"OPTIONS /v1/list HTTP/1.1\r\nHost: 127.0.0.1:{rig.Port}\r\nOrigin: {Origin}\r\n"
            + "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: authorization\r\nAccess-Control-Request-Private-Network: true\r\n\r\n");
        Assert.Equal(204, status);
        Assert.Contains($"Access-Control-Allow-Origin: {Origin}", head);
        Assert.Contains("Access-Control-Allow-Private-Network: true", head);
        Assert.Contains("Access-Control-Allow-Headers: authorization, content-type", head);
        Assert.DoesNotContain("Access-Control-Allow-Credentials", head);
    }

    [Fact]
    public async Task No_token_wrong_token_and_another_account_are_refused()
    {
        using var rig = new Rig();
        Assert.Equal(401, (await rig.Get("/v1/drives", token: null)).Status);
        Assert.Equal(401, (await rig.Get("/v1/drives", token: "forged")).Status);
        Assert.Equal(403, (await rig.Get("/v1/drives", token: "web-b")).Status);
        Assert.Equal(503, (await rig.Get("/v1/drives", token: "down")).Status);
        Assert.Equal(401, (await rig.Raw($"GET /v1/drives HTTP/1.1\r\nHost: 127.0.0.1:{rig.Port}\r\nOrigin: {Origin}\r\nAuthorization: Basic eDp5\r\n\r\n")).Status);
    }

    [Fact]
    public async Task Nothing_is_served_while_this_app_is_signed_out()
    {
        using var rig = new Rig { Own = null };
        var (status, _, body) = await rig.Get("/v1/drives");
        Assert.Equal(409, status);
        Assert.Contains("pc_signed_out", body);
    }

    [Theory]
    [InlineData("C%3A%5CWindows", 403)]
    [InlineData("C%3A%5CUsers%5Cme%5CAppData%5CLocal", 403)]
    [InlineData("C%3A%5CDocs%5C..%5C..%5CWindows", 400)]
    [InlineData("%5C%5Cserver%5Cshare", 400)]
    [InlineData("C%3A%5CDocs%5Ca.pdf%3Astream", 400)]
    [InlineData("C%3A%5CNope", 404)]
    [InlineData("C%3A%5CDocs%5Ca.pdf", 400)]
    public async Task Blocked_escaping_and_missing_paths_are_refused(string query, int expected)
    {
        using var rig = new Rig();
        Assert.Equal(expected, (await rig.Get("/v1/list?path=" + query)).Status);
    }

    [Fact]
    public async Task A_path_asked_twice_in_one_address_is_refused()
    {
        using var rig = new Rig();
        Assert.Equal(400, (await rig.Get("/v1/list?path=C%3A%5CDocs&path=C%3A%5CWindows")).Status);
    }

    [Fact]
    public async Task Documents_open_but_programs_are_only_shown_in_explorer()
    {
        using var rig = new Rig();
        var doc = await rig.Post("/v1/open", "{\"path\":\"C:\\\\Docs\\\\a.pdf\"}");
        Assert.Equal(200, doc.Status);
        Assert.Contains("opened", doc.Body);
        var exe = await rig.Post("/v1/open", "{\"path\":\"C:\\\\Docs\\\\setup.exe\"}");
        Assert.Equal(200, exe.Status);
        Assert.Contains("revealed", exe.Body);
        Assert.Equal(new[] { "C:\\Docs\\a.pdf" }, rig.Shell.Opened);
        Assert.Equal(new[] { "C:\\Docs\\setup.exe" }, rig.Shell.Revealed);
        Assert.Equal(403, (await rig.Post("/v1/open", "{\"path\":\"C:\\\\Windows\\\\notepad.exe\"}")).Status);
        Assert.Equal(400, (await rig.Post("/v1/open", "{\"nope\":1}")).Status);
        Assert.Equal(2, rig.Shell.Opened.Count + rig.Shell.Revealed.Count);
    }

    [Fact]
    public async Task Wrong_methods_unknown_routes_and_malformed_requests_are_refused()
    {
        using var rig = new Rig();
        Assert.Equal(405, (await rig.Get("/v1/open")).Status);
        Assert.Equal(404, (await rig.Get("/v1/delete")).Status);
        Assert.Equal(400, (await rig.Raw($"GET /v1/hello HTTP/1.0\r\nHost: 127.0.0.1:{rig.Port}\r\n\r\n")).Status);
        Assert.Equal(400, (await rig.Raw($"GET /v1/hello HTTP/1.1\r\nHost: 127.0.0.1:{rig.Port}\r\nHost: evil.example\r\nOrigin: {Origin}\r\n\r\n")).Status);
        Assert.Equal(400, (await rig.Raw($"POST /v1/open HTTP/1.1\r\nHost: 127.0.0.1:{rig.Port}\r\nOrigin: {Origin}\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n")).Status);
        Assert.Equal(400, (await rig.Raw($"POST /v1/open HTTP/1.1\r\nHost: 127.0.0.1:{rig.Port}\r\nOrigin: {Origin}\r\nContent-Length: 999999\r\n\r\n")).Status);
        Assert.Empty(rig.Shell.Opened);
    }

    [Fact]
    public async Task A_closed_door_accepts_no_connection()
    {
        var rig = new Rig();
        var port = rig.Port;
        rig.Dispose();
        using var client = new TcpClient();
        await Assert.ThrowsAnyAsync<SocketException>(() => client.ConnectAsync(IPAddress.Loopback, port));
    }

    [Fact]
    public async Task Own_user_id_comes_from_this_apps_token_and_is_null_when_signed_out()
    {
        Assert.Equal("11111111-2222-3333-4444-555555555555", await PcDoor.OwnUserIdAsync(new FixedAuth(FakeJwts.Make("a")), default));
        Assert.Null(await PcDoor.OwnUserIdAsync(new FixedAuth(null), default));
    }

    [Fact]
    public void The_door_code_never_writes_moves_or_deletes_and_never_logs_names()
    {
        // Writing lives in PcTransfer.cs alone (new files only, see PcTransferTests); the door itself still never touches a file.
        foreach (var name in new[] { "PcDoor.cs", "PcFiles.cs", "PcPath.cs", "WebUserVerifier.cs" })
        {
            var text = File.ReadAllText(Path.Combine(SourceRoot(), "src", "BasketDrop.Core", name));
            Assert.DoesNotMatch(@"File\.(Delete|Move|Copy|Write|Create|Append|Replace|Open)|Directory\.(Delete|Move|Create)|FileMode\.|\.Delete\(|\.MoveTo\(|\.CopyTo\(", text);
            Assert.DoesNotMatch(@"_log\.Write\([^)]*(path|Path|name|Name|full)", text);
        }
        var door = File.ReadAllText(Path.Combine(SourceRoot(), "src", "BasketDrop.Core", "PcDoor.cs"));
        Assert.Contains("\"https://bokdoong.com\", \"https://work.bokdoong.com\", \"https://desk.bokdoong.com\", \"https://nojoplus.com\"", door);
        Assert.DoesNotContain("github.io", door);
        Assert.DoesNotContain("Access-Control-Allow-Origin: *", door);
        Assert.DoesNotContain("Allow-Credentials", door);
        var shell = File.ReadAllText(Path.Combine(SourceRoot(), "src", "BasketDrop", "PcShell.cs"));
        Assert.Contains("PcPath.CanOpenDirectly(fullPath)", shell);
        Assert.Contains("FofAllowUndo", shell); // trash = the recycle bin, never a permanent delete
        Assert.DoesNotContain("File.Delete", shell);
    }

    [Fact]
    public async Task An_old_style_door_without_transfer_offers_no_read_write_or_trash()
    {
        using var rig = new Rig();
        var hello = await rig.Get("/v1/hello");
        Assert.DoesNotContain("\"write\"", hello.Body);
        Assert.Equal(404, (await rig.Get("/v1/read?path=C%3A%5CDocs%5Ca.pdf&at=0&len=5")).Status);
        Assert.Equal(404, (await rig.Post("/v1/trash", "{\"path\":\"C:\\\\Docs\\\\a.pdf\"}")).Status);
        Assert.Empty(rig.Shell.Trashed);
    }

    [Fact]
    public async Task Hello_tells_the_screen_it_can_read_write_and_trash()
    {
        using var rig = new Rig(canWrite: true);
        var hello = await rig.Get("/v1/hello");
        Assert.Contains("\"read\"", hello.Body);
        Assert.Contains("\"write\"", hello.Body);
        Assert.Contains("\"trash\"", hello.Body);
    }

    [Fact]
    public async Task A_file_is_read_in_pieces_with_its_size_for_the_web2_page_only()
    {
        using var rig = new Rig(canWrite: true);
        var (status, head, body) = await rig.Get("/v1/read?path=C%3A%5CDocs%5Ca.pdf&at=1&len=3");
        Assert.Equal(200, status);
        Assert.Equal("ELL", body);
        Assert.Contains("X-Pc-Size: 5", head);
        Assert.Contains("Access-Control-Expose-Headers: X-Pc-Size", head);
        Assert.Contains("Content-Type: application/octet-stream", head);
        Assert.Equal(400, (await rig.Get("/v1/read?path=C%3A%5CDocs%5Ca.pdf&at=0&len=99999999")).Status);
        Assert.Equal(400, (await rig.Get("/v1/read?path=C%3A%5CDocs%5Ca.pdf&at=-1&len=3")).Status);
        Assert.Equal(404, (await rig.Get("/v1/read?path=C%3A%5CDocs%5Cnope&at=0&len=3")).Status);
        // Same gates as looking: another page, another account.
        Assert.Equal(403, (await rig.Get("/v1/read?path=C%3A%5CDocs%5Ca.pdf&at=0&len=3", origin: "https://evil.example")).Status);
        Assert.Equal(403, (await rig.Get("/v1/read?path=C%3A%5CDocs%5Ca.pdf&at=0&len=3", token: "web-b")).Status);
    }

    [Fact]
    public async Task A_new_file_is_written_in_order_and_never_replaces_one()
    {
        using var rig = new Rig(canWrite: true);
        var start = await rig.Post("/v1/write/start", "{\"dir\":\"C:\\\\Docs\",\"name\":\"b.txt\",\"size\":4}");
        Assert.Equal(200, start.Status);
        Assert.Contains("\"id\":\"id1\"", start.Body);
        Assert.Equal(200, (await rig.PostBytes("/v1/write/piece?id=id1&at=0", Encoding.ASCII.GetBytes("ab"))).Status);
        Assert.Equal(409, (await rig.PostBytes("/v1/write/piece?id=id1&at=0", Encoding.ASCII.GetBytes("ab"))).Status); // out of order
        Assert.Equal(200, (await rig.PostBytes("/v1/write/piece?id=id1&at=2", Encoding.ASCII.GetBytes("cd"))).Status);
        Assert.Equal("abcd", Encoding.ASCII.GetString(rig.Transfer.Written.ToArray()));
        var taken = await rig.Post("/v1/write/finish", "{\"id\":\"id1\"}");
        Assert.Equal(409, taken.Status);
        Assert.Contains("exists", taken.Body);
        var numbered = await rig.Post("/v1/write/finish", "{\"id\":\"id1\",\"numbered\":true}");
        Assert.Equal(200, numbered.Status);
        Assert.Contains("b (2).txt", numbered.Body);
        Assert.Equal(200, (await rig.Post("/v1/write/cancel", "{\"id\":\"id1\"}")).Status);
    }

    [Fact]
    public async Task Programs_bad_requests_and_oversized_pieces_are_refused()
    {
        using var rig = new Rig(canWrite: true);
        var exe = await rig.Post("/v1/write/start", "{\"dir\":\"C:\\\\Docs\",\"name\":\"run.exe\",\"size\":4}");
        Assert.Equal(403, exe.Status);
        Assert.Contains("risky_kind", exe.Body);
        Assert.Equal(400, (await rig.Post("/v1/write/start", "{\"dir\":\"C:\\\\Docs\",\"name\":\"b.txt\"}")).Status);
        // Only the piece route takes a large body; a large JSON body anywhere else is refused before it is read.
        Assert.Equal(400, (await rig.PostBytes("/v1/write/start", Array.Empty<byte>(), claimed: 8000)).Status);
        Assert.Equal(400, (await rig.PostBytes("/v1/write/piece?id=id1&at=0", Array.Empty<byte>(), claimed: PcTransfer.MaxPiece + 1)).Status);
        Assert.Equal(401, (await rig.PostBytes("/v1/write/piece?id=id1&at=0", new byte[3], token: "forged")).Status);
        Assert.Equal(405, (await rig.Get("/v1/write/start")).Status);
        Assert.DoesNotContain(rig.Transfer.Calls, c => c.StartsWith("piece", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Pinned_pc_folders_stay_on_this_pc_and_only_allowed_paths_are_kept()
    {
        using var rig = new Rig(canWrite: true);
        Assert.Contains("\"pins\"", (await rig.Get("/v1/hello")).Body);
        Assert.Equal(200, (await rig.Post("/v1/pins", "{\"pins\":[\"C:\\\\Docs\",\"d:\\\\자료\\\\\"]}")).Status);
        Assert.Equal(new[] { "C:\\Docs", "D:\\자료" }, rig.Pins.Saved);
        var got = await rig.Get("/v1/pins");
        Assert.Equal(200, got.Status);
        Assert.Contains("C:\\\\Docs", got.Body);
        Assert.Equal(400, (await rig.Post("/v1/pins", "{\"pins\":[\"C:\\\\Windows\"]}")).Status);
        Assert.Equal(400, (await rig.Post("/v1/pins", "{\"pins\":[\"\\\\\\\\server\\\\x\"]}")).Status);
        Assert.Equal(400, (await rig.Post("/v1/pins", "{\"pins\":[1]}")).Status);
        Assert.Equal(new[] { "C:\\Docs", "D:\\자료" }, rig.Pins.Saved); // refused lists change nothing
        Assert.Equal(403, (await rig.Get("/v1/pins", token: "web-b")).Status);
        using var old = new Rig();
        Assert.Equal(404, (await old.Get("/v1/pins")).Status);
    }

    [Fact]
    public async Task Only_a_found_file_goes_to_the_recycle_bin()
    {
        using var rig = new Rig(canWrite: true);
        Assert.Equal(200, (await rig.Post("/v1/trash", "{\"path\":\"C:\\\\Docs\\\\a.pdf\"}")).Status);
        Assert.Equal(400, (await rig.Post("/v1/trash", "{\"path\":\"C:\\\\Docs\"}")).Status);       // a folder
        Assert.Equal(403, (await rig.Post("/v1/trash", "{\"path\":\"C:\\\\Windows\\\\x.dll\"}")).Status);
        Assert.Equal(404, (await rig.Post("/v1/trash", "{\"path\":\"C:\\\\Docs\\\\nope.pdf\"}")).Status);
        Assert.Equal(new[] { "C:\\Docs\\a.pdf" }, rig.Shell.Trashed);
    }

    [Fact]
    public async Task A_door_that_can_edit_renames_makes_folders_moves_and_copies_for_the_owner_only()
    {
        using var rig = new Rig(canEdit: true);
        var hello = await rig.Get("/v1/hello");
        Assert.Contains("\"edit\"", hello.Body);
        var renamed = await rig.Post("/v1/rename", "{\"path\":\"C:\\\\Docs\\\\a.pdf\",\"name\":\"b.pdf\"}");
        Assert.Equal(200, renamed.Status);
        Assert.Contains("\"path\":\"C:\\\\Docs\\\\b.pdf\"", renamed.Body);
        Assert.Equal(403, (await rig.Post("/v1/rename", "{\"path\":\"C:\\\\Docs\\\\a.pdf\",\"name\":\"run.exe\"}")).Status);
        Assert.Equal(409, (await rig.Post("/v1/rename", "{\"path\":\"C:\\\\Docs\\\\a.pdf\",\"name\":\"taken.pdf\"}")).Status);
        Assert.Equal(200, (await rig.Post("/v1/mkdir", "{\"dir\":\"C:\\\\Docs\",\"name\":\"새 폴더\"}")).Status);
        Assert.Equal(403, (await rig.Post("/v1/mkdir", "{\"dir\":\"C:\\\\Windows\",\"name\":\"x\"}")).Status);
        Assert.Equal(409, (await rig.Post("/v1/move", "{\"path\":\"C:\\\\Docs\\\\a.pdf\",\"dir\":\"C:\\\\\"}")).Status);
        Assert.Equal(200, (await rig.Post("/v1/move", "{\"path\":\"C:\\\\Docs\\\\a.pdf\",\"dir\":\"C:\\\\\",\"numbered\":true}")).Status);
        var other = await rig.Post("/v1/move", "{\"path\":\"C:\\\\Docs\",\"dir\":\"D:\\\\\"}");
        Assert.Equal(400, other.Status);
        Assert.Contains("other_drive", other.Body);
        Assert.Equal(200, (await rig.Post("/v1/copy", "{\"path\":\"C:\\\\Docs\\\\a.pdf\",\"dir\":\"C:\\\\Docs\"}")).Status);
        Assert.Equal(405, (await rig.Get("/v1/rename")).Status);
        Assert.Equal(400, (await rig.Post("/v1/rename", "[1]")).Status);
        // Another account or no sign-in never reaches the edit.
        var calls = rig.Edit.Calls.Count;
        Assert.Equal(403, (await rig.Post("/v1/rename", "{\"path\":\"C:\\\\Docs\\\\a.pdf\",\"name\":\"c.pdf\"}", token: "web-b")).Status);
        Assert.Equal(401, (await rig.Post("/v1/mkdir", "{\"dir\":\"C:\\\\Docs\",\"name\":\"y\"}", token: "nope")).Status);
        Assert.Equal(calls, rig.Edit.Calls.Count);
    }

    [Fact]
    public async Task A_door_without_edit_offers_none_of_it_and_still_refuses_folders_in_the_bin()
    {
        using var rig = new Rig(canWrite: true);
        Assert.DoesNotContain("\"edit\"", (await rig.Get("/v1/hello")).Body);
        Assert.Equal(404, (await rig.Post("/v1/rename", "{\"path\":\"C:\\\\Docs\\\\a.pdf\",\"name\":\"b.pdf\"}")).Status);
        Assert.Equal(404, (await rig.Post("/v1/move", "{\"path\":\"C:\\\\Docs\\\\a.pdf\",\"dir\":\"C:\\\\\"}")).Status);
        Assert.Equal(400, (await rig.Post("/v1/trash", "{\"path\":\"C:\\\\Docs\"}")).Status);
        Assert.Empty(rig.Edit.Calls);
        Assert.Empty(rig.Shell.Trashed);
    }

    [Fact]
    public async Task A_door_that_can_edit_sends_a_folder_but_never_a_drive_to_the_bin()
    {
        using var rig = new Rig(canEdit: true);
        Assert.Equal(200, (await rig.Post("/v1/trash", "{\"path\":\"C:\\\\Docs\"}")).Status);
        Assert.Equal(400, (await rig.Post("/v1/trash", "{\"path\":\"C:\\\\\"}")).Status);
        Assert.Equal(403, (await rig.Post("/v1/trash", "{\"path\":\"C:\\\\Windows\"}")).Status);
        Assert.Equal(new[] { "C:\\Docs" }, rig.Shell.Trashed);
    }

    [Theory]
    [InlineData("https://bokdoong.com", true)]
    [InlineData("https://work.bokdoong.com", true)]
    [InlineData("https://desk.bokdoong.com", true)]
    [InlineData("https://nojoplus.com", true)]
    [InlineData("https://www.nojoplus.com", false)]
    [InlineData("http://nojoplus.com", false)]
    [InlineData("https://nojoplus.com.evil.example", false)]
    [InlineData("https://bokdoong.com.evil.example", false)]
    [InlineData("http://bokdoong.com", false)]
    [InlineData("https://bokdoong.com/work", false)]
    [InlineData("https://mj880616.github.io", false)]
    [InlineData("null", false)]
    [InlineData("", false)]
    public void Only_exact_Web2_addresses_are_allowed(string origin, bool allowed)
        => Assert.Equal(allowed, PcDoor.IsAllowedOrigin(origin));

    [Fact]
    public void The_door_is_off_until_the_tray_menu_turns_it_on()
    {
        Assert.False(new AppSettings().WebDoor);
        var tray = File.ReadAllText(Path.Combine(SourceRoot(), "src", "BasketDrop", "TrayApp.cs"));
        Assert.Contains("var open = wanted && _auth.State == AuthState.SignedIn", tray);
        Assert.Single(System.Text.RegularExpressions.Regex.Matches(tray, @"PcDoor\.Open\("));
    }

    internal static string SourceRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "src", "BasketDrop"))) dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException("basket-pc root not found");
    }
}

/// <summary>The real disk behind the rules. Windows only (drive paths); the test folder sits under the build output, not AppData.</summary>
public class PcFilesTests
{
    [Fact]
    public void Lists_a_folder_skips_hidden_and_system_items_and_refuses_files_as_folders()
    {
        if (!OperatingSystem.IsWindows()) return;
        var root = Path.Combine(AppContext.BaseDirectory, "pcfiles-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(root, "sub"));
        File.WriteAllText(Path.Combine(root, "b.txt"), "hello");
        var hidden = Path.Combine(root, "hidden.txt");
        File.WriteAllText(hidden, "x");
        File.SetAttributes(hidden, FileAttributes.Hidden);
        var system = Path.Combine(root, "sys.txt");
        File.WriteAllText(system, "x");
        File.SetAttributes(system, FileAttributes.System);
        try
        {
            if (PcPath.Parse(root) is not { } segs || PcPath.IsBlocked(segs)) return; // build output under a blocked folder: nothing to test here
            var files = new PcFiles(null);
            var listing = files.List(root);
            Assert.Equal(PcLookup.Ok, listing.Result);
            Assert.Equal(new[] { "sub", "b.txt" }, listing.Entries.Select(e => e.Name));
            Assert.True(listing.Entries[0].Dir);
            Assert.Equal(5, listing.Entries[1].Size);
            Assert.Equal(PcLookup.Blocked, files.Find(hidden).Result);
            Assert.Equal(PcLookup.NotFolder, files.List(Path.Combine(root, "b.txt")).Result);
            Assert.Equal(PcLookup.NotFound, files.List(Path.Combine(root, "nope")).Result);
            Assert.Equal(PcLookup.NotFound, files.Find(Path.Combine(root, "b.txt", "x")).Result);
            Assert.Equal(PcLookup.Blocked, new PcFiles(root).List(root).Result); // the app's own folder
            Assert.Equal(PcLookup.Blocked, files.List("C:\\Windows").Result);
        }
        finally
        {
            File.SetAttributes(hidden, FileAttributes.Normal);
            File.SetAttributes(system, FileAttributes.Normal);
            Directory.Delete(root, true);
        }
    }

    [Fact]
    public void Drives_are_plain_roots()
    {
        if (!OperatingSystem.IsWindows()) return;
        var drives = new PcFiles(null).Drives();
        Assert.NotEmpty(drives);
        Assert.All(drives, d => Assert.Matches(@"^[A-Z]:\\$", d.Root));
    }
}

/// <summary>Copying onto this PC: new files only, through a hidden part file, never replacing or deleting another file.</summary>
public class PcTransferTests
{
    [Theory]
    [InlineData("보고서.pdf", 2, "보고서 (2).pdf")]
    [InlineData("자료", 3, "자료 (3)")]
    [InlineData("a.tar.gz", 2, "a.tar (2).gz")]
    [InlineData(".env", 2, ".env (2)")]
    public void Taken_names_get_a_number(string name, int n, string expected) => Assert.Equal(expected, PcTransfer.Numbered(name, n));

    [Theory]
    [InlineData("b.txt", PcStep.Ok)]
    [InlineData("회의 자료 (1).hwpx", PcStep.Ok)]
    [InlineData("run.exe", PcStep.Risky)]
    [InlineData("x.ps1", PcStep.Risky)]
    [InlineData("a\\b.txt", PcStep.BadPath)]
    [InlineData("..", PcStep.BadPath)]
    [InlineData("con.txt", PcStep.BadPath)]
    [InlineData("a:b", PcStep.BadPath)]
    [InlineData("~basket-abc.part", PcStep.BadPath)]
    [InlineData("", PcStep.BadPath)]
    public void Only_plain_file_names_that_are_not_programs_may_be_written(string name, PcStep expected)
        => Assert.Equal(expected, PcTransfer.NameCheck(new[] { "C:", "Docs" }, name, null));

    [Fact]
    public void Nothing_is_written_into_blocked_folders()
    {
        Assert.Equal(PcStep.Blocked, PcTransfer.NameCheck(new[] { "C:" }, "Windows", null));
        Assert.Equal(PcStep.Blocked, PcTransfer.NameCheck(new[] { "C:", "Users", "me" }, "AppData", null));
    }

    [Fact]
    public void The_transfer_code_only_ever_removes_its_own_part_file_and_never_logs_names()
    {
        var text = File.ReadAllText(Path.Combine(PcDoorTests.SourceRoot(), "src", "BasketDrop.Core", "PcTransfer.cs"));
        Assert.DoesNotMatch(@"Directory\.(Delete|Move)|File\.Replace|File\.Copy|overwrite:\s*true|FileMode\.(Create|Truncate|Append|OpenOrCreate)\b|\.MoveTo\(|\.CopyTo\(|_log", text);
        Assert.Single(System.Text.RegularExpressions.Regex.Matches(text, @"File\.Delete\("));
        Assert.Contains("File.Delete(s.Part)", text);
        Assert.Contains("FileMode.CreateNew", text);
        Assert.Contains("overwrite: false", text);
    }

    [Fact]
    public void A_file_is_written_read_and_named_on_the_real_disk()
    {
        if (!OperatingSystem.IsWindows()) return;
        var root = Path.Combine(AppContext.BaseDirectory, "pctransfer-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        File.WriteAllText(Path.Combine(root, "b.txt"), "old");
        try
        {
            if (PcPath.Parse(root) is not { } segs || PcPath.IsBlocked(segs)) return;
            var now = DateTimeOffset.Parse("2026-11-08T00:00:00Z");
            using var t = new PcTransfer(new PcFiles(null), null, () => now);
            var (ok, id) = t.Begin(root, "b.txt", 4);
            Assert.Equal(PcStep.Ok, ok);
            // The part file is hidden, so the screen never lists it.
            Assert.DoesNotContain(new PcFiles(null).List(root).Entries, e => e.Name.StartsWith(PcTransfer.PartPrefix, StringComparison.Ordinal));
            Assert.Equal(PcStep.Ok, t.Piece(id, 0, "ne"u8.ToArray()));
            Assert.Equal(PcStep.BadPiece, t.Piece(id, 0, "ne"u8.ToArray()));
            Assert.Equal(PcStep.BadPiece, t.Finish(id, true).Result); // not complete yet
            Assert.Equal(PcStep.Ok, t.Piece(id, 2, "w!"u8.ToArray()));
            Assert.Equal(PcStep.BadPiece, t.Piece(id, 4, "x"u8.ToArray())); // past the size
            Assert.Equal(PcStep.Exists, t.Finish(id, false).Result);
            var (named, name) = t.Finish(id, true);
            Assert.Equal(PcStep.Ok, named);
            Assert.Equal("b (2).txt", name);
            Assert.Equal("old", File.ReadAllText(Path.Combine(root, "b.txt")));
            Assert.Equal("new!", File.ReadAllText(Path.Combine(root, "b (2).txt")));
            Assert.Equal(0, t.OpenCount);
            var read = t.Read(Path.Combine(root, "b (2).txt"), 1, 2);
            Assert.Equal(PcStep.Ok, read.Result);
            Assert.Equal("ew", System.Text.Encoding.ASCII.GetString(read.Bytes));
            Assert.Equal(4, read.Size);
            Assert.Equal(PcStep.NotFile, t.Read(root, 0, 1).Result);
            // A cancelled or abandoned file leaves nothing behind.
            var (_, gone) = t.Begin(root, "c.txt", 10);
            t.Cancel(gone);
            Assert.Empty(Directory.GetFiles(root, PcTransfer.PartPrefix + "*"));
            Assert.Equal(PcStep.Risky, t.Begin(root, "x.exe", 1).Result);
        }
        finally
        {
            Directory.Delete(root, true);
        }
    }
}

/// <summary>FILES-내PC쓰기: rename, new folder, move and copy inside this PC — never replacing or deleting anything.</summary>
public class PcEditTests
{
    [Fact]
    public void The_edit_code_never_replaces_or_deletes_and_never_logs()
    {
        var text = File.ReadAllText(Path.Combine(PcDoorTests.SourceRoot(), "src", "BasketDrop.Core", "PcEdit.cs"));
        Assert.DoesNotMatch(@"File\.(Delete|Replace|WriteAll|Create|Open)|Directory\.Delete|overwrite:\s*true|FileMode\.|\.Delete\(|_log", text);
        Assert.Contains("File.Copy(item.Full, target, overwrite: false)", text);
        Assert.Contains("File.Move(from, to, overwrite: false)", text);
        Assert.Contains("PcTransfer.NameCheck", text);
    }

    [Fact]
    public void Renames_makes_folders_moves_and_copies_on_the_real_disk_without_replacing()
    {
        if (!OperatingSystem.IsWindows()) return;
        var root = Path.Combine(AppContext.BaseDirectory, "pcedit-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(root, "sub"));
        File.WriteAllText(Path.Combine(root, "a.txt"), "one");
        File.WriteAllText(Path.Combine(root, "b.txt"), "two");
        try
        {
            if (PcPath.Parse(root) is not { } segs || PcPath.IsBlocked(segs)) return;
            var edit = new PcEdit(new PcFiles(null), null);
            var a = Path.Combine(root, "a.txt");
            Assert.Equal(PcStep.Exists, edit.Rename(a, "b.txt").Result);
            Assert.Equal("two", File.ReadAllText(Path.Combine(root, "b.txt")));
            Assert.Equal(PcStep.Risky, edit.Rename(a, "a.exe").Result);
            Assert.Equal(PcStep.BadPath, edit.Rename(a, "..").Result);
            var (renamed, c) = edit.Rename(a, "c.txt");
            Assert.Equal(PcStep.Ok, renamed);
            Assert.Equal(Path.Combine(root, "c.txt"), c);
            Assert.Equal(PcStep.Ok, edit.Rename(c, "C.txt").Result); // only the letter case
            var (made, folder) = edit.MakeFolder(root, "새 폴더");
            Assert.Equal(PcStep.Ok, made);
            Assert.True(Directory.Exists(folder));
            Assert.Equal(PcStep.Exists, edit.MakeFolder(root, "새 폴더").Result);
            var (copied, copy) = edit.Copy(Path.Combine(root, "b.txt"), root, false);
            Assert.Equal(PcStep.Ok, copied);
            Assert.Equal(Path.Combine(root, "b (2).txt"), copy); // a copy into its own folder always gets a number
            Assert.Equal(PcStep.NotFile, edit.Copy(Path.Combine(root, "sub"), root, true).Result);
            File.WriteAllText(Path.Combine(root, "sub", "b.txt"), "sub");
            Assert.Equal(PcStep.Exists, edit.Move(Path.Combine(root, "b.txt"), Path.Combine(root, "sub"), false).Result);
            var (moved, to) = edit.Move(Path.Combine(root, "b.txt"), Path.Combine(root, "sub"), true);
            Assert.Equal(PcStep.Ok, moved);
            Assert.Equal(Path.Combine(root, "sub", "b (2).txt"), to);
            Assert.Equal("sub", File.ReadAllText(Path.Combine(root, "sub", "b.txt")));
            Assert.Equal(PcStep.BadPath, edit.Move(Path.Combine(root, "sub"), Path.Combine(root, "sub"), true).Result); // into itself
            Assert.Equal(PcStep.Ok, edit.Move(Path.Combine(root, "sub"), folder, false).Result);
            Assert.True(File.Exists(Path.Combine(folder!, "sub", "b (2).txt")));
            Assert.Equal(PcStep.BadPath, edit.Rename(segs[0] + "\\", "x").Result); // never a drive
            Assert.Equal(PcStep.Blocked, edit.MakeFolder("C:\\Windows", "x").Result);
        }
        finally
        {
            Directory.Delete(root, true);
        }
    }
}

/// <summary>'고정한 폴더' kept in this app's own data folder: plain allowed paths only, at most twelve, in order.</summary>
public class PcPinsTests
{
    [Fact]
    public void Pins_are_saved_cleaned_and_loaded_in_order()
    {
        var dir = Path.Combine(AppContext.BaseDirectory, "pcpins-" + Guid.NewGuid().ToString("N"));
        try
        {
            var pins = new PcPins(Path.Combine(dir, "pc-pins.json"), null);
            Assert.Empty(pins.Load());
            Assert.True(pins.Save(new[] { "d:\\자료\\", "C:\\Docs" }));
            Assert.Equal(new[] { "D:\\자료", "C:\\Docs" }, pins.Load());
            Assert.False(pins.Save(new[] { "C:\\Docs", "c:\\docs" }));          // the same folder twice
            Assert.False(pins.Save(new[] { "C:\\Program Files\\x" }));          // blocked
            Assert.False(pins.Save(new[] { "C:\\a\\..\\Windows" }));           // escaping
            Assert.False(pins.Save(new string?[] { null }));
            Assert.False(pins.Save(Enumerable.Range(0, 13).Select(i => (string?)$"C:\\f{i}").ToList()));
            Assert.Equal(new[] { "D:\\자료", "C:\\Docs" }, pins.Load());        // refused saves keep the old list
            Assert.True(pins.Save(Array.Empty<string?>()));
            Assert.Empty(pins.Load());
        }
        finally
        {
            if (Directory.Exists(dir)) Directory.Delete(dir, true);
        }
    }
}
