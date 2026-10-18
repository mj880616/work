namespace BasketDrop.App;

/// <summary>
/// Small notice in the bottom-right corner for about two seconds. It never takes focus, makes no sound and
/// passes mouse clicks through, so it cannot interrupt what the user is typing.
/// </summary>
internal sealed class ToastForm : Form
{
    private const int WsExNoActivate = 0x08000000, WsExToolWindow = 0x80, WsExTransparent = 0x20;
    private static ToastForm? _current;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 2200 };

    private ToastForm(string text, bool warning)
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        BackColor = warning ? Color.FromArgb(120, 53, 15) : Color.FromArgb(30, 41, 59);
        var label = new Label
        {
            Text = text, ForeColor = Color.White, AutoSize = true, MaximumSize = new Size(360, 0),
            Padding = new Padding(14, 10, 14, 10), Font = new Font("Segoe UI", 10f),
        };
        Controls.Add(label);
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        _timer.Tick += (_, _) => Close();
        FormClosed += (_, _) => { _timer.Dispose(); if (_current == this) _current = null; };
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= WsExNoActivate | WsExToolWindow | WsExTransparent;
            return cp;
        }
    }

    public static void Show(string text, bool warning = false)
    {
        _current?.Close();
        var toast = new ToastForm(text, warning);
        _current = toast;
        var area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1280, 720);
        toast.Show();
        toast.Location = new Point(area.Right - toast.Width - 16, area.Bottom - toast.Height - 16);
        toast._timer.Start();
    }
}
