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

    [Fact]
    public void Only_the_token_store_talks_to_Credential_Manager()
    {
        var users = Sources().Where(f => File.ReadAllText(f).Contains("advapi32")).Select(Path.GetFileName).ToList();
        Assert.Equal(new[] { "TokenStore.cs" }, users);
    }

    [Fact]
    public void Tokens_are_never_written_to_files_or_passed_as_process_arguments()
    {
        foreach (var file in Sources())
        {
            var text = File.ReadAllText(file);
            Assert.DoesNotMatch(@"(?is)File\.(Write|AppendAll|Create)[^;]*(token|refresh|verifier)", text);
            Assert.DoesNotMatch(@"(?is)(Arguments|ArgumentList|ProcessStartInfo)[^;]*(token|refresh|verifier)", text);
        }
    }

    [Fact]
    public void Server_logout_is_always_scoped_to_this_session_only()
    {
        var all = string.Join(" ", Sources().Select(File.ReadAllText));
        Assert.Contains("scope=local", all);
        Assert.DoesNotContain("scope=global", all);
        Assert.DoesNotContain("scope=others", all);
        // Without a session id the server's logout ends every session, so the call is guarded.
        Assert.Contains("\"session_id\"", File.ReadAllText(Path.Combine(Root(), "src", "BasketDrop.Core", "SupabaseAuthProvider.cs")));
    }

    [Fact]
    public void Every_http_client_refuses_to_follow_redirects()
    {
        foreach (var file in Sources().Where(f => File.ReadAllText(f).Contains("new HttpClient")))
            Assert.Contains("AllowAutoRedirect = false", File.ReadAllText(file));
    }

    [Fact]
    public void The_hotkey_uses_RegisterHotKey_only_and_no_keyboard_hook()
    {
        var users = Sources().Where(f => File.ReadAllText(f).Contains("RegisterHotKey(")).Select(Path.GetFileName).ToList();
        Assert.Equal(new[] { "HotkeyWindow.cs" }, users);
        foreach (var file in Sources())
            Assert.DoesNotMatch(@"SetWindowsHookEx|WH_KEYBOARD|GetAsyncKeyState|GetKeyboardState|GetKeyState|RegisterRawInputDevices|SendKeys", File.ReadAllText(file));
    }

    [Fact]
    public void Update_addresses_are_decided_in_one_file_and_never_point_at_latest_or_other_repositories()
    {
        foreach (var file in Sources())
        {
            var text = File.ReadAllText(file);
            var name = Path.GetFileName(file);
            if (name != "UpdatePolicy.cs")
            {
                Assert.DoesNotContain("github.com", text);
                Assert.DoesNotContain("githubusercontent", text);
            }
            Assert.DoesNotContain("releases/latest", text);
            Assert.DoesNotContain("GithubSource", text); // it takes whichever release is newest, whatever its tag
            if (name != "UpdateService.cs") Assert.DoesNotContain("SimpleWebSource", text);
        }
        var service = File.ReadAllText(Path.Combine(Root(), "src", "BasketDrop", "UpdateService.cs"));
        Assert.Contains("UpdatePolicy.ReleaseBase(tag)", service);
        Assert.Contains("new TrustedDownloader(", service);
        Assert.Contains("AllowVersionDowngrade = false", service);
    }

    [Fact]
    public void App_files_and_user_data_live_in_different_folders()
    {
        // The installer owns the app folder and deletes it on update/uninstall; the queue must never be inside it.
        var paths = File.ReadAllText(Path.Combine(Root(), "src", "BasketDrop", "AppPaths.cs"));
        Assert.Contains("\"BasketDrop\")", paths);
        var workflow = Path.Combine(Root(), "..", ".github", "workflows", "basket-pc-release.yml");
        var release = File.ReadAllText(workflow);
        Assert.Contains("PACK_ID: BasketDropApp", release);
        Assert.Contains("--packId $env:PACK_ID", release);
    }

    [Fact]
    public void Uninstall_removes_the_login_and_the_entries_but_not_the_queue()
    {
        var program = File.ReadAllText(Path.Combine(Root(), "src", "BasketDrop", "Program.cs"));
        Assert.Contains("OnBeforeUninstallFastCallback", program);
        Assert.Contains("RemoveRunValue()", program);
        Assert.Contains("CredentialManagerTokenStore().Delete()", program);
        Assert.Contains("SendToShortcut.Remove()", program);
        Assert.DoesNotContain("AppPaths.Root", program);
        Assert.DoesNotContain("AppPaths.Queue", program);
    }

    [Fact]
    public void Auth_requests_go_over_https_and_use_no_service_key()
    {
        var client = File.ReadAllText(Path.Combine(Root(), "src", "BasketDrop.Core", "AuthClient.cs"));
        Assert.Contains("Uri.UriSchemeHttps", client);
        Assert.DoesNotContain("ServerCertificateCustomValidationCallback", string.Join(" ", Sources().Select(File.ReadAllText)));
        Assert.DoesNotContain("DangerousAcceptAnyServerCertificateValidator", string.Join(" ", Sources().Select(File.ReadAllText)));
    }
}
