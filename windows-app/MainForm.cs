using System.Diagnostics;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace KPTUWork;

public sealed class MainForm : Form
{
    private const string HomeUrl = "https://mj880616.github.io/work/app/";
    private const string InternalHost = "mj880616.github.io";
    private const string NativeUserAgent = "KPTUWindows/0.1.0";

    private readonly WebView2 webView = new()
    {
        Dock = DockStyle.Fill,
        DefaultBackgroundColor = Color.White
    };

    private string? pendingActivation;
    private bool initialized;

    public MainForm(string? startupActivation)
    {
        pendingActivation = startupActivation;
        Text = "업무 현황";
        StartPosition = FormStartPosition.CenterScreen;
        Width = 1280;
        Height = 860;
        MinimumSize = new Size(900, 620);
        BackColor = Color.White;
        Controls.Add(webView);

        RegisterProtocolHandler();
        Shown += async (_, _) => await InitializeAsync();
    }

    public void HandleActivation(string activation)
    {
        if (string.IsNullOrWhiteSpace(activation)) return;

        if (!initialized || webView.CoreWebView2 is null)
        {
            pendingActivation = activation;
            return;
        }

        Activate();
        WindowState = FormWindowState.Normal;
        BringToFront();
        webView.CoreWebView2.Navigate(BuildTarget(activation));
    }

    private async Task InitializeAsync()
    {
        try
        {
            var dataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "KPTUWork",
                "WebView2");
            Directory.CreateDirectory(dataFolder);

            var environment = await CoreWebView2Environment.CreateAsync(null, dataFolder);
            await webView.EnsureCoreWebView2Async(environment);

            var core = webView.CoreWebView2;
            core.Settings.UserAgent = core.Settings.UserAgent + " " + NativeUserAgent;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.AreDefaultScriptDialogsEnabled = true;
            core.Settings.AreDefaultContextMenusEnabled = true;

            core.NavigationStarting += CoreOnNavigationStarting;
            core.NewWindowRequested += CoreOnNewWindowRequested;
            core.NavigationCompleted += (_, e) =>
            {
                if (!e.IsSuccess)
                    Text = "업무 현황 · 연결 확인 필요";
                else
                    Text = "업무 현황";
            };

            initialized = true;
            var target = BuildTarget(pendingActivation);
            pendingActivation = null;
            core.Navigate(target);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "Windows 앱을 시작하지 못했습니다.\n\nMicrosoft Edge WebView2 Runtime이 설치되어 있는지 확인해 주세요.\n\n" + ex.Message,
                "업무 현황",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            Close();
        }
    }

    private void CoreOnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(e.Uri)) return;

        if (Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri) &&
            uri.Scheme.Equals("kptuwork", StringComparison.OrdinalIgnoreCase))
        {
            e.Cancel = true;
            HandleActivation(e.Uri);
            return;
        }

        if (ShouldOpenExternal(e.Uri))
        {
            e.Cancel = true;
            OpenExternal(e.Uri);
        }
    }

    private void CoreOnNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        if (string.IsNullOrWhiteSpace(e.Uri)) return;

        if (ShouldOpenExternal(e.Uri))
            OpenExternal(e.Uri);
        else
            webView.CoreWebView2.Navigate(e.Uri);
    }

    private static bool ShouldOpenExternal(string raw)
    {
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var uri)) return false;
        if (uri.Scheme is not ("http" or "https")) return true;

        if (GetQueryValue(uri, "external") == "1") return true;

        return !(uri.Scheme.Equals("https", StringComparison.OrdinalIgnoreCase) &&
                 uri.Host.Equals(InternalHost, StringComparison.OrdinalIgnoreCase));
    }

    private static void OpenExternal(string raw)
    {
        try
        {
            Process.Start(new ProcessStartInfo(raw) { UseShellExecute = true });
        }
        catch
        {
            // Keep the app usable even when Windows cannot resolve an external handler.
        }
    }

    private static string BuildTarget(string? activation)
    {
        if (string.IsNullOrWhiteSpace(activation)) return FreshHome();
        if (!Uri.TryCreate(activation, UriKind.Absolute, out var uri)) return FreshHome();

        if (uri.Scheme.Equals("kptuwork", StringComparison.OrdinalIgnoreCase) &&
            uri.Host.Equals("auth", StringComparison.OrdinalIgnoreCase))
        {
            var payload = GetQueryValue(uri, "payload");
            if (!string.IsNullOrWhiteSpace(payload))
                return FreshHome() + "#" + payload;

            var query = uri.Query.TrimStart('?');
            return string.IsNullOrWhiteSpace(query) ? FreshHome() : FreshHome() + "&" + query;
        }

        if (uri.Scheme.Equals("https", StringComparison.OrdinalIgnoreCase) &&
            uri.Host.Equals(InternalHost, StringComparison.OrdinalIgnoreCase))
            return activation;

        return FreshHome();
    }

    private static string FreshHome() =>
        HomeUrl + "?app=" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    private static string? GetQueryValue(Uri uri, string key)
    {
        var query = uri.Query.TrimStart('?');
        if (query.Length == 0) return null;

        foreach (var pair in query.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var parts = pair.Split('=', 2);
            var name = Uri.UnescapeDataString(parts[0]);
            if (!name.Equals(key, StringComparison.OrdinalIgnoreCase)) continue;
            return parts.Length > 1 ? Uri.UnescapeDataString(parts[1]) : string.Empty;
        }

        return null;
    }

    private static void RegisterProtocolHandler()
    {
        try
        {
            var executable = Environment.ProcessPath;
            if (string.IsNullOrWhiteSpace(executable)) return;

            using var root = Registry.CurrentUser.CreateSubKey(@"Software\Classes\kptuwork");
            root?.SetValue(string.Empty, "URL:KPTU Work Protocol");
            root?.SetValue("URL Protocol", string.Empty);

            using var command = Registry.CurrentUser.CreateSubKey(@"Software\Classes\kptuwork\shell\open\command");
            command?.SetValue(string.Empty, $"\"{executable}\" \"%1\"");
        }
        catch
        {
            // Protocol registration is best-effort and requires no administrator rights.
        }
    }
}
