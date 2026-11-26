namespace BasketDrop;

/// <summary>
/// S69(사용자 11/24: 파일 올리기 트레이 아이콘이 아직 옛 그림): when the program picture changes, an updated PC shows the
/// new picture in the tray, title bars and taskbar at once (they come from the new exe's own resources), but Windows may keep
/// showing the old picture for the Start menu and desktop shortcuts from its icon cache, because the exe path does not change.
/// So once per picture revision the installed program tells Windows that those shortcuts and the exe changed
/// (TrayApp → ShellIcons.Refresh). Nothing is created or deleted; only the shortcut the installer made under the current
/// name (<see cref="RenamedShortcuts.NewFileName"/>) is touched. The user never has to clear any cache.
/// </summary>
public static class IconRefresh
{
    /// <summary>
    /// The picture in basket-pc/icon/basket-icon.svg. 1 = 노조+ basket picture (up to 0.8.0), 2 = WORK ON+ mark (0.8.1, S69).
    /// Raise it whenever tools/make-icon.py writes a different picture.
    /// </summary>
    public const int Revision = 2;

    /// <summary>True until this PC has refreshed the shortcut pictures for <see cref="Revision"/>.</summary>
    public static bool Due(AppSettings settings) => settings.IconRevision < Revision;

    /// <summary>The installer's shortcuts (current name) that exist in the given folders.</summary>
    public static IReadOnlyList<string> Shortcuts(IEnumerable<string> folders) =>
        folders.Where(f => !string.IsNullOrEmpty(f))
            .Select(f => Path.Combine(f, RenamedShortcuts.NewFileName))
            .Where(File.Exists)
            .ToList();
}
