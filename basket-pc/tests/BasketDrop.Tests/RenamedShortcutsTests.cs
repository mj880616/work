using Xunit;

namespace BasketDrop.Tests;

public sealed class RenamedShortcutsTests : IDisposable
{
    private readonly string _start = Directory.CreateTempSubdirectory("rs-start").FullName;
    private readonly string _desk = Directory.CreateTempSubdirectory("rs-desk").FullName;

    public void Dispose()
    {
        Directory.Delete(_start, true);
        Directory.Delete(_desk, true);
    }

    private static void Touch(string folder, string name) => File.WriteAllText(Path.Combine(folder, name), "x");

    [Fact]
    public void The_new_name_is_the_program_name()
    {
        Assert.Equal("WORK ON+ 파일 올리기.lnk", RenamedShortcuts.NewFileName);
        Assert.Equal(["BasketDrop.lnk", "노조+ 업로드.lnk", "노조+ 파일 올리기.lnk"], RenamedShortcuts.OldFileNames);
    }

    [Fact]
    public void After_an_update_the_old_shortcut_goes_where_the_new_one_is_there()
    {
        // S63-09·S68-21: all older names (BasketDrop → 노조+ 업로드 → 노조+ 파일 올리기 → WORK ON+ 파일 올리기) go once the new one is there.
        Touch(_start, "BasketDrop.lnk");
        Touch(_start, "노조+ 업로드.lnk");
        Touch(_start, "노조+ 파일 올리기.lnk");
        Touch(_start, "WORK ON+ 파일 올리기.lnk");
        Touch(_desk, "노조+ 파일 올리기.lnk");
        Touch(_desk, "WORK ON+ 파일 올리기.lnk");
        Assert.Equal(4, RenamedShortcuts.RemoveWhereReplaced([_start, _desk]));
        Assert.Equal(["WORK ON+ 파일 올리기.lnk"], Directory.GetFiles(_start).Select(Path.GetFileName));
        Assert.Equal(["WORK ON+ 파일 올리기.lnk"], Directory.GetFiles(_desk).Select(Path.GetFileName));
    }

    [Fact]
    public void Without_the_new_shortcut_the_old_one_stays_so_the_PC_is_never_left_with_none()
    {
        Touch(_start, "BasketDrop.lnk");
        Touch(_desk, "노조+ 업로드.lnk");
        Touch(_desk, "노조+ 파일 올리기.lnk");
        Assert.Equal(0, RenamedShortcuts.RemoveWhereReplaced([_start, _desk, ""]));
        Assert.True(File.Exists(Path.Combine(_start, "BasketDrop.lnk")));
        Assert.True(File.Exists(Path.Combine(_desk, "노조+ 업로드.lnk")));
        Assert.True(File.Exists(Path.Combine(_desk, "노조+ 파일 올리기.lnk")));
    }

    [Fact]
    public void Only_the_exact_old_file_is_touched()
    {
        Touch(_start, "WORK ON+ 파일 올리기.lnk");
        Touch(_start, "노조+ 파일 올리기 (2).lnk");
        Touch(_start, "노조+ 업로드 (2).lnk");
        Touch(_start, "BasketDrop (2).lnk");
        Touch(_start, "Other.lnk");
        Assert.Equal(0, RenamedShortcuts.RemoveWhereReplaced([_start]));
        RenamedShortcuts.RemoveOld([_start]);
        Assert.Equal(5, Directory.GetFiles(_start).Length);
    }

    [Fact]
    public void Uninstall_removes_the_old_name_even_alone()
    {
        Touch(_desk, "BasketDrop.lnk");
        Touch(_desk, "노조+ 업로드.lnk");
        Touch(_desk, "노조+ 파일 올리기.lnk");
        RenamedShortcuts.RemoveOld([_desk, ""]);
        Assert.Empty(Directory.GetFiles(_desk));
    }
}
