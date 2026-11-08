using Xunit;

namespace BasketDrop.Tests;

public class SettingsStoreTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "bd-settings-" + Guid.NewGuid().ToString("N"));
    private string PathOf => Path.Combine(_dir, "settings.json");

    public void Dispose()
    {
        if (Directory.Exists(_dir)) Directory.Delete(_dir, true);
    }

    [Fact]
    public void Without_a_file_the_defaults_apply()
    {
        var s = new SettingsStore(PathOf).Load();
        Assert.False(s.LegacyEntriesCleaned);
        Assert.False(s.WebDoor);
        Assert.True(s.AutoStart);
        Assert.False(s.AutoStartDecided);
    }

    [Fact]
    public void Choices_survive_a_restart()
    {
        var store = new SettingsStore(PathOf);
        store.Save(new AppSettings { LegacyEntriesCleaned = true, AutoStart = false, AutoStartDecided = true });
        var s = new SettingsStore(PathOf).Load();
        Assert.True(s.LegacyEntriesCleaned);
        Assert.False(s.AutoStart);
    }

    [Fact]
    public void A_settings_file_from_an_older_version_loads_and_drops_the_removed_entrance_values_on_save()
    {
        Directory.CreateDirectory(_dir);
        File.WriteAllText(PathOf, "{\"Hotkey\":\"CtrlQ\",\"Corner\":\"Off\",\"DesktopTile\":false,\"DesktopTileX\":10,\"DesktopTileY\":20,\"AutoStart\":false,\"AutoStartDecided\":true,\"WebDoor\":true}");
        var store = new SettingsStore(PathOf);
        var s = store.Load();
        Assert.False(s.AutoStart);
        Assert.True(s.WebDoor);
        Assert.False(s.LegacyEntriesCleaned);
        store.Save(s);
        var text = File.ReadAllText(PathOf);
        foreach (var gone in new[] { "Hotkey", "Corner", "DesktopTile" }) Assert.DoesNotContain(gone, text);
    }

    [Fact]
    public void A_damaged_file_gives_the_defaults_instead_of_a_crash()
    {
        Directory.CreateDirectory(_dir);
        File.WriteAllText(PathOf, "{ broken");
        Assert.False(new SettingsStore(PathOf).Load().LegacyEntriesCleaned);
    }
}

public class AutoStartTests : IDisposable
{
    private sealed class FakeRegistry : IStartupRegistry
    {
        public string? Value;
        public bool DisabledByWindows;
        public string? GetRunValue() => Value;
        public void SetRunValue(string command) => Value = command;
        public void RemoveRunValue() => Value = null;
        public bool IsDisabledByWindows() => DisabledByWindows;
    }

    private readonly string _dir = Path.Combine(Path.GetTempPath(), "bd-autostart-" + Guid.NewGuid().ToString("N"));
    private SettingsStore Store => new(Path.Combine(_dir, "settings.json"));
    private const string Exe = @"C:\Users\x\AppData\Local\BasketDropApp\current\BasketDrop.exe";

    public void Dispose()
    {
        if (Directory.Exists(_dir)) Directory.Delete(_dir, true);
    }

    [Fact]
    public void The_first_run_turns_it_on_with_the_installed_path()
    {
        var reg = new FakeRegistry();
        var state = new AutoStartManager(reg, Store, Exe).Sync();
        Assert.Equal(AutoStartState.On, state);
        Assert.Equal("\"" + Exe + "\"", reg.Value);
        Assert.True(Store.Load().AutoStartDecided);
    }

    [Fact]
    public void A_broken_or_old_path_is_repaired_on_every_start()
    {
        var reg = new FakeRegistry { Value = @"""C:\old\place\BasketDrop.exe""" };
        new AutoStartManager(reg, Store, Exe).Sync();
        Assert.Equal("\"" + Exe + "\"", reg.Value);
    }

    [Fact]
    public void Turning_it_off_removes_the_entry_and_the_choice_is_kept_after_a_restart()
    {
        var reg = new FakeRegistry();
        Assert.Equal(AutoStartState.Off, new AutoStartManager(reg, Store, Exe).SetEnabled(false));
        Assert.Null(reg.Value);

        // The next start must not undo the user's choice.
        Assert.Equal(AutoStartState.Off, new AutoStartManager(reg, Store, Exe).Sync());
        Assert.Null(reg.Value);
    }

    [Fact]
    public void Turning_it_back_on_writes_the_entry_again()
    {
        var reg = new FakeRegistry();
        var m = new AutoStartManager(reg, Store, Exe);
        m.SetEnabled(false);
        Assert.Equal(AutoStartState.On, m.SetEnabled(true));
        Assert.Equal("\"" + Exe + "\"", reg.Value);
    }

    [Fact]
    public void A_switch_off_in_Windows_Settings_is_respected_not_overridden()
    {
        var reg = new FakeRegistry { DisabledByWindows = true };
        Assert.Equal(AutoStartState.DisabledInWindows, new AutoStartManager(reg, Store, Exe).Sync());
        // the entry itself is kept correct so that switching it back on in Windows works
        Assert.Equal("\"" + Exe + "\"", reg.Value);
    }

    [Fact]
    public void A_copy_that_is_not_installed_never_touches_the_registry_or_the_settings()
    {
        var reg = new FakeRegistry();
        var m = new AutoStartManager(reg, Store, null);
        Assert.Equal(AutoStartState.NotInstalled, m.Sync());
        Assert.Equal(AutoStartState.NotInstalled, m.SetEnabled(true));
        Assert.Null(reg.Value);
        Assert.False(File.Exists(Path.Combine(_dir, "settings.json")));
    }
}
