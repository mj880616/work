using System.Drawing;

namespace BasketDrop;

/// <summary>
/// Where the desktop tile sits (the small "바구니로" box that stays on the desktop, also after Win+D).
/// Pure arithmetic in physical pixels, tested without Windows. The saved place is the tile's top-left corner.
/// </summary>
public static class DesktopTileGeometry
{
    /// <summary>Size of the tile at 100% scale.</summary>
    public static readonly Size SizeAt96 = new(118, 96);

    /// <summary>Gap between the tile and the edge of the work area at 100% scale (default place only).</summary>
    public const int MarginAt96 = 16;

    public static Size SizeFor(int dpi) => new(CornerGeometry.Scale(SizeAt96.Width, dpi), CornerGeometry.Scale(SizeAt96.Height, dpi));

    public static MonitorInfo? Primary(IReadOnlyList<MonitorInfo> monitors) =>
        monitors.FirstOrDefault(m => m.Primary) ?? monitors.FirstOrDefault();

    private static Rectangle Area(MonitorInfo m) => m.WorkingArea.IsEmpty ? m.Bounds : m.WorkingArea;

    /// <summary>Default place: top right of the primary monitor's work area (the taskbar is never covered).</summary>
    public static Rectangle DefaultRect(MonitorInfo m)
    {
        var size = SizeFor(m.Dpi);
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
    public static (Rectangle Rect, MonitorInfo Monitor)? Place(int? x, int? y, IReadOnlyList<MonitorInfo> monitors)
    {
        if (monitors.Count == 0) return null;
        if (x is int px && y is int py && MonitorAt(new Point(px, py), monitors) is { } m)
            return (Clamp(new Rectangle(new Point(px, py), SizeFor(m.Dpi)), m), m);
        var primary = Primary(monitors)!;
        return (DefaultRect(primary), primary);
    }

    /// <summary>
    /// After the tile was moved: the monitor under its centre decides the scale, and the tile is kept inside that
    /// monitor's work area. A centre on no monitor (pushed past the edge) uses the nearest monitor by distance.
    /// </summary>
    public static (Rectangle Rect, MonitorInfo Monitor)? AfterMove(Point topLeft, Size current, IReadOnlyList<MonitorInfo> monitors)
    {
        if (monitors.Count == 0) return null;
        var center = new Point(topLeft.X + current.Width / 2, topLeft.Y + current.Height / 2);
        var m = MonitorAt(center, monitors) ?? monitors.OrderBy(o => Distance(o.Bounds, center)).First();
        return (Clamp(new Rectangle(topLeft, SizeFor(m.Dpi)), m), m);
    }

    private static long Distance(Rectangle r, Point p)
    {
        long dx = p.X < r.Left ? r.Left - p.X : p.X >= r.Right ? p.X - r.Right + 1 : 0;
        long dy = p.Y < r.Top ? r.Top - p.Y : p.Y >= r.Bottom ? p.Y - r.Bottom + 1 : 0;
        return dx * dx + dy * dy;
    }
}

/// <summary>A press on the tile is a click (opens the paste window) until the pointer moves past a few pixels; then it moves the tile.</summary>
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
