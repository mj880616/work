namespace BasketDrop;

/// <summary>
/// The installer names its Start menu and desktop shortcuts after the program title. The title changed from
/// "BasketDrop" to "노조+ 업로드" (BASKET-노조플러스업로드) and then to "노조+ 파일 올리기" (S63-09 PC도우미구분), so a PC
/// installed with an older title may still hold an old-name shortcut next to the new one. Only those exact old file
/// names are touched, and only in the folders given.
/// </summary>
public static class RenamedShortcuts
{
    /// <summary>The shortcut file names the installer used before (older --packTitle values), oldest first.</summary>
    public static readonly IReadOnlyList<string> OldFileNames = ["BasketDrop.lnk", "노조+ 업로드.lnk"];

    /// <summary>The shortcut file name the installer uses now (--packTitle in .github/workflows/basket-pc-release.yml).</summary>
    public static string NewFileName => TrayStatus.Name + ".lnk";

    /// <summary>
    /// After an update: removes an old shortcut only where the new one is already there, so the PC never ends up
    /// with no shortcut at all (a folder where the user had removed the shortcut is left as it is).
    /// Returns how many were removed.
    /// </summary>
    public static int RemoveWhereReplaced(IEnumerable<string> folders)
    {
        var removed = 0;
        foreach (var folder in folders)
        {
            if (string.IsNullOrEmpty(folder) || !File.Exists(Path.Combine(folder, NewFileName))) continue;
            foreach (var name in OldFileNames)
            {
                var old = Path.Combine(folder, name);
                if (!File.Exists(old)) continue;
                File.Delete(old);
                removed++;
            }
        }
        return removed;
    }

    /// <summary>On uninstall: the installer removes the shortcuts it knows by the new name; this removes the old names too.</summary>
    public static void RemoveOld(IEnumerable<string> folders)
    {
        foreach (var folder in folders)
        {
            if (string.IsNullOrEmpty(folder)) continue;
            foreach (var name in OldFileNames)
            {
                var old = Path.Combine(folder, name);
                if (File.Exists(old)) File.Delete(old);
            }
        }
    }
}
