using System.Drawing.Drawing2D;

namespace BasketDrop.App;

/// <summary>
/// The small "바구니로" tile on the desktop (paper colour, navy basket, like the program icon). It is an ordinary,
/// never-topmost window: other windows cover it, and <see cref="DesktopTile"/> keeps it above the desktop so it stays
/// after Win+D. It never takes focus. Files, text and pictures dropped on it go through <see cref="DropData.Send"/>
/// (and so <see cref="TrayApp.Submit"/>); a click opens the paste window; pressing and dragging moves it.
/// Sizes are physical pixels from the monitor's own scale, so it looks the same at 100%, 125% and 150%.
/// </summary>
internal sealed class DesktopTileForm : Form
{
    private const int WsExNoActivate = 0x08000000, WsExToolWindow = 0x80;
    private static readonly Color Paper = Color.FromArgb(0xF2, 0xEF, 0xE6);
    private static readonly Color PaperOver = Color.FromArgb(0xE6, 0xE2, 0xD4);
    private static readonly Color Navy = Color.FromArgb(0x3B, 0x4A, 0x6B);
    private static readonly Color Muted = Color.FromArgb(0x6E, 0x73, 0x7F);
    private static readonly Color Edge = Color.FromArgb(0xCF, 0xC9, 0xB8);

    private readonly TrayApp _app;
    private int _dpi = 96;
    private bool _dragOver;
    private bool _busy;
    private bool _pressed;
    private bool _moving;
    private Point _downAt;
    private Point _downLocation;
    private Icon? _icon;
    private int _iconSize;

    /// <summary>Raised when a move by mouse ends, with the new top-left corner; the owner clamps and saves it.</summary>
    public event Action<Point>? Moved;

    public DesktopTileForm(TrayApp app)
    {
        _app = app;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = false;
        MinimizeBox = false;
        MaximizeBox = false;
        ControlBox = false;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        AllowDrop = true;
        DoubleBuffered = true;
        BackColor = Paper;
        Cursor = Cursors.Hand;
        Text = "바구니 PC드롭 바탕화면 칸";
        AccessibleName = "바구니로";
        AccessibleDescription = "파일·글·사진을 끌어다 놓으면 바구니로 보냅니다. 누르면 붙여넣기 창이 열립니다. 눌러서 끌면 칸이 옮겨집니다.";
    }

    public int Dpi => _dpi;

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= WsExNoActivate | WsExToolWindow;
            return cp;
        }
    }

    /// <summary>Puts the tile at <paramref name="bounds"/> (already sized for <paramref name="dpi"/>).</summary>
    public void Place(Rectangle bounds, int dpi)
    {
        _dpi = dpi;
        Bounds = bounds;
        UpdateShape();
        Invalidate();
    }

    /// <summary>The tile was dragged onto a monitor with another scale: keep the top-left corner, take that monitor's size.</summary>
    protected override void OnDpiChanged(DpiChangedEventArgs e)
    {
        e.Cancel = true;
        base.OnDpiChanged(e);
        _dpi = e.DeviceDpiNew;
        Size = DesktopTileGeometry.SizeFor(_dpi);
        UpdateShape();
        Invalidate();
    }

    protected override void OnSizeChanged(EventArgs e)
    {
        base.OnSizeChanged(e);
        UpdateShape();
    }

    private int S(int v) => CornerGeometry.Scale(v, _dpi);

    private void UpdateShape()
    {
        if (Width <= 0 || Height <= 0) return;
        using var path = RoundRect(new Rectangle(0, 0, Width, Height), S(10));
        var old = Region;
        Region = new Region(path);
        old?.Dispose();
    }

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

    private Icon IconAt(int size)
    {
        if (_icon == null || _iconSize != size)
        {
            _icon?.Dispose();
            _icon = AppIcon.ForSize(size);
            _iconSize = size;
        }
        return _icon;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.Clear(_dragOver ? PaperOver : Paper);

        var edge = new Rectangle(0, 0, Width - 1, Height - 1);
        using (var pen = _dragOver
                   ? new Pen(Navy, Math.Max(1, S(2))) { DashStyle = DashStyle.Dash }
                   : new Pen(Edge, Math.Max(1, S(1))))
        using (var path = RoundRect(_dragOver ? Rectangle.Inflate(edge, -S(2), -S(2)) : edge, S(10)))
            g.DrawPath(pen, path);

        var iconSize = S(32);
        g.DrawIcon(IconAt(iconSize), new Rectangle((Width - iconSize) / 2, S(10), iconSize, iconSize));

        var title = _busy ? "담는 중…" : _dragOver ? "놓으면 바구니로" : "바구니로";
        using var big = new Font("Malgun Gothic", S(13), FontStyle.Bold, GraphicsUnit.Pixel);
        using var small = new Font("Malgun Gothic", S(10), GraphicsUnit.Pixel);
        const TextFormatFlags centered = TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine
                                         | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPadding;
        var titleBox = new Rectangle(S(4), S(46), Width - S(8), S(20));
        var subBox = new Rectangle(S(2), titleBox.Bottom + S(2), Width - S(4), S(16));
        TextRenderer.DrawText(g, title, big, titleBox, Navy, centered);
        if (!_busy) TextRenderer.DrawText(g, "끌어 놓기 · 누르면 쓰기", small, subBox, Muted, centered);
    }

    // ---- click opens the paste window, press and drag moves the tile ----

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left) return;
        _pressed = true;
        _moving = false;
        _downAt = Cursor.Position;
        _downLocation = Location;
        Capture = true;
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        if (!_pressed) return;
        if ((e.Button & MouseButtons.Left) == 0) { EndPress(); return; } // the button-up was missed
        var now = Cursor.Position;
        if (!_moving && TileGesture.IsMove(_downAt, now, S(TileGesture.MoveThresholdAt96)))
        {
            _moving = true;
            Cursor = Cursors.SizeAll;
        }
        if (_moving) Location = new Point(_downLocation.X + now.X - _downAt.X, _downLocation.Y + now.Y - _downAt.Y);
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        if (e.Button != MouseButtons.Left || !_pressed) return;
        var wasMoving = _moving;
        EndPress();
        if (wasMoving) { Moved?.Invoke(Location); return; }
        if (!_busy) _app.ShowPaste();
    }

    /// <summary>Windows took the mouse away in the middle of a move (e.g. a message box): keep the tile where it is.</summary>
    protected override void OnMouseCaptureChanged(EventArgs e)
    {
        base.OnMouseCaptureChanged(e);
        if (!_moving || Capture) return;
        EndPress();
        Moved?.Invoke(Location);
    }

    private void EndPress()
    {
        _pressed = false;
        _moving = false;
        Cursor = Cursors.Hand;
        if (Capture) Capture = false;
    }

    // ---- drag and drop ----

    protected override void OnDragEnter(DragEventArgs e)
    {
        base.OnDragEnter(e);
        e.Effect = !_busy && DropData.Accepts(e.Data) ? DragDropEffects.Copy : DragDropEffects.None;
        _dragOver = e.Effect != DragDropEffects.None;
        Invalidate();
    }

    protected override void OnDragOver(DragEventArgs e)
    {
        base.OnDragOver(e);
        e.Effect = !_busy && DropData.Accepts(e.Data) ? DragDropEffects.Copy : DragDropEffects.None;
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
        // Copy what was dropped now and answer the other program at once; questions come afterwards (same as the corner box).
        var items = DropData.Read(e.Data);
        if (items.IsEmpty)
        {
            Invalidate();
            ToastForm.Show(DropData.Unsupported, true);
            return;
        }
        _busy = true;
        Invalidate();
        BeginInvoke(new Action(() => Send(items)));
    }

    private void Send(DroppedItems items)
    {
        try
        {
            DropData.Send(_app, items, this);
        }
        finally
        {
            _busy = false;
            if (!IsDisposed) Invalidate();
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _icon?.Dispose();
            Region?.Dispose();
        }
        base.Dispose(disposing);
    }
}
