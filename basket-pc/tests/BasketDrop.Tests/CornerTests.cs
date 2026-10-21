using System.Drawing;
using Xunit;

namespace BasketDrop.Tests;

public class CornerChoiceTests
{
    [Fact]
    public void The_default_is_the_top_right_corner()
    {
        Assert.Equal(CornerChoice.TopRight, CornerChoices.Default);
        Assert.Equal("TopRight", new AppSettings().Corner);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("topright")]
    [InlineData("Left")]
    [InlineData("7")]
    public void An_unknown_saved_value_falls_back_to_the_default(string? saved)
    {
        Assert.Equal(CornerChoice.TopRight, CornerChoices.FromId(saved));
    }

    [Theory]
    [InlineData("TopRight", CornerChoice.TopRight)]
    [InlineData("BottomRight", CornerChoice.BottomRight)]
    [InlineData("Off", CornerChoice.Off)]
    public void Saved_values_round_trip(string saved, CornerChoice expected)
    {
        Assert.Equal(expected, CornerChoices.FromId(saved));
        Assert.Equal(saved, expected.ToString());
    }
}

public class CornerGeometryTests
{
    private static MonitorInfo Mon(int x, int y, int w, int h, bool primary = false, int dpi = 96, int taskbar = 0) =>
        new(new Rectangle(x, y, w, h), new Rectangle(x, y, w, h - taskbar), primary, dpi);

    [Fact]
    public void One_monitor_uses_its_own_corner()
    {
        var laptop = Mon(0, 0, 1920, 1080, primary: true);
        Assert.Same(laptop, CornerGeometry.PickMonitor(new[] { laptop }, CornerChoice.TopRight));
        Assert.Equal(new Rectangle(1914, 0, 6, 6), CornerGeometry.HotRect(laptop, CornerChoice.TopRight));
        Assert.Equal(new Rectangle(1914, 1074, 6, 6), CornerGeometry.HotRect(laptop, CornerChoice.BottomRight));
    }

    [Fact]
    public void Off_picks_no_monitor()
    {
        Assert.Null(CornerGeometry.PickMonitor(new[] { Mon(0, 0, 1920, 1080, true) }, CornerChoice.Off));
        Assert.Null(CornerGeometry.PickMonitor(Array.Empty<MonitorInfo>(), CornerChoice.TopRight));
    }

    [Fact]
    public void A_monitor_on_the_right_of_the_primary_takes_the_corner_because_the_pointer_would_pass_through()
    {
        var laptop = Mon(0, 0, 1920, 1080, primary: true, dpi: 144);
        var external = Mon(1920, 0, 2560, 1440);
        var picked = CornerGeometry.PickMonitor(new[] { laptop, external }, CornerChoice.TopRight);
        Assert.Same(external, picked);
    }

    [Fact]
    public void A_monitor_on_the_left_keeps_the_primary_corner()
    {
        var laptop = Mon(0, 0, 1920, 1080, primary: true);
        var left = Mon(-2560, 0, 2560, 1440);
        Assert.Same(laptop, CornerGeometry.PickMonitor(new[] { left, laptop }, CornerChoice.TopRight));
    }

    [Fact]
    public void A_monitor_above_the_primary_blocks_the_top_corner_but_not_the_bottom_one()
    {
        var laptop = Mon(0, 0, 1920, 1080, primary: true);
        var above = Mon(0, -1080, 1920, 1080);
        Assert.False(CornerGeometry.IsDeadEnd(new[] { laptop, above }, laptop, CornerChoice.TopRight));
        Assert.True(CornerGeometry.IsDeadEnd(new[] { laptop, above }, laptop, CornerChoice.BottomRight));
        Assert.Same(above, CornerGeometry.PickMonitor(new[] { laptop, above }, CornerChoice.TopRight));
        Assert.Same(laptop, CornerGeometry.PickMonitor(new[] { laptop, above }, CornerChoice.BottomRight));
    }

    [Fact]
    public void A_shorter_monitor_on_the_right_leaves_the_primary_bottom_corner_free()
    {
        var big = Mon(0, 0, 2560, 1440, primary: true);
        var small = Mon(2560, 0, 1920, 1080); // top aligned, ends above the big one's bottom
        Assert.True(CornerGeometry.IsDeadEnd(new[] { big, small }, big, CornerChoice.BottomRight));
        Assert.False(CornerGeometry.IsDeadEnd(new[] { big, small }, big, CornerChoice.TopRight));
    }

    [Fact]
    public void Sizes_follow_the_monitor_scale()
    {
        var at150 = Mon(0, 0, 2880, 1800, primary: true, dpi: 144, taskbar: 72);
        Assert.Equal(new Rectangle(2871, 0, 9, 9), CornerGeometry.HotRect(at150, CornerChoice.TopRight));
        var box = CornerGeometry.BoxRect(at150, CornerChoice.TopRight);
        Assert.Equal(new Size(360, 198), box.Size);
        Assert.Equal(2880 - 12, box.Right);
        Assert.Equal(12, box.Top);
    }

    [Fact]
    public void The_bottom_box_sits_above_the_taskbar()
    {
        var m = Mon(0, 0, 1920, 1080, primary: true, taskbar: 48);
        var box = CornerGeometry.BoxRect(m, CornerChoice.BottomRight);
        Assert.Equal(1032 - 8, box.Bottom);
        Assert.Equal(1920 - 8, box.Right);
    }

    [Fact]
    public void The_keep_open_area_covers_box_and_corner_and_stays_on_the_monitor()
    {
        var m = Mon(0, 0, 1920, 1080, primary: true);
        var keep = CornerGeometry.KeepOpenRect(m, CornerChoice.TopRight);
        Assert.True(keep.Contains(CornerGeometry.BoxRect(m, CornerChoice.TopRight)));
        Assert.True(keep.Contains(CornerGeometry.HotRect(m, CornerChoice.TopRight)));
        Assert.True(m.Bounds.Contains(keep));
    }
}

public class FullscreenRuleTests
{
    private static readonly Rectangle Monitor = new(0, 0, 1920, 1080);

    [Fact]
    public void A_window_covering_the_whole_monitor_is_full_screen()
    {
        Assert.True(FullscreenRule.CoversMonitor(new Rectangle(0, 0, 1920, 1080), Monitor, "Chrome_WidgetWin_1"));
        Assert.True(FullscreenRule.CoversMonitor(new Rectangle(-8, -8, 1936, 1096), Monitor, "Game"));
    }

    [Fact]
    public void A_maximized_window_leaves_the_taskbar_and_is_not_full_screen()
    {
        Assert.False(FullscreenRule.CoversMonitor(new Rectangle(0, 0, 1920, 1032), Monitor, "CabinetWClass"));
    }

    [Theory]
    [InlineData("Progman")]
    [InlineData("WorkerW")]
    [InlineData("Shell_TrayWnd")]
    public void The_desktop_is_not_full_screen(string cls)
    {
        Assert.False(FullscreenRule.CoversMonitor(Monitor, Monitor, cls));
    }

    [Theory]
    [InlineData(1, false)] // not present
    [InlineData(2, true)]  // busy (full screen)
    [InlineData(3, true)]  // Direct3D full screen
    [InlineData(4, true)]  // presentation mode
    [InlineData(5, false)] // accepts notifications
    public void Windows_quiet_states(int state, bool quiet)
    {
        Assert.Equal(quiet, FullscreenRule.IsQuietState(state));
    }
}

public class CornerDetectorTests
{
    private static readonly DateTimeOffset T0 = new(2026, 10, 21, 9, 0, 0, TimeSpan.Zero);
    private static DateTimeOffset At(int ms) => T0.AddMilliseconds(ms);

    [Fact]
    public void Hovering_opens_after_0_6_seconds()
    {
        var d = new CornerDetector();
        Assert.Equal(CornerAction.None, d.Sample(At(0), true, true, false, false));
        Assert.Equal(CornerAction.None, d.Sample(At(550), true, true, false, false));
        Assert.Equal(CornerAction.Show, d.Sample(At(600), true, true, false, false));
        Assert.True(d.Visible);
    }

    [Fact]
    public void Dragging_in_opens_after_0_15_seconds()
    {
        var d = new CornerDetector();
        d.Sample(At(0), true, true, true, false);
        Assert.Equal(CornerAction.None, d.Sample(At(100), true, true, true, false));
        Assert.Equal(CornerAction.Show, d.Sample(At(150), true, true, true, false));
    }

    [Fact]
    public void Passing_through_the_corner_does_not_open()
    {
        var d = new CornerDetector();
        d.Sample(At(0), true, true, false, false);
        d.Sample(At(300), false, true, false, false);
        Assert.Equal(CornerAction.None, d.Sample(At(400), true, true, false, false));
        Assert.Equal(CornerAction.None, d.Sample(At(900), true, true, false, false)); // the timer restarted at 400
        Assert.Equal(CornerAction.Show, d.Sample(At(1000), true, true, false, false));
    }

    [Fact]
    public void Full_screen_keeps_it_closed()
    {
        var d = new CornerDetector();
        for (var ms = 0; ms <= 2000; ms += 50) Assert.Equal(CornerAction.None, d.Sample(At(ms), true, true, true, quiet: true));
        Assert.False(d.Visible);
    }

    [Fact]
    public void Leaving_closes_after_0_4_seconds_and_coming_back_in_time_keeps_it_open()
    {
        var d = new CornerDetector();
        d.Sample(At(0), true, true, false, false);
        d.Sample(At(600), true, true, false, false);
        Assert.Equal(CornerAction.None, d.Sample(At(700), false, false, false, false));
        Assert.Equal(CornerAction.None, d.Sample(At(1000), false, true, false, false)); // back inside
        Assert.Equal(CornerAction.None, d.Sample(At(1100), false, false, false, false));
        Assert.Equal(CornerAction.None, d.Sample(At(1450), false, false, false, false));
        Assert.Equal(CornerAction.Hide, d.Sample(At(1500), false, false, false, false));
        Assert.False(d.Visible);
    }

    [Fact]
    public void Hold_open_wins_while_a_question_or_a_drop_is_on_screen()
    {
        var d = new CornerDetector();
        d.Sample(At(0), true, true, false, false);
        d.Sample(At(600), true, true, false, false);
        Assert.Equal(CornerAction.None, d.Sample(At(5000), false, false, false, false, holdOpen: true));
        Assert.True(d.Visible);
    }

    [Fact]
    public void After_closing_the_pointer_must_leave_the_corner_before_it_opens_again()
    {
        var d = new CornerDetector();
        d.Sample(At(0), true, true, false, false);
        d.Sample(At(600), true, true, false, false);
        Assert.Equal(CornerAction.Hide, d.Close());
        Assert.Equal(CornerAction.None, d.Close());
        for (var ms = 700; ms <= 3000; ms += 100) Assert.Equal(CornerAction.None, d.Sample(At(ms), true, true, false, false));
        d.Sample(At(3100), false, false, false, false);
        d.Sample(At(3200), true, true, false, false);
        Assert.Equal(CornerAction.Show, d.Sample(At(3800), true, true, false, false));
    }
}
