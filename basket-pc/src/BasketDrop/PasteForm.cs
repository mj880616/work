using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace BasketDrop.App;

/// <summary>
/// S69-35 (사용자 11/24 "더블클릭하면 입력창 나오고 거기엔 텍스트든 그림이든 복붙 가능"): the small input window a double
/// click on a drop box opens. Several lines of text, Ctrl+V of text, pictures (screenshots, copied pictures) and copied
/// files, and drag and drop. Pictures and files show as small previews with an X to take them out. [보내기] (Ctrl+Enter)
/// sends through <see cref="DropData.Send"/> → <see cref="TrayApp.Submit"/>, the same gate and queue as a drop: text as a
/// text item, pictures as PNG file items, files as file items. Esc or a click elsewhere closes it; what was typed stays in
/// this window in memory only (never written to disk) until it is sent or the program quits.
/// </summary>
internal sealed class PasteForm : Form
{
    private const int DwmwaWindowCornerPreference = 33, DwmwcpRoundSmall = 3;
    private static readonly Color Paper = TileArt.Paper;
    private static readonly Color Field = Color.FromArgb(0xFB, 0xFA, 0xF6);
    private static readonly Color Navy = TileArt.Navy;
    private static readonly Color Muted = TileArt.Muted;
    private static readonly Color Edge = TileArt.Edge;
    private const string Hint = "Ctrl+V 붙여넣기 · Ctrl+Enter 보내기 · Esc 닫기";

    private readonly TrayApp _app;
    private readonly List<PasteItem> _items = new();
    private readonly FlowLayoutPanel _strip = new() { WrapContents = false, AutoScroll = true, Margin = Padding.Empty };
    private readonly Panel _box = new();
    private readonly TextBox _text = new() { Multiline = true, AcceptsReturn = true, BorderStyle = BorderStyle.None, ScrollBars = ScrollBars.Vertical };
    private readonly Label _hint = new() { AutoEllipsis = true, TextAlign = ContentAlignment.MiddleLeft };
    private readonly Button _send = new() { Text = "보내기", FlatStyle = FlatStyle.Flat, UseVisualStyleBackColor = false };
    private readonly ToolTip _tips = new();
    private int _dpi = 96;
    private bool _sending;
    private Rectangle _anchor;

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    public PasteForm(TrayApp app)
    {
        _app = app;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        KeyPreview = true;
        AllowDrop = true;
        BackColor = Paper;
        Text = "WORK ON+로 붙여넣기";
        AccessibleName = "WORK ON+로 붙여넣기";
        AccessibleDescription = "글을 쓰거나 Ctrl+V로 글·그림·파일을 붙여 넣고 보내기를 누르면 WORK ON+로 보냅니다.";

        _box.BackColor = Field;
        _text.BackColor = Field;
        _text.ForeColor = Navy;
        _text.AccessibleName = "보낼 글";
        _box.Controls.Add(_text);
        _hint.ForeColor = Muted;
        _hint.Text = Hint;
        _send.BackColor = Navy;
        _send.ForeColor = Paper;
        _send.FlatAppearance.BorderSize = 0;
        _send.Cursor = Cursors.Hand;
        _send.Click += (_, _) => Send();
        _strip.BackColor = Paper;
        _strip.Visible = false;
        Controls.Add(_strip);
        Controls.Add(_box);
        Controls.Add(_hint);
        Controls.Add(_send);

        foreach (Control c in new Control[] { this, _box, _text, _strip, _hint })
        {
            c.AllowDrop = true;
            c.DragEnter += OnDragIn;
            c.DragOver += OnDragIn;
            c.DragDrop += OnDropped;
        }
        Relayout();
    }

    private int S(int v) => CornerGeometry.Scale(v, _dpi);

    /// <summary>Opens (or brings back) the window next to the box at <paramref name="anchor"/>, on its monitor's scale.</summary>
    public void ShowNear(Rectangle anchor, int dpi)
    {
        _anchor = anchor;
        _dpi = dpi;
        _hint.ForeColor = Muted;
        _hint.Text = Hint;
        Relayout();
        Bounds = PastePlacement.Near(anchor, Size, Screen.FromRectangle(anchor).WorkingArea, S(8));
        if (!Visible) Show();
        Activate();
        _text.Focus();
        _text.SelectionStart = _text.TextLength;
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        // Windows 11: small round corners drawn by the system (smooth). Windows 10 ignores this and keeps square corners.
        var round = DwmwcpRoundSmall;
        try { _ = DwmSetWindowAttribute(Handle, DwmwaWindowCornerPreference, ref round, sizeof(int)); }
        catch (DllNotFoundException) { }
        catch (EntryPointNotFoundException) { }
    }

    protected override void OnDpiChanged(DpiChangedEventArgs e)
    {
        e.Cancel = true;
        base.OnDpiChanged(e);
        _dpi = e.DeviceDpiNew;
        Relayout();
        KeepOnScreen();
    }

    /// <summary>All sizes come from the monitor's scale, so the window is equally sharp at 100%, 125%, 150% and 200%.</summary>
    private void Relayout()
    {
        SuspendLayout();
        var pad = S(8);
        var width = S(320);
        var y = pad;
        var thumb = S(48);
        _strip.Visible = _items.Count > 0;
        if (_strip.Visible)
        {
            _strip.Bounds = new Rectangle(pad, y, width - 2 * pad, thumb + S(4));
            foreach (Control c in _strip.Controls)
            {
                c.Size = new Size(thumb, thumb);
                c.Margin = new Padding(0, 0, S(6), 0);
            }
            y = _strip.Bottom + S(6);
        }
        _box.Bounds = new Rectangle(pad, y, width - 2 * pad, S(88));
        _box.Padding = new Padding(S(6));
        _text.Font = new Font("Malgun Gothic", S(13), GraphicsUnit.Pixel);
        _text.Bounds = new Rectangle(S(6), S(6), _box.Width - S(12), _box.Height - S(12));
        y = _box.Bottom + S(6);
        var row = S(26);
        _send.Font = new Font("Malgun Gothic", S(12), FontStyle.Bold, GraphicsUnit.Pixel);
        _send.Bounds = new Rectangle(width - pad - S(64), y, S(64), row);
        _hint.Font = new Font("Malgun Gothic", S(11), GraphicsUnit.Pixel);
        _hint.Bounds = new Rectangle(pad, y, _send.Left - pad - S(6), row);
        ClientSize = new Size(width, y + row + pad);
        ResumeLayout(true);
        Invalidate();
    }

    private void KeepOnScreen()
    {
        if (!Visible) return;
        var area = Screen.FromRectangle(_anchor.IsEmpty ? Bounds : _anchor).WorkingArea;
        var w = Math.Min(Width, area.Width);
        var h = Math.Min(Height, area.Height);
        Location = new Point(Math.Clamp(Left, area.Left, area.Right - w), Math.Clamp(Top, area.Top, area.Bottom - h));
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        using var pen = new Pen(Edge);
        e.Graphics.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
        using var field = new Pen(Edge);
        e.Graphics.DrawRectangle(field, _box.Left - 1, _box.Top - 1, _box.Width + 1, _box.Height + 1);
    }

    // ---- keys: Ctrl+V for pictures and files, Ctrl+Enter sends, Esc closes ----

    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        switch (keyData)
        {
            case Keys.Escape:
                Hide();
                return true;
            case Keys.Control | Keys.Enter:
                Send();
                return true;
            case Keys.Control | Keys.A when _text.Focused:
                _text.SelectAll();
                return true;
            case Keys.Control | Keys.V:
            case Keys.Shift | Keys.Insert:
                if (PasteSpecial()) return true;
                break;
        }
        return base.ProcessCmdKey(ref msg, keyData);
    }

    /// <summary>
    /// Copied files first, then text (the text box pastes it itself; copies from Word or Excel carry a picture too, and
    /// the words are what was meant), then a picture. Returns true when this took the paste.
    /// </summary>
    private bool PasteSpecial()
    {
        IDataObject? data;
        try { data = Clipboard.GetDataObject(); }
        catch (ExternalException) { return false; }
        if (data == null) return false;
        if (data.GetData(DataFormats.FileDrop) is string[] files && files.Length > 0)
        {
            AddFiles(files);
            return true;
        }
        if (data.GetDataPresent(DataFormats.UnicodeText) || data.GetDataPresent(DataFormats.Text)) return false;
        if (DropData.PictureOf(data) is { } png)
        {
            AddPicture(png);
            return true;
        }
        return false;
    }

    // ---- drag and drop onto the window ----

    private void OnDragIn(object? sender, DragEventArgs e) =>
        e.Effect = !_sending && DropData.Accepts(e.Data) ? DragDropEffects.Copy : DragDropEffects.None;

    private void OnDropped(object? sender, DragEventArgs e)
    {
        var dropped = DropData.Read(e.Data);
        if (dropped.IsEmpty) { Say(DropData.Unsupported); return; }
        AddFiles(dropped.Files);
        foreach (var png in dropped.Pngs) AddPicture(png);
        if (dropped.Text is { } text)
        {
            _text.SelectedText = text;
            _text.Focus();
        }
    }

    // ---- the previews ----

    private bool Room()
    {
        if (_items.Count < Limits.MaxFilesPerNote) return true;
        Say($"한 번에 {Limits.MaxFilesPerNote}개까지 보낼 수 있어요.");
        return false;
    }

    private void AddFiles(IEnumerable<string> paths)
    {
        foreach (var path in paths.Where(p => !string.IsNullOrWhiteSpace(p)))
        {
            if (!Room()) break;
            Add(new PasteItem(path, null, Path.GetFileName(path), PasteItem.ThumbOfFile(path)));
        }
    }

    private void AddPicture(byte[] png)
    {
        if (!Room()) return;
        var n = _items.Count(i => i.Png != null) + 1;
        Add(new PasteItem(null, png, $"그림 {n}", PasteItem.ThumbOfBytes(png)));
    }

    private void Add(PasteItem item)
    {
        _items.Add(item);
        var tile = new PasteThumb(item);
        tile.RemoveClicked += () => Remove(item, tile);
        _tips.SetToolTip(tile, item.Name);
        _strip.Controls.Add(tile);
        Relayout();
        KeepOnScreen();
    }

    private void Remove(PasteItem item, PasteThumb tile)
    {
        _items.Remove(item);
        _strip.Controls.Remove(tile);
        tile.Dispose();
        item.Dispose();
        Relayout();
        _text.Focus();
    }

    private void ClearAll()
    {
        foreach (Control c in _strip.Controls.Cast<Control>().ToList()) c.Dispose();
        _strip.Controls.Clear();
        foreach (var i in _items) i.Dispose();
        _items.Clear();
        _text.Clear();
        Relayout();
    }

    private void Say(string line)
    {
        _hint.ForeColor = Navy;
        _hint.Text = line;
    }

    // ---- sending ----

    private void Send()
    {
        if (_sending) return;
        var text = _text.Text;
        var hasText = text.Trim().Length > 0;
        if (!hasText && _items.Count == 0) { Say("보낼 글이나 그림이 없어요."); return; }
        var files = _items.Where(i => i.Path != null).Select(i => i.Path!).ToList();
        var pngs = _items.Where(i => i.Png != null).Select(i => i.Png!).ToList();
        bool sent;
        _sending = true;
        try { sent = DropData.Send(_app, new DroppedItems(files, hasText ? text : null, pngs), this, "붙여넣기"); }
        finally { _sending = false; }
        if (!sent) { Activate(); _text.Focus(); return; }
        ClearAll();
        Hide();
    }

    // ---- closing keeps what was typed (in memory) ----

    protected override void OnDeactivate(EventArgs e)
    {
        base.OnDeactivate(e);
        // A question from Submit (a message box) also takes the focus away; only a click elsewhere closes.
        if (!_sending && Visible) Hide();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Hide();
            return;
        }
        base.OnFormClosing(e);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            foreach (var i in _items) i.Dispose();
            _items.Clear();
            _tips.Dispose();
        }
        base.Dispose(disposing);
    }
}

/// <summary>One picture or file waiting in the input window, with its small preview (memory only).</summary>
internal sealed class PasteItem : IDisposable
{
    private const int ThumbPixels = 128;
    private const long MaxPreviewBytes = 40L * 1024 * 1024;
    private static readonly string[] PictureEndings = { ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tif", ".tiff" };

    public PasteItem(string? path, byte[]? png, string name, Bitmap? thumb)
    {
        Path = path;
        Png = png;
        Name = name;
        Thumb = thumb;
    }

    public string? Path { get; }
    public byte[]? Png { get; }
    public string Name { get; }
    public Bitmap? Thumb { get; private set; }

    public static Bitmap? ThumbOfBytes(byte[] bytes)
    {
        try
        {
            using var ms = new MemoryStream(bytes);
            using var image = Image.FromStream(ms);
            return Shrink(image);
        }
        catch (ArgumentException) { return null; }
        catch (ExternalException) { return null; }
    }

    /// <summary>A preview for a picture file; other files (and pictures too large to open quickly) get a plain file mark.</summary>
    public static Bitmap? ThumbOfFile(string path)
    {
        try
        {
            var ending = System.IO.Path.GetExtension(path).ToLowerInvariant();
            if (!PictureEndings.Contains(ending)) return null;
            var info = new FileInfo(path);
            if (!info.Exists || info.Length > MaxPreviewBytes) return null;
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            using var image = Image.FromStream(stream, false, false);
            return Shrink(image);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentException or ExternalException or NotSupportedException)
        {
            return null;
        }
    }

    private static Bitmap Shrink(Image image)
    {
        var k = Math.Min(1.0, ThumbPixels / (double)Math.Max(image.Width, image.Height));
        var w = Math.Max(1, (int)Math.Round(image.Width * k));
        var h = Math.Max(1, (int)Math.Round(image.Height * k));
        var bmp = new Bitmap(w, h);
        using var g = Graphics.FromImage(bmp);
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.DrawImage(image, new Rectangle(0, 0, w, h));
        return bmp;
    }

    public void Dispose()
    {
        Thumb?.Dispose();
        Thumb = null;
    }
}

/// <summary>A small square preview with an X in the corner that takes the item out.</summary>
internal sealed class PasteThumb : Control
{
    private readonly PasteItem _item;
    private bool _overX;

    public event Action? RemoveClicked;

    public PasteThumb(PasteItem item)
    {
        _item = item;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        BackColor = Color.FromArgb(0xFB, 0xFA, 0xF6);
        AccessibleName = item.Name;
        AccessibleRole = AccessibleRole.Graphic;
    }

    private Rectangle XBox
    {
        get
        {
            var s = Math.Max(12, Width / 3);
            return new Rectangle(Width - s, 0, s, s);
        }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.Clear(BackColor);
        if (_item.Thumb is { } thumb)
        {
            var k = Math.Min((Width - 4) / (double)thumb.Width, (Height - 4) / (double)thumb.Height);
            var w = (int)Math.Round(thumb.Width * k);
            var h = (int)Math.Round(thumb.Height * k);
            g.DrawImage(thumb, new Rectangle((Width - w) / 2, (Height - h) / 2, w, h));
        }
        else
        {
            var ending = System.IO.Path.GetExtension(_item.Name).TrimStart('.').ToUpperInvariant();
            if (ending.Length == 0 || ending.Length > 5) ending = "파일";
            using var font = new Font("Malgun Gothic", Math.Max(8, Height / 5), FontStyle.Bold, GraphicsUnit.Pixel);
            TextRenderer.DrawText(g, ending, font, ClientRectangle, TileArt.Muted, BackColor,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
        }
        using (var pen = new Pen(TileArt.Edge)) g.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);

        var x = XBox;
        var dot = Rectangle.Inflate(x, -2, -2);
        using (var fill = new SolidBrush(_overX ? TileArt.Navy : Color.FromArgb(0xC8, 0x22, 0x26, 0x2B))) g.FillEllipse(fill, dot);
        var p = Math.Max(3, dot.Width / 3);
        using var cross = new Pen(TileArt.Paper, Math.Max(1.2f, dot.Width / 9f));
        g.DrawLine(cross, dot.Left + p, dot.Top + p, dot.Right - p, dot.Bottom - p);
        g.DrawLine(cross, dot.Right - p, dot.Top + p, dot.Left + p, dot.Bottom - p);
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        var over = XBox.Contains(e.Location);
        if (over == _overX) return;
        _overX = over;
        Cursor = over ? Cursors.Hand : Cursors.Default;
        Invalidate();
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        base.OnMouseLeave(e);
        if (!_overX) return;
        _overX = false;
        Invalidate();
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        if (e.Button == MouseButtons.Left && XBox.Contains(e.Location)) RemoveClicked?.Invoke();
    }
}
