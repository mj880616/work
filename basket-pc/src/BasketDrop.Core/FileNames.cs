using System.Text;

namespace BasketDrop;

/// <summary>
/// Cleans the file name shown in the basket and builds the multipart header that carries it.
/// History: basket-pc v0.2.0 wrote non-ASCII names as a MIME encoded word (<c>filename="=?utf-8?B?...?="</c>), which
/// the basket Edge function read as a single <c>"</c>. v0.2.1 (PR #918) sent the raw UTF-8 name in quotes like a
/// browser, but replaced <c>" \ ; =</c> with '_' because the server then cut quoted names at ';' and '='.
/// Since PR #925 (basket-files v9) the server reads quoted <c>filename=</c> properly (';' '=' inside quotes are
/// kept, <c>\"</c> and <c>\\</c> are unescaped), so the original name is sent: quoted-string with <c>"</c> and
/// <c>\</c> escaped by a backslash (RFC 6266 4.1 / RFC 7578 4.2).
/// No <c>filename*</c> (RFC 5987): RFC 7578 4.2 forbids it in form data and Node's form parser rejects the whole
/// request when it is present. An ASCII-only <c>filename</c> would lose the Korean name.
/// </summary>
public static class FileNames
{
    /// <summary>Used when nothing readable is left of a name; the original extension is kept after it.</summary>
    public const string Fallback = "파일";

    private const int MaxExtensionChars = 16;
    private static readonly char[] Separators = { '\\', '/' };

    /// <summary>
    /// Path with surrounding blanks and quotes removed (a path copied as text or passed by another program can be
    /// wrapped in quotes, e.g. <c>"C:\자료\이름.hwp"</c>).
    /// </summary>
    public static string CleanPath(string path)
    {
        var p = (path ?? "").Trim();
        while (p.Length >= 2 && p[0] == '"' && p[^1] == '"') p = p[1..^1].Trim();
        return p;
    }

    /// <summary>
    /// The name to show and send: NFC (names from macOS can arrive decomposed), no control characters, last path
    /// segment only (cut at '/' and, like the server, at '\'), no trailing dots or blanks, extension kept.
    /// Quotes, ';' and '=' stay in the name. A name with no letter or digit left (e.g. <c>"</c>, <c>___.hwp</c>,
    /// <c>.hwp</c>) becomes <see cref="Fallback"/> plus the original extension.
    /// </summary>
    public static string Clean(string? raw)
    {
        var s = DropBrokenSurrogates(raw ?? "");
        try { s = s.Normalize(NormalizationForm.FormC); }
        catch (ArgumentException) { /* already stripped of what Normalize rejects; keep as is */ }

        var sb = new StringBuilder(s.Length);
        foreach (var c in s)
            if (!char.IsControl(c) && !IsInvisibleFormat(c)) sb.Append(c);
        s = sb.ToString();

        var cut = s.LastIndexOfAny(Separators);
        if (cut >= 0) s = s[(cut + 1)..];
        s = s.Trim().TrimEnd('.', ' ').Trim();

        var (stem, ext) = Split(s);
        if (!stem.Any(char.IsLetterOrDigit)) return Fallback + ext;
        return s;
    }

    /// <summary>
    /// Content-Disposition for one file part, written like a browser form: <c>form-data; name="file";
    /// filename="UTF-8 name"</c>. The name is sent as cleaned (<see cref="Clean"/>); inside the quotes only
    /// <c>"</c> and <c>\</c> are escaped with a backslash. The part headers must be written as UTF-8.
    /// </summary>
    public static string ContentDisposition(string fieldName, string fileName) =>
        $"form-data; name=\"{fieldName}\"; filename=\"{EscapeQuoted(Clean(fileName))}\"";

    /// <summary>Content of an HTTP quoted-string: a backslash before every <c>"</c> and <c>\</c>.</summary>
    public static string EscapeQuoted(string value) => value.Replace("\\", "\\\\").Replace("\"", "\\\"");

    /// <summary>Stem and extension (with the dot). An extension is 1–16 letters or digits after the last dot.</summary>
    internal static (string Stem, string Ext) Split(string name)
    {
        var dot = name.LastIndexOf('.');
        if (dot < 0 || dot == name.Length - 1) return (name, "");
        var ext = name[dot..];
        if (ext.Length - 1 > MaxExtensionChars || !ext.Skip(1).All(char.IsLetterOrDigit)) return (name, "");
        return (name[..dot], ext);
    }

    // Zero-width and direction marks would hide part of a name; they are never meaningful in a file name here.
    private static bool IsInvisibleFormat(char c) =>
        c is '\u200B' or '\u200C' or '\u200D' or '\u200E' or '\u200F' or '\uFEFF'
        || (c >= '\u202A' && c <= '\u202E') || (c >= '\u2066' && c <= '\u2069');

    private static string DropBrokenSurrogates(string s)
    {
        var sb = new StringBuilder(s.Length);
        for (var i = 0; i < s.Length; i++)
        {
            var c = s[i];
            if (char.IsHighSurrogate(c))
            {
                if (i + 1 < s.Length && char.IsLowSurrogate(s[i + 1])) { sb.Append(c).Append(s[i + 1]); i++; }
                continue;
            }
            if (char.IsLowSurrogate(c)) continue;
            sb.Append(c);
        }
        return sb.ToString();
    }
}
