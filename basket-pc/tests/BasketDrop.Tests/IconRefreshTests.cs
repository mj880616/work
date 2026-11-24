using Xunit;

namespace BasketDrop.Tests;

public class IconRefreshTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "bd-icon-" + Guid.NewGuid().ToString("N"));
    private string Start => Path.Combine(_root, "start");
    private string Desk => Path.Combine(_root, "desk");

    public IconRefreshTests()
    {
        Directory.CreateDirectory(Start);
        Directory.CreateDirectory(Desk);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }

    [Fact]
    public void A_pc_that_never_refreshed_is_due_once_and_then_not()
    {
        var s = new AppSettings();
        Assert.True(IconRefresh.Due(s));
        s.IconRevision = IconRefresh.Revision;
        Assert.False(IconRefresh.Due(s));
    }

    [Fact]
    public void The_revision_survives_a_restart_and_older_settings_files_start_at_zero()
    {
        var path = Path.Combine(_root, "settings.json");
        File.WriteAllText(path, "{\"AutoStart\":true,\"AutoStartDecided\":true}");
        var store = new SettingsStore(path);
        Assert.Equal(0, store.Load().IconRevision);
        var s = store.Load();
        s.IconRevision = IconRefresh.Revision;
        store.Save(s);
        Assert.False(IconRefresh.Due(new SettingsStore(path).Load()));
    }

    [Fact]
    public void Only_the_current_name_shortcuts_that_exist_are_touched()
    {
        File.WriteAllText(Path.Combine(Start, RenamedShortcuts.NewFileName), "");
        File.WriteAllText(Path.Combine(Desk, "노조+ 파일 올리기.lnk"), "");
        var links = IconRefresh.Shortcuts([Start, Desk, "", Path.Combine(_root, "missing")]);
        Assert.Equal([Path.Combine(Start, RenamedShortcuts.NewFileName)], links);
    }

    [Fact]
    public void The_icon_source_is_the_work_on_plus_mark_and_the_program_refreshes_shortcuts()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "src", "BasketDrop"))) dir = dir.Parent;
        var root = dir?.FullName ?? throw new InvalidOperationException("basket-pc root not found");
        var svg = File.ReadAllText(Path.Combine(root, "icon", "basket-icon.svg"));
        Assert.Contains("aria-label=\"WORK ON+ 파일 올리기\"", svg);
        Assert.Contains("M19 27L25 42L32 30L39 42L45 27", svg); // the W of app/app-icon.svg
        Assert.DoesNotContain("노조", svg);
        var tray = File.ReadAllText(Path.Combine(root, "src", "BasketDrop", "TrayApp.cs"));
        Assert.Contains("ShellIcons.RefreshOnce(", tray);
    }
}
