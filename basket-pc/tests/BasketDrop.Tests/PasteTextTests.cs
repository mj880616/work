using Xunit;

namespace BasketDrop.Tests;

/// <summary>The paste window as an editable box (BASKET-PC붙여넣기입력칸): what is sent, the status line, [보내기].</summary>
public class PasteTextTests
{
    [Fact]
    public void Edited_text_is_sent_exactly_as_the_box_shows_it()
    {
        var edited = "첫 줄 고침\r\n둘째 줄\r\n  들여쓴 줄  ";
        Assert.Equal(edited, PasteText.Compose(edited, "", hasAttachment: false));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\r\n\t")]
    public void An_empty_or_blank_box_sends_nothing_and_send_stays_off(string text)
    {
        Assert.Equal("", PasteText.Compose(text, "", hasAttachment: false));
        Assert.False(PasteText.CanSend(text, hasAttachment: false));
    }

    [Fact]
    public void Send_turns_on_as_soon_as_there_is_text_or_an_attachment()
    {
        Assert.True(PasteText.CanSend("a", hasAttachment: false));
        Assert.True(PasteText.CanSend("", hasAttachment: true));
    }

    [Fact]
    public void With_a_picture_or_files_only_the_description_line_is_sent()
    {
        Assert.Equal("회의 화이트보드", PasteText.Compose("숨은 글", "  회의 화이트보드 ", hasAttachment: true));
        Assert.Equal("", PasteText.Compose("숨은 글", "", hasAttachment: true));
    }

    [Fact]
    public void The_description_stays_one_line()
    {
        Assert.Equal("가 나 다", PasteText.Compose("", "가\r\n나\n다", hasAttachment: true));
        Assert.Equal("가 나", PasteText.OneLine("가\r나"));
    }

    [Theory]
    [InlineData("한 줄", 1)]
    [InlineData("한 줄\r\n", 1)]
    [InlineData("1\r\n2\r\n3\r\n4", 4)]
    [InlineData("1\n2\n\n4\n", 4)]
    [InlineData("1\r2", 2)]
    [InlineData("", 0)]
    public void Lines_are_counted_as_the_user_sees_them(string text, int lines)
    {
        Assert.Equal(lines, PasteText.LineCount(text));
    }

    [Fact]
    public void Status_line_texts()
    {
        Assert.Equal("글 · 4줄", PasteText.TextStatus("가\r\n나\r\n다\r\n라"));
        Assert.Equal("", PasteText.TextStatus("  "));
        Assert.Equal("사진 · 1280×720", PasteText.PictureStatus(1280, 720));
        Assert.Equal("파일 · 보고서.pdf", PasteText.FilesStatus(new[] { "보고서.pdf" }));
        Assert.Equal("파일 · 3개", PasteText.FilesStatus(new[] { "a", "b", "c" }));
        Assert.Equal("", PasteText.FilesStatus(Array.Empty<string>()));
    }

    [Fact]
    public void Placeholder_and_description_hint_texts()
    {
        Assert.Equal("여기에 붙여넣거나 바로 쓰기", PasteText.Placeholder);
        Assert.Equal("설명 한 줄(선택)", PasteText.CaptionPlaceholder);
    }

    [Fact]
    public void A_long_edited_text_is_still_checked_against_the_basket_limit()
    {
        using var dir = new TempDir();
        var drop = new DropService(new QueueStore(dir.Sub("queue")), new HistoryStore(dir.Sub("history.json")));
        var tooLong = new string('가', Limits.MaxTextChars + 1);
        var plan = drop.Inspect(Array.Empty<DropSource>(), PasteText.Compose(tooLong, "", hasAttachment: false));
        Assert.Contains(plan.Problems, p => p.Kind == ProblemKind.TextTooLong);
    }

    [Fact]
    public void Edited_text_goes_into_the_queue_unchanged()
    {
        using var dir = new TempDir();
        var drop = new DropService(new QueueStore(dir.Sub("queue")), new HistoryStore(dir.Sub("history.json")));
        var edited = "붙여넣은 글을\r\n고쳐서 보냄";
        var items = drop.Commit(drop.Inspect(Array.Empty<DropSource>(), PasteText.Compose(edited, "", hasAttachment: false)));
        Assert.Equal(edited, Assert.Single(items).RawText);
    }

    [Fact]
    public void A_picture_and_its_description_go_together_in_one_upload()
    {
        // The description uses the existing memo field of the upload (raw_text), no new server field.
        using var dir = new TempDir();
        var drop = new DropService(new QueueStore(dir.Sub("queue")), new HistoryStore(dir.Sub("history.json")));
        var picture = DropSource.FromBytes(new byte[] { 1, 2, 3 }, "붙여넣기-20261029-012100.png");
        var items = drop.Commit(drop.Inspect(new[] { picture }, PasteText.Compose("", "화이트보드 사진", hasAttachment: true)));
        var item = Assert.Single(items);
        Assert.Equal("화이트보드 사진", item.RawText);
        Assert.Single(item.Files);
    }
}
