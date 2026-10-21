using System.Text;
using Xunit;

namespace BasketDrop.Tests;

/// <summary>
/// basket-pc v0.2.0 bug: a Korean HWP name reached the basket as a single '"' (download: "_ (1)", no extension).
/// The .NET multipart helper wrote the name as "=?utf-8?B?...?=". v0.2.1 sent the raw UTF-8 name but replaced
/// quote, backslash, ';' and '=' with '_'. Since basket-files v9 (PR #925) the server reads quoted names with ';'
/// '=' and backslash-escaped quotes, so the original name is sent. These tests pin the request bytes and read them
/// back with an RFC 6266 quoted-string reader (what the server's multipart.ts implements). The same header lines
/// are fed to the real server parser by tests/edge-isolation/basket-pc-filename.test.mjs (shared fixture).
/// </summary>
public class FileNameTests
{
    private const string Hwp = "연구 목적 및 면접조사 (최종).hwp";

    // ---- name cleaning ----

    [Theory]
    [InlineData(Hwp, Hwp)]
    [InlineData("C:\\자료\\" + Hwp, Hwp)]
    [InlineData("자료/하위/메모.txt", "메모.txt")]
    [InlineData("회의 (1) [최종] {수정}.hwpx", "회의 (1) [최종] {수정}.hwpx")]
    [InlineData("이름.hwp. . ", "이름.hwp")]
    [InlineData("줄\r\n바꿈\t.hwp", "줄바꿈.hwp")]
    [InlineData("숨김\u200B\u202E글자.pdf", "숨김글자.pdf")]
    [InlineData("a=b;c.txt", "a=b;c.txt")]
    [InlineData("회의록; 최종=v2 \"확정\".hwp", "회의록; 최종=v2 \"확정\".hwp")] // quotes, ';' and '=' are part of the name
    [InlineData("a\\b.txt", "b.txt")]                      // backslash is a Windows path separator; the server cuts there too
    [InlineData("dir/a.txt", "a.txt")]
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

    [Theory]
    [InlineData("\"C:\\자료\\" + Hwp + "\"")]        // path wrapped in quotes
    [InlineData("  \"C:\\자료\\" + Hwp + "\"  ")]
    public void FromPath_strips_quotes_from_the_path_and_the_name(string raw)
    {
        var src = DropSource.FromPath(raw);
        Assert.Equal("C:\\자료\\" + Hwp, src.Path);
        Assert.Equal(Hwp, src.DisplayName);
    }

    [Fact]
    public void FromPath_drops_a_stray_quote_left_at_the_end_of_a_path()
    {
        Assert.Equal(Hwp, DropSource.FromPath("C:\\자료\\" + Hwp + "\"").DisplayName);
        Assert.Equal("파일", DropSource.FromPath("C:\\자료\\\"").DisplayName);
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
        Assert.Equal(name, ReadFileName(h));
    }

    [Fact]
    public void Header_keeps_semicolon_equals_and_escapes_quotes()
    {
        var h = FileNames.ContentDisposition("file", "회의록; 최종=v2 \"확정\".hwp");
        Assert.Equal("form-data; name=\"file\"; filename=\"회의록; 최종=v2 \\\"확정\\\".hwp\"", h);
        Assert.Equal("회의록; 최종=v2 \"확정\".hwp", ReadFileName(h));
        Assert.Equal("a=b;c.txt", ReadFileName(FileNames.ContentDisposition("file", "a=b;c.txt")));
    }

    [Theory]
    [InlineData("plain", "plain")]
    [InlineData("a\"b", "a\\\"b")]
    [InlineData("a\\b", "a\\\\b")]
    [InlineData("\\\"", "\\\\\\\"")]
    [InlineData("a;b=c", "a;b=c")]
    public void EscapeQuoted_puts_a_backslash_before_quote_and_backslash_only(string raw, string escaped)
    {
        Assert.Equal(escaped, FileNames.EscapeQuoted(raw));
        Assert.Equal(raw, Unquote("\"" + escaped + "\""));
    }

    [Fact]
    public void Header_for_a_backslash_name_uses_the_last_segment_like_the_server()
    {
        Assert.Equal("b.txt", ReadFileName(FileNames.ContentDisposition("file", "a\\b.txt")));
    }

    [Fact]
    public void Header_for_a_quote_only_name_uses_the_fallback()
    {
        Assert.Equal("파일", ReadFileName(FileNames.ContentDisposition("file", "\"")));
    }

    [Fact]
    public void Header_never_contains_a_line_break()
    {
        var h = FileNames.ContentDisposition("file", "a\r\nContent-Type: x\r\n\r\n.txt");
        Assert.DoesNotContain('\r', h);
        Assert.DoesNotContain('\n', h);
    }

    /// <summary>The cases the Deno test feeds to the server's multipart parser: same file, same header text.</summary>
    [Fact]
    public void Header_matches_the_shared_fixture_used_by_the_server_cross_check()
    {
        var cases = LoadFixture();
        Assert.True(cases.Count >= 5);
        foreach (var (input, header, stored) in cases)
        {
            var h = FileNames.ContentDisposition("file", input);
            Assert.Equal(header, h);
            Assert.Equal(stored, ReadFileName(h));
        }
    }

    private static List<(string Input, string Header, string Stored)> LoadFixture()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "tests", "fixtures", "basket-pc-content-disposition.json")))
            dir = dir.Parent;
        Assert.NotNull(dir);
        using var doc = System.Text.Json.JsonDocument.Parse(File.ReadAllText(Path.Combine(dir!.FullName, "tests", "fixtures", "basket-pc-content-disposition.json"), Encoding.UTF8));
        return doc.RootElement.GetProperty("cases").EnumerateArray()
            .Select(c => (c.GetProperty("input").GetString()!, c.GetProperty("header").GetString()!, c.GetProperty("stored").GetString()!))
            .ToList();
    }

    // ---- the real request bytes ----

    [Theory]
    [InlineData(Hwp)]
    [InlineData("회의 \"초안\" (1).hwp")]
    [InlineData("회의록; 최종=v2 \"확정\".hwp")]
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
        Assert.Equal(FileNames.Clean(displayName), ReadFileName(value));
        Assert.Equal(displayName, FileNames.Clean(displayName)); // the original name goes out unchanged
        Assert.Contains("Content-Type: application/x-hwp", body);
        Assert.Contains("hwp bytes", body);
    }

    /// <summary>
    /// Reads filename="..." the way the basket-files multipart reader does: a quoted string ends at the first
    /// unescaped quote and a backslash inside it means "the next character as is"; ';' inside quotes is text.
    /// </summary>
    private static string ReadFileName(string contentDisposition)
    {
        var i = 0;
        while (i < contentDisposition.Length)
        {
            var eq = contentDisposition.IndexOf('=', i);
            Assert.True(eq > 0, "no filename parameter");
            var key = contentDisposition[i..eq].Trim(' ', ';');
            if (contentDisposition[eq + 1] == '"')
            {
                var sb = new StringBuilder();
                var j = eq + 2;
                for (; j < contentDisposition.Length && contentDisposition[j] != '"'; j++)
                {
                    if (contentDisposition[j] == '\\' && j + 1 < contentDisposition.Length) j++;
                    sb.Append(contentDisposition[j]);
                }
                Assert.True(j < contentDisposition.Length, "unterminated quoted string");
                Assert.True(j + 1 == contentDisposition.Length || contentDisposition[j + 1] == ';', "text after the closing quote");
                if (key == "filename") return sb.ToString();
                i = j + 1;
            }
            else
            {
                var semi = contentDisposition.IndexOf(';', eq);
                if (semi < 0) semi = contentDisposition.Length;
                if (key == "filename") return contentDisposition[(eq + 1)..semi];
                i = semi;
            }
        }
        throw new Xunit.Sdk.XunitException("no filename parameter");
    }

    private static string Unquote(string quoted)
    {
        var sb = new StringBuilder();
        for (var i = 1; i < quoted.Length - 1; i++)
        {
            if (quoted[i] == '\\') i++;
            sb.Append(quoted[i]);
        }
        return sb.ToString();
    }
}
