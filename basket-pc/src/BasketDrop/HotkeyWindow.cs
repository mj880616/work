using System.Runtime.InteropServices;

namespace BasketDrop.App;

/// <summary>
/// Message-only window that owns one global hotkey, registered with the system's RegisterHotKey. It never watches
/// keystrokes in general (no keyboard hook): Windows tells it only when the chosen combination is pressed.
/// </summary>
internal sealed class HotkeyWindow : NativeWindow, IDisposable
{
    private const int WmHotkey = 0x0312;
    private const uint ModNoRepeat = 0x4000;
    private static readonly IntPtr HwndMessage = new(-3);
    // Two ids, used alternately, so a new combination can be registered before the old one is let go.
    private static readonly int[] HotkeyIds = { 0x4B42, 0x4B43 };
    private int _currentId = -1;

    public event Action? Pressed;
    public HotkeyChoice? Current { get; private set; }
    public bool Registered => Current != null;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint modifiers, uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    public HotkeyWindow(HotkeyChoice choice)
    {
        CreateHandle(new CreateParams { Parent = HwndMessage });
        TryChange(choice);
    }

    /// <summary>Switches to another combination. When Windows refuses (another program uses it) the current one stays.</summary>
    public bool TryChange(HotkeyChoice choice)
    {
        if (Current == choice) return true;
        var id = HotkeyIds.First(i => i != _currentId);
        if (!RegisterHotKey(Handle, id, choice.Modifiers | ModNoRepeat, choice.VirtualKey)) return false;
        if (_currentId >= 0) UnregisterHotKey(Handle, _currentId);
        _currentId = id;
        Current = choice;
        return true;
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WmHotkey && Registered && m.WParam.ToInt32() == _currentId) Pressed?.Invoke();
        else base.WndProc(ref m);
    }

    public void Dispose()
    {
        if (Registered) UnregisterHotKey(Handle, _currentId);
        Current = null;
        DestroyHandle();
    }
}
