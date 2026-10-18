using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace BasketDrop.App;

internal sealed record ClipboardContent(IReadOnlyList<string> Files, string? Text, byte[]? Png)
{
    public bool IsEmpty => Files.Count == 0 && Text == null && Png == null;
}

/// <summary>
/// The only place that touches the Windows clipboard. It is called only when the user presses the hotkey or
/// pastes into the paste window; nothing watches the clipboard. Preference: copied files, then text, then a picture
/// (a spreadsheet cell offers both text and a picture; the text is the useful one, a screenshot has only a picture).
/// </summary>
internal static class ClipboardReader
{
    public static ClipboardContent Read()
    {
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                return ReadOnce();
            }
            catch (ExternalException) when (attempt < 4)
            {
                Thread.Sleep(80); // another program holds the clipboard for a moment
            }
        }
    }

    private static ClipboardContent ReadOnce()
    {
        var files = new List<string>();
        if (Clipboard.ContainsFileDropList())
            foreach (var f in Clipboard.GetFileDropList()) if (f != null) files.Add(f);
        string? text = null;
        if (files.Count == 0 && Clipboard.ContainsText())
        {
            var t = Clipboard.GetText();
            if (t.Trim().Length > 0) text = t;
        }
        byte[]? png = null;
        if (files.Count == 0 && text == null && Clipboard.ContainsImage())
        {
            using var image = Clipboard.GetImage();
            if (image != null)
            {
                using var ms = new MemoryStream();
                image.Save(ms, ImageFormat.Png);
                png = ms.ToArray();
            }
        }
        return new ClipboardContent(files, text, png);
    }

    public static string PictureName(DateTime now) => $"붙여넣기-{now:yyyyMMdd-HHmmss}.png";
}
