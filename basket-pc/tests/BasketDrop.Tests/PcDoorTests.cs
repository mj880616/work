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
        public void Open(string fullPath) => Opened.Add(fullPath);
        public void Reveal(string fullPath) => Revealed.Add(fullPath);
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
        public PcDoor Door { get; }
        public int Port => Door.Port;

        public Rig()
        {
            Door = PcDoor.Open(new FakeFiles(), Shell, Verifier, _ => Task.FromResult<string?>(Own), new NullLog(), "9.9.9", new[] { FakeServer.UnusedPort() });
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

        public async Task<(int Status, string Head, string Body)> Raw(string request)
        {
            using var client = new TcpClient();
            await client.ConnectAsync(IPAddress.Loopback, Port);
            var stream = client.GetStream();
            await stream.WriteAsync(Encoding.UTF8.GetBytes(request));
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
        foreach (var name in new[] { "PcDoor.cs", "PcFiles.cs", "PcPath.cs", "WebUserVerifier.cs" })
        {
            var text = File.ReadAllText(Path.Combine(SourceRoot(), "src", "BasketDrop.Core", name));
            Assert.DoesNotMatch(@"File\.(Delete|Move|Copy|Write|Create|Append|Replace|Open)|Directory\.(Delete|Move|Create)|FileMode\.|\.Delete\(|\.MoveTo\(|\.CopyTo\(", text);
            Assert.DoesNotMatch(@"_log\.Write\([^)]*(path|Path|name|Name|full)", text);
        }
        var door = File.ReadAllText(Path.Combine(SourceRoot(), "src", "BasketDrop.Core", "PcDoor.cs"));
        Assert.Contains("\"https://bokdoong.com\", \"https://work.bokdoong.com\", \"https://desk.bokdoong.com\"", door);
        Assert.DoesNotContain("github.io", door);
        Assert.DoesNotContain("Access-Control-Allow-Origin: *", door);
        Assert.DoesNotContain("Allow-Credentials", door);
        var shell = File.ReadAllText(Path.Combine(SourceRoot(), "src", "BasketDrop", "PcShell.cs"));
        Assert.Contains("PcPath.CanOpenDirectly(fullPath)", shell);
    }

    [Theory]
    [InlineData("https://bokdoong.com", true)]
    [InlineData("https://work.bokdoong.com", true)]
    [InlineData("https://desk.bokdoong.com", true)]
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
