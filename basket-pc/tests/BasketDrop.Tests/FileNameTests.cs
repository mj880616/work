using System.Text;
using Xunit;

namespace BasketDrop.Tests;

/// <summary>
/// basket-pc v0.2.0 bug: a Korean HWP name reached the basket as a single '"' (download: "_ (1)", no extension).
/// The .NET multipart helper wrote the name as "=?utf-8?B?...?=" and the basket Edge function's form parser
/// (Deno formData) splits header parameters on '='. These tests pin the request bytes and read
/// them back with the same simple split the server uses.
/// </summary>
public class FileNameTests
{
    private const string Hwp = "연구 목적 및 면접조사 (최종).hwp";

    // ---- name cleaning ----

    [Theory]
    [InlineData(Hwp, Hwp)]
    [InlineData("\"C:\\자료\\연구 목적 및 면접조사 (최종).hwp\"", Hwp)]
    [InlineData("C:\\자료\\" + Hwp + "\"", Hwp)]          // a path that kept its closing quote
    [InlineData("  \"보고서.hwp\"  ", "보고서.hwp")]
    [InlineData("자료/하위/메모.txt", "메모.txt")]
    [InlineData("회의 (1) [최종] {수정}.hwpx", "회의 (1) [최종] {수정}.hwpx")]
    [InlineData("이름.hwp. . ", "이름.hwp")]
    [InlineData("줄\r\n바꿈\t.hwp", "줄바꿈.hwp")]
    [InlineData("숨김\u200B\u202E글자.pdf", "숨김글자.pdf")]
    [InlineData("a=b;c.txt", "a=b;c.txt")]                // kept in the name; only the header copy changes them
    public void Names_are_cleaned_and_keep_their_extension(string raw, string expected)
    {
        Assert.Equal(expected, FileNames.Clean(raw));
    }

    [Theory]
    [InlineData("\"", "파일")]
    [InlineData("", "파일")]
    [InlineData("   ", "파일")]
    [InlineData("\"\".hwp", "파일.hwp")]
    [InlineData("___.hwp", "파일.hwp")]
    [InlineData(".hwp", "파일.hwp")]
    [InlineData("C:\\자료\\\"", "파일")]
    [InlineData("C:\\자료\\", "파일")]
    public void Unreadable_names_become_the_fallback_with_the_original_extension(string raw, string expected)
    {
        Assert.Equal(expected, FileNames.Clean(raw));
    }

    [Fact]
    public void Decomposed_names_from_macOS_are_composed()
    {
        var nfd = Hwp.Normalize(NormalizationForm.FormD);
        Assert.NotEqual(Hwp, nfd); // the fixture really is decomposed
        var clean = FileNames.Clean(nfd);
        Assert.Equal(Hwp, clean);
        Assert.True(clean.IsNormalized(NormalizationForm.FormC));
    }

    [Fact]
    public void Broken_surrogates_are_dropped_and_pairs_kept()
    {
        Assert.Equal("ab.txt", FileNames.Clean("a\uD800b.txt"));
        Assert.Equal("😀 메모.txt", FileNames.Clean("😀 메모.txt"));
    }

    [Fact]
    public void FromPath_strips_quotes_from_the_path_and_the_name()
    {
        var src = DropSource.FromPath("\"C:\\자료\\" + Hwp + "\"");
        Assert.Equal("C:\\자료\\" + Hwp, src.Path);
        Assert.Equal(Hwp, src.DisplayName);
    }

    // ---- header ----

    [Theory]
    [InlineData(Hwp)]
    [InlineData("plain name.txt")]
    [InlineData("😀 메모 (2).txt")]
    public void Header_carries_the_utf8_name_like_a_browser(string name)
    {
        var h = FileNames.ContentDisposition("file", name);
        Assert.Equal($"form-data; name=\"file\"; filename=\"{name}\"", h);
        Assert.DoesNotContain("=?", h);
        Assert.DoesNotContain("filename*", h); // RFC 7578 4.2; Node's parser rejects the whole form with it
        Assert.Equal(name, ServerSplit(h)["filename"]);
    }

    [Fact]
    public void Characters_that_break_the_server_split_are_replaced_in_the_header()
    {
        Assert.Equal("a_b_c.txt", ServerSplit(FileNames.ContentDisposition("file", "a=b;c.txt"))["filename"]);
    }

    [Fact]
    public void Header_for_a_quote_only_name_uses_the_fallback()
    {
        Assert.Equal("파일", ServerSplit(FileNames.ContentDisposition("file", "\""))["filename"]);
    }

    // ---- the real request bytes ----

    [Theory]
    [InlineData(Hwp)]
    [InlineData("회의 \"초안\" (1).hwp")]
    public async Task Upload_sends_the_korean_name_as_utf8_that_the_server_reads_back(string displayName)
    {
        using var server = new FakeServer(_ => new Reply { Body = "{\"ok\":true,\"note_id\":\"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\",\"attachments\":[]}" });
        using var api = new HttpBasketApi(server.BaseUrl);
        using var dir = new TempDir();
        var path = dir.WriteFile("f0", "hwp bytes");
        var file = new QueueFile { StoredName = "f0", DisplayName = displayName, MimeType = "application/x-hwp", SizeBytes = 9, Sha256 = "AA" };

        var r = await api.UploadFileAsync("T", path, file, null, null, default);

        Assert.Equal(ApiOutcome.Ok, r.Outcome);
        var body = Encoding.UTF8.GetString(server.Requests[0].Body);
        var line = body.Split("\r\n").Single(l => l.StartsWith("Content-Disposition:", StringComparison.OrdinalIgnoreCase) && l.Contains("name=\"file\""));
        Assert.DoesNotContain("=?", line);
        Assert.DoesNotContain("\uFFFD", line); // no Latin-1 '?' / broken bytes
        var value = line["Content-Disposition:".Length..].Trim();
        Assert.Equal(FileNames.Clean(displayName), ServerSplit(value)["filename"]);
        Assert.Contains("Content-Type: application/x-hwp", body);
        Assert.Contains("hwp bytes", body);
    }

    /// <summary>
    /// The basket Edge function's form parser (Deno ext/fetch parseContentDisposition): split on ';', then each
    /// parameter on '=', take the second piece, strip one pair of surrounding quotes.
    /// </summary>
    private static Dictionary<string, string> ServerSplit(string contentDisposition)
    {
        var map = new Dictionary<string, string>();
        foreach (var part in contentDisposition.Split(';').Skip(1))
        {
            var entries = part.Trim().Split('=');
            if (entries.Length > 1)
            {
                var v = entries[1];
                map[entries[0]] = v.Length >= 2 && v[0] == '"' && v[^1] == '"' && !v[1..^1].Contains('"') ? v[1..^1] : v;
            }
        }
        return map;
    }
}
