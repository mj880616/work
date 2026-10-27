using System.Net;
using System.Text;
using Xunit;

namespace BasketDrop.Tests;

/// <summary>The updater trusts this repository's Basket PC releases and nothing else.</summary>
public class UpdateTests
{
    private static string Release(string tag, bool draft = false, bool prerelease = false) =>
        $"{{\"tag_name\":\"{tag}\",\"draft\":{(draft ? "true" : "false")},\"prerelease\":{(prerelease ? "true" : "false")}}}";

    private static string List(params string[] releases) => "[" + string.Join(",", releases) + "]";

    [Fact]
    public void The_newest_basket_pc_release_is_chosen()
    {
        var json = List(Release("basket-pc-v0.2.0"), Release("basket-pc-v0.10.0"), Release("basket-pc-v0.9.9"));
        Assert.Equal("basket-pc-v0.10.0", UpdatePolicy.PickTag(json));
    }

    [Theory]
    [InlineData("v9.9.9")]
    [InlineData("windows-app-v9.0.0")]
    [InlineData("basket-pc-v9.0.0-rc1")]
    [InlineData("basket-pc-v9.0.0.1")]
    [InlineData("basket-pc-v9.0")]
    [InlineData("Basket-PC-v9.0.0")]
    [InlineData("xbasket-pc-v9.0.0")]
    [InlineData("basket-pc-v9.0.0/../v1")]
    [InlineData("")]
    public void Releases_with_any_other_tag_are_never_chosen(string tag)
    {
        var json = List(Release(tag), Release("basket-pc-v0.1.0"));
        Assert.Equal("basket-pc-v0.1.0", UpdatePolicy.PickTag(json));
    }

    [Fact]
    public void Other_releases_alone_give_no_update()
    {
        Assert.Null(UpdatePolicy.PickTag(List(Release("v1.0.0"), Release("pages-2026-10-20"))));
        Assert.Null(UpdatePolicy.PickTag("[]"));
    }

    [Fact]
    public void Draft_prerelease_and_unclear_releases_are_skipped()
    {
        var json = List(
            Release("basket-pc-v9.0.0", draft: true),
            Release("basket-pc-v8.0.0", prerelease: true),
            "{\"tag_name\":\"basket-pc-v7.0.0\"}",
            "{\"tag_name\":\"basket-pc-v6.0.0\",\"draft\":\"no\",\"prerelease\":false}",
            Release("basket-pc-v0.1.0"));
        Assert.Equal("basket-pc-v0.1.0", UpdatePolicy.PickTag(json));
    }

    [Theory]
    [InlineData("")]
    [InlineData("not json")]
    [InlineData("{\"tag_name\":\"basket-pc-v1.0.0\"}")]
    [InlineData("[1,\"x\",null,{\"tag_name\":5}]")]
    public void A_list_that_is_not_understood_gives_no_update(string json)
    {
        Assert.Null(UpdatePolicy.PickTag(json));
    }

    [Fact]
    public void Files_come_only_from_this_repositorys_download_folder_of_the_chosen_tag()
    {
        const string tag = "basket-pc-v1.2.3";
        var baseUri = UpdatePolicy.ReleaseBase(tag);
        Assert.Equal("https://github.com/mj880616/work/releases/download/basket-pc-v1.2.3/", baseUri.AbsoluteUri);
        Assert.True(UpdatePolicy.IsReleaseFileRequest(new Uri(baseUri, "releases.win.json?x=1"), tag));
        Assert.True(UpdatePolicy.IsReleaseFileRequest(new Uri(baseUri, "BasketDropApp-1.2.3-full.nupkg"), tag));

        foreach (var bad in new[]
        {
            "http://github.com/mj880616/work/releases/download/basket-pc-v1.2.3/a.nupkg",          // not https
            "https://github.com/mj880616/work/releases/download/basket-pc-v1.2.4/a.nupkg",         // another tag of ours
            "https://github.com/mj880616/work/releases/download/v1.2.3/a.nupkg",                   // another kind of tag
            "https://github.com/mj880616/other/releases/download/basket-pc-v1.2.3/a.nupkg",        // another repository
            "https://github.com/someone/work/releases/download/basket-pc-v1.2.3/a.nupkg",          // another owner
            "https://github.com/mj880616/work/releases/latest/download/a.nupkg",                   // "latest" is never used
            "https://evil.example/mj880616/work/releases/download/basket-pc-v1.2.3/a.nupkg",       // another host
            "https://github.com:8443/mj880616/work/releases/download/basket-pc-v1.2.3/a.nupkg",    // another port
            "https://user@github.com/mj880616/work/releases/download/basket-pc-v1.2.3/a.nupkg",    // credentials in the address
            "https://github.com/mj880616/work/releases/download/basket-pc-v1.2.3/sub/a.nupkg",     // deeper path
            "https://github.com/mj880616/work/releases/download/basket-pc-v1.2.3/",                // no file
            "https://github.com/mj880616/work/releases/download/basket-pc-v1.2.3/%2e%2e/a.nupkg",  // encoded dots
        })
            Assert.False(UpdatePolicy.IsReleaseFileRequest(new Uri(bad), tag), bad);
    }

    [Fact]
    public void A_tag_that_is_not_ours_has_no_download_folder()
    {
        Assert.Throws<ArgumentException>(() => UpdatePolicy.ReleaseBase("v1.0.0"));
        Assert.False(UpdatePolicy.IsReleaseFileRequest(new Uri("https://github.com/mj880616/work/releases/download/v1.0.0/a"), "v1.0.0"));
    }

    [Fact]
    public void Only_the_release_list_of_this_repository_may_be_asked_for_first()
    {
        Assert.True(UpdatePolicy.IsReleaseListRequest(UpdatePolicy.ReleaseListUri));
        Assert.False(UpdatePolicy.IsReleaseListRequest(new Uri("https://api.github.com/repos/mj880616/other/releases")));
        Assert.False(UpdatePolicy.IsReleaseListRequest(new Uri("https://api.github.com/repos/mj880616/work/releases/latest")));
        Assert.False(UpdatePolicy.IsReleaseListRequest(new Uri("http://api.github.com/repos/mj880616/work/releases")));
    }

    [Fact]
    public void Redirects_may_only_go_to_githubs_file_hosts_over_https()
    {
        const string tag = "basket-pc-v1.2.3";
        Assert.True(UpdatePolicy.IsAllowedRedirect(new Uri("https://objects.githubusercontent.com/x/y?sig=1"), tag));
        Assert.True(UpdatePolicy.IsAllowedRedirect(new Uri("https://release-assets.githubusercontent.com/x"), tag));
        Assert.False(UpdatePolicy.IsAllowedRedirect(new Uri("http://objects.githubusercontent.com/x"), tag));
        Assert.False(UpdatePolicy.IsAllowedRedirect(new Uri("https://evil.example/x"), tag));
        Assert.False(UpdatePolicy.IsAllowedRedirect(new Uri("https://githubusercontent.com.evil.example/x"), tag));
        Assert.False(UpdatePolicy.IsAllowedRedirect(new Uri("https://raw.githubusercontent.com/mj880616/work/main/a"), tag));
    }

    // ---- the fetcher, with a fake network ----

    private sealed class FakeHandler : HttpMessageHandler
    {
        private readonly Func<Uri, HttpResponseMessage> _reply;
        public List<Uri> Requests { get; } = new();
        public FakeHandler(Func<Uri, HttpResponseMessage> reply) { _reply = reply; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add(request.RequestUri!);
            return Task.FromResult(_reply(request.RequestUri!));
        }
    }

    private static HttpResponseMessage Ok(string body) => new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8) };

    private static HttpResponseMessage Redirect(string to)
    {
        var r = new HttpResponseMessage(HttpStatusCode.Found);
        r.Headers.Location = new Uri(to);
        return r;
    }

    private const string Tag = "basket-pc-v1.2.3";
    private const string File1 = "https://github.com/mj880616/work/releases/download/basket-pc-v1.2.3/BasketDropApp-1.2.3-full.nupkg";

    [Fact]
    public async Task A_download_redirected_to_githubs_file_host_is_followed()
    {
        var handler = new FakeHandler(u => u.Host == "github.com" ? Redirect("https://release-assets.githubusercontent.com/blob?sig=1") : Ok("PAYLOAD"));
        using var fetcher = new TrustedFetcher(Tag, handler);
        var bytes = await fetcher.GetBytesAsync(new Uri(File1), 1024, CancellationToken.None);
        Assert.Equal("PAYLOAD", Encoding.UTF8.GetString(bytes));
        Assert.Equal(2, handler.Requests.Count);
    }

    [Fact]
    public async Task A_redirect_to_any_other_host_is_refused_and_never_requested()
    {
        var handler = new FakeHandler(_ => Redirect("https://evil.example/payload"));
        using var fetcher = new TrustedFetcher(Tag, handler);
        await Assert.ThrowsAsync<UpdateFetchException>(() => fetcher.GetBytesAsync(new Uri(File1), 1024, CancellationToken.None));
        Assert.Single(handler.Requests);
    }

    [Fact]
    public async Task A_redirect_down_to_plain_http_is_refused()
    {
        var handler = new FakeHandler(_ => Redirect("http://objects.githubusercontent.com/blob"));
        using var fetcher = new TrustedFetcher(Tag, handler);
        await Assert.ThrowsAsync<UpdateFetchException>(() => fetcher.GetBytesAsync(new Uri(File1), 1024, CancellationToken.None));
    }

    [Fact]
    public async Task A_request_for_another_release_is_refused_without_any_network_call()
    {
        var handler = new FakeHandler(_ => Ok("x"));
        using var fetcher = new TrustedFetcher(Tag, handler);
        foreach (var url in new[]
        {
            "https://github.com/mj880616/work/releases/download/basket-pc-v1.2.4/a.nupkg",
            "https://github.com/mj880616/work/releases/download/v1.2.3/a.nupkg",
            "https://github.com/mj880616/work/releases/latest/download/a.nupkg",
            "https://example.com/a.nupkg",
        })
            await Assert.ThrowsAsync<UpdateFetchException>(() => fetcher.GetBytesAsync(new Uri(url), 1024, CancellationToken.None));
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task Before_a_release_is_chosen_only_the_release_list_may_be_fetched()
    {
        var handler = new FakeHandler(_ => Ok("[]"));
        using var fetcher = new TrustedFetcher(null, handler);
        await Assert.ThrowsAsync<UpdateFetchException>(() => fetcher.GetBytesAsync(new Uri(File1), 1024, CancellationToken.None));
        Assert.Empty(handler.Requests);
        var bytes = await fetcher.GetBytesAsync(UpdatePolicy.ReleaseListUri, 1024, CancellationToken.None);
        Assert.Equal("[]", Encoding.UTF8.GetString(bytes));
    }

    [Fact]
    public async Task An_oversized_or_failed_download_is_an_error()
    {
        using var big = new TrustedFetcher(Tag, new FakeHandler(_ => Ok(new string('x', 5000))));
        await Assert.ThrowsAsync<UpdateFetchException>(() => big.GetBytesAsync(new Uri(File1), 1000, CancellationToken.None));
        using var missing = new TrustedFetcher(Tag, new FakeHandler(_ => new HttpResponseMessage(HttpStatusCode.NotFound)));
        await Assert.ThrowsAsync<UpdateFetchException>(() => missing.GetBytesAsync(new Uri(File1), 1000, CancellationToken.None));
    }
}
