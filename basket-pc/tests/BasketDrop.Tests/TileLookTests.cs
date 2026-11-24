using System.Drawing;
using System.Drawing.Imaging;
using BasketDrop.App;
using Xunit;

namespace BasketDrop.Tests;

/// <summary>S69-35: the tile's size limits, resize band, double click, input window place, icon frame and picture.</summary>
public class TileSizeTests
{
    private static MonitorInfo Mon(int x, int y, int w, int h, bool primary = false, int dpi = 96) =>
        new(new Rectangle(x, y, w, h), new Rectangle(x, y, w, h), primary, dpi);

    [Fact]
    public void A_tile_never_resized_keeps_the_default_size()
    {
        Assert.Null(DesktopTileGeometry.Saved(null, null));
        Assert.Null(DesktopTileGeometry.Saved(200, null));
        Assert.Equal(DesktopTileGeometry.SizeAt96, DesktopTileGeometry.ClampAt96(null));
        Assert.Equal(new Size(118, 96), DesktopTileGeometry.SizeFor(96, null));
    }

    [Theory]
    [InlineData(10, 10, 96, 78)]
    [InlineData(2000, 2000, 360, 300)]
    [InlineData(200, 150, 200, 150)]
    public void The_saved_size_stays_between_the_smallest_and_largest(int w, int h, int ew, int eh)
    {
        Assert.Equal(new Size(ew, eh), DesktopTileGeometry.ClampAt96(new Size(w, h)));
    }

    [Theory]
    [InlineData(96, 236, 192)]
    [InlineData(120, 295, 240)]
    [InlineData(144, 354, 288)]
    [InlineData(192, 472, 384)]
    public void A_saved_size_is_shown_at_each_monitors_scale(int dpi, int w, int h)
    {
        Assert.Equal(new Size(w, h), DesktopTileGeometry.SizeFor(dpi, new Size(236, 192)));
        Assert.Equal(new Size(236, 192), DesktopTileGeometry.ToAt96(new Size(w, h), dpi));
    }

    [Fact]
    public void A_saved_size_is_used_for_the_place_and_kept_on_screen()
    {
        var m = Mon(0, 0, 1920, 1080, primary: true, dpi: 144);
        var placed = DesktopTileGeometry.Place(1800, 1000, new[] { m }, new Size(200, 150))!.Value;
        Assert.Equal(new Rectangle(1920 - 300, 1080 - 225, 300, 225), placed.Rect);
        var moved = DesktopTileGeometry.AfterMove(new Point(10, 10), new Size(300, 225), new[] { m }, new Size(200, 150))!.Value;
        Assert.Equal(new Size(300, 225), moved.Rect.Size);
    }

    [Theory]
    [InlineData(118, 96, 1f)]
    [InlineData(236, 192, 2f)]
    [InlineData(236, 96, 1f)]   // wide: the height decides
    [InlineData(177, 144, 1.5f)]
    public void The_inside_grows_with_the_tile(int w, int h, float k)
    {
        Assert.Equal(k, DesktopTileGeometry.ContentScale(new Size(w, h)), 3);
    }
}

public class TileHitTestTests
{
    private static readonly Size Tile = new(118, 96);

    [Theory]
    [InlineData(59, 48, TileZone.Inside)]
    [InlineData(0, 48, TileZone.Left)]
    [InlineData(117, 48, TileZone.Right)]
    [InlineData(59, 0, TileZone.Top)]
    [InlineData(59, 95, TileZone.Bottom)]
    [InlineData(0, 0, TileZone.TopLeft)]
    [InlineData(117, 0, TileZone.TopRight)]
    [InlineData(0, 95, TileZone.BottomLeft)]
    [InlineData(117, 95, TileZone.BottomRight)]
    [InlineData(110, 93, TileZone.BottomRight)] // the corner reaches twice the band along each edge
    [InlineData(6, 48, TileZone.Inside)]        // just inside the band: move, drop, click
    public void Edges_resize_and_the_inside_moves(int x, int y, TileZone zone)
    {
        Assert.Equal(zone, TileHitTest.At(new Point(x, y), Tile, 6));
    }

    [Fact]
    public void A_tiny_tile_keeps_its_middle_for_moving()
    {
        Assert.Equal(TileZone.Inside, TileHitTest.At(new Point(15, 15), new Size(30, 30), 20));
    }
}

public class DoubleClickRuleTests
{
    [Fact]
    public void Two_quick_clicks_in_one_place_are_a_double_click()
    {
        Assert.True(DoubleClickRule.IsDouble(new Point(10, 10), 1000, new Point(12, 11), 1300, 500, new Size(4, 4)));
    }

    [Fact]
    public void A_slow_or_far_second_click_is_not()
    {
        Assert.False(DoubleClickRule.IsDouble(new Point(10, 10), 1000, new Point(10, 10), 1600, 500, new Size(4, 4)));
        Assert.False(DoubleClickRule.IsDouble(new Point(10, 10), 1000, new Point(30, 10), 1100, 500, new Size(4, 4)));
    }
}

public class PastePlacementTests
{
    private static readonly Rectangle Area = new(0, 0, 1920, 1040);

    [Fact]
    public void It_opens_below_the_tile()
    {
        var r = PastePlacement.Near(new Rectangle(1786, 16, 118, 96), new Size(320, 180), Area, 8);
        Assert.Equal(new Rectangle(1600, 120, 320, 180), r);
    }

    [Fact]
    public void Near_the_bottom_it_opens_above()
    {
        var r = PastePlacement.Near(new Rectangle(100, 940, 118, 96), new Size(320, 180), Area, 8);
        Assert.Equal(new Rectangle(0, 940 - 8 - 180, 320, 180), r);
    }

    [Fact]
    public void It_never_leaves_the_screen()
    {
        var r = PastePlacement.Near(new Rectangle(1900, -50, 118, 96), new Size(5000, 3000), Area, 8);
        Assert.True(Area.Contains(r));
    }
}

public class IconFrameTests
{
    [Theory]
    [InlineData(32, 32)]
    [InlineData(40, 40)]
    [InlineData(48, 48)]
    [InlineData(64, 64)]
    [InlineData(56, 64)]   // 175%: a larger frame drawn smaller, never a small one stretched
    [InlineData(70, 256)]
    [InlineData(300, 256)]
    public void The_icon_is_never_stretched_up(int want, int frame)
    {
        Assert.Equal(frame, IconFrames.Pick(want, IconFrames.InAppIcon));
    }

    [Fact]
    public void The_frame_list_matches_the_icon_file()
    {
        var path = Path.Combine(Root(), "src", "BasketDrop", "app.ico");
        var bytes = File.ReadAllBytes(path);
        var count = BitConverter.ToUInt16(bytes, 4);
        var sizes = Enumerable.Range(0, count).Select(i => bytes[6 + i * 16] == 0 ? 256 : bytes[6 + i * 16]).OrderBy(s => s).ToArray();
        Assert.Equal(IconFrames.InAppIcon, sizes);
    }

    internal static string Root()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "src", "BasketDrop"))) dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException("basket-pc root not found");
    }
}

public class DropWordsTests
{
    [Theory]
    [InlineData(2, 0, false, "파일 2개")]
    [InlineData(0, 1, false, "사진")]
    [InlineData(0, 2, true, "사진 2개 · 글")]
    [InlineData(1, 1, true, "파일 1개 · 사진 1개 · 글")]
    [InlineData(0, 0, true, "글")]
    public void The_notice_says_what_was_sent(int files, int pictures, bool text, string expected)
    {
        Assert.Equal(expected, DropWords.What(files, pictures, text));
    }
}

/// <summary>
/// The tile picture itself (cause of "귀퉁이가 조악함"): the old window was cut by a Region, so a corner pixel was either
/// fully in or fully out. The new picture must have partly see-through pixels along the round corner at every scale.
/// Set BASKET_TILE_SHOTS to a folder to keep the pictures (CI uploads them).
/// </summary>
public class TileArtTests
{
    public static TheoryData<int, int, int> Scales() => new()
    {
        { 96, 118, 96 }, { 120, 148, 120 }, { 144, 177, 144 }, { 192, 236, 192 }, { 144, 354, 288 },
    };

    [Theory]
    [MemberData(nameof(Scales))]
    public void Corners_are_smooth_and_the_middle_is_solid(int dpi, int w, int h)
    {
        using var picture = TileArt.Render(new Size(w, h), dpi, new TileLook(false, false));
        Assert.Equal(new Size(w, h), picture.Size);
        Assert.Equal(PixelFormat.Format32bppPArgb, picture.PixelFormat);

        // Middle of the card: fully opaque paper or ink.
        Assert.Equal(255, picture.GetPixel(w / 2, h - TileArt.Margin(dpi) - 4).A);
        // The very corner is see-through but still takes the mouse (alpha 1, invisible).
        Assert.Equal(1, picture.GetPixel(0, 0).A);
        // Along the top-left arc there are partly see-through pixels: the edge is smoothed, not stepped.
        var partial = 0;
        var reach = Math.Max(8, w / 8);
        for (var y = 0; y < reach; y++)
            for (var x = 0; x < reach; x++)
            {
                var a = picture.GetPixel(x, y).A;
                if (a > 40 && a < 220) partial++;
            }
        Assert.True(partial >= 4, $"only {partial} soft corner pixels at {dpi} dpi");

        var shots = Environment.GetEnvironmentVariable("BASKET_TILE_SHOTS");
        if (!string.IsNullOrEmpty(shots))
        {
            Directory.CreateDirectory(shots);
            foreach (var (look, name) in new[] { (new TileLook(false, false), "normal"), (new TileLook(true, false), "drag"), (new TileLook(false, true), "busy") })
            {
                using var shot = TileArt.Render(new Size(w, h), dpi, look);
                using var onDesk = new Bitmap(w + 40, h + 40);
                using (var g = Graphics.FromImage(onDesk))
                {
                    g.Clear(Color.FromArgb(0x3A, 0x5F, 0x7D)); // a desktop-like background, to see the edge
                    g.DrawImage(shot, 20, 20, w, h);
                }
                onDesk.Save(Path.Combine(shots, $"tile-{dpi * 100 / 96}pct-{w}x{h}-{name}.png"), ImageFormat.Png);
            }
        }
    }
}
