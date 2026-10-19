using Xunit;

namespace BasketDrop.Tests;

public class HotkeyChoiceTests
{
    [Fact]
    public void The_default_is_Ctrl_and_the_key_left_of_the_number_1()
    {
        Assert.Equal("Ctrl+`", HotkeyChoice.Default.Label);
        Assert.Equal(0xC0u, HotkeyChoice.Default.VirtualKey); // VK_OEM_3: same physical key on Korean and US keyboards
        Assert.Equal(HotkeyChoice.ModControl, HotkeyChoice.Default.Modifiers);
    }

    [Fact]
    public void The_choices_are_Ctrl_backtick_Q_and_Space_only()
    {
        Assert.Equal(new[] { "Ctrl+`", "Ctrl+Q", "Ctrl+Space" }, HotkeyChoice.All.Select(c => c.Label));
        Assert.Equal(0x51u, HotkeyChoice.CtrlQ.VirtualKey);
        Assert.Equal(0x20u, HotkeyChoice.CtrlSpace.VirtualKey);
    }

    [Fact]
    public void Every_choice_needs_a_modifier_and_has_its_own_id()
    {
        Assert.All(HotkeyChoice.All, c => Assert.NotEqual(0u, c.Modifiers));
        Assert.Equal(HotkeyChoice.All.Count, HotkeyChoice.All.Select(c => c.Id).Distinct().Count());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("CtrlShiftB")]
    [InlineData("A")]
    public void An_unknown_saved_value_falls_back_to_the_default(string? saved)
    {
        Assert.Equal(HotkeyChoice.Default, HotkeyChoice.FromId(saved));
    }

    [Fact]
    public void A_saved_choice_is_found_again()
    {
        foreach (var c in HotkeyChoice.All) Assert.Equal(c, HotkeyChoice.FromId(c.Id));
    }
}

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
        Assert.Equal(HotkeyChoice.Default.Id, s.Hotkey);
        Assert.True(s.AutoStart);
        Assert.False(s.AutoStartDecided);
    }

    [Fact]
    public void Choices_survive_a_restart()
    {
        var store = new SettingsStore(PathOf);
        store.Save(new AppSettings { Hotkey = HotkeyChoice.CtrlQ.Id, AutoStart = false, AutoStartDecided = true });
        var s = new SettingsStore(PathOf).Load();
        Assert.Equal(HotkeyChoice.CtrlQ.Id, s.Hotkey);
        Assert.False(s.AutoStart);
    }

    [Fact]
    public void A_damaged_file_gives_the_defaults_instead_of_a_crash()
    {
        Directory.CreateDirectory(_dir);
        File.WriteAllText(PathOf, "{ broken");
        Assert.Equal(HotkeyChoice.Default.Id, new SettingsStore(PathOf).Load().Hotkey);
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
