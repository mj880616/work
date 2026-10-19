namespace BasketDrop;

/// <summary>
/// A global shortcut the user can pick. Only a modifier plus one key (never a bare key); the key codes are
/// Windows virtual-key codes, which name the same physical key on a Korean and a US keyboard.
/// </summary>
public sealed record HotkeyChoice(string Id, string Label, uint Modifiers, uint VirtualKey)
{
    public const uint ModControl = 0x2;

    /// <summary>The key left of the number 1 (VK_OEM_3).</summary>
    public static readonly HotkeyChoice CtrlBacktick = new("CtrlBacktick", "Ctrl+`", ModControl, 0xC0);
    public static readonly HotkeyChoice CtrlQ = new("CtrlQ", "Ctrl+Q", ModControl, 0x51);
    public static readonly HotkeyChoice CtrlSpace = new("CtrlSpace", "Ctrl+Space", ModControl, 0x20);

    public static IReadOnlyList<HotkeyChoice> All { get; } = new[] { CtrlBacktick, CtrlQ, CtrlSpace };

    public static HotkeyChoice Default => CtrlBacktick;

    /// <summary>An unknown or hand-edited value in the settings file falls back to the default.</summary>
    public static HotkeyChoice FromId(string? id) => All.FirstOrDefault(c => c.Id == id) ?? Default;
}
