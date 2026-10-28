namespace BasketDrop.App;

/// <summary>
/// The paste window: one editable box. Pasted or typed text can be fixed before sending, and what is sent is exactly
/// what the box shows. A pasted picture or copied files replace the box with a large view, a ✕ to take it out and an
/// optional one-line description (sent as the upload's memo, the same field the old memo line used).
/// The clipboard is read only when the user pastes (Ctrl+V / Shift+Insert) in this window.
/// </summary>
internal sealed class PasteForm : Form
{
    private static readonly Color SendColor = Color.FromArgb(47, 84, 130); // toned-down navy, only while there is something to send

    private readonly TrayApp _app;
    private readonly TextBox _editor = new()
    {
        Multiline = true, AcceptsReturn = true, AcceptsTab = false, WordWrap = true, ScrollBars = ScrollBars.Vertical,
        BorderStyle = BorderStyle.None, Dock = DockStyle.Fill, MaxLength = 0,
    };
    private readonly Label _placeholder = new() { Text = PasteText.Placeholder, AutoSize = true, ForeColor = SystemColors.GrayText };

    private readonly Panel _attachPanel = new() { Dock = DockStyle.Fill, Visible = false };
    private readonly PictureBox _picture = new() { SizeMode = PictureBoxSizeMode.Zoom, Dock = DockStyle.Fill, Visible = false };
    private readonly ListBox _fileList = new() { Dock = DockStyle.Fill, Visible = false, IntegralHeight = false, BorderStyle = BorderStyle.None };
    private readonly Button _removeButton = new() { Text = "✕", FlatStyle = FlatStyle.Flat, TabStop = true };
    private readonly TextBox _caption = new() { Dock = DockStyle.Fill, PlaceholderText = PasteText.CaptionPlaceholder, MaxLength = PasteText.MaxCaptionChars };

    private readonly Label _status = new() { AutoSize = true, Anchor = AnchorStyles.Left, ForeColor = SystemColors.GrayText };
    private readonly Button _sendButton = new() { Text = "보내기 Ctrl+Enter", AutoSize = true, FlatStyle = FlatStyle.Flat };
    private readonly Button _closeButton = new() { Text = "닫기", AutoSize = true };

    /// <summary>The picture or files shown instead of the text box (Text is always null here).</summary>
    private ClipboardContent? _attachment;

    public PasteForm(TrayApp app)
    {
        _app = app;
        Icon = AppIcon.ForWindow();
        Text = "바구니에 붙여넣기";
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(520, 300);
        MinimumSize = new Size(380, 240);
        KeyPreview = true;
        ShowInTaskbar = true;

        _placeholder.Location = new Point(6, 3);
        _placeholder.BackColor = _editor.BackColor;
        _placeholder.Click += (_, _) => _editor.Focus();
        _editor.Controls.Add(_placeholder);

        var removeSize = LogicalToDeviceUnits(28);
        _removeButton.Size = new Size(removeSize, removeSize);
        _removeButton.FlatAppearance.BorderSize = 0;
        _removeButton.BackColor = SystemColors.Control;
        _removeButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        var view = new Panel { Dock = DockStyle.Fill };
        view.Controls.Add(_removeButton);
        view.Controls.Add(_picture);
        view.Controls.Add(_fileList);
        view.Resize += (_, _) => _removeButton.Location = new Point(view.ClientSize.Width - _removeButton.Width - 4, 4);
        var captionRow = new Panel { Dock = DockStyle.Bottom, Height = LogicalToDeviceUnits(30), Padding = new Padding(4, 6, 4, 0) };
        captionRow.Controls.Add(_caption);
        _attachPanel.Controls.Add(view);
        _attachPanel.Controls.Add(captionRow);

        var box = new Panel { Dock = DockStyle.Fill, BorderStyle = BorderStyle.FixedSingle, Padding = new Padding(4), BackColor = _editor.BackColor };
        box.Controls.Add(_editor);
        box.Controls.Add(_attachPanel);

        var buttons = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.RightToLeft, WrapContents = false, Margin = Padding.Empty, Anchor = AnchorStyles.Right };
        buttons.Controls.AddRange(new Control[] { _sendButton, _closeButton });
        var bottom = new TableLayoutPanel { Dock = DockStyle.Bottom, AutoSize = true, ColumnCount = 2, RowCount = 1, Padding = new Padding(0, 8, 0, 0) };
        bottom.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        bottom.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        bottom.Controls.Add(_status, 0, 0);
        bottom.Controls.Add(buttons, 1, 0);

        var body = new Panel { Dock = DockStyle.Fill, Padding = new Padding(12) };
        body.Controls.Add(box);
        body.Controls.Add(bottom);
        Controls.Add(body);

        _editor.TextChanged += (_, _) => { _placeholder.Visible = _editor.TextLength == 0; UpdateState(); GrowToFitText(); };
        _caption.TextChanged += (_, _) => UpdateState();
        _removeButton.Click += (_, _) => RemoveAttachment();
        _sendButton.Click += (_, _) => Send();
        _closeButton.Click += (_, _) => Close();
        ActiveControl = _editor;
        UpdateState();
    }

    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        // In the description line Ctrl+V keeps its normal meaning (paste text into that line).
        if ((keyData == (Keys.Control | Keys.V) || keyData == (Keys.Shift | Keys.Insert)) && !_caption.Focused) { Paste(); return true; }
        if (keyData == (Keys.Control | Keys.Enter)) { Send(); return true; }
        if (keyData == (Keys.Control | Keys.A) && _editor.Focused) { _editor.SelectAll(); return true; }
        // Esc closes only an empty window, so a slip of the finger does not throw away text being fixed.
        if (keyData == Keys.Escape && !HasContent()) { Close(); return true; }
        return base.ProcessCmdKey(ref msg, keyData);
    }

    private void Paste()
    {
        ClipboardContent c;
        try { c = ClipboardReader.Read(); }
        catch (System.Runtime.InteropServices.ExternalException)
        {
            _status.Text = "클립보드를 읽지 못했어요. 잠시 뒤 다시 붙여넣어 주세요.";
            return;
        }
        if (c.IsEmpty)
        {
            _status.Text = c.HasUnsupported ? "이 형식은 붙여넣을 수 없어요." : "클립보드에 붙여넣을 글·사진·파일이 없어요.";
            return;
        }

        if (c.Files.Count > 0 || c.Png != null)
        {
            ShowAttachment(new ClipboardContent(c.Files, null, c.Png));
            return;
        }

        var text = c.Text!;
        if (_attachment != null)
        {
            // While a picture or files are shown, pasted text goes into the description line.
            _caption.Focus();
            _caption.SelectedText = PasteText.OneLine(text);
            return;
        }
        _editor.Focus();
        _editor.SelectedText = text.Replace("\r\n", "\n").Replace('\r', '\n').Replace("\n", "\r\n");
        _editor.ScrollToCaret();
    }

    private void ShowAttachment(ClipboardContent c)
    {
        ClearPicture();
        _attachment = c;
        _picture.Visible = _fileList.Visible = false;
        if (c.Files.Count > 0)
        {
            _fileList.Items.Clear();
            foreach (var f in c.Files) _fileList.Items.Add(FileNames.Clean(f));
            _fileList.Visible = true;
        }
        else
        {
            _picture.Image = Image.FromStream(new MemoryStream(c.Png!));
            _picture.Visible = true;
        }
        _editor.Visible = false;
        _attachPanel.Visible = true;
        _removeButton.BringToFront();
        _caption.Focus();
        UpdateState();
        if (_picture.Image != null) GrowToFitPicture(_picture.Image.Size);
    }

    private void RemoveAttachment()
    {
        ClearPicture();
        _attachment = null;
        _fileList.Items.Clear();
        _caption.Clear();
        _attachPanel.Visible = false;
        _editor.Visible = true;
        _editor.Focus();
        UpdateState();
    }

    private void ClearPicture()
    {
        _picture.Image?.Dispose();
        _picture.Image = null;
    }

    private bool HasContent() => PasteText.CanSend(_editor.Text, _attachment != null);

    /// <summary>One place that sets the status line and the [보내기] look from what the window holds.</summary>
    private void UpdateState()
    {
        if (_attachment == null) _status.Text = PasteText.TextStatus(_editor.Text);
        else
        {
            var s = _picture.Image != null
                ? PasteText.PictureStatus(_picture.Image.Width, _picture.Image.Height)
                : PasteText.FilesStatus(_fileList.Items.Cast<object>().Select(o => o.ToString() ?? "").ToList());
            if (_editor.Text.Trim().Length > 0) s += " · 쓰던 글은 ✕를 누르면 돌아와요";
            _status.Text = s;
        }

        var can = HasContent();
        _sendButton.Enabled = can;
        _sendButton.BackColor = can ? SendColor : SystemColors.Control;
        _sendButton.ForeColor = can ? Color.White : SystemColors.GrayText;
        _sendButton.FlatAppearance.BorderSize = can ? 0 : 1;
        _sendButton.FlatAppearance.BorderColor = SystemColors.ControlDark;
    }

    /// <summary>The window grows with the text, up to the screen height; after that the box scrolls. It never shrinks on its own.</summary>
    private void GrowToFitText()
    {
        if (!_editor.Visible) return;
        var area = Screen.FromControl(this).WorkingArea;
        if (Height >= area.Height) return;
        var width = Math.Max(_editor.ClientSize.Width - 4, 50);
        var needed = TextRenderer.MeasureText(_editor.Text + "\n", _editor.Font, new Size(width, int.MaxValue),
            TextFormatFlags.WordBreak | TextFormatFlags.TextBoxControl).Height;
        GrowBy(needed - _editor.ClientSize.Height, area);
    }

    /// <summary>A pasted picture is shown large: the window grows so the picture fits its width, up to the screen height.</summary>
    private void GrowToFitPicture(Size image)
    {
        var area = Screen.FromControl(this).WorkingArea;
        var box = _picture.ClientSize;
        if (box.Width <= 0 || image.Width <= 0) return;
        var shown = image.Height * Math.Min(1.0, (double)box.Width / image.Width);
        GrowBy((int)Math.Ceiling(shown) - box.Height, area);
    }

    private void GrowBy(int extra, Rectangle area)
    {
        if (extra <= 0) return;
        var height = Math.Min(Height + extra, area.Height);
        if (height <= Height) return;
        var top = Top;
        if (top + height > area.Bottom) top = Math.Max(area.Top, area.Bottom - height);
        SetBounds(Left, top, Width, height);
    }

    private void Send()
    {
        var hasAttachment = _attachment != null;
        if (!PasteText.CanSend(_editor.Text, hasAttachment)) return;
        var sources = hasAttachment ? TrayApp.ToSources(_attachment!) : new List<DropSource>();
        var text = PasteText.Compose(_editor.Text, _caption.Text, hasAttachment);
        if (_app.Submit(sources, text, this)) Close();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _picture.Image?.Dispose();
        base.Dispose(disposing);
    }
}
