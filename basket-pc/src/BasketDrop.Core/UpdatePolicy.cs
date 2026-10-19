using System.Text.Json;
using System.Text.RegularExpressions;

namespace BasketDrop;

/// <summary>
/// What the updater trusts: releases of this one repository whose tag is exactly <c>basket-pc-vX.Y.Z</c>,
/// neither draft nor pre-release. Everything else in the repository (other tags, other apps' releases) is never read.
/// All the address rules live here so they can be tested without a network.
/// </summary>
public static class UpdatePolicy
{
    private const string Owner = "mj880616";
    private const string Repo = "work";
    public const string TagPrefix = "basket-pc-v";

    private static readonly Regex TagPattern = new(@"^basket-pc-v(\d{1,4})\.(\d{1,4})\.(\d{1,4})$", RegexOptions.CultureInvariant);

    // Anything a release download may be redirected to; both are GitHub's own download hosts.
    private static readonly string[] RedirectHosts = { "objects.githubusercontent.com", "release-assets.githubusercontent.com" };

    public static Uri ReleaseListUri { get; } = new($"https://api.github.com/repos/{Owner}/{Repo}/releases?per_page=100");

    public static Version? ParseTag(string? tag)
    {
        var m = tag == null ? null : TagPattern.Match(tag);
        return m is { Success: true }
            ? new Version(int.Parse(m.Groups[1].Value), int.Parse(m.Groups[2].Value), int.Parse(m.Groups[3].Value))
            : null;
    }

    /// <summary>The newest acceptable tag in GitHub's release list, or null when there is none (or the list is not understood).</summary>
    public static string? PickTag(string releaseListJson)
    {
        try
        {
            using var doc = JsonDocument.Parse(releaseListJson);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return null;
            string? best = null;
            Version? bestVersion = null;
            foreach (var r in doc.RootElement.EnumerateArray())
            {
                if (r.ValueKind != JsonValueKind.Object) continue;
                if (!IsFalse(r, "draft") || !IsFalse(r, "prerelease")) continue;
                if (!r.TryGetProperty("tag_name", out var t) || t.ValueKind != JsonValueKind.String) continue;
                var tag = t.GetString();
                var v = ParseTag(tag);
                if (v == null || (bestVersion != null && v <= bestVersion)) continue;
                best = tag;
                bestVersion = v;
            }
            return best;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    // A missing or odd value counts as "not false", so an unclear release is skipped.
    private static bool IsFalse(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.False;

    /// <summary>The folder every file of that release is downloaded from.</summary>
    public static Uri ReleaseBase(string tag)
    {
        if (ParseTag(tag) == null) throw new ArgumentException("not a Basket PC release tag", nameof(tag));
        return new Uri($"https://github.com/{Owner}/{Repo}/releases/download/{tag}/");
    }

    private static bool PlainHttps(Uri u) =>
        u.IsAbsoluteUri && u.Scheme == Uri.UriSchemeHttps && u.IsDefaultPort && string.IsNullOrEmpty(u.UserInfo) && string.IsNullOrEmpty(u.Fragment);

    /// <summary>The release list request (the first step, before a tag is known).</summary>
    public static bool IsReleaseListRequest(Uri u) =>
        PlainHttps(u) && u.Host == ReleaseListUri.Host && u.AbsolutePath == ReleaseListUri.AbsolutePath;

    /// <summary>A file request for the chosen release: this repository's download folder of that tag, nothing else.</summary>
    public static bool IsReleaseFileRequest(Uri u, string tag)
    {
        if (ParseTag(tag) == null || !PlainHttps(u)) return false;
        var baseUri = ReleaseBase(tag);
        var path = u.AbsolutePath;
        return u.Host == baseUri.Host
            && path.StartsWith(baseUri.AbsolutePath, StringComparison.Ordinal)
            && path.Length > baseUri.AbsolutePath.Length
            && !path.Contains('%')
            && !path.Contains("..", StringComparison.Ordinal)
            && !path[baseUri.AbsolutePath.Length..].Contains('/');
    }

    /// <summary>Where GitHub may send a download afterwards (its own file hosts, over HTTPS).</summary>
    public static bool IsAllowedRedirect(Uri u, string? tag) =>
        PlainHttps(u) && (RedirectHosts.Contains(u.Host) || (tag != null && IsReleaseFileRequest(u, tag)));
}
