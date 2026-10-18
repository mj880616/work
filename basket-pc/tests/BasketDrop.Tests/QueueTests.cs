using Xunit;

namespace BasketDrop.Tests;

public class QueueTests
{
    private const string FakeToken = "FAKE-TOKEN-do-not-leak-0123456789";

    private sealed class Rig : IDisposable
    {
        public TempDir Dir = new();
        public QueueStore Store;
        public HistoryStore History;
        public DropService Drop;
        public FakeApi Api = new();
        public string? Token = FakeToken;

        public Rig()
        {
            Store = new QueueStore(Dir.Sub("queue"));
            History = new HistoryStore(Dir.Sub("history.json"));
            Drop = new DropService(Store, History);
        }

        public QueueProcessor Processor(IAuthProvider? auth = null) => new(Store, History, Api, auth ?? new FixedAuth(Token));

        public QueueItem Enqueue(string text, params string[] names)
        {
            var sources = names.Select(n => DropSource.FromPath(Dir.WriteFile(n, "content of " + n))).ToList();
            var plan = Drop.Inspect(sources, text);
            return Drop.Commit(plan).First();
        }

        public void Dispose() => Dir.Dispose();
    }

    [Fact]
    public async Task Success_removes_queue_files_and_records_history()
    {
        using var r = new Rig();
        var item = r.Enqueue("memo", "a.txt", "b.txt");
        var finished = new List<ItemFinished>();
        var p = r.Processor();
        p.Finished += finished.Add;

        await p.RunOnceAsync(default);

        Assert.Empty(r.Store.List());
        Assert.False(Directory.Exists(r.Store.ItemDir(item.Id)));
        Assert.Equal(2, r.Api.Uploads.Count);
        Assert.Equal("memo", r.Api.Uploads[0].Text); // text rides with the first file only
        Assert.Null(r.Api.Uploads[1].Text);
        Assert.Null(r.Api.Uploads[0].NoteId);
        Assert.NotNull(r.Api.Uploads[1].NoteId); // second file joins the note made by the first
        var recent = r.History.Recent(5);
        Assert.Single(recent);
        Assert.Equal(2, recent[0].FileCount);
        Assert.Single(finished);
        Assert.Equal(FinishKind.Sent, finished[0].Kind);
    }

    [Fact]
    public async Task Unknown_result_is_never_resent_automatically()
    {
        using var r = new Rig();
        r.Enqueue("", "a.txt");
        r.Api.Script.Enqueue(new ApiResult(ApiOutcome.Unknown, "note_save_result_unknown"));
        var p = r.Processor();

        await p.RunOnceAsync(default);
        await p.RunOnceAsync(default);
        await p.RunOnceAsync(default);

        Assert.Equal(1, r.Api.Calls);
        Assert.Equal(ItemState.Unknown, r.Store.List().Single().State);
    }

    [Fact]
    public async Task Unknown_survives_restart_and_still_is_not_resent()
    {
        using var r = new Rig();
        var item = r.Enqueue("", "a.txt");
        item.State = ItemState.Sending; // process died while the request was in flight
        r.Store.Save(item);

        Assert.Equal(1, r.Store.RecoverInterrupted());
        await r.Processor().RunOnceAsync(default);

        Assert.Equal(0, r.Api.Calls);
        Assert.Equal(ItemState.Unknown, r.Store.List().Single().State);
    }

    [Fact]
    public async Task Not_reached_is_retried_with_growing_backoff_and_then_sent()
    {
        using var r = new Rig();
        r.Enqueue("", "a.txt");
        r.Api.Script.Enqueue(new ApiResult(ApiOutcome.NotReached, "not_reached"));
        r.Api.Script.Enqueue(new ApiResult(ApiOutcome.NotReached, "not_reached"));
        var p = r.Processor();

        var d1 = await p.RunOnceAsync(default);
        var d2 = await p.RunOnceAsync(default);
        Assert.Equal(TimeSpan.FromSeconds(15), d1);
        Assert.Equal(TimeSpan.FromSeconds(30), d2);
        Assert.Equal(ItemState.NotReached, r.Store.List().Single().State);

        var d3 = await p.RunOnceAsync(default);
        Assert.Null(d3);
        Assert.Empty(r.Store.List());
        Assert.Equal(3, r.Api.Calls);
    }

    [Fact]
    public void Backoff_is_capped_at_ten_minutes()
    {
        Assert.Equal(TimeSpan.FromMinutes(10), QueueProcessor.Backoff(50));
    }

    [Fact]
    public async Task Signed_out_keeps_items_and_files_and_sends_nothing()
    {
        using var r = new Rig();
        var item = r.Enqueue("hello", "a.txt");

        await r.Processor(new NotSignedInAuthProvider()).RunOnceAsync(default);

        Assert.Equal(0, r.Api.Calls);
        var kept = r.Store.List().Single();
        Assert.Equal(ItemState.LoginRequired, kept.State);
        Assert.True(File.Exists(r.Store.FilePath(kept, kept.Files[0])));

        // after sign-in the same item goes out
        await r.Processor().RunOnceAsync(default);
        Assert.Empty(r.Store.List());
        Assert.Single(r.Api.Uploads);
    }

    [Fact]
    public async Task Partial_progress_is_kept_and_resend_sends_only_the_rest_into_the_same_note()
    {
        using var r = new Rig();
        var item = r.Enqueue("memo", "a.txt", "b.txt", "c.txt");
        r.Api.Script.Enqueue(new ApiResult(ApiOutcome.Ok, "ok"));
        r.Api.Script.Enqueue(new ApiResult(ApiOutcome.Unknown, "timeout"));
        var p = r.Processor();

        await p.RunOnceAsync(default);
        var stuck = r.Store.List().Single();
        Assert.Equal(ItemState.Unknown, stuck.State);
        Assert.Equal(FileState.Done, stuck.Files[0].State);
        Assert.False(File.Exists(r.Store.FilePath(stuck, stuck.Files[0]))); // sent file's copy is gone at once
        Assert.NotNull(stuck.NoteId);

        p.Resend(stuck.Id);
        await p.RunOnceAsync(default);

        Assert.Empty(r.Store.List());
        Assert.Equal(new[] { "a.txt", "b.txt", "b.txt", "c.txt" }, r.Api.Uploads.Select(u => u.File));
        Assert.All(r.Api.Uploads.Skip(1), u => Assert.Equal(stuck.NoteId, u.NoteId));
    }

    [Fact]
    public async Task Rejected_stops_and_waits_for_the_user()
    {
        using var r = new Rig();
        r.Enqueue("", "a.txt");
        r.Api.Script.Enqueue(new ApiResult(ApiOutcome.Rejected, "file_too_large"));
        var p = r.Processor();

        await p.RunOnceAsync(default);
        await p.RunOnceAsync(default);

        Assert.Equal(1, r.Api.Calls);
        var item = r.Store.List().Single();
        Assert.Equal(ItemState.Rejected, item.State);
        Assert.Equal("file_too_large", item.ErrorCode);
        p.Discard(item.Id);
        Assert.Empty(r.Store.List());
    }

    [Fact]
    public async Task Text_only_memo_uses_its_fixed_id_and_a_repeat_counts_as_saved()
    {
        using var r = new Rig();
        var item = r.Enqueue("just words");
        Assert.True(item.TextOnly);
        var id = item.NoteId!.Value;
        r.Api.Script.Enqueue(new ApiResult(ApiOutcome.Unknown, "http_503"));
        var p = r.Processor();

        await p.RunOnceAsync(default);
        p.Resend(item.Id);
        r.Api.Script.Enqueue(new ApiResult(ApiOutcome.AlreadySaved, "already_saved"));
        await p.RunOnceAsync(default);

        Assert.Empty(r.Store.List());
        Assert.All(r.Api.Notes, n => Assert.Equal(id, n.Id)); // same id both times, so no second row can exist
        Assert.Equal(2, r.Api.Notes.Count);
    }

    [Fact]
    public async Task More_than_twenty_files_are_split_into_several_memos_with_text_on_the_first()
    {
        using var r = new Rig();
        var names = Enumerable.Range(0, 45).Select(i => $"f{i}.txt").ToArray();
        var sources = names.Select(n => DropSource.FromPath(r.Dir.WriteFile(n, "x" + n))).ToList();
        var items = r.Drop.Commit(r.Drop.Inspect(sources, "note"));

        Assert.Equal(new[] { 20, 20, 5 }, items.Select(i => i.Files.Count));
        Assert.Equal("note", items[0].RawText);
        Assert.Equal("", items[1].RawText);

        await r.Processor().RunOnceAsync(default);
        Assert.Empty(r.Store.List());
        Assert.Equal(45, r.Api.Uploads.Count);
    }

    [Fact]
    public void Limits_match_the_web_basket()
    {
        using var r = new Rig();
        var empty = r.Dir.WriteFile("empty.txt", "");
        var folder = r.Dir.Sub("dir");
        Directory.CreateDirectory(folder);
        var longName = new string('가', 256) + ".txt";
        var plan = r.Drop.Inspect(new[]
        {
            DropSource.FromPath(empty),
            DropSource.FromPath(folder),
            DropSource.FromPath(r.Dir.Sub("missing.bin")),
            DropSource.FromBytes(new byte[] { 1 }, longName),
        }, new string('a', Limits.MaxTextChars + 1));

        var kinds = plan.Problems.Select(p => p.Kind).ToHashSet();
        Assert.Contains(ProblemKind.Empty, kinds);
        Assert.Contains(ProblemKind.Folder, kinds);
        Assert.Contains(ProblemKind.Missing, kinds);
        Assert.Contains(ProblemKind.NameTooLong, kinds);
        Assert.Contains(ProblemKind.TextTooLong, kinds);
        Assert.Empty(plan.Files);
        Assert.Equal(104_857_600, Limits.MaxFileBytes);
    }

    [Fact]
    public void Line_breaks_count_as_two_characters_like_the_web_check()
    {
        Assert.Equal(7, Limits.TextLength("a\nb\nc"));
        Assert.Equal(7, Limits.TextLength("a\r\nb\r\nc"));
        Assert.Equal(2, Limits.TextLength("😀😀")); // Unicode characters, not UTF-16 units
    }

    [Fact]
    public void Upload_timeout_matches_the_web_budget()
    {
        Assert.Equal(TimeSpan.FromSeconds(94), Limits.UploadTimeout(1));
        Assert.Equal(TimeSpan.FromSeconds(490), Limits.UploadTimeout(Limits.MaxFileBytes));
        Assert.Equal(TimeSpan.FromMinutes(10), Limits.UploadTimeout(long.MaxValue / 4));
    }

    [Fact]
    public void Queue_cap_refuses_files_that_would_exceed_the_limit()
    {
        using var r = new Rig();
        var big = new QueueItem { Id = Guid.NewGuid(), CreatedAt = DateTimeOffset.Now, NoteId = Guid.NewGuid() };
        big.Files.Add(new QueueFile { StoredName = "f0", DisplayName = "x", SizeBytes = Limits.MaxQueueBytes - 5, Sha256 = "AA" });
        Directory.CreateDirectory(r.Store.ItemDir(big.Id));
        r.Store.Save(big);

        var plan = r.Drop.Inspect(new[] { DropSource.FromBytes(new byte[10], "ten.bin") }, "");

        Assert.Empty(plan.Files);
        Assert.Equal(ProblemKind.QueueFull, plan.Problems.Single().Kind);
    }

    [Fact]
    public async Task Same_file_again_is_flagged_as_duplicate_after_it_was_sent()
    {
        using var r = new Rig();
        var path = r.Dir.WriteFile("a.txt", "same bytes");
        r.Drop.Commit(r.Drop.Inspect(new[] { DropSource.FromPath(path) }, ""));
        await r.Processor().RunOnceAsync(default);

        var again = r.Drop.Inspect(new[] { DropSource.FromPath(path) }, "");
        Assert.Equal(new[] { "a.txt" }, again.Duplicates);
        var other = r.Drop.Inspect(new[] { DropSource.FromBytes(new byte[] { 9, 9 }, "b.bin") }, "");
        Assert.Empty(other.Duplicates);
    }

    [Fact]
    public void Program_like_files_are_flagged()
    {
        using var r = new Rig();
        var plan = r.Drop.Inspect(new[] { DropSource.FromBytes(new byte[] { 1 }, "setup.EXE"), DropSource.FromBytes(new byte[] { 1 }, "a.png") }, "");
        Assert.Equal(new[] { "setup.EXE" }, plan.Risky);
    }

    [Fact]
    public async Task Stale_items_are_reported_after_seven_days()
    {
        using var r = new Rig();
        var item = r.Enqueue("", "a.txt");
        item.CreatedAt = DateTimeOffset.Now.AddDays(-8);
        r.Store.Save(item);
        Assert.Single(r.Store.Stale(DateTimeOffset.Now));
        await Task.CompletedTask;
    }

    [Fact]
    public async Task No_token_or_secret_text_is_left_on_disk_or_in_the_log()
    {
        using var r = new Rig();
        var logPath = r.Dir.Sub("log.txt");
        var log = new FileLog(logPath);
        r.Enqueue("secret memo text", "private-name.txt");
        r.Api.Script.Enqueue(new ApiResult(ApiOutcome.Unknown, "timeout"));
        var p = new QueueProcessor(r.Store, r.History, r.Api, new FixedAuth(FakeToken), log);
        await p.RunOnceAsync(default);
        p.Resend(r.Store.List().Single().Id);
        await p.RunOnceAsync(default);
        log.Write(LogCode.Error, 1);

        foreach (var file in Directory.EnumerateFiles(r.Dir.Path, "*", SearchOption.AllDirectories))
        {
            var text = File.ReadAllText(file);
            Assert.DoesNotContain(FakeToken, text);
            Assert.DoesNotContain("eyJ", text); // no JWT-looking value either
            if (Path.GetFileName(file) is "log.txt") { Assert.DoesNotContain("private-name", text); Assert.DoesNotContain("secret memo", text); }
        }
        Assert.True(File.Exists(logPath));
    }
}
