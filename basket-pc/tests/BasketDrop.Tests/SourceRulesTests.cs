using System.Text.RegularExpressions;
using Xunit;

namespace BasketDrop.Tests;

/// <summary>Rules the design fixes in code (R11 clipboard, 4.4 token handling), checked on the source files.</summary>
public class SourceRulesTests
{
    private static string Root()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "src", "BasketDrop"))) dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException("basket-pc root not found");
    }

    private static IEnumerable<string> Sources() =>
        Directory.EnumerateFiles(Path.Combine(Root(), "src"), "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}")
                     && !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}"));

    [Fact]
    public void Clipboard_is_read_in_one_file_only()
    {
        var users = Sources().Where(f => Regex.IsMatch(File.ReadAllText(f), @"\bClipboard\.|GetDataObject|OleGetClipboard")).Select(Path.GetFileName).ToList();
        Assert.Equal(new[] { "ClipboardReader.cs" }, users);
    }

    [Fact]
    public void Clipboard_reader_is_only_called_from_user_actions()
    {
        // The only callers allowed are the hotkey handler and the paste window.
        var callers = Sources().Where(f => File.ReadAllText(f).Contains("ClipboardReader.Read") && !f.EndsWith("ClipboardReader.cs"))
            .Select(Path.GetFileName).OrderBy(x => x).ToList();
        Assert.Equal(new[] { "PasteForm.cs", "TrayApp.cs" }, callers);
    }

    [Fact]
    public void No_source_logs_or_shows_token_values()
    {
        foreach (var file in Sources())
        {
            var text = File.ReadAllText(file);
            Assert.DoesNotMatch(@"(?i)(Console\.Write|Debug\.Write|MessageBox\.Show|Log\.Write)\([^;]*token", text);
            Assert.DoesNotContain("Environment.GetEnvironmentVariable", text); // no token via environment either
        }
    }

    [Fact]
    public void Program_never_takes_anything_but_file_paths_as_arguments()
    {
        var program = File.ReadAllText(Path.Combine(Root(), "src", "BasketDrop", "Program.cs"));
        Assert.DoesNotContain("--token", program);
        Assert.Contains("File.Exists", program);
    }

    [Fact]
    public void No_server_secret_in_the_sources()
    {
        foreach (var file in Sources())
        {
            var text = File.ReadAllText(file);
            Assert.DoesNotContain("service_role", text);
            Assert.DoesNotContain("sb_secret", text);
        }
    }
}
