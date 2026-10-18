using System.Runtime.InteropServices;

namespace BasketDrop.App;

/// <summary>Message-only window that owns one global hotkey (Ctrl+Shift+B).</summary>
internal sealed class HotkeyWindow : NativeWindow, IDisposable
{
    private const int WmHotkey = 0x0312;
    private const uint ModControl = 0x2, ModShift = 0x4, ModNoRepeat = 0x4000;
    private static readonly IntPtr HwndMessage = new(-3);
    private const int HotkeyId = 0x4B42;

    public event Action? Pressed;
    public bool Registered { get; private set; }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint modifiers, uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    public HotkeyWindow()
    {
        CreateHandle(new CreateParams { Parent = HwndMessage });
        Registered = RegisterHotKey(Handle, HotkeyId, ModControl | ModShift | ModNoRepeat, (uint)Keys.B);
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WmHotkey && m.WParam.ToInt32() == HotkeyId) Pressed?.Invoke();
        else base.WndProc(ref m);
    }

    public void Dispose()
    {
        if (Registered) UnregisterHotKey(Handle, HotkeyId);
        Registered = false;
        DestroyHandle();
    }
}
