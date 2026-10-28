namespace BasketDrop;

/// <summary>
/// Rules of the paste window kept out of the UI so they can be tested: what is sent, the status line and when
/// [보내기] is active. The window shows either the editable text box or one attachment (a picture or copied files)
/// with an optional one-line description.
/// </summary>
public static class PasteText
{
    public const string Placeholder = "여기에 붙여넣거나 바로 쓰기";
    public const string CaptionPlaceholder = "설명 한 줄(선택)";
    public const int MaxCaptionChars = 200;

    /// <summary>
    /// The text that goes into the basket. With an attachment it is the description line only (the upload's memo);
    /// without one it is exactly what the box shows, edits included. Whitespace-only counts as nothing.
    /// </summary>
    public static string Compose(string editorText, string caption, bool hasAttachment)
    {
        if (hasAttachment) return OneLine(caption).Trim();
        return editorText.Trim().Length == 0 ? "" : editorText;
    }

    /// <summary>[보내기] is active (and drawn dark) only when something would be sent.</summary>
    public static bool CanSend(string editorText, bool hasAttachment) =>
        hasAttachment || editorText.Trim().Length > 0;

    /// <summary>Lines as the user sees them: a final line break does not start a new counted line.</summary>
    public static int LineCount(string text)
    {
        if (text.Length == 0) return 0;
        var normalized = text.Replace("\r\n", "\n").Replace('\r', '\n');
        var lines = normalized.Split('\n').Length;
        if (normalized.EndsWith('\n')) lines--;
        return Math.Max(lines, 1);
    }

    /// <summary>Status line under the box: '글 · 4줄', '사진 · 1280×720', '파일 · 이름' or '파일 · 3개'. Empty when nothing is there.</summary>
    public static string TextStatus(string editorText) =>
        editorText.Trim().Length == 0 ? "" : $"글 · {LineCount(editorText)}줄";

    public static string PictureStatus(int width, int height) => $"사진 · {width}×{height}";

    public static string FilesStatus(IReadOnlyList<string> names) =>
        names.Count == 0 ? "" : names.Count == 1 ? $"파일 · {names[0]}" : $"파일 · {names.Count}개";

    /// <summary>Text pasted into the one-line description: line breaks become spaces.</summary>
    public static string OneLine(string text) =>
        text.Replace("\r\n", " ").Replace('\r', ' ').Replace('\n', ' ');
}
