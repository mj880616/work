using System.Drawing;

namespace BasketDrop;

/// <summary>
/// Where the desktop tile sits (the small "WORK ON+로" box that stays on the desktop, also after Win+D).
/// Pure arithmetic in physical pixels, tested without Windows. The saved place is the tile's top-left corner.
/// </summary>
public static class DesktopTileGeometry
{
    /// <summary>Size of the tile at 100% scale.</summary>
    public static readonly Size SizeAt96 = new(118, 96);

    /// <summary>Gap between the tile and the edge of the work area at 100% scale (default place only).</summary>
    public const int MarginAt96 = 16;

    /// <summary>S69-35: smallest and largest size (at 100% scale) the user can drag the tile to.</summary>
    public static readonly Size MinAt96 = new(96, 78);

    public static readonly Size MaxAt96 = new(360, 300);

    public static Size SizeFor(int dpi) => SizeFor(dpi, SizeAt96);

    /// <summary>The tile at <paramref name="at96"/> (size at 100% scale, kept within the limits) on a monitor with <paramref name="dpi"/>.</summary>
    public static Size SizeFor(int dpi, Size? at96)
    {
        var s = ClampAt96(at96);
        return new(CornerGeometry.Scale(s.Width, dpi), CornerGeometry.Scale(s.Height, dpi));
    }

    /// <summary>A saved size (null = never resized) kept within <see cref="MinAt96"/>..<see cref="MaxAt96"/>.</summary>
    public static Size ClampAt96(Size? at96)
    {
        if (at96 is not { } s || s.Width <= 0 || s.Height <= 0) return SizeAt96;
        return new(Math.Clamp(s.Width, MinAt96.Width, MaxAt96.Width), Math.Clamp(s.Height, MinAt96.Height, MaxAt96.Height));
    }

    /// <summary>A size in screen pixels on a monitor with <paramref name="dpi"/>, as the size at 100% scale that is saved.</summary>
    public static Size ToAt96(Size physical, int dpi)
    {
        var d = dpi <= 0 ? 96 : dpi;
        return ClampAt96(new Size((int)Math.Round(physical.Width * 96.0 / d), (int)Math.Round(physical.Height * 96.0 / d)));
    }

    /// <summary>The saved width and height as one size, or null when the tile was never resized.</summary>
    public static Size? Saved(int? width96, int? height96) =>
        width96 is int w && height96 is int h && w > 0 && h > 0 ? ClampAt96(new Size(w, h)) : null;

    /// <summary>
    /// How large the inside (icon, words) is drawn: screen pixels per pixel of the 100% layout (118 × 96). The smaller of
    /// the two ratios, so a wide or tall tile keeps everything inside. It does not depend on the scale: the size already does.
    /// </summary>
    public static float ContentScale(Size physical) =>
        Math.Max(0.1f, Math.Min(physical.Width / (float)SizeAt96.Width, physical.Height / (float)SizeAt96.Height));

    public static MonitorInfo? Primary(IReadOnlyList<MonitorInfo> monitors) =>
        monitors.FirstOrDefault(m => m.Primary) ?? monitors.FirstOrDefault();

    private static Rectangle Area(MonitorInfo m) => m.WorkingArea.IsEmpty ? m.Bounds : m.WorkingArea;

    /// <summary>Default place: top right of the primary monitor's work area (the taskbar is never covered).</summary>
    public static Rectangle DefaultRect(MonitorInfo m) => DefaultRect(m, null);

    public static Rectangle DefaultRect(MonitorInfo m, Size? at96)
    {
        var size = SizeFor(m.Dpi, at96);
        var gap = CornerGeometry.Scale(MarginAt96, m.Dpi);
        var area = Area(m);
        return new Rectangle(area.Right - size.Width - gap, area.Top + gap, size.Width, size.Height);
    }

    /// <summary>The monitor that holds the point, or null when the point is on no monitor.</summary>
    public static MonitorInfo? MonitorAt(Point p, IReadOnlyList<MonitorInfo> monitors) =>
        monitors.FirstOrDefault(m => m.Bounds.Contains(p));

    /// <summary>Keeps the whole tile inside the monitor's work area (never under the taskbar, never off screen).</summary>
    public static Rectangle Clamp(Rectangle r, MonitorInfo m)
    {
        var area = Area(m);
        var w = Math.Min(r.Width, area.Width);
        var h = Math.Min(r.Height, area.Height);
        var x = Math.Clamp(r.X, area.Left, area.Right - w);
        var y = Math.Clamp(r.Y, area.Top, area.Bottom - h);
        return new Rectangle(x, y, w, h);
    }

    /// <summary>
    /// The tile for a saved top-left corner. A place on a monitor that is gone (unplugged) falls back to the default
    /// place on the primary monitor; the saved value itself is kept, so plugging the monitor back brings the tile back.
    /// Null only when there is no monitor at all.
    /// </summary>
    public static (Rectangle Rect, MonitorInfo Monitor)? Place(int? x, int? y, IReadOnlyList<MonitorInfo> monitors, Size? at96 = null)
    {
        if (monitors.Count == 0) return null;
        if (x is int px && y is int py && MonitorAt(new Point(px, py), monitors) is { } m)
            return (Clamp(new Rectangle(new Point(px, py), SizeFor(m.Dpi, at96)), m), m);
        var primary = Primary(monitors)!;
        return (DefaultRect(primary, at96), primary);
    }

    /// <summary>
    /// After the tile was moved: the monitor under its centre decides the scale, and the tile is kept inside that
    /// monitor's work area. A centre on no monitor (pushed past the edge) uses the nearest monitor by distance.
    /// </summary>
    public static (Rectangle Rect, MonitorInfo Monitor)? AfterMove(Point topLeft, Size current, IReadOnlyList<MonitorInfo> monitors, Size? at96 = null)
    {
        if (monitors.Count == 0) return null;
        var center = new Point(topLeft.X + current.Width / 2, topLeft.Y + current.Height / 2);
        var m = MonitorAt(center, monitors) ?? monitors.OrderBy(o => Distance(o.Bounds, center)).First();
        return (Clamp(new Rectangle(topLeft, SizeFor(m.Dpi, at96)), m), m);
    }

    private static long Distance(Rectangle r, Point p)
    {
        long dx = p.X < r.Left ? r.Left - p.X : p.X >= r.Right ? p.X - r.Right + 1 : 0;
        long dy = p.Y < r.Top ? r.Top - p.Y : p.Y >= r.Bottom ? p.Y - r.Bottom + 1 : 0;
        return dx * dx + dy * dy;
    }
}

/// <summary>A press on the tile is a click (opens the file picker) until the pointer moves past a few pixels; then it moves the tile.</summary>
public static class TileGesture
{
    /// <summary>How far (at 100% scale) the pointer may wander during a click before the press becomes a move.</summary>
    public const int MoveThresholdAt96 = 5;

    public static bool IsMove(Point down, Point now, int threshold) =>
        Math.Abs(now.X - down.X) > threshold || Math.Abs(now.Y - down.Y) > threshold;
}

/// <summary>Window classes of the Windows desktop itself (wallpaper and icons). Win+D brings one of them to the front.</summary>
public static class DesktopShell
{
    public static bool IsDesktop(string? windowClass) => windowClass is "Progman" or "WorkerW";
}

/// <summary>S69-35: which part of the tile the pointer is on. A thin band at the edges resizes; the inside moves, drops and clicks.</summary>
public enum TileZone { Inside, Left, Right, Top, Bottom, TopLeft, TopRight, BottomLeft, BottomRight }

public static class TileHitTest
{
    /// <summary>Width of the resize band at 100% scale. Corners take twice that along each edge so they are easy to hit.</summary>
    public const int EdgeAt96 = 6;

    public static TileZone At(Point p, Size size, int edge)
    {
        if (size.Width <= 0 || size.Height <= 0 || edge <= 0) return TileZone.Inside;
        // A tile too small for two bands keeps at least a third of its width and height for moving and dropping.
        var ex = Math.Min(edge, size.Width / 3);
        var ey = Math.Min(edge, size.Height / 3);
        var cx = Math.Min(edge * 2, size.Width / 3);
        var cy = Math.Min(edge * 2, size.Height / 3);
        bool left = p.X < ex, right = p.X >= size.Width - ex, top = p.Y < ey, bottom = p.Y >= size.Height - ey;
        bool nearLeft = p.X < cx, nearRight = p.X >= size.Width - cx, nearTop = p.Y < cy, nearBottom = p.Y >= size.Height - cy;
        if ((top && nearLeft) || (left && nearTop)) return TileZone.TopLeft;
        if ((top && nearRight) || (right && nearTop)) return TileZone.TopRight;
        if ((bottom && nearLeft) || (left && nearBottom)) return TileZone.BottomLeft;
        if ((bottom && nearRight) || (right && nearBottom)) return TileZone.BottomRight;
        if (left) return TileZone.Left;
        if (right) return TileZone.Right;
        if (top) return TileZone.Top;
        if (bottom) return TileZone.Bottom;
        return TileZone.Inside;
    }
}

/// <summary>S69-35: two clicks close in time and place are a double click (opens the input window); one click alone opens the file picker.</summary>
public static class DoubleClickRule
{
    public static bool IsDouble(Point first, long firstMs, Point second, long secondMs, int maxMs, Size box) =>
        secondMs >= firstMs && secondMs - firstMs <= maxMs
        && Math.Abs(second.X - first.X) <= Math.Max(1, box.Width / 2)
        && Math.Abs(second.Y - first.Y) <= Math.Max(1, box.Height / 2);
}

/// <summary>S69-35: where the input window opens: next to the box it came from, always wholly on the screen.</summary>
public static class PastePlacement
{
    /// <summary>Below the box, else above, else left, else right; then kept inside the work area.</summary>
    public static Rectangle Near(Rectangle anchor, Size size, Rectangle area, int gap)
    {
        var w = Math.Min(size.Width, area.Width);
        var h = Math.Min(size.Height, area.Height);
        var x = anchor.Left + (anchor.Width - w) / 2;
        var y = anchor.Top + (anchor.Height - h) / 2;
        if (anchor.Bottom + gap + h <= area.Bottom) y = anchor.Bottom + gap;
        else if (anchor.Top - gap - h >= area.Top) y = anchor.Top - gap - h;
        else if (anchor.Left - gap - w >= area.Left) x = anchor.Left - gap - w;
        else if (anchor.Right + gap + w <= area.Right) x = anchor.Right + gap;
        x = Math.Clamp(x, area.Left, area.Right - w);
        y = Math.Clamp(y, area.Top, area.Bottom - h);
        return new Rectangle(x, y, w, h);
    }
}

/// <summary>S69-35: which frame of the program icon to draw for a size, so the picture is never stretched up (that blurs).</summary>
public static class IconFrames
{
    /// <summary>The frame sizes inside app.ico (tools/make-icon.py).</summary>
    public static readonly int[] InAppIcon = { 16, 20, 24, 32, 40, 48, 64, 256 };

    /// <summary>The exact size when there is one; otherwise the next larger frame (drawn smaller); the largest when none is larger.</summary>
    public static int Pick(int pixels, IReadOnlyList<int> available)
    {
        if (available.Count == 0) return pixels;
        var sorted = available.Where(a => a > 0).OrderBy(a => a).ToList();
        if (sorted.Count == 0) return pixels;
        foreach (var a in sorted) if (a >= pixels) return a;
        return sorted[^1];
    }
}

/// <summary>S69-35: the one-line notice after sending ("파일 2개 · 사진 1개 · 글").</summary>
public static class DropWords
{
    public static string What(int files, int pictures, bool text)
    {
        var parts = new List<string>();
        if (files > 0) parts.Add($"파일 {files}개");
        if (pictures > 0) parts.Add(files == 0 && !text && pictures == 1 ? "사진" : $"사진 {pictures}개");
        if (text) parts.Add("글");
        return parts.Count == 0 ? "없음" : string.Join(" · ", parts);
    }
}
