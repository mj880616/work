using System.Diagnostics;

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
}
