using System.Runtime.InteropServices;
using System.Text;

namespace BasketDrop.App;

/// <summary>
/// Keeps the desktop tile (<see cref="DesktopTileForm"/>) on the desktop, also after Win+D (show desktop).
/// Two layers, because Windows has no official "desktop widget" window:
/// 1. The tile's owner window is set to the desktop window ("Progman"). An owned window always stays just above its
///    owner, so when Win+D brings the desktop to the front the tile comes with it, and any other window still covers it.
/// 2. A UI-thread timer (every 0.5 s) only looks at which window class is in front. While that is the desktop and the
///    desktop window covers the middle of the tile, it lifts the tile above the desktop (never topmost, never focused).
///    The same timer re-attaches the tile when Explorer restarts (the desktop window is replaced) and rebuilds it if
///    Windows destroyed it. It reads no keys, no clipboard and not the mouse.
/// The place is kept in settings.json (DesktopTileX/Y); a monitor that is gone falls back to the default place.
/// </summary>
internal sealed class DesktopTile : IDisposable
{
    private const int GwlpHwndParent = -8;
    private const uint SwpNoSize = 0x1, SwpNoMove = 0x2, SwpNoActivate = 0x10;
    private const int SwShowNoActivate = 4;
    private static readonly IntPtr HwndTop = IntPtr.Zero, HwndBottom = new(1);

    private readonly TrayApp _app;
    private readonly SettingsStore _settings;
    private readonly ILog _log;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 500 };
    private DesktopTileForm? _form;
    private IntPtr _owner;
    private IntPtr _attached; // the tile window the owner was set on (WinForms may rebuild a window handle)
    private bool _on;

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint { public int X; public int Y; }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindow(string className, string? windowName);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    private static extern IntPtr SetWindowLongPtr64(IntPtr hwnd, int index, IntPtr value);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongW")]
    private static extern int SetWindowLong32(IntPtr hwnd, int index, int value);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hwnd, int command);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern IntPtr WindowFromPoint(NativePoint point);

    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);

    public DesktopTile(TrayApp app, SettingsStore settings, ILog log, bool on)
    {
        _app = app;
        _settings = settings;
        _log = log;
        _timer.Tick += (_, _) => Tick();
        Microsoft.Win32.SystemEvents.DisplaySettingsChanged += OnDisplayChanged;
        Apply(on);
    }

    public bool On => _on;

    public void Apply(bool on)
    {
        _on = on;
        if (on)
        {
            Create();
            _timer.Start();
        }
        else
        {
            _timer.Stop();
            Destroy();
        }
    }

    private void Create()
    {
        if (_form is { IsDisposed: false, IsHandleCreated: true }) return;
        Destroy();
        var s = _settings.Load();
        if (DesktopTileGeometry.Place(s.DesktopTileX, s.DesktopTileY, MonitorList.All()) is not { } placed) return;
        var form = new DesktopTileForm(_app);
        form.Moved += OnMoved;
        form.Place(placed.Rect, placed.Monitor.Dpi);
        _form = form;
        var handle = form.Handle; // create the window before it is shown, so the owner is set first
        Attach(handle);
        form.Visible = true; // ShowWithoutActivation: shown without taking focus
        form.Place(placed.Rect, placed.Monitor.Dpi); // again, in case Windows moved it while it appeared on a monitor with another scale
        // Start behind every open window: the tile belongs to the desktop, not in front of the user's work.
        SetWindowPos(handle, HwndBottom, 0, 0, 0, 0, SwpNoMove | SwpNoSize | SwpNoActivate);
    }

    private void Destroy()
    {
        var form = _form;
        _form = null;
        _owner = IntPtr.Zero;
        _attached = IntPtr.Zero;
        if (form == null) return;
        form.Moved -= OnMoved;
        if (!form.IsDisposed) form.Dispose();
    }

    /// <summary>Makes the desktop window the tile's owner. Without a desktop window (Explorer not running yet) only layer 2 works until the next try.</summary>
    private void Attach(IntPtr handle)
    {
        _attached = handle;
        var desktop = FindWindow("Progman", null);
        if (desktop == IntPtr.Zero) { _owner = IntPtr.Zero; return; }
        if (IntPtr.Size == 8) SetWindowLongPtr64(handle, GwlpHwndParent, desktop);
        else SetWindowLong32(handle, GwlpHwndParent, desktop.ToInt32());
        _owner = desktop;
    }

    private void Tick()
    {
        if (!_on) return;
        var form = _form;
        // Windows destroys owned windows together with their owner (Explorer restarted): build the tile again.
        if (form == null || form.IsDisposed || !form.IsHandleCreated)
        {
            Create();
            return;
        }
        var handle = form.Handle;
        if (_owner == IntPtr.Zero || !IsWindow(_owner) || _attached != handle) Attach(handle);

        if (!DesktopShell.IsDesktop(ClassOf(GetForegroundWindow()))) return;
        // The desktop is in front (Win+D, or a click on the desktop). Bring the tile back if Windows hid it, and lift it
        // only when the desktop itself covers it; a window of the user's that covers it stays in front.
        if (!IsWindowVisible(handle) || IsIconic(handle)) ShowWindow(handle, SwShowNoActivate);
        var b = form.Bounds;
        var at = WindowFromPoint(new NativePoint { X = b.Left + b.Width / 2, Y = b.Top + b.Height / 2 });
        var root = at == IntPtr.Zero ? IntPtr.Zero : GetAncestor(at, 2 /* GA_ROOT */);
        if (root != IntPtr.Zero && root != handle && DesktopShell.IsDesktop(ClassOf(root)))
            SetWindowPos(handle, HwndTop, 0, 0, 0, 0, SwpNoMove | SwpNoSize | SwpNoActivate);
    }

    private static string ClassOf(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return "";
        var name = new StringBuilder(64);
        _ = GetClassName(hwnd, name, name.Capacity);
        return name.ToString();
    }

    private void OnMoved(Point topLeft)
    {
        var form = _form;
        if (form == null || form.IsDisposed) return;
        if (DesktopTileGeometry.AfterMove(topLeft, form.Size, MonitorList.All()) is not { } moved) return;
        form.Place(moved.Rect, moved.Monitor.Dpi);
        var s = _settings.Load();
        s.DesktopTileX = moved.Rect.X;
        s.DesktopTileY = moved.Rect.Y;
        try { _settings.Save(s); }
        catch (IOException) { _log.Write(LogCode.Error); }
    }

    private void OnDisplayChanged(object? sender, EventArgs e)
    {
        // Monitors were plugged, unplugged or rescaled: place the tile again from the saved place (the saved value is not changed).
        var form = _form;
        if (!_on || form == null || form.IsDisposed || !form.IsHandleCreated) return;
        try { form.BeginInvoke(new Action(PlaceFromSettings)); } catch (InvalidOperationException) { }
    }

    private void PlaceFromSettings()
    {
        var form = _form;
        if (!_on || form == null || form.IsDisposed) return;
        var s = _settings.Load();
        if (DesktopTileGeometry.Place(s.DesktopTileX, s.DesktopTileY, MonitorList.All()) is { } placed)
            form.Place(placed.Rect, placed.Monitor.Dpi);
    }

    public void Dispose()
    {
        Microsoft.Win32.SystemEvents.DisplaySettingsChanged -= OnDisplayChanged;
        _timer.Dispose();
        Destroy();
    }
}
