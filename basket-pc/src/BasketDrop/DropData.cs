using System.Drawing.Imaging;

namespace BasketDrop.App;

/// <summary>What was dragged onto one of the drop boxes (screen-corner box, desktop tile), and the one way it is sent.</summary>
internal sealed record DroppedItems(List<string> Files, string? Text, List<byte[]> Pngs)
{
    public bool IsEmpty => Files.Count == 0 && Text == null && Pngs.Count == 0;
}

/// <summary>
/// Shared by <see cref="CornerDropForm"/>, <see cref="DesktopTileForm"/> and the input window (<see cref="PasteForm"/>, S69-35): which drags are accepted, how a drop is
/// copied out, and sending it through <see cref="TrayApp.Submit"/>, the same gate as every other entry.
/// </summary>
internal static class DropData
{
    public static bool Accepts(IDataObject? data) =>
        data != null && (data.GetDataPresent(DataFormats.FileDrop) || data.GetDataPresent(DataFormats.UnicodeText)
                         || data.GetDataPresent(DataFormats.Text) || data.GetDataPresent(DataFormats.Bitmap));

    /// <summary>Files first; otherwise text; otherwise a picture (as PNG).</summary>
    public static DroppedItems Read(IDataObject? data)
    {
        var files = new List<string>();
        var pngs = new List<byte[]>();
        if (data == null) return new DroppedItems(files, null, pngs);
        if (data.GetData(DataFormats.FileDrop) is string[] paths)
            files.AddRange(paths.Where(p => !string.IsNullOrWhiteSpace(p)));
        string? text = null;
        if (files.Count == 0)
        {
            var t = data.GetData(DataFormats.UnicodeText) as string ?? data.GetData(DataFormats.Text) as string;
            if (t != null && t.Trim().Length > 0) text = t;
        }
        if (files.Count == 0 && text == null && PictureOf(data) is { } png) pngs.Add(png);
        return new DroppedItems(files, text, pngs);
    }

    /// <summary>A picture in a drag or on the clipboard, as PNG bytes: the program's own PNG when it gave one (keeps see-through parts), else the bitmap.</summary>
    public static byte[]? PictureOf(IDataObject data)
    {
        if (data.GetDataPresent("PNG") && data.GetData("PNG") is MemoryStream stream && stream.Length > 0)
        {
            try
            {
                stream.Position = 0;
                using var check = Image.FromStream(stream);
                return stream.ToArray();
            }
            catch (ArgumentException) { }
        }
        if (data.GetData(DataFormats.Bitmap) is Image image)
        {
            using var ms = new MemoryStream();
            image.Save(ms, ImageFormat.Png);
            return ms.ToArray();
        }
        return null;
    }

    public const string Unsupported = "이 형식은 보낼 수 없어요. 글·사진·파일만 보낼 수 있어요.";

    /// <summary>
    /// Files as file items, pictures as PNG file items, text as a text item, all through <see cref="TrayApp.Submit"/>.
    /// Returns true when something was queued. <paramref name="namePrefix"/> names the pictures ("끌어놓기", "붙여넣기").
    /// </summary>
    public static bool Send(TrayApp app, DroppedItems items, IWin32Window owner, string namePrefix = "끌어놓기")
    {
        var sources = items.Files.Select(DropSource.FromPath).ToList();
        var stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
        for (var i = 0; i < items.Pngs.Count; i++)
            sources.Add(DropSource.FromBytes(items.Pngs[i], items.Pngs.Count == 1 ? $"{namePrefix}-{stamp}.png" : $"{namePrefix}-{stamp}-{i + 1}.png"));
        if (!app.Submit(sources, items.Text ?? "", owner)) return false;
        app.ShowQueued(DropWords.What(items.Files.Count, items.Pngs.Count, items.Text != null));
        return true;
    }
}
