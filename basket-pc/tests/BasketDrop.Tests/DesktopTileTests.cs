using System.Drawing;
using Xunit;

namespace BasketDrop.Tests;

public class DesktopTileGeometryTests
{
    private static MonitorInfo Mon(int x, int y, int w, int h, bool primary = false, int dpi = 96, int taskbar = 0) =>
        new(new Rectangle(x, y, w, h), new Rectangle(x, y, w, h - taskbar), primary, dpi);

    [Theory]
    [InlineData(96, 118, 96)]
    [InlineData(120, 148, 120)]
    [InlineData(144, 177, 144)]
    public void The_tile_grows_with_the_screen_scale(int dpi, int w, int h)
    {
        Assert.Equal(new Size(w, h), DesktopTileGeometry.SizeFor(dpi));
    }

    [Fact]
    public void Without_a_saved_place_it_sits_top_right_of_the_primary_monitor()
    {
        var left = Mon(-1920, 0, 1920, 1080);
        var primary = Mon(0, 0, 1920, 1080, primary: true, taskbar: 48);
        var placed = DesktopTileGeometry.Place(null, null, new[] { left, primary });
        Assert.NotNull(placed);
        Assert.Same(primary, placed!.Value.Monitor);
        Assert.Equal(new Rectangle(1920 - 118 - 16, 16, 118, 96), placed.Value.Rect);
    }

    [Fact]
    public void The_default_place_is_scaled_at_150_percent()
    {
        var m = Mon(0, 0, 2880, 1800, primary: true, dpi: 144);
        var placed = DesktopTileGeometry.Place(null, null, new[] { m })!.Value;
        Assert.Equal(new Rectangle(2880 - 177 - 24, 24, 177, 144), placed.Rect);
    }

    [Fact]
    public void A_saved_place_is_kept()
    {
        var m = Mon(0, 0, 1920, 1080, primary: true);
        var placed = DesktopTileGeometry.Place(300, 200, new[] { m })!.Value;
        Assert.Equal(new Rectangle(300, 200, 118, 96), placed.Rect);
    }

    [Fact]
    public void A_saved_place_on_an_unplugged_monitor_falls_back_to_the_default()
    {
        var laptop = Mon(0, 0, 1920, 1080, primary: true);
        var placed = DesktopTileGeometry.Place(2500, 100, new[] { laptop })!.Value;
        Assert.Equal(DesktopTileGeometry.DefaultRect(laptop), placed.Rect);
    }

    [Fact]
    public void A_saved_place_on_a_second_monitor_uses_that_monitors_scale()
    {
        var laptop = Mon(0, 0, 1920, 1080, primary: true, dpi: 144);
        var external = Mon(1920, 0, 2560, 1440, dpi: 96);
        var placed = DesktopTileGeometry.Place(2000, 100, new[] { laptop, external })!.Value;
        Assert.Same(external, placed.Monitor);
        Assert.Equal(new Rectangle(2000, 100, 118, 96), placed.Rect);
    }

    [Fact]
    public void The_tile_never_goes_under_the_taskbar_or_off_screen()
    {
        var m = Mon(0, 0, 1920, 1080, primary: true, taskbar: 48);
        Assert.Equal(new Rectangle(1920 - 118, 1032 - 96, 118, 96), DesktopTileGeometry.Clamp(new Rectangle(1900, 1060, 118, 96), m));
        Assert.Equal(new Rectangle(0, 0, 118, 96), DesktopTileGeometry.Clamp(new Rectangle(-50, -30, 118, 96), m));
    }

    [Fact]
    public void After_a_move_the_monitor_under_the_centre_decides_the_scale()
    {
        var laptop = Mon(0, 0, 1920, 1080, primary: true, dpi: 96);
        var external = Mon(1920, 0, 2560, 1440, dpi: 144);
        var moved = DesktopTileGeometry.AfterMove(new Point(1900, 100), new Size(118, 96), new[] { laptop, external })!.Value;
        Assert.Same(external, moved.Monitor);
        Assert.Equal(new Rectangle(1920, 100, 177, 144), moved.Rect);
    }

    [Fact]
    public void A_tile_pushed_past_the_edge_comes_back_on_the_nearest_monitor()
    {
        var m = Mon(0, 0, 1920, 1080, primary: true);
        var moved = DesktopTileGeometry.AfterMove(new Point(2100, -300), new Size(118, 96), new[] { m })!.Value;
        Assert.Equal(new Rectangle(1920 - 118, 0, 118, 96), moved.Rect);
    }

    [Fact]
    public void No_monitor_means_no_tile()
    {
        Assert.Null(DesktopTileGeometry.Place(null, null, Array.Empty<MonitorInfo>()));
        Assert.Null(DesktopTileGeometry.AfterMove(Point.Empty, new Size(118, 96), Array.Empty<MonitorInfo>()));
    }
}

public class DesktopTileGestureTests
{
    [Theory]
    [InlineData(0, 0, false)]
    [InlineData(5, -5, false)]
    [InlineData(6, 0, true)]
    [InlineData(0, -6, true)]
    public void A_small_wobble_is_still_a_click(int dx, int dy, bool move)
    {
        Assert.Equal(move, TileGesture.IsMove(new Point(100, 100), new Point(100 + dx, 100 + dy), TileGesture.MoveThresholdAt96));
    }

    [Theory]
    [InlineData("Progman", true)]
    [InlineData("WorkerW", true)]
    [InlineData("Shell_TrayWnd", false)]
    [InlineData("Chrome_WidgetWin_1", false)]
    [InlineData(null, false)]
    public void Only_the_desktop_window_classes_count_as_the_desktop(string? cls, bool desktop)
    {
        Assert.Equal(desktop, DesktopShell.IsDesktop(cls));
    }
}

public class DesktopTileSettingsTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "bd-tile-" + Guid.NewGuid().ToString("N"));
    private string PathOf => Path.Combine(_dir, "settings.json");

    public void Dispose()
    {
        if (Directory.Exists(_dir)) Directory.Delete(_dir, true);
    }

    [Fact]
    public void The_tile_is_on_by_default_without_a_saved_place()
    {
        var s = new AppSettings();
        Assert.True(s.DesktopTile);
        Assert.Null(s.DesktopTileX);
        Assert.Null(s.DesktopTileY);
    }

    [Fact]
    public void An_older_settings_file_without_the_tile_keeps_its_choices_and_turns_the_tile_on()
    {
        Directory.CreateDirectory(_dir);
        File.WriteAllText(PathOf, "{\"Hotkey\":\"" + HotkeyChoice.CtrlQ.Id + "\",\"Corner\":\"Off\"}");
        var s = new SettingsStore(PathOf).Load();
        Assert.Equal(HotkeyChoice.CtrlQ.Id, s.Hotkey);
        Assert.Equal("Off", s.Corner);
        Assert.True(s.DesktopTile);
        Assert.Null(s.DesktopTileX);
    }

    [Fact]
    public void Off_and_the_place_survive_a_restart()
    {
        new SettingsStore(PathOf).Save(new AppSettings { DesktopTile = false, DesktopTileX = -1500, DesktopTileY = 40 });
        var s = new SettingsStore(PathOf).Load();
        Assert.False(s.DesktopTile);
        Assert.Equal(-1500, s.DesktopTileX);
        Assert.Equal(40, s.DesktopTileY);
    }
}
