using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Web;
using Xunit;

namespace BasketDrop.Tests;

/// <summary>Stand-in for Supabase Auth on a loopback port. No test in this file calls production.</summary>
public sealed class FakeAuthServer : IDisposable
{
    public const string Refresh0 = "REFRESH-SECRET-0-0123456789";
    private readonly object _gate = new();
    private readonly HashSet<string> _usedCodes = new();
    private int _issued;
    private readonly FakeServer _server;

    public FakeAuthServer() { _server = new FakeServer(Handle); }

    public string BaseUrl => _server.BaseUrl;
    public string? ExpectedChallenge { get; set; }
    public string CurrentRefresh { get; set; } = Refresh0;
    public bool NoSession { get; set; }
    /// <summary>When set, refresh calls answer this status instead of working.</summary>
    public int? RefreshStatus { get; set; }
    public int RefreshDelayMs { get; set; }
    public int Exchanges { get; private set; }
    public int Refreshes { get; private set; }
    public int Logouts { get; private set; }
    public string? LastLogoutAuth { get; private set; }
    public string? LastLogoutLine { get; private set; }
    public string? LastVerifier { get; private set; }
    public string LastAccess { get; private set; } = "";

    public IReadOnlyList<Captured> Requests => _server.Requests;

    private Reply Issue()
    {
        var n = ++_issued;
        CurrentRefresh = $"REFRESH-SECRET-{n}-0123456789";
        LastAccess = FakeJwts.Make("access" + n, !NoSession);
        return new Reply { Body = JsonSerializer.Serialize(new { access_token = LastAccess, refresh_token = CurrentRefresh, expires_in = 3600 }) };
    }

    private Reply Handle(Captured c)
    {
        var line = c.RequestLine;
        if (line.StartsWith("POST /auth/v1/token?grant_type=pkce "))
        {
            using var doc = JsonDocument.Parse(c.Body);
            var code = doc.RootElement.GetProperty("auth_code").GetString()!;
            var verifier = doc.RootElement.GetProperty("code_verifier").GetString()!;
            lock (_gate)
            {
                LastVerifier = verifier;
                // Same rules as the real server: a code works once and only together with the matching verifier.
                if (!_usedCodes.Add(code) || Pkce.Challenge(verifier) != ExpectedChallenge)
                    return new Reply { Status = 400, Body = "{\"error\":\"invalid_grant\"}" };
                Exchanges++;
                return Issue();
            }
        }
        if (line.StartsWith("POST /auth/v1/token?grant_type=refresh_token "))
        {
            using var doc = JsonDocument.Parse(c.Body);
            var refresh = doc.RootElement.GetProperty("refresh_token").GetString();
            lock (_gate)
            {
                Refreshes++;
                if (RefreshStatus is { } status) return new Reply { Status = status, Body = "{}" };
                if (RefreshDelayMs > 0) Thread.Sleep(RefreshDelayMs);
                if (refresh != CurrentRefresh) return new Reply { Status = 400, Body = "{\"error\":\"invalid_grant\"}" };
                return Issue();
            }
        }
        if (line.StartsWith("POST /auth/v1/logout"))
        {
            lock (_gate)
            {
                Logouts++;
                LastLogoutLine = line;
                LastLogoutAuth = c.Headers.GetValueOrDefault("Authorization");
            }
            return new Reply { Status = 204, Body = "" };
        }
        return new Reply { Status = 404, Body = "{}" };
    }

    public void Dispose() => _server.Dispose();
}

public class AuthTests
{
    private sealed class Rig : IDisposable
    {
        public FakeAuthServer Server = new();
        public MemoryTokenStore Store;
        public FakeApi Api = new();
        public TempDir Dir = new();
        public DateTimeOffset Now = new(2026, 10, 19, 12, 0, 0, TimeSpan.Zero);
        public HttpAuthClient Client;
        public SupabaseAuthProvider Auth;
        public List<Uri> OpenedUrls = new();
        public ILog Log;

        public Rig(string? savedRefresh = null, TimeSpan? signInTimeout = null)
        {
            Store = new MemoryTokenStore(savedRefresh);
            Client = new HttpAuthClient(Server.BaseUrl, "PUBLIC-KEY", () => Now);
            Log = new FileLog(Dir.Sub("log.txt"));
            Auth = new SupabaseAuthProvider(Client, Store, Api, Log, () => Now, new[] { FakeServer.UnusedPort() }, signInTimeout ?? TimeSpan.FromSeconds(10));
        }

        /// <summary>Plays the browser: reads the address it was given, then "returns" to the loopback address.</summary>
        public Func<Uri, bool> Browser(string query = "?code=CODE1", Func<string, string>? tamper = null) => url =>
        {
            OpenedUrls.Add(url);
            var q = HttpUtility.ParseQueryString(url.Query);
            Assert.Equal("google", q["provider"]);
            Assert.Equal("s256", q["code_challenge_method"]);
            Server.ExpectedChallenge = q["code_challenge"];
            var redirect = q["redirect_to"]!;
            Assert.StartsWith("http://127.0.0.1:", redirect);
            var target = (tamper == null ? redirect : tamper(redirect)) + query;
            _ = Task.Run(async () =>
            {
                try { using var http = new HttpClient(); await http.GetAsync(target); }
                catch (HttpRequestException) { }
            });
            return true;
        };

        public void Dispose()
        {
            Client.Dispose();
            Server.Dispose();
            Dir.Dispose();
        }
    }

    // ---- PKCE ----

    [Fact]
    public void Pkce_challenge_matches_the_RFC7636_test_vector()
    {
        Assert.Equal("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", Pkce.Challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"));
    }

    [Fact]
    public void Verifier_and_state_are_random_url_safe_values()
    {
        var a = Pkce.NewVerifier();
        Assert.Matches("^[A-Za-z0-9_-]{43,128}$", a);
        Assert.NotEqual(a, Pkce.NewVerifier());
        Assert.Matches("^[A-Za-z0-9_-]{16,}$", Pkce.NewState());
        Assert.NotEqual(Pkce.NewState(), Pkce.NewState());
    }

    // ---- loopback receiver ----

    [Fact]
    public async Task Receiver_ignores_wrong_state_and_host_then_accepts_the_right_one_exactly_once()
    {
        var port = FakeServer.UnusedPort();
        using var receiver = LoopbackReceiver.Start("STATE-OK", new[] { port });
        using var http = new HttpClient();

        var wrongState = await http.GetAsync($"http://127.0.0.1:{port}/basket-drop/STATE-BAD?code=evil");
        Assert.Equal(HttpStatusCode.NotFound, wrongState.StatusCode);
        var noState = await http.GetAsync($"http://127.0.0.1:{port}/basket-drop/?code=evil");
        Assert.Equal(HttpStatusCode.NotFound, noState.StatusCode);
        using var wrongHost = new HttpRequestMessage(HttpMethod.Get, $"http://127.0.0.1:{port}/basket-drop/STATE-OK?code=evil");
        wrongHost.Headers.Host = "attacker.example";
        Assert.Equal(HttpStatusCode.BadRequest, (await http.SendAsync(wrongHost)).StatusCode);
        var noCode = await http.GetAsync($"http://127.0.0.1:{port}/basket-drop/STATE-OK");
        Assert.Equal(HttpStatusCode.BadRequest, noCode.StatusCode);

        var ok = await http.GetAsync($"http://127.0.0.1:{port}/basket-drop/STATE-OK?code=the-code");
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var page = await ok.Content.ReadAsStringAsync();
        Assert.DoesNotContain("the-code", page); // the code is never echoed back to the browser
        Assert.Contains("no-referrer", string.Join(",", ok.Headers.GetValues("Referrer-Policy")));

        var result = await receiver.WaitAsync(TimeSpan.FromSeconds(5), default);
        Assert.Equal(new CallbackResult(CallbackKind.Code, "the-code"), result);

        // A replay finds the listener gone.
        await Assert.ThrowsAsync<HttpRequestException>(() => http.GetAsync($"http://127.0.0.1:{port}/basket-drop/STATE-OK?code=again"));
    }

    [Fact]
    public async Task Receiver_reports_a_refused_login_and_times_out_without_a_visit()
    {
        var port = FakeServer.UnusedPort();
        using (var receiver = LoopbackReceiver.Start("S", new[] { port }))
        {
            using var http = new HttpClient();
            await http.GetAsync($"http://127.0.0.1:{port}/basket-drop/S?error=access_denied&error_description=x");
            Assert.Equal(CallbackKind.Denied, (await receiver.WaitAsync(TimeSpan.FromSeconds(5), default))!.Kind);
        }
        using var idle = LoopbackReceiver.Start("S", new[] { FakeServer.UnusedPort() });
        Assert.Null(await idle.WaitAsync(TimeSpan.FromMilliseconds(200), default));
    }

    [Fact]
    public void Receiver_skips_busy_ports_and_fails_when_all_are_busy()
    {
        var busy = new TcpListener(IPAddress.Loopback, 0);
        busy.Start();
        try
        {
            var busyPort = ((IPEndPoint)busy.LocalEndpoint).Port;
            Assert.Throws<PortsBusyException>(() => LoopbackReceiver.Start("S", new[] { busyPort }));
            var free = FakeServer.UnusedPort();
            using var r = LoopbackReceiver.Start("S", new[] { busyPort, free });
            Assert.Equal(free, r.Port);
            Assert.StartsWith($"http://127.0.0.1:{free}/basket-drop/", r.RedirectUri);
        }
        finally { busy.Stop(); }
    }

    // ---- sign-in ----

    [Fact]
    public async Task Sign_in_saves_only_the_refresh_token_and_keeps_the_access_token_in_memory()
    {
        using var r = new Rig();
        var outcome = await r.Auth.SignInAsync(r.Browser(), default);

        Assert.Equal(SignInOutcome.Ok, outcome);
        Assert.Equal(AuthState.SignedIn, r.Auth.State);
        Assert.Equal("REFRESH-SECRET-1-0123456789", r.Store.Load());
        Assert.Equal(1, r.Api.OwnerChecks);
        Assert.Equal(r.Server.LastAccess, await r.Auth.GetAccessTokenAsync(default));
        Assert.Equal(0, r.Server.Refreshes); // still valid, no extra refresh
        // The browser address holds the public challenge, never the verifier or any token.
        var url = Assert.Single(r.OpenedUrls).AbsoluteUri;
        Assert.DoesNotContain(r.Server.LastVerifier!, url);
        Assert.DoesNotContain("REFRESH-SECRET", url);
        var exchange = r.Server.Requests.Single(x => x.RequestLine.Contains("grant_type=pkce"));
        Assert.Equal("PUBLIC-KEY", exchange.Headers["apikey"]);
    }

    [Fact]
    public async Task A_return_with_the_wrong_state_is_refused_and_never_exchanged()
    {
        using var r = new Rig(signInTimeout: TimeSpan.FromMilliseconds(800));
        var outcome = await r.Auth.SignInAsync(r.Browser(tamper: red => red[..red.LastIndexOf('/')] + "/WRONG-STATE"), default);

        Assert.Equal(SignInOutcome.TimedOut, outcome);
        Assert.Equal(0, r.Server.Exchanges);
        Assert.DoesNotContain(r.Server.Requests, x => x.RequestLine.Contains("/token"));
        Assert.Null(r.Store.Load());
        Assert.Equal(AuthState.SignedOut, r.Auth.State);
    }

    [Fact]
    public async Task A_used_code_is_refused_and_the_existing_login_is_untouched()
    {
        using var r = new Rig();
        Assert.Equal(SignInOutcome.Ok, await r.Auth.SignInAsync(r.Browser(), default));
        var saved = r.Store.Load();

        // The same code comes back a second time: the server refuses it.
        var again = await r.Auth.SignInAsync(r.Browser(), default);

        Assert.Equal(SignInOutcome.Failed, again);
        Assert.Equal(saved, r.Store.Load());
        Assert.Equal(1, r.Server.Exchanges);
        await Assert.ThrowsAsync<AuthRejectedException>(() => r.Client.ExchangeCodeAsync("CODE1", Pkce.NewVerifier(), default));
    }

    [Fact]
    public async Task A_code_with_a_different_verifier_is_refused()
    {
        using var r = new Rig();
        r.Server.ExpectedChallenge = Pkce.Challenge("the-real-verifier");
        await Assert.ThrowsAsync<AuthRejectedException>(() => r.Client.ExchangeCodeAsync("CODE-X", "another-verifier", default));
    }

    [Fact]
    public async Task A_denied_login_saves_nothing()
    {
        using var r = new Rig();
        Assert.Equal(SignInOutcome.Denied, await r.Auth.SignInAsync(r.Browser("?error=access_denied"), default));
        Assert.Null(r.Store.Load());
        Assert.Equal(0, r.Server.Exchanges);
    }

    [Fact]
    public async Task A_non_owner_account_is_refused_nothing_is_saved_and_its_new_session_is_ended()
    {
        using var r = new Rig();
        r.Api.Owner = new ApiResult(ApiOutcome.Rejected, "workspace_not_found");

        var outcome = await r.Auth.SignInAsync(r.Browser(), default);

        Assert.Equal(SignInOutcome.NotOwner, outcome);
        Assert.Null(r.Store.Load());
        Assert.Equal(0, r.Store.Saves);
        Assert.Equal(AuthState.SignedOut, r.Auth.State);
        Assert.Equal(1, r.Server.Logouts);
        Assert.Contains("scope=local", r.Server.LastLogoutLine);
        Assert.Null(await r.Auth.GetAccessTokenAsync(default));
    }

    [Fact]
    public async Task If_the_owner_check_cannot_run_nothing_is_saved()
    {
        using var r = new Rig();
        r.Api.Owner = new ApiResult(ApiOutcome.NotReached, "not_reached");
        Assert.Equal(SignInOutcome.Unavailable, await r.Auth.SignInAsync(r.Browser(), default));
        Assert.Null(r.Store.Load());
    }

    [Fact]
    public async Task Sign_in_fails_cleanly_when_no_loopback_port_is_free()
    {
        using var r = new Rig();
        var busy = new TcpListener(IPAddress.Loopback, 0);
        busy.Start();
        try
        {
            var port = ((IPEndPoint)busy.LocalEndpoint).Port;
            var auth = new SupabaseAuthProvider(r.Client, r.Store, r.Api, null, () => r.Now, new[] { port });
            Assert.Equal(SignInOutcome.PortsBusy, await auth.SignInAsync(r.Browser(), default));
            Assert.Empty(r.OpenedUrls);
        }
        finally { busy.Stop(); }
    }

    // ---- refresh ----

    [Fact]
    public async Task Concurrent_requests_after_expiry_refresh_exactly_once_and_keep_the_rotated_token()
    {
        using var r = new Rig();
        Assert.Equal(SignInOutcome.Ok, await r.Auth.SignInAsync(r.Browser(), default));
        r.Server.RefreshDelayMs = 150;
        r.Now = r.Now.AddHours(2);

        var tokens = await Task.WhenAll(Enumerable.Range(0, 12).Select(_ => Task.Run(() => r.Auth.GetAccessTokenAsync(default))));

        Assert.Equal(1, r.Server.Refreshes);
        Assert.Single(tokens.Distinct());
        Assert.Equal(r.Server.LastAccess, tokens[0]);
        Assert.Equal(r.Server.CurrentRefresh, r.Store.Load());
    }

    [Fact]
    public async Task The_token_is_renewed_shortly_before_it_expires()
    {
        using var r = new Rig();
        await r.Auth.SignInAsync(r.Browser(), default);
        r.Now = r.Now.AddSeconds(3600 - 30); // inside the 60 second margin
        await r.Auth.GetAccessTokenAsync(default);
        Assert.Equal(1, r.Server.Refreshes);
    }

    [Fact]
    public async Task A_dead_login_clears_the_saved_token_asks_for_sign_in_and_keeps_the_queue()
    {
        using var r = new Rig(savedRefresh: "REFRESH-SECRET-stale");
        Assert.Equal(AuthState.SignedIn, r.Auth.State); // a saved login exists until the server says otherwise
        var seen = new List<AuthState>();
        r.Auth.StateChanged += seen.Add;
        using var qdir = new TempDir();
        var store = new QueueStore(qdir.Sub("queue"));
        var history = new HistoryStore(qdir.Sub("history.json"));
        var drop = new DropService(store, history);
        var file = qdir.WriteFile("a.txt", "content");
        drop.Commit(drop.Inspect(new[] { DropSource.FromPath(file) }, "memo"));
        var processor = new QueueProcessor(store, history, r.Api, r.Auth);

        await processor.RunOnceAsync(default);

        Assert.Null(r.Store.Load());
        Assert.Equal(new[] { AuthState.ReloginNeeded }, seen);
        var item = Assert.Single(store.List());
        Assert.Equal(ItemState.LoginRequired, item.State);
        Assert.True(File.Exists(store.FilePath(item, item.Files[0])));
        Assert.Empty(r.Api.Uploads);

        // Signing in again sends the waiting item.
        Assert.Equal(SignInOutcome.Ok, await r.Auth.SignInAsync(r.Browser(), default));
        await processor.RunOnceAsync(default);
        Assert.Empty(store.List());
        Assert.Single(r.Api.Uploads);
        Assert.Equal(AuthState.SignedIn, r.Auth.State);
    }

    [Fact]
    public async Task A_network_problem_during_refresh_keeps_the_login_and_the_queue_and_retries_later()
    {
        using var r = new Rig();
        await r.Auth.SignInAsync(r.Browser(), default);
        var saved = r.Store.Load();
        r.Server.RefreshStatus = 503;
        r.Now = r.Now.AddHours(2);
        using var qdir = new TempDir();
        var store = new QueueStore(qdir.Sub("queue"));
        var history = new HistoryStore(qdir.Sub("history.json"));
        var drop = new DropService(store, history);
        drop.Commit(drop.Inspect(new[] { DropSource.FromPath(qdir.WriteFile("a.txt", "content")) }, ""));
        var processor = new QueueProcessor(store, history, r.Api, r.Auth);

        var delay = await processor.RunOnceAsync(default);

        Assert.NotNull(delay);
        Assert.Equal(saved, r.Store.Load());
        Assert.Equal(AuthState.SignedIn, r.Auth.State);
        Assert.Equal(ItemState.Pending, Assert.Single(store.List()).State); // not "login needed": the login is fine
        Assert.Empty(r.Api.Uploads);

        r.Server.RefreshStatus = null;
        await processor.RunOnceAsync(default);
        Assert.Empty(store.List());
        Assert.Single(r.Api.Uploads);
    }

    [Fact]
    public async Task A_401_from_the_basket_forces_a_renewal_before_the_token_is_used_again()
    {
        using var r = new Rig();
        await r.Auth.SignInAsync(r.Browser(), default);
        using var qdir = new TempDir();
        var store = new QueueStore(qdir.Sub("queue"));
        var history = new HistoryStore(qdir.Sub("history.json"));
        var drop = new DropService(store, history);
        drop.Commit(drop.Inspect(new[] { DropSource.FromPath(qdir.WriteFile("a.txt", "content")) }, ""));
        r.Api.Script.Enqueue(new ApiResult(ApiOutcome.LoginRequired, "session_required"));
        var processor = new QueueProcessor(store, history, r.Api, r.Auth);

        await processor.RunOnceAsync(default);
        Assert.Equal(ItemState.LoginRequired, Assert.Single(store.List()).State);
        Assert.Equal(0, r.Server.Refreshes);

        await processor.RunOnceAsync(default); // renews first, then sends
        Assert.Equal(1, r.Server.Refreshes);
        Assert.Empty(store.List());
    }

    // ---- sign-out ----

    [Fact]
    public async Task Sign_out_deletes_the_saved_login_and_ends_only_this_session()
    {
        using var r = new Rig();
        await r.Auth.SignInAsync(r.Browser(), default);
        var access = r.Server.LastAccess;

        var result = await r.Auth.SignOutAsync(default);

        Assert.True(result.ServerSessionEnded);
        Assert.Null(r.Store.Load());
        Assert.Equal(AuthState.SignedOut, r.Auth.State);
        Assert.Equal(1, r.Server.Logouts);
        Assert.Contains("scope=local", r.Server.LastLogoutLine);
        Assert.Equal("Bearer " + access, r.Server.LastLogoutAuth);
        Assert.Null(await r.Auth.GetAccessTokenAsync(default));
    }

    [Fact]
    public async Task Sign_out_never_calls_the_server_without_a_session_id_because_that_would_end_every_session()
    {
        using var r = new Rig();
        r.Server.NoSession = true;
        await r.Auth.SignInAsync(r.Browser(), default);

        var result = await r.Auth.SignOutAsync(default);

        Assert.False(result.ServerSessionEnded);
        Assert.Equal(0, r.Server.Logouts);
        Assert.Null(r.Store.Load());
        Assert.Equal(AuthState.SignedOut, r.Auth.State);
    }

    [Fact]
    public async Task Sign_out_works_offline_on_this_pc()
    {
        using var r = new Rig();
        await r.Auth.SignInAsync(r.Browser(), default);
        r.Server.RefreshStatus = 503;
        r.Now = r.Now.AddHours(2);

        var result = await r.Auth.SignOutAsync(default);

        Assert.False(result.ServerSessionEnded);
        Assert.Null(r.Store.Load());
        Assert.Equal(AuthState.SignedOut, r.Auth.State);
    }

    // ---- nothing secret is left behind ----

    [Fact]
    public async Task No_token_or_code_reaches_the_log_or_any_file()
    {
        using var r = new Rig();
        await r.Auth.SignInAsync(r.Browser(), default);
        r.Now = r.Now.AddHours(2);
        await r.Auth.GetAccessTokenAsync(default);
        var access = r.Server.LastAccess;
        var refresh = r.Server.CurrentRefresh;
        await r.Auth.SignOutAsync(default);

        Assert.True(File.Exists(r.Dir.Sub("log.txt")));
        foreach (var file in Directory.EnumerateFiles(r.Dir.Path, "*", SearchOption.AllDirectories))
        {
            var text = File.ReadAllText(file);
            Assert.DoesNotContain(access, text);
            Assert.DoesNotContain("REFRESH-SECRET", text);
            Assert.DoesNotContain("CODE1", text);
            Assert.DoesNotContain(refresh, text);
            Assert.DoesNotContain(r.Server.LastVerifier!, text);
        }
    }

    // ---- Credential Manager (test-only entry name, removed afterwards) ----

    [Fact]
    public void Credential_manager_store_saves_replaces_reads_and_deletes()
    {
        if (!OperatingSystem.IsWindows()) return;
        var store = new CredentialManagerTokenStore("BasketDrop.Test/" + Guid.NewGuid().ToString("N"));
        try
        {
            Assert.Null(store.Load());
            store.Delete(); // deleting nothing is fine
            store.Save("first-é-token");
            Assert.Equal("first-é-token", store.Load());
            store.Save("second-token");
            Assert.Equal("second-token", store.Load());
            store.Delete();
            Assert.Null(store.Load());
        }
        finally { store.Delete(); }
    }
}
