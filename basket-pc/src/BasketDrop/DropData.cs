using System.Drawing.Imaging;

namespace BasketDrop.App;

/// <summary>What was dragged onto one of the drop boxes (hot corner box, desktop tile), and the one way it is sent.</summary>
internal sealed record DroppedItems(List<string> Files, string? Text, byte[]? Png)
{
    public bool IsEmpty => Files.Count == 0 && Text == null && Png == null;
}

/// <summary>
/// Shared by <see cref="CornerDropForm"/> and <see cref="DesktopTileForm"/>: which drags are accepted, how a drop is
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
        if (data == null) return new DroppedItems(files, null, null);
        if (data.GetData(DataFormats.FileDrop) is string[] paths)
            files.AddRange(paths.Where(p => !string.IsNullOrWhiteSpace(p)));
        string? text = null;
        if (files.Count == 0)
        {
            var t = data.GetData(DataFormats.UnicodeText) as string ?? data.GetData(DataFormats.Text) as string;
            if (t != null && t.Trim().Length > 0) text = t;
        }
        byte[]? png = null;
        if (files.Count == 0 && text == null && data.GetData(DataFormats.Bitmap) is Image image)
        {
            using var ms = new MemoryStream();
            image.Save(ms, ImageFormat.Png);
            png = ms.ToArray();
        }
        return new DroppedItems(files, text, png);
    }

    public const string Unsupported = "이 형식은 보낼 수 없어요. 글·사진·파일만 보낼 수 있어요.";

    public static void Send(TrayApp app, DroppedItems items, IWin32Window owner)
    {
        var sources = items.Files.Select(DropSource.FromPath).ToList();
        if (items.Png != null) sources.Add(DropSource.FromBytes(items.Png, $"끌어놓기-{DateTime.Now:yyyyMMdd-HHmmss}.png"));
        if (app.Submit(sources, items.Text ?? "", owner))
            ToastForm.Show(items.Files.Count > 0 ? $"대기열에 담았어요 (파일 {items.Files.Count}개)" : items.Text != null ? "대기열에 담았어요 (글)" : "대기열에 담았어요 (사진)");
    }
}
