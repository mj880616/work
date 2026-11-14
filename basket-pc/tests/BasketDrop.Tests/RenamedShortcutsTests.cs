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
        Assert.Equal("노조+ 업로드.lnk", RenamedShortcuts.NewFileName);
        Assert.Equal("BasketDrop.lnk", RenamedShortcuts.OldFileName);
    }

    [Fact]
    public void After_an_update_the_old_shortcut_goes_where_the_new_one_is_there()
    {
        Touch(_start, "BasketDrop.lnk");
        Touch(_start, "노조+ 업로드.lnk");
        Touch(_desk, "BasketDrop.lnk");
        Touch(_desk, "노조+ 업로드.lnk");
        Assert.Equal(2, RenamedShortcuts.RemoveWhereReplaced([_start, _desk]));
        Assert.False(File.Exists(Path.Combine(_start, "BasketDrop.lnk")));
        Assert.False(File.Exists(Path.Combine(_desk, "BasketDrop.lnk")));
        Assert.True(File.Exists(Path.Combine(_start, "노조+ 업로드.lnk")));
        Assert.True(File.Exists(Path.Combine(_desk, "노조+ 업로드.lnk")));
    }

    [Fact]
    public void Without_the_new_shortcut_the_old_one_stays_so_the_PC_is_never_left_with_none()
    {
        Touch(_start, "BasketDrop.lnk");
        Assert.Equal(0, RenamedShortcuts.RemoveWhereReplaced([_start, _desk, ""]));
        Assert.True(File.Exists(Path.Combine(_start, "BasketDrop.lnk")));
    }

    [Fact]
    public void Only_the_exact_old_file_is_touched()
    {
        Touch(_start, "노조+ 업로드.lnk");
        Touch(_start, "BasketDrop (2).lnk");
        Touch(_start, "Other.lnk");
        Assert.Equal(0, RenamedShortcuts.RemoveWhereReplaced([_start]));
        RenamedShortcuts.RemoveOld([_start]);
        Assert.Equal(3, Directory.GetFiles(_start).Length);
    }

    [Fact]
    public void Uninstall_removes_the_old_name_even_alone()
    {
        Touch(_desk, "BasketDrop.lnk");
        RenamedShortcuts.RemoveOld([_desk, ""]);
        Assert.Empty(Directory.GetFiles(_desk));
    }
}
