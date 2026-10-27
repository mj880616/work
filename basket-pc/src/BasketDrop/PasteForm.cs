namespace BasketDrop.App;

/// <summary>Ctrl+V → preview → one memo line → Ctrl+Enter. The clipboard is read only when Ctrl+V or [붙여넣기] is pressed.</summary>
internal sealed class PasteForm : Form
{
    private readonly TrayApp _app;
    private readonly Label _hint = new() { Text = "Ctrl+V로 복사한 글·사진·파일을 붙여넣어요.", AutoSize = true, Dock = DockStyle.Top, Padding = new Padding(0, 0, 0, 6) };
    private readonly TextBox _textPreview = new() { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Fill, Visible = false };
    private readonly PictureBox _picture = new() { SizeMode = PictureBoxSizeMode.Zoom, Dock = DockStyle.Fill, Visible = false };
    private readonly ListBox _fileList = new() { Dock = DockStyle.Fill, Visible = false, IntegralHeight = false };
    private readonly TextBox _memo = new() { Dock = DockStyle.Fill, PlaceholderText = "메모 한 줄 (없어도 돼요)", MaxLength = 200 };
    private readonly Button _pasteButton = new() { Text = "붙여넣기 (Ctrl+V)", AutoSize = true };
    private readonly Button _sendButton = new() { Text = "보내기 (Ctrl+Enter)", AutoSize = true, Enabled = false };
    private readonly Button _closeButton = new() { Text = "닫기 (Esc)", AutoSize = true };
    private ClipboardContent? _content;

    public PasteForm(TrayApp app)
    {
        _app = app;
        Icon = AppIcon.ForWindow();
        Text = "바구니에 붙여넣기";
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(520, 380);
        MinimumSize = new Size(380, 280);
        KeyPreview = true;
        ShowInTaskbar = true;

        var preview = new Panel { Dock = DockStyle.Fill, BorderStyle = BorderStyle.FixedSingle };
        preview.Controls.AddRange(new Control[] { _textPreview, _picture, _fileList });

        var memoRow = new Panel { Dock = DockStyle.Bottom, Height = 32, Padding = new Padding(0, 6, 0, 0) };
        memoRow.Controls.Add(_memo);

        var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, AutoSize = true, FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(0, 8, 0, 0) };
        buttons.Controls.AddRange(new Control[] { _closeButton, _sendButton, _pasteButton });

        var body = new Panel { Dock = DockStyle.Fill, Padding = new Padding(12) };
        body.Controls.Add(preview);
        body.Controls.Add(memoRow);
        body.Controls.Add(buttons);
        body.Controls.Add(_hint);
        Controls.Add(body);

        _pasteButton.Click += (_, _) => Paste();
        _sendButton.Click += (_, _) => Send();
        _closeButton.Click += (_, _) => Close();
        ActiveControl = _pasteButton;
    }

    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        // In the memo box Ctrl+V keeps its normal meaning (paste into the memo line).
        if (keyData == (Keys.Control | Keys.V) && !_memo.Focused) { Paste(); return true; }
        if (keyData == (Keys.Control | Keys.Enter)) { Send(); return true; }
        if (keyData == Keys.Escape) { Close(); return true; }
        return base.ProcessCmdKey(ref msg, keyData);
    }

    private void Paste()
    {
        ClipboardContent c;
        try { c = ClipboardReader.Read(); }
        catch (System.Runtime.InteropServices.ExternalException)
        {
            _hint.Text = "클립보드를 읽지 못했어요. 잠시 뒤 다시 눌러 주세요.";
            return;
        }
        if (c.IsEmpty)
        {
            _hint.Text = "클립보드에 붙여넣을 글·사진·파일이 없어요.";
            return;
        }
        _content = c;
        _textPreview.Visible = _picture.Visible = _fileList.Visible = false;
        _picture.Image?.Dispose();
        _picture.Image = null;

        if (c.Files.Count > 0)
        {
            _fileList.Items.Clear();
            foreach (var f in c.Files) _fileList.Items.Add(FileNames.Clean(f));
            _fileList.Visible = true;
            _hint.Text = $"파일 {c.Files.Count}개를 붙여넣었어요.";
        }
        else if (c.Text != null)
        {
            _textPreview.Text = c.Text;
            _textPreview.Visible = true;
            _hint.Text = $"글 {Limits.TextLength(c.Text):N0}자를 붙여넣었어요.";
        }
        else if (c.Png != null)
        {
            _picture.Image = Image.FromStream(new MemoryStream(c.Png));
            _picture.Visible = true;
            _hint.Text = "사진을 붙여넣었어요.";
        }
        _sendButton.Enabled = true;
        _memo.Focus();
    }

    private void Send()
    {
        if (_content == null) return;
        var memo = _memo.Text.Trim();
        var pasted = _content.Text ?? "";
        var text = memo.Length > 0 && pasted.Length > 0 ? memo + "\n\n" + pasted : memo.Length > 0 ? memo : pasted;
        if (_app.Submit(TrayApp.ToSources(_content), text, this)) Close();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _picture.Image?.Dispose();
        base.Dispose(disposing);
    }
}
