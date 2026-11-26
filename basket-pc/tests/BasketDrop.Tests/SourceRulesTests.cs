using System.Text.RegularExpressions;
using Xunit;

namespace BasketDrop.Tests;

/// <summary>Rules the design fixes in code (4.4 token handling, removed entrances), checked on the source files.</summary>
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
    public void Program_reads_no_arguments_and_has_no_path_pipe()
    {
        var program = File.ReadAllText(Path.Combine(Root(), "src", "BasketDrop", "Program.cs"));
        Assert.DoesNotContain("--token", program);
        Assert.DoesNotContain("args", program);
        Assert.DoesNotContain("NamedPipe", program);
        // S63-09: the command line is read in one place only (LaunchArgs), and only for the one fixed word.
        foreach (var file in Sources().Where(f => Path.GetFileName(f) != "LaunchArgs.cs"))
            Assert.DoesNotContain("GetCommandLineArgs", File.ReadAllText(file));
        var launch = File.ReadAllText(Path.Combine(Root(), "src", "BasketDrop.Core", "LaunchArgs.cs"));
        Assert.Contains("public const string Background = \"--background\";", launch);
    }

    [Fact]
    public void A_start_by_the_user_shows_the_helper_window_with_open_nojoplus()
    {
        // S63-09 PC도우미구분(사용자 11/16): the tray program is not 노조+ itself; double-click explains that and opens the web app.
        var program = File.ReadAllText(Path.Combine(Root(), "src", "BasketDrop", "Program.cs"));
        Assert.Contains("if (LaunchArgs.StartedByUser()) HelperSignal.Ring();", program);
        var tray = File.ReadAllText(Path.Combine(Root(), "src", "BasketDrop", "TrayApp.cs"));
        Assert.Contains("ToolStripMenuItem _openNojoPlusItem = new(\"WORK ON+ 열기\")", tray);
        Assert.Contains("if (LaunchArgs.StartedByUser()) HelperForm.ShowOrFocus();", tray);
        Assert.Contains("RegisterWaitForSingleObject(_helperSignal", tray);
        var helper = File.ReadAllText(Path.Combine(Root(), "src", "BasketDrop", "HelperForm.cs"));
        Assert.Contains("이 프로그램은 PC 파일을 WORK ON+로 올리는 도우미예요.", helper);
        Assert.Contains("Text = \"WORK ON+ 열기\"", helper);
        Assert.Contains("new ProcessStartInfo(NojoPlusWeb.AppUrl) { UseShellExecute = true }", helper);
        var update = File.ReadAllText(Path.Combine(Root(), "src", "BasketDrop", "UpdateService.cs"));
        Assert.Contains("ApplyUpdatesAndRestart(_pending, [LaunchArgs.Background])", update);
    }

    [Fact]
    public void The_removed_send_entrances_leave_no_code_behind()
    {
        // Clipboard hotkey, right-click Send to (S54-13). The corner box and desktop tile came back (S69-31).
        // S69-35 (사용자 11/24): an input window opened by a double click on a box came back too; there is still no hotkey.
        foreach (var gone in new[] { "HotkeyWindow.cs", "ClipboardReader.cs", "SendToShortcut.cs", "HotkeyChoice.cs", "PasteText.cs" })
            Assert.DoesNotContain(gone, Sources().Select(Path.GetFileName));
        var all = string.Join(" ", Sources().Select(File.ReadAllText));
        Assert.DoesNotMatch(@"RegisterHotKey|ClipboardReader|OleGetClipboard|SetWindowsHookEx|AddClipboardFormatListener", all);
        var tray = File.ReadAllText(Path.Combine(Root(), "src", "BasketDrop", "TrayApp.cs"));
        foreach (var word in new[] { "단축키", "붙여넣기", "[보내기]" }) Assert.DoesNotContain(word, tray);
    }

    [Fact]
    public void Only_the_input_window_reads_the_clipboard_and_only_when_the_user_presses_paste_in_it()
    {
        // S69-35: the clipboard is read in one place, when Ctrl+V (or Shift+Insert) is pressed in the input window.
        var readers = Sources().Where(f => System.Text.RegularExpressions.Regex.IsMatch(File.ReadAllText(f), @"\bClipboard\.|GetDataObject"))
            .Select(Path.GetFileName).ToList();
        Assert.Equal(new[] { "PasteForm.cs" }, readers);
        var paste = File.ReadAllText(Path.Combine(Root(), "src", "BasketDrop", "PasteForm.cs"));
        Assert.Single(System.Text.RegularExpressions.Regex.Matches(paste, @"Clipboard\.GetDataObject\(\)"));
        Assert.Contains("case Keys.Control | Keys.V:", paste);
        Assert.Contains("if (PasteSpecial()) return true;", paste);
        // It sends through the same gate, keeps what was typed in memory only and talks to no server itself.
        Assert.Contains("DropData.Send(_app,", paste);
        foreach (var banned in new[] { "HttpClient", "BasketApi", "_auth", "File.Write", "AtomicFile", "SettingsStore", "Registry" })
            Assert.DoesNotContain(banned, paste);
        var tray = File.ReadAllText(Path.Combine(Root(), "src", "BasketDrop", "TrayApp.cs"));
        Assert.Contains("public void OpenPaste(Rectangle anchor, int dpi)", tray);
        foreach (var box in new[] { "CornerDropForm.cs", "DesktopTileForm.cs" })
            Assert.Contains("_app.OpenPaste(", File.ReadAllText(Path.Combine(Root(), "src", "BasketDrop", box)));
    }

    [Fact]
    public void The_corner_box_and_desktop_tile_send_only_through_the_one_queue_gate()
    {
        // S69-31 (사용자 11/24): both boxes are back; they add no new server path, only TrayApp.Submit → queue → QueueProcessor.
        foreach (var file in new[] { "CornerRules.cs", "DesktopTileRules.cs", "DropService.cs" })
            Assert.Contains(file, Sources().Select(Path.GetFileName));
        var app = Path.Combine(Root(), "src", "BasketDrop");
        foreach (var file in new[] { "CornerWatcher.cs", "CornerDropForm.cs", "DesktopTile.cs", "DesktopTileForm.cs", "DropData.cs", "MonitorList.cs",
                     "PasteForm.cs", "TileArt.cs", "LayeredWindow.cs" })
        {
            var text = File.ReadAllText(Path.Combine(app, file));
            Assert.DoesNotContain("HttpClient", text);
            Assert.DoesNotContain("BasketApi", text);
            Assert.DoesNotContain("_auth", text);
        }
        var drop = File.ReadAllText(Path.Combine(app, "DropData.cs"));
        Assert.Contains("app.Submit(", drop);
        var submits = Sources().Where(f => File.ReadAllText(f).Contains(".Submit(")).Select(Path.GetFileName).OrderBy(n => n).ToList();
        Assert.Equal(new[] { "DropData.cs" }, submits);
        // The corner watcher reads only mouse buttons, never keys.
        var watcher = File.ReadAllText(Path.Combine(app, "CornerWatcher.cs"));
        Assert.Contains("VkLButton = 0x01, VkRButton = 0x02", watcher);
        Assert.Equal(new[] { "CornerWatcher.cs" }, Sources().Where(f => File.ReadAllText(f).Contains("GetAsyncKeyState")).Select(Path.GetFileName));
        var tray = File.ReadAllText(Path.Combine(app, "TrayApp.cs"));
        Assert.Contains("new(\"화면 구석 칸\")", tray);
        Assert.Contains("new(\"바탕화면 칸\")", tray);
        Assert.Contains("DropBoxDefaults.RestoreOnce(settings)", tray);
    }

    [Fact]
    public void The_first_run_cleanup_only_touches_the_old_send_to_shortcut_and_history_file()
    {
        var legacy = File.ReadAllText(Path.Combine(Root(), "src", "BasketDrop", "LegacyEntries.cs"));
        Assert.Contains("SpecialFolder.SendTo", legacy);
        Assert.Contains("\"바구니 PC드롭.lnk\"", legacy);
        Assert.Contains("LegacyEntriesCleaned", legacy);
        Assert.Contains("queue.List().Count == 0", legacy); // a waiting item is never deleted
        Assert.DoesNotContain("Directory.Delete", legacy);
        Assert.DoesNotContain("EnumerateFiles", legacy);
        Assert.Contains("LegacyEntries.CleanOnce(", File.ReadAllText(Path.Combine(Root(), "src", "BasketDrop", "TrayApp.cs")));
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
    public void Program_name_is_the_same_everywhere_but_the_update_ids_stay()
    {
        // BASKET-노조플러스업로드: shown name changes; packId, exe name and setup file name do not (installed PCs keep updating).
        var release = File.ReadAllText(Path.Combine(Root(), "..", ".github", "workflows", "basket-pc-release.yml"));
        Assert.Contains($"--packTitle \"{TrayStatus.Name}\"", release);
        Assert.Contains("PACK_ID: BasketDropApp", release);
        Assert.Contains("--mainExe BasketDrop.exe", release);
        Assert.Contains("${PACK_ID}-win-Setup.exe", release);
        var tray = File.ReadAllText(Path.Combine(Root(), "src", "BasketDrop", "TrayApp.cs"));
        Assert.Contains("BalloonTipTitle = TrayStatus.Name", tray);
        Assert.Contains("WORK ON+에서 이 PC 보기", tray);
        Assert.Contains("LegacyEntries.RemoveRenamedShortcuts(", tray);
        foreach (var file in Sources())
        {
            var text = File.ReadAllText(file);
            if (Path.GetFileName(file) == "LegacyEntries.cs") continue; // keeps the old Send to file name on purpose
            Assert.DoesNotContain("바구니 PC드롭", text);
            // S68-21(사용자 11/22 17:04): 보이는 글자에 옛 앱 이름 '노조+'가 남지 않는다(옛 바로가기 파일 이름 목록은 RenamedShortcuts.cs만, 주석 제외).
            if (Path.GetFileName(file) != "RenamedShortcuts.cs") Assert.DoesNotMatch("\"[^\"\\n]*노조\\+[^\"\\n]*\"", text);
            Assert.DoesNotMatch("\"[^\"\\n]*(웹2|Web2)[^\"\\n]*\"", text); // shown words only, not comments
        }
    }

    [Fact]
    public void Uninstall_removes_the_login_and_the_entries_but_not_the_queue()
    {
        var program = File.ReadAllText(Path.Combine(Root(), "src", "BasketDrop", "Program.cs"));
        Assert.Contains("OnBeforeUninstallFastCallback", program);
        Assert.Contains("RemoveRunValue()", program);
        Assert.Contains("CredentialManagerTokenStore().Delete()", program);
        Assert.Contains("LegacyEntries.RemoveSendTo()", program);
        Assert.Contains("RenamedShortcuts.RemoveOld(LegacyEntries.ShortcutFolders)", program);
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

    [Fact]
    public void Program_icon_holds_every_size_and_windows_use_it()
    {
        var ico = File.ReadAllBytes(Path.Combine(Root(), "src", "BasketDrop", "app.ico"));
        Assert.Equal(1, BitConverter.ToUInt16(ico, 2)); // type: icon
        var sizes = Enumerable.Range(0, BitConverter.ToUInt16(ico, 4))
            .Select(i => ico[6 + 16 * i] == 0 ? 256 : (int)ico[6 + 16 * i]).OrderBy(x => x).ToArray();
        Assert.Equal(new[] { 16, 20, 24, 32, 40, 48, 64, 256 }, sizes);

        var csproj = File.ReadAllText(Path.Combine(Root(), "src", "BasketDrop", "BasketDrop.csproj"));
        Assert.Contains("<ApplicationIcon>app.ico</ApplicationIcon>", csproj);
        Assert.Contains("BasketDrop.app.ico", csproj);

        var tray = File.ReadAllText(Path.Combine(Root(), "src", "BasketDrop", "TrayApp.cs"));
        Assert.Contains("AppIcon.ForTray()", tray);
        Assert.DoesNotContain("GetHicon", tray); // the old drawn "B" icon must not come back
        foreach (var form in new[] { "StatusForm.cs" })
            Assert.Contains("AppIcon.ForWindow()", File.ReadAllText(Path.Combine(Root(), "src", "BasketDrop", form)));
    }

    private static int[] IcoSizes(string file)
    {
        var ico = File.ReadAllBytes(file);
        Assert.Equal(1, BitConverter.ToUInt16(ico, 2));
        return Enumerable.Range(0, BitConverter.ToUInt16(ico, 4))
            .Select(i => ico[6 + 16 * i] == 0 ? 256 : (int)ico[6 + 16 * i]).OrderBy(x => x).ToArray();
    }

    [Fact]
    public void Tray_status_icons_are_built_and_embedded()
    {
        var csproj = File.ReadAllText(Path.Combine(Root(), "src", "BasketDrop", "BasketDrop.csproj"));
        var appIcon = File.ReadAllText(Path.Combine(Root(), "src", "BasketDrop", "AppIcon.cs"));
        foreach (var name in new[] { "tray-pending.ico", "tray-signedout.ico", "tray-signedout-pending.ico" })
        {
            Assert.Equal(new[] { 16, 20, 24, 32, 40, 48 }, IcoSizes(Path.Combine(Root(), "src", "BasketDrop", name)));
            Assert.Contains($"LogicalName=\"BasketDrop.{name}\"", csproj);
            Assert.Contains($"\"BasketDrop.{name}\"", appIcon);
        }
        var tray = File.ReadAllText(Path.Combine(Root(), "src", "BasketDrop", "TrayApp.cs"));
        Assert.Contains("TrayStatus.From(", tray);
        Assert.Contains("AppIcon.ForTray(picture)", tray);
    }

    [Fact]
    public void Icon_drawing_uses_the_web2_icon_colours()
    {
        static HashSet<string> Colours(string svg) =>
            Regex.Matches(svg, "#[0-9A-Fa-f]{6}").Select(m => m.Value.ToUpperInvariant()).ToHashSet();
        var web2 = Colours(File.ReadAllText(Path.Combine(Root(), "..", "app", "app-icon.svg")));
        var basket = Colours(File.ReadAllText(Path.Combine(Root(), "icon", "basket-icon.svg")));
        basket.Remove("#C9673D"); // the waiting dot, the only extra colour
        Assert.Equal(web2.OrderBy(x => x), basket.OrderBy(x => x));
        Assert.True(File.Exists(Path.Combine(Root(), "tools", "make-icon.py")));
    }
}
