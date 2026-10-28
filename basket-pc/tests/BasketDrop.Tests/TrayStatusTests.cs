using Xunit;

namespace BasketDrop.Tests;

public class TrayStatusTests
{
    [Fact]
    public void Signed_in_with_nothing_waiting_shows_the_plain_icon()
    {
        var s = TrayStatus.From([], AuthState.SignedIn);
        Assert.Equal(TrayPicture.Normal, s.Picture);
        Assert.Equal("바구니 PC드롭\n로그인됨 · 보낼 것 없음", s.Tooltip);
    }

    [Fact]
    public void Waiting_items_add_the_dot_and_a_count_line()
    {
        var s = TrayStatus.From([ItemState.Pending, ItemState.Sending, ItemState.NotReached], AuthState.SignedIn);
        Assert.Equal(TrayPicture.Pending, s.Picture);
        Assert.Equal("바구니 PC드롭\n보낼 것 3개 대기 중", s.Tooltip);
    }

    [Fact]
    public void Only_items_that_still_need_checking_do_not_add_the_dot()
    {
        var s = TrayStatus.From([ItemState.Unknown, ItemState.Rejected], AuthState.SignedIn);
        Assert.Equal(TrayPicture.Normal, s.Picture);
        Assert.Equal("바구니 PC드롭\n확인 필요 2개", s.Tooltip);
    }

    [Fact]
    public void Login_needed_turns_grey_and_says_so()
    {
        Assert.Equal(TrayPicture.SignedOut, TrayStatus.From([], AuthState.SignedOut).Picture);
        Assert.Equal("바구니 PC드롭\n로그인 필요", TrayStatus.From([], AuthState.SignedOut).Tooltip);
        var s = TrayStatus.From([ItemState.LoginRequired, ItemState.Pending], AuthState.ReloginNeeded);
        Assert.Equal(TrayPicture.SignedOutPending, s.Picture);
        Assert.Equal("바구니 PC드롭\n다시 로그인 필요\n보낼 것 2개 대기 중", s.Tooltip);
    }

    [Fact]
    public void Dot_goes_away_when_the_queue_empties_and_colour_returns_after_login()
    {
        Assert.Equal(TrayPicture.SignedOutPending, TrayStatus.From([ItemState.LoginRequired], AuthState.SignedOut).Picture);
        Assert.Equal(TrayPicture.Pending, TrayStatus.From([ItemState.Pending], AuthState.SignedIn).Picture);
        Assert.Equal(TrayPicture.Normal, TrayStatus.From([], AuthState.SignedIn).Picture);
    }

    [Fact]
    public void Tooltip_stays_within_the_windows_limit()
    {
        var many = Enumerable.Repeat(ItemState.Pending, 99999).Concat(Enumerable.Repeat(ItemState.Unknown, 99999));
        Assert.True(TrayStatus.From(many, AuthState.ReloginNeeded).Tooltip.Length <= TrayStatus.TooltipMax);
    }
}
