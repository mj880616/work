namespace BasketDrop.App;

/// <summary>
/// The small "WORK ON+로" tile on the desktop (paper ground, charcoal text and the WORK ON+ icon, S69-30 colours). It is an ordinary,
/// never-topmost window: other windows cover it, and <see cref="DesktopTile"/> keeps it above the desktop so it stays
/// after Win+D. It never takes focus. Files, text and pictures dropped on it go through <see cref="DropData.Send"/>
/// (and so <see cref="TrayApp.Submit"/>); a click opens the file picker; a double click opens the input window
/// (<see cref="TrayApp.OpenPaste"/>, S69-35); pressing and dragging the inside moves it; dragging an edge or corner resizes it.
/// S69-35: it is a layered window drawn by <see cref="TileArt"/> (smooth corners, sharp at every scale and size).
/// </summary>
internal sealed class DesktopTileForm : Form
{
    private const int WsExNoActivate = 0x08000000, WsExToolWindow = 0x80;
    private const int WmNcHitTest = 0x84;
    private const int HtClient = 1, HtLeft = 10, HtRight = 11, HtTop = 12, HtTopLeft = 13, HtTopRight = 14, HtBottom = 15,
        HtBottomLeft = 16, HtBottomRight = 17;

    private readonly TrayApp _app;
    private readonly System.Windows.Forms.Timer _clickTimer = new();
    private int _dpi = 96;
    private Size _at96 = DesktopTileGeometry.SizeAt96;
    private bool _dragOver;
    private bool _busy;
    private bool _pressed;
    private bool _moving;
    private Point _downAt;
    private Point _downLocation;
    private bool _clickPending;
    private Point _clickAt;
    private long _clickMs;

    /// <summary>Raised when a move by mouse ends, with the new top-left corner; the owner clamps and saves it.</summary>
    public event Action<Point>? Moved;

    /// <summary>S69-35: raised when a resize by an edge or corner ends; the owner clamps and saves the place and size.</summary>
    public event Action<Rectangle>? Resized;

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
        Cursor = Cursors.Hand;
        Text = "WORK ON+ 바탕화면 칸";
        AccessibleName = "WORK ON+로";
        AccessibleDescription = "파일·글·사진을 끌어다 놓으면 WORK ON+로 보냅니다. 누르면 파일 선택 창, 두 번 누르면 붙여넣기 창이 열립니다. 눌러서 끌면 옮겨지고, 가장자리를 끌면 크기가 바뀝니다.";
        _clickTimer.Interval = Math.Max(100, SystemInformation.DoubleClickTime);
        _clickTimer.Tick += (_, _) => SingleClick();
    }

    public int Dpi => _dpi;

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= WsExNoActivate | WsExToolWindow | LayeredWindow.WsExLayered;
            return cp;
        }
    }

    /// <summary>Puts the tile at <paramref name="bounds"/> (already sized for <paramref name="dpi"/> from <paramref name="at96"/>).</summary>
    public void Place(Rectangle bounds, int dpi, Size at96)
    {
        _dpi = dpi;
        _at96 = DesktopTileGeometry.ClampAt96(at96);
        SetLimits();
        Bounds = bounds;
        Redraw();
    }

    private void SetLimits()
    {
        // Clear first: a new minimum larger than the old maximum (or the other way) would otherwise be refused.
        MinimumSize = Size.Empty;
        MaximumSize = Size.Empty;
        MinimumSize = DesktopTileGeometry.SizeFor(_dpi, DesktopTileGeometry.MinAt96);
        MaximumSize = DesktopTileGeometry.SizeFor(_dpi, DesktopTileGeometry.MaxAt96);
    }

    /// <summary>The tile was dragged onto a monitor with another scale: keep the top-left corner, take that monitor's size.</summary>
    protected override void OnDpiChanged(DpiChangedEventArgs e)
    {
        e.Cancel = true;
        base.OnDpiChanged(e);
        _dpi = e.DeviceDpiNew;
        SetLimits();
        Size = DesktopTileGeometry.SizeFor(_dpi, _at96);
        Redraw();
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        Redraw();
    }

    protected override void OnSizeChanged(EventArgs e)
    {
        base.OnSizeChanged(e);
        Redraw();
    }

    protected override void OnVisibleChanged(EventArgs e)
    {
        base.OnVisibleChanged(e);
        if (Visible) Redraw();
    }

    /// <summary>A layered window has no WM_PAINT: every change of look or size draws the whole picture again.</summary>
    private void Redraw()
    {
        if (!IsHandleCreated || IsDisposed || Width <= 0 || Height <= 0) return;
        using var picture = TileArt.Render(Size, _dpi, new TileLook(_dragOver, _busy));
        LayeredWindow.Show(Handle, picture);
    }

    private int S(int v) => CornerGeometry.Scale(v, _dpi);

    // ---- edges resize (Windows does the dragging), the inside is ours ----

    protected override void WndProc(ref Message m)
    {
        base.WndProc(ref m);
        if (m.Msg != WmNcHitTest || _busy) return;
        var lp = m.LParam.ToInt64();
        var screen = new Point(unchecked((short)(lp & 0xFFFF)), unchecked((short)((lp >> 16) & 0xFFFF)));
        var zone = TileHitTest.At(PointToClient(screen), Size, S(TileHitTest.EdgeAt96));
        m.Result = (IntPtr)(zone switch
        {
            TileZone.Left => HtLeft,
            TileZone.Right => HtRight,
            TileZone.Top => HtTop,
            TileZone.Bottom => HtBottom,
            TileZone.TopLeft => HtTopLeft,
            TileZone.TopRight => HtTopRight,
            TileZone.BottomLeft => HtBottomLeft,
            TileZone.BottomRight => HtBottomRight,
            _ => HtClient,
        });
    }

    protected override void OnResizeEnd(EventArgs e)
    {
        base.OnResizeEnd(e);
        _at96 = DesktopTileGeometry.ToAt96(Size, _dpi);
        Resized?.Invoke(Bounds);
    }

    /// <summary>The size at 100% scale that this tile shows now (after a resize, before it is saved).</summary>
    public Size At96 => _at96;

    // ---- click opens the file picker, double click the input window, press and drag moves the tile ----

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
            CancelClick();
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
        if (_busy) return;
        var at = Cursor.Position;
        var ms = Environment.TickCount64;
        if (_clickPending && DoubleClickRule.IsDouble(_clickAt, _clickMs, at, ms, _clickTimer.Interval, SystemInformation.DoubleClickSize))
        {
            CancelClick();
            _app.OpenPaste(Bounds, _dpi);
            return;
        }
        // Wait a moment: a second click turns this into a double click.
        _clickPending = true;
        _clickAt = at;
        _clickMs = ms;
        _clickTimer.Stop();
        _clickTimer.Start();
    }

    private void SingleClick()
    {
        CancelClick();
        if (!_busy && !IsDisposed) _app.PickFiles(this);
    }

    private void CancelClick()
    {
        _clickPending = false;
        _clickTimer.Stop();
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
        Redraw();
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
        Redraw();
    }

    protected override void OnDragDrop(DragEventArgs e)
    {
        base.OnDragDrop(e);
        _dragOver = false;
        CancelClick();
        // Copy what was dropped now and answer the other program at once; questions come afterwards (same as the corner box).
        var items = DropData.Read(e.Data);
        if (items.IsEmpty)
        {
            Redraw();
            ToastForm.Show(DropData.Unsupported, true);
            return;
        }
        _busy = true;
        Redraw();
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
            if (!IsDisposed) Redraw();
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _clickTimer.Dispose();
        base.Dispose(disposing);
    }
}
