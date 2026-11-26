using System.Diagnostics;

namespace BasketDrop.App;

/// <summary>
/// S63-09 PC도우미구분(사용자 11/16): people took this tray program for the web app itself and saw nothing open on double-click.
/// This small window says what the program is and opens WORK ON+ (S68-21 name) in the default browser. One window at a time; it holds no data.
/// </summary>
internal sealed class HelperForm : Form
{
    public const string Lead = "이 프로그램은 PC 파일을 WORK ON+로 올리는 도우미예요.";
    public const string Body = "WORK ON+는 크롬·엣지 같은 인터넷 브라우저에서 씁니다. WORK ON+를 쓰려면 [WORK ON+ 열기]를 누르세요.";
    public const string Tray = "도우미는 화면 오른쪽 아래 알림 영역에서 조용히 돌아요. 아이콘을 오른쪽 클릭하면 메뉴가 나와요.";

    private static HelperForm? _current;

    private HelperForm()
    {
        Icon = AppIcon.ForWindow();
        Text = TrayStatus.Name;
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        Font = new Font("Segoe UI", 10f);

        var layout = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, AutoSize = true, Padding = new Padding(16), WrapContents = false };
        layout.Controls.Add(new Label { Text = Lead, AutoSize = true, MaximumSize = new Size(380, 0), Font = new Font("Segoe UI", 10.5f, FontStyle.Bold), Margin = new Padding(0, 0, 0, 8) });
        layout.Controls.Add(new Label { Text = Body, AutoSize = true, MaximumSize = new Size(380, 0), Margin = new Padding(0, 0, 0, 6) });
        layout.Controls.Add(new Label { Text = Tray, AutoSize = true, MaximumSize = new Size(380, 0), ForeColor = SystemColors.GrayText, Margin = new Padding(0, 0, 0, 12) });

        var open = new Button { Text = "WORK ON+ 열기", AutoSize = true };
        open.Click += (_, _) => { OpenNojoPlus(); Close(); };
        var close = new Button { Text = "닫기", AutoSize = true };
        close.Click += (_, _) => Close();
        var buttons = new FlowLayoutPanel { FlowDirection = FlowDirection.LeftToRight, AutoSize = true, Margin = Padding.Empty };
        buttons.Controls.Add(open);
        buttons.Controls.Add(close);
        layout.Controls.Add(buttons);
        Controls.Add(layout);
        AcceptButton = open;
        CancelButton = close;
        FormClosed += (_, _) => { if (_current == this) _current = null; };
    }

    /// <summary>Shows the window, or brings the open one to the front.</summary>
    public static void ShowOrFocus()
    {
        if (_current is { IsDisposed: false })
        {
            if (_current.WindowState == FormWindowState.Minimized) _current.WindowState = FormWindowState.Normal;
            _current.Activate();
            return;
        }
        _current = new HelperForm();
        _current.Show();
        _current.Activate();
    }

    /// <summary>WORK ON+ itself: the web app in the default browser. Only the fixed address, nothing added to it.</summary>
    public static void OpenNojoPlus()
    {
        try { using var _ = Process.Start(new ProcessStartInfo(NojoPlusWeb.AppUrl) { UseShellExecute = true }); }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException) { }
    }
}
