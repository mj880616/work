using System.Diagnostics;
using System.Runtime.InteropServices;

namespace BasketDrop.App;

/// <summary>
/// The door's only way to touch Windows. Paths reach here only after <see cref="PcPath"/> and <see cref="PcFiles.Find"/>
/// accepted them (plain drive path, no quote characters), and only documents on the open list are opened with their
/// program; folders open in Explorer and everything else is merely selected in Explorer.
/// </summary>
internal sealed class PcShell : IPcShell
{
    public void Open(string fullPath)
    {
        if (Directory.Exists(fullPath))
        {
            using var _ = Process.Start(new ProcessStartInfo("explorer.exe") { Arguments = "\"" + fullPath + "\"", UseShellExecute = false });
            return;
        }
        if (!PcPath.CanOpenDirectly(fullPath)) { Reveal(fullPath); return; }
        using var p = Process.Start(new ProcessStartInfo(fullPath) { UseShellExecute = true });
    }

    public void Reveal(string fullPath)
    {
        using var _ = Process.Start(new ProcessStartInfo("explorer.exe") { Arguments = "/select,\"" + fullPath + "\"", UseShellExecute = false });
    }

    // SHFileOperation FO_DELETE with FOF_ALLOWUNDO: the Windows recycle bin, never a permanent delete.
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ShFileOp
    {
        public IntPtr Hwnd;
        public uint Func;
        public string From;
        public string? To;
        public ushort Flags;
        public int AnyAborted;
        public IntPtr NameMappings;
        public string? ProgressTitle;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHFileOperation(ref ShFileOp op);

    private const uint FoDelete = 3;
    private const ushort FofSilent = 0x4, FofNoConfirmation = 0x10, FofAllowUndo = 0x40, FofNoErrorUi = 0x400, FofWantNukeWarning = 0x4000;

    /// <summary>
    /// One file or folder (already checked by <see cref="PcFiles.Find"/>; folders only from a door that can edit) to the recycle bin. If Windows cannot keep it in the bin
    /// (a network or removable drive), it asks instead of deleting for good (FOF_WANTNUKEWARNING).
    /// </summary>
    public bool Trash(string fullPath)
    {
        var folder = Directory.Exists(fullPath);
        if (!folder && !File.Exists(fullPath)) return false;
        var op = new ShFileOp
        {
            Func = FoDelete,
            From = fullPath + "\0\0", // the list ends with two NULs
            Flags = (ushort)(FofAllowUndo | FofNoConfirmation | FofSilent | FofNoErrorUi | FofWantNukeWarning),
        };
        return SHFileOperation(ref op) == 0 && op.AnyAborted == 0 && !(folder ? Directory.Exists(fullPath) : File.Exists(fullPath));
    }
}
