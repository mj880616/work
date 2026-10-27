using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

namespace BasketDrop.App;

/// <summary>
/// The small drop box that the hot corner opens. It never takes focus (so typing elsewhere is not interrupted), stays
/// above other windows while open, and accepts files, text and pictures dragged onto it. A click opens the paste
/// window. Everything dropped goes through <see cref="TrayApp.Submit"/>, the same gate as every other entry.
/// Sizes are physical pixels worked out from the monitor's own scale, so it looks the same at 100%, 125% and 150%.
/// </summary>
internal sealed class CornerDropForm : Form
{
    private const int WsExNoActivate = 0x08000000, WsExToolWindow = 0x80, WsExTopmost = 0x8;

    private readonly TrayApp _app;
    private Rectangle _target;
    private int _dpi = 96;
    private bool _dragOver;
    private bool _busy;

    /// <summary>Raised after something was dropped (or the paste window was opened), so the watcher closes the box.</summary>
    public event Action? Dropped;

    /// <summary>True while a drag is over the box or a question about the drop is on screen; the box must stay.</summary>
    public bool HoldOpen => _dragOver || _busy;

    public CornerDropForm(TrayApp app)
    {
        _app = app;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        AllowDrop = true;
        DoubleBuffered = true;
        BackColor = Color.FromArgb(30, 41, 59);
        Cursor = Cursors.Hand;
        Text = "바구니 PC드롭 구석 칸";
        AccessibleName = "바구니에 놓기";
        AccessibleDescription = "파일·글·사진을 여기에 끌어다 놓으면 바구니로 보냅니다. 누르면 붙여넣기 창이 열립니다.";
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= WsExNoActivate | WsExToolWindow | WsExTopmost;
            return cp;
        }
    }

    public void ShowBox(Rectangle bounds, int dpi, CornerChoice corner)
    {
        _target = bounds;
        _dpi = dpi;
        _dragOver = false;
        _busy = false;
        Bounds = bounds;
        if (!Visible) Visible = true; // ShowWithoutActivation: shown with SW_SHOWNOACTIVATE
        Bounds = bounds; // again, in case Windows moved it while it appeared on a monitor with another scale
        Invalidate();
    }

    public void HideBox()
    {
        _dragOver = false;
        if (_busy) return;
        if (Visible) Visible = false;
    }

    /// <summary>Keep our own size when the box lands on a monitor with another scale; it is already sized for that monitor.</summary>
    protected override void OnDpiChanged(DpiChangedEventArgs e)
    {
        e.Cancel = true;
        base.OnDpiChanged(e);
        if (!_target.IsEmpty) Bounds = _target;
    }

    private int S(int v) => CornerGeometry.Scale(v, _dpi);

    private static GraphicsPath RoundRect(Rectangle r, int radius)
    {
        var path = new GraphicsPath();
        var d = Math.Max(2, radius * 2);
        path.AddArc(r.Left, r.Top, d, d, 180, 90);
        path.AddArc(r.Right - d, r.Top, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        path.AddArc(r.Left, r.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        var back = _dragOver ? Color.FromArgb(21, 94, 117) : Color.FromArgb(30, 41, 59);
        g.Clear(back);

        var inner = new Rectangle(S(8), S(8), Width - S(16), Height - S(16));
        using (var pen = new Pen(Color.FromArgb(_dragOver ? 255 : 160, 226, 232, 240), Math.Max(1, S(2))) { DashStyle = DashStyle.Dash })
        using (var path = RoundRect(inner, S(8)))
            g.DrawPath(pen, path);

        var title = _busy ? "담는 중…" : _dragOver ? "놓으면 바구니로" : "여기에 끌어다 놓기";
        var sub = _busy ? "" : "누르면 붙여넣기 창";
        using var big = new Font("Segoe UI", S(17), FontStyle.Bold, GraphicsUnit.Pixel);
        using var small = new Font("Segoe UI", S(12), GraphicsUnit.Pixel);
        var titleBox = new Rectangle(inner.Left, inner.Top + S(18), inner.Width, S(30));
        var subBox = new Rectangle(inner.Left, titleBox.Bottom + S(6), inner.Width, S(22));
        const TextFormatFlags centered = TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis;
        TextRenderer.DrawText(g, title, big, titleBox, Color.White, centered);
        if (sub.Length > 0) TextRenderer.DrawText(g, sub, small, subBox, Color.FromArgb(203, 213, 225), centered);
    }

    // ---- click: open the paste window ----

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        if (e.Button != MouseButtons.Left || _busy) return;
        Dropped?.Invoke();
        _app.ShowPaste();
    }

    // ---- drag and drop ----

    private static bool Accepts(IDataObject? data) =>
        data != null && (data.GetDataPresent(DataFormats.FileDrop) || data.GetDataPresent(DataFormats.UnicodeText)
                         || data.GetDataPresent(DataFormats.Text) || data.GetDataPresent(DataFormats.Bitmap));

    protected override void OnDragEnter(DragEventArgs e)
    {
        base.OnDragEnter(e);
        e.Effect = !_busy && Accepts(e.Data) ? DragDropEffects.Copy : DragDropEffects.None;
        _dragOver = e.Effect != DragDropEffects.None;
        Invalidate();
    }

    protected override void OnDragOver(DragEventArgs e)
    {
        base.OnDragOver(e);
        e.Effect = !_busy && Accepts(e.Data) ? DragDropEffects.Copy : DragDropEffects.None;
    }

    protected override void OnDragLeave(EventArgs e)
    {
        base.OnDragLeave(e);
        _dragOver = false;
        Invalidate();
    }

    protected override void OnDragDrop(DragEventArgs e)
    {
        base.OnDragDrop(e);
        _dragOver = false;
        // Copy what was dropped now, then answer the program it came from at once; any question is asked afterwards
        // so the other program (e.g. Explorer) is not left waiting while a message box is open.
        var (files, text, png) = Read(e.Data);
        if (files.Count == 0 && text == null && png == null)
        {
            Invalidate();
            ToastForm.Show("이 형식은 보낼 수 없어요. 글·사진·파일만 보낼 수 있어요.", true);
            return;
        }
        _busy = true;
        Invalidate();
        BeginInvoke(new Action(() => Send(files, text, png)));
    }

    private static (List<string> Files, string? Text, byte[]? Png) Read(IDataObject? data)
    {
        var files = new List<string>();
        if (data == null) return (files, null, null);
        if (data.GetData(DataFormats.FileDrop) is string[] paths)
            files.AddRange(paths.Where(p => !string.IsNullOrWhiteSpace(p)));
        string? text = null;
        if (files.Count == 0)
        {
            var t = data.GetData(DataFormats.UnicodeText) as string ?? data.GetData(DataFormats.Text) as string;
            if (t != null && t.Trim().Length > 0) text = t;
        }
        byte[]? png = null;
        if (files.Count == 0 && text == null && data.GetData(DataFormats.Bitmap) is Image image)
        {
            using var ms = new MemoryStream();
            image.Save(ms, ImageFormat.Png);
            png = ms.ToArray();
        }
        return (files, text, png);
    }

    private void Send(List<string> files, string? text, byte[]? png)
    {
        try
        {
            var sources = files.Select(DropSource.FromPath).ToList();
            if (png != null) sources.Add(DropSource.FromBytes(png, $"끌어놓기-{DateTime.Now:yyyyMMdd-HHmmss}.png"));
            if (_app.Submit(sources, text ?? "", this))
                ToastForm.Show(files.Count > 0 ? $"대기열에 담았어요 (파일 {files.Count}개)" : text != null ? "대기열에 담았어요 (글)" : "대기열에 담았어요 (사진)");
        }
        finally
        {
            _busy = false;
            Dropped?.Invoke();
        }
    }
}
