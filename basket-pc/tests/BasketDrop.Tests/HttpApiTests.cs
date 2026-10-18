using System.Text;
using Xunit;

namespace BasketDrop.Tests;

public class HttpApiTests
{
    // A JWT-shaped fake whose "sub" is a made-up id. It is not a real credential.
    private static readonly string FakeJwt = "h." + Convert.ToBase64String(Encoding.UTF8.GetBytes("{\"sub\":\"11111111-2222-3333-4444-555555555555\"}")).TrimEnd('=') + ".s";
    private static readonly string NoteJson = "{\"ok\":true,\"note_id\":\"" + Guid.Parse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee") + "\",\"attachments\":[{\"drive_file_id\":\"x\"}]}";

    private static (QueueFile File, string Path, TempDir Dir) OneFile()
    {
        var dir = new TempDir();
        var path = dir.WriteFile("f0", "hello");
        return (new QueueFile { StoredName = "f0", DisplayName = "한글 이름.txt", MimeType = "text/plain", SizeBytes = 5, Sha256 = "AA" }, path, dir);
    }

    [Fact]
    public async Task Upload_has_the_same_shape_as_the_web_request()
    {
        using var server = new FakeServer(_ => new Reply { Body = NoteJson });
        using var api = new HttpBasketApi(server.BaseUrl, "PUBLIC-KEY");
        var (file, path, dir) = OneFile();
        using var _ = dir;

        var r = await api.UploadFileAsync("TOKEN", path, file, "memo\nline2", null, default);

        Assert.Equal(ApiOutcome.Ok, r.Outcome);
        Assert.Equal(Guid.Parse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"), r.NoteId);
        var req = Assert.Single(server.Requests);
        Assert.StartsWith("POST /functions/v1/basket-files ", req.RequestLine);
        Assert.Equal("Bearer TOKEN", req.Headers["Authorization"]);
        Assert.Equal("PUBLIC-KEY", req.Headers["apikey"]);
        var body = Encoding.UTF8.GetString(req.Body);
        Assert.Contains("name=file", body);
        Assert.Contains("name=raw_text", body);
        Assert.Contains("memo\r\nline2", body); // newlines sent as CRLF like a browser form
        Assert.DoesNotContain("name=note_id", body);
    }

    [Fact]
    public async Task Later_files_send_note_id_and_no_text()
    {
        var id = Guid.Parse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
        using var server = new FakeServer(_ => new Reply { Body = NoteJson });
        using var api = new HttpBasketApi(server.BaseUrl);
        var (file, path, dir) = OneFile();
        using var _ = dir;

        var r = await api.UploadFileAsync("T", path, file, "ignored", id, default);

        Assert.Equal(ApiOutcome.Ok, r.Outcome);
        var body = Encoding.UTF8.GetString(server.Requests[0].Body);
        Assert.Contains("name=note_id", body);
        Assert.DoesNotContain("name=raw_text", body);
    }

    [Theory]
    [InlineData(401, "{\"code\":\"session_required\"}", ApiOutcome.LoginRequired, "session_required")]
    [InlineData(413, "{\"code\":\"file_too_large\"}", ApiOutcome.Rejected, "file_too_large")]
    [InlineData(403, "{\"code\":\"forbidden\"}", ApiOutcome.Rejected, "forbidden")]
    [InlineData(503, "{\"code\":\"note_save_result_unknown\"}", ApiOutcome.Unknown, "note_save_result_unknown")]
    [InlineData(500, "not json", ApiOutcome.Unknown, "http_500")]
    [InlineData(404, "{\"code\":\"bad code with spaces!\"}", ApiOutcome.Rejected, "http_404")]
    public async Task Server_answers_are_classified(int status, string body, ApiOutcome outcome, string code)
    {
        using var server = new FakeServer(_ => new Reply { Status = status, Body = body });
        using var api = new HttpBasketApi(server.BaseUrl);
        var (file, path, dir) = OneFile();
        using var _ = dir;

        var r = await api.UploadFileAsync("T", path, file, null, null, default);

        Assert.Equal(outcome, r.Outcome);
        Assert.Equal(code, r.Code);
    }

    [Fact]
    public async Task A_200_that_is_not_the_expected_shape_is_unknown()
    {
        using var server = new FakeServer(_ => new Reply { Body = "{\"ok\":true}" });
        using var api = new HttpBasketApi(server.BaseUrl);
        var (file, path, dir) = OneFile();
        using var _ = dir;

        Assert.Equal(ApiOutcome.Unknown, (await api.UploadFileAsync("T", path, file, null, null, default)).Outcome);
    }

    [Fact]
    public async Task A_connection_that_drops_after_the_request_is_unknown_and_never_retried()
    {
        using var server = new FakeServer(_ => new Reply { DropAfterRead = true });
        using var api = new HttpBasketApi(server.BaseUrl);
        var (file, path, dir) = OneFile();
        using var _ = dir;

        var r = await api.UploadFileAsync("T", path, file, null, null, default);

        Assert.Equal(ApiOutcome.Unknown, r.Outcome);
        Assert.Single(server.Requests); // the HTTP layer itself did not replay the request
    }

    [Fact]
    public async Task Nothing_listening_means_not_reached()
    {
        using var api = new HttpBasketApi($"http://127.0.0.1:{FakeServer.UnusedPort()}");
        var (file, path, dir) = OneFile();
        using var _ = dir;

        var r = await api.UploadFileAsync("T", path, file, null, null, default);

        Assert.Equal(ApiOutcome.NotReached, r.Outcome);
    }

    [Fact]
    public async Task Whole_pipeline_unknown_over_real_http_is_not_resent()
    {
        using var server = new FakeServer(_ => new Reply { DropAfterRead = true });
        using var api = new HttpBasketApi(server.BaseUrl);
        using var dir = new TempDir();
        var store = new QueueStore(dir.Sub("q"));
        var history = new HistoryStore(dir.Sub("h.json"));
        var drop = new DropService(store, history);
        drop.Commit(drop.Inspect(new[] { DropSource.FromPath(dir.WriteFile("a.txt", "abc")) }, ""));
        var p = new QueueProcessor(store, history, api, new FixedAuth(FakeJwt));

        await p.RunOnceAsync(default);
        await p.RunOnceAsync(default);

        Assert.Single(server.Requests);
        Assert.Equal(ItemState.Unknown, store.List().Single().State);
    }

    [Fact]
    public async Task Text_note_reads_workspace_then_inserts_with_the_client_id()
    {
        var id = Guid.NewGuid();
        using var server = new FakeServer(req =>
            req.RequestLine.StartsWith("GET")
                ? new Reply { Body = "[{\"workspace_id\":\"ws-1\"}]" }
                : new Reply { Status = 201, Body = "" });
        using var api = new HttpBasketApi(server.BaseUrl);

        var r = await api.CreateNoteAsync(FakeJwt, id, "hello", default);

        Assert.Equal(ApiOutcome.Ok, r.Outcome);
        Assert.Contains("role=eq.owner", server.Requests[0].RequestLine);
        Assert.Contains("user_id=eq.11111111-2222-3333-4444-555555555555", server.Requests[0].RequestLine);
        var post = server.Requests[1];
        Assert.StartsWith("POST /rest/v1/app_notes ", post.RequestLine);
        var json = Encoding.UTF8.GetString(post.Body);
        Assert.Contains(id.ToString(), json);
        Assert.Contains("ws-1", json);
        Assert.Contains("hello", json);
    }

    [Fact]
    public async Task Text_note_duplicate_id_counts_as_already_saved()
    {
        using var server = new FakeServer(req =>
            req.RequestLine.StartsWith("GET")
                ? new Reply { Body = "[{\"workspace_id\":\"ws-1\"}]" }
                : new Reply { Status = 409, Body = "{\"code\":\"23505\",\"message\":\"duplicate key\"}" });
        using var api = new HttpBasketApi(server.BaseUrl);

        var r = await api.CreateNoteAsync(FakeJwt, Guid.NewGuid(), "hello", default);

        Assert.Equal(ApiOutcome.AlreadySaved, r.Outcome);
    }

    [Fact]
    public async Task Failed_workspace_lookup_never_writes()
    {
        using var server = new FakeServer(_ => new Reply { Status = 503, Body = "{}" });
        using var api = new HttpBasketApi(server.BaseUrl);

        var r = await api.CreateNoteAsync(FakeJwt, Guid.NewGuid(), "hello", default);

        Assert.Equal(ApiOutcome.NotReached, r.Outcome);
        Assert.All(server.Requests, q => Assert.StartsWith("GET", q.RequestLine));
    }

    [Fact]
    public void Plain_http_is_refused_except_for_loopback()
    {
        Assert.Throws<ArgumentException>(() => new HttpBasketApi("http://example.com"));
        using var ok = new HttpBasketApi("http://127.0.0.1:9");
    }
}
