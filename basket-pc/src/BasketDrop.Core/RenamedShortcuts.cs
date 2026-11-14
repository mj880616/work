namespace BasketDrop;

/// <summary>
/// The installer names its Start menu and desktop shortcuts after the program title. The title changed from
/// "BasketDrop" to "노조+ 업로드" (BASKET-노조플러스업로드), so a PC installed with the old title may still hold
/// "BasketDrop.lnk" next to the new one. Only that exact old file name is touched, and only in the folders given.
/// </summary>
public static class RenamedShortcuts
{
    /// <summary>The shortcut file name the installer used before the rename (old --packTitle).</summary>
    public const string OldFileName = "BasketDrop.lnk";

    /// <summary>The shortcut file name the installer uses now (--packTitle in .github/workflows/basket-pc-release.yml).</summary>
    public static string NewFileName => TrayStatus.Name + ".lnk";

    /// <summary>
    /// After an update: removes the old shortcut only where the new one is already there, so the PC never ends up
    /// with no shortcut at all (a folder where the user had removed the shortcut is left as it is).
    /// Returns how many were removed.
    /// </summary>
    public static int RemoveWhereReplaced(IEnumerable<string> folders)
    {
        var removed = 0;
        foreach (var folder in folders)
        {
            if (string.IsNullOrEmpty(folder)) continue;
            var old = Path.Combine(folder, OldFileName);
            if (File.Exists(old) && File.Exists(Path.Combine(folder, NewFileName)))
            {
                File.Delete(old);
                removed++;
            }
        }
        return removed;
    }

    /// <summary>On uninstall: the installer removes the shortcuts it knows by the new name; this removes the old name too.</summary>
    public static void RemoveOld(IEnumerable<string> folders)
    {
        foreach (var folder in folders)
        {
            if (string.IsNullOrEmpty(folder)) continue;
            var old = Path.Combine(folder, OldFileName);
            if (File.Exists(old)) File.Delete(old);
        }
    }
}
