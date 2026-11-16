using Xunit;

namespace BasketDrop.Tests;

/// <summary>S63-09 PC도우미구분: only the exact word --background keeps the helper window closed.</summary>
public sealed class LaunchArgsTests
{
    [Fact]
    public void Only_exactly_background_counts()
    {
        Assert.True(LaunchArgs.IsBackground(["--background"]));
        Assert.False(LaunchArgs.IsBackground([]));
        Assert.False(LaunchArgs.IsBackground(["--Background"]));
        Assert.False(LaunchArgs.IsBackground(["--background", "C:\\x.txt"]));
        Assert.False(LaunchArgs.IsBackground(["C:\\x.txt"]));
    }

    [Fact]
    public void The_windows_start_entry_carries_the_word()
    {
        Assert.Equal("\"C:\\a\\BasketDrop.exe\" --background", AutoStartManager.CommandFor(@"C:\a\BasketDrop.exe"));
    }

    [Fact]
    public void Open_nojoplus_goes_to_the_web_app_address()
    {
        Assert.Equal("https://nojoplus.com/work/app/", NojoPlusWeb.AppUrl);
    }
}
