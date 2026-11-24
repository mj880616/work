using System.Runtime.InteropServices;
using System.Text;

namespace BasketDrop.App;

/// <summary>
/// Hot corner (design D1·D2, stage 3). A UI-thread timer reads only the pointer position and whether a mouse button
/// is held, every 50 ms; it installs no hook and never reads the keyboard or the clipboard. When the pointer rests in
/// the chosen corner (0.6 s, or 0.15 s while dragging) the drop box appears without taking focus, and it goes away
/// when the pointer leaves. A full-screen program on that monitor keeps it quiet.
/// </summary>
internal sealed class CornerWatcher : IDisposable
{
    private const int VkLButton = 0x01, VkRButton = 0x02;

    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 50 };
    private readonly CornerDetector _detector = new();
    private readonly CornerDropForm _box;
    private CornerChoice _corner;
    private MonitorInfo? _monitor;
    private DateTimeOffset _layoutAt = DateTimeOffset.MinValue;

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect { public int Left; public int Top; public int Right; public int Bottom; }

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out NativePoint point);

    // Mouse buttons only (VK_LBUTTON / VK_RBUTTON), to tell "dragging a file in" from "just resting". Never keys.
    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vk);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hwnd, out NativeRect rect);

    [DllImport("user32.dll")]
    private static extern bool IsZoomed(IntPtr hwnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);

    [DllImport("shell32.dll")]
    private static extern int SHQueryUserNotificationState(out int state);

    public CornerWatcher(TrayApp app, CornerChoice corner)
    {
        _box = new CornerDropForm(app);
        _box.Dropped += () => Close();
        _timer.Tick += (_, _) => Tick();
        Microsoft.Win32.SystemEvents.DisplaySettingsChanged += OnDisplayChanged;
        Apply(corner);
    }

    public CornerChoice Corner => _corner;

    public void Apply(CornerChoice corner)
    {
        _corner = corner;
        Close();
        _monitor = null;
        if (corner == CornerChoice.Off) _timer.Stop(); else _timer.Start();
    }

    private void OnDisplayChanged(object? sender, EventArgs e)
    {
        // Monitors were plugged, unplugged or rescaled: work the corner out again on the next tick.
        _monitor = null;
        Close();
    }

    private void Close()
    {
        if (_detector.Close() == CornerAction.Hide) _box.HideBox();
    }

    private void Tick()
    {
        var now = DateTimeOffset.Now;
        if (_monitor == null || now - _layoutAt > TimeSpan.FromSeconds(5))
        {
            _monitor = CornerGeometry.PickMonitor(MonitorList.All(), _corner);
            _layoutAt = now;
        }
        var m = _monitor;
        if (m == null || !GetCursorPos(out var p)) return;
        var pt = new Point(p.X, p.Y);
        var inHot = CornerGeometry.HotRect(m, _corner).Contains(pt);
        var keep = _detector.Visible && CornerGeometry.KeepOpenRect(m, _corner).Contains(pt);
        var button = (GetAsyncKeyState(VkLButton) & 0x8000) != 0 || (GetAsyncKeyState(VkRButton) & 0x8000) != 0;
        // Only ask Windows about full screen while the pointer is actually in the corner.
        var quiet = inHot && !_detector.Visible && IsQuiet(m);

        switch (_detector.Sample(now, inHot, keep, button, quiet, _box.HoldOpen))
        {
            case CornerAction.Show:
                _box.ShowBox(CornerGeometry.BoxRect(m, _corner), m.Dpi, _corner);
                break;
            case CornerAction.Hide:
                _box.HideBox();
                break;
        }
    }

    private static bool IsQuiet(MonitorInfo m)
    {
        if (SHQueryUserNotificationState(out var state) == 0 && FullscreenRule.IsQuietState(state)) return true;
        var fg = GetForegroundWindow();
        if (fg == IntPtr.Zero || !GetWindowRect(fg, out var r)) return false;
        var name = new StringBuilder(64);
        _ = GetClassName(fg, name, name.Capacity);
        return FullscreenRule.CoversMonitor(Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom), m.Bounds, name.ToString(), IsZoomed(fg));
    }

    public void Dispose()
    {
        Microsoft.Win32.SystemEvents.DisplaySettingsChanged -= OnDisplayChanged;
        _timer.Dispose();
        _box.Dispose();
    }
}
