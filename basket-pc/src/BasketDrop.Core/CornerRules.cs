using System.Drawing;

namespace BasketDrop;

/// <summary>Which screen corner opens the drop box (design D1). Off turns the corner watcher off entirely.</summary>
public enum CornerChoice
{
    TopRight,
    BottomRight,
    Off,
}

public static class CornerChoices
{
    public static CornerChoice Default => CornerChoice.TopRight;

    /// <summary>An unknown or hand-edited value in the settings file falls back to the default.</summary>
    public static CornerChoice FromId(string? id) =>
        Enum.TryParse<CornerChoice>(id, ignoreCase: false, out var c) && Enum.IsDefined(c) ? c : Default;

    public static string Label(CornerChoice c) => c switch
    {
        CornerChoice.TopRight => "오른쪽 위",
        CornerChoice.BottomRight => "오른쪽 아래",
        _ => "끄기",
    };
}

/// <summary>One monitor as the corner code sees it: whole area, area without the taskbar, scale in DPI.</summary>
public sealed record MonitorInfo(Rectangle Bounds, Rectangle WorkingArea, bool Primary, int Dpi = 96);

/// <summary>Where the hot corner and the drop box are. Pure arithmetic in physical pixels, tested without Windows.</summary>
public static class CornerGeometry
{
    /// <summary>Size of the invisible hot square at 100% scale. The pointer stops in a real corner, so a few pixels are enough.</summary>
    public const int HotSizeAt96 = 6;

    /// <summary>Size of the drop box at 100% scale.</summary>
    public static readonly Size BoxSizeAt96 = new(240, 132);

    /// <summary>Gap between the box and the screen edge at 100% scale.</summary>
    public const int BoxMarginAt96 = 8;

    public static int Scale(int value, int dpi) => (int)Math.Round(value * (dpi <= 0 ? 96 : dpi) / 96.0);

    /// <summary>
    /// The monitor whose chosen corner is a real dead end for the pointer (no other monitor touches it), so the pointer
    /// stops there. The primary monitor wins when its corner qualifies (design D1); otherwise the outermost one in that
    /// direction (e.g. an external monitor on the right of a laptop). Null when there is no monitor or the corner is off.
    /// </summary>
    public static MonitorInfo? PickMonitor(IReadOnlyList<MonitorInfo> monitors, CornerChoice corner)
    {
        if (corner == CornerChoice.Off || monitors.Count == 0) return null;
        var dead = monitors.Where(m => IsDeadEnd(monitors, m, corner)).ToList();
        if (dead.Count == 0) return monitors.FirstOrDefault(m => m.Primary) ?? monitors[0];
        return dead.FirstOrDefault(m => m.Primary)
            ?? dead.OrderByDescending(m => m.Bounds.Right)
                   .ThenBy(m => corner == CornerChoice.TopRight ? m.Bounds.Top : -m.Bounds.Bottom)
                   .First();
    }

    /// <summary>True when the pixels just past the corner (right, diagonal, and above/below) are on no monitor.</summary>
    public static bool IsDeadEnd(IReadOnlyList<MonitorInfo> monitors, MonitorInfo m, CornerChoice corner)
    {
        var x = m.Bounds.Right - 1;
        var y = corner == CornerChoice.TopRight ? m.Bounds.Top : m.Bounds.Bottom - 1;
        var dy = corner == CornerChoice.TopRight ? -1 : 1;
        var beyond = new[] { new Point(x + 1, y), new Point(x + 1, y + dy), new Point(x, y + dy) };
        return !monitors.Any(o => beyond.Any(p => o.Bounds.Contains(p)));
    }

    /// <summary>The small square at the very corner of the monitor (whole screen, taskbar included).</summary>
    public static Rectangle HotRect(MonitorInfo m, CornerChoice corner)
    {
        var s = Scale(HotSizeAt96, m.Dpi);
        var x = m.Bounds.Right - s;
        var y = corner == CornerChoice.TopRight ? m.Bounds.Top : m.Bounds.Bottom - s;
        return new Rectangle(x, y, s, s);
    }

    /// <summary>The drop box, inside the area that the taskbar does not cover, next to the chosen corner.</summary>
    public static Rectangle BoxRect(MonitorInfo m, CornerChoice corner)
    {
        var w = Scale(BoxSizeAt96.Width, m.Dpi);
        var h = Scale(BoxSizeAt96.Height, m.Dpi);
        var gap = Scale(BoxMarginAt96, m.Dpi);
        var area = m.WorkingArea.IsEmpty ? m.Bounds : m.WorkingArea;
        var x = area.Right - w - gap;
        var y = corner == CornerChoice.TopRight ? area.Top + gap : area.Bottom - h - gap;
        return new Rectangle(x, y, w, h);
    }

    /// <summary>
    /// The area the pointer may stay in while the box is open: the box, the hot corner and the path between them,
    /// plus a margin. Leaving it for a moment closes the box.
    /// </summary>
    public static Rectangle KeepOpenRect(MonitorInfo m, CornerChoice corner)
    {
        var r = Rectangle.Union(BoxRect(m, corner), HotRect(m, corner));
        var margin = Scale(16, m.Dpi);
        r.Inflate(margin, margin);
        r.Intersect(m.Bounds);
        return r;
    }
}

/// <summary>
/// A full-screen program (video, game, slide show) owns the whole monitor. Then the corner must stay quiet (design D2).
/// The desktop itself also covers the monitor, so its window classes are not counted.
/// </summary>
public static class FullscreenRule
{
    private static readonly string[] DesktopClasses = { "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd" };

    /// <summary>
    /// A maximized window is an ordinary window even when the taskbar hides itself and the window then covers the
    /// whole monitor, so it never counts as full screen.
    /// </summary>
    public static bool CoversMonitor(Rectangle window, Rectangle monitor, string? windowClass, bool maximized = false)
    {
        if (maximized || window.IsEmpty || monitor.IsEmpty) return false;
        if (windowClass != null && DesktopClasses.Contains(windowClass, StringComparer.Ordinal)) return false;
        return window.Left <= monitor.Left && window.Top <= monitor.Top && window.Right >= monitor.Right && window.Bottom >= monitor.Bottom;
    }

    /// <summary>Windows' own "do not disturb" answer (SHQueryUserNotificationState): 2 busy full screen, 3 Direct3D full screen, 4 presentation.</summary>
    public static bool IsQuietState(int userNotificationState) => userNotificationState is 2 or 3 or 4;
}

/// <summary>
/// Decides when the box appears and disappears. It is fed one sample per timer tick and returns what to do.
/// Appear: the pointer stays in the hot corner 0.6 s, or 0.15 s while a mouse button is held (dragging a file in).
/// After the box closes, the pointer must leave the corner before it can open again (no flicker loop).
/// Disappear: the pointer stays outside the keep-open area for 0.4 s, unless something is being dropped.
/// </summary>
public sealed class CornerDetector
{
    public static readonly TimeSpan HoverDelay = TimeSpan.FromMilliseconds(600);
    public static readonly TimeSpan DragDelay = TimeSpan.FromMilliseconds(150);
    public static readonly TimeSpan LeaveDelay = TimeSpan.FromMilliseconds(400);

    private DateTimeOffset? _enteredAt;
    private DateTimeOffset? _leftAt;
    private bool _needsLeave;

    public bool Visible { get; private set; }

    public CornerAction Sample(DateTimeOffset now, bool inHot, bool inKeepOpen, bool buttonDown, bool quiet, bool holdOpen = false)
    {
        if (Visible)
        {
            if (holdOpen || inKeepOpen || inHot)
            {
                _leftAt = null;
                return CornerAction.None;
            }
            _leftAt ??= now;
            if (now - _leftAt.Value < LeaveDelay) return CornerAction.None;
            return Close();
        }

        if (!inHot || quiet)
        {
            _enteredAt = null;
            if (!inHot) _needsLeave = false;
            return CornerAction.None;
        }
        if (_needsLeave) return CornerAction.None;
        _enteredAt ??= now;
        if (now - _enteredAt.Value < (buttonDown ? DragDelay : HoverDelay)) return CornerAction.None;
        Visible = true;
        _leftAt = null;
        return CornerAction.Show;
    }

    /// <summary>Close from outside (drop done, setting changed, full screen started).</summary>
    public CornerAction Close()
    {
        if (!Visible) return CornerAction.None;
        Visible = false;
        _enteredAt = null;
        _leftAt = null;
        _needsLeave = true;
        return CornerAction.Hide;
    }
}

public enum CornerAction
{
    None,
    Show,
    Hide,
}
