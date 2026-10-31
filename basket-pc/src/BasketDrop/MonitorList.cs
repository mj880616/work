using System.Runtime.InteropServices;

namespace BasketDrop.App;

/// <summary>All monitors in physical pixels (the program is per-monitor DPI aware) with each one's scale. Shared by the hot corner and the desktop tile.</summary>
internal static class MonitorList
{
    private const int MdtEffectiveDpi = 0;

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint { public int X; public int Y; }

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromPoint(NativePoint point, uint flags);

    [DllImport("shcore.dll")]
    private static extern int GetDpiForMonitor(IntPtr monitor, int type, out uint dpiX, out uint dpiY);

    public static List<MonitorInfo> All()
    {
        var list = new List<MonitorInfo>();
        foreach (var s in Screen.AllScreens)
        {
            var dpi = 96;
            var center = new NativePoint { X = s.Bounds.Left + s.Bounds.Width / 2, Y = s.Bounds.Top + s.Bounds.Height / 2 };
            var handle = MonitorFromPoint(center, 2 /* MONITOR_DEFAULTTONEAREST */);
            if (handle != IntPtr.Zero && GetDpiForMonitor(handle, MdtEffectiveDpi, out var dx, out _) == 0 && dx > 0) dpi = (int)dx;
            list.Add(new MonitorInfo(s.Bounds, s.WorkingArea, s.Primary, dpi));
        }
        return list;
    }
}
