namespace BasketDrop.App;

/// <summary>Queue and sent history. Shows counts and times; the history holds no file names.</summary>
internal sealed class StatusForm : Form
{
    private readonly QueueStore _store;
    private readonly HistoryStore _history;
    private readonly QueueProcessor _processor;
    private readonly Action _kick;
    private readonly ListView _queue = new() { Dock = DockStyle.Fill, View = View.Details, FullRowSelect = true, MultiSelect = false, HideSelection = false };
    private readonly ListView _sent = new() { Dock = DockStyle.Fill, View = View.Details, FullRowSelect = true };
    private readonly Button _resend = new() { Text = "다시 보내기", AutoSize = true, Enabled = false };
    private readonly Button _discard = new() { Text = "버리기", AutoSize = true, Enabled = false };
    private readonly Button _open = new() { Text = "바구니 열기", AutoSize = true };
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 2000 };

    public StatusForm(QueueStore store, HistoryStore history, QueueProcessor processor, Action kick)
    {
        _store = store;
        _history = history;
        _processor = processor;
        _kick = kick;
        Text = "보낸 기록·대기열";
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(640, 460);

        _queue.Columns.Add("대기열", 130);
        _queue.Columns.Add("내용", 140);
        _queue.Columns.Add("만든 시각", 130);
        _queue.Columns.Add("상태", 230);
        _sent.Columns.Add("보낸 기록 (최근 10건)", 200);
        _sent.Columns.Add("내용", 140);
        _sent.Columns.Add("시각", 200);

        var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, AutoSize = true, FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(8) };
        buttons.Controls.AddRange(new Control[] { _open, _discard, _resend });
        var split = new SplitContainer { Dock = DockStyle.Fill, Orientation = Orientation.Horizontal, SplitterDistance = 230 };
        split.Panel1.Controls.Add(_queue);
        split.Panel2.Controls.Add(_sent);
        Controls.Add(split);
        Controls.Add(buttons);

        _queue.SelectedIndexChanged += (_, _) => UpdateButtons();
        _resend.Click += (_, _) => Resend();
        _discard.Click += (_, _) => Discard();
        _open.Click += (_, _) => TrayApp.OpenBasket();
        _timer.Tick += (_, _) => Fill();
        _timer.Start();
        Fill();
    }

    private QueueItem? Selected => _queue.SelectedItems.Count == 1 ? _queue.SelectedItems[0].Tag as QueueItem : null;

    private void Fill()
    {
        var selected = Selected?.Id;
        _queue.BeginUpdate();
        _queue.Items.Clear();
        var now = DateTimeOffset.Now;
        foreach (var item in _store.List())
        {
            var state = Messages.State(item) + (now - item.CreatedAt > Limits.StaleAfter ? " · 7일 지남, 버릴까요?" : "");
            var row = new ListViewItem(new[] { "대기", Messages.Describe(item), item.CreatedAt.LocalDateTime.ToString("MM-dd HH:mm"), state }) { Tag = item };
            _queue.Items.Add(row);
            if (item.Id == selected) row.Selected = true;
        }
        _queue.EndUpdate();

        _sent.Items.Clear();
        foreach (var h in _history.Recent(10))
        {
            var what = h.FileCount > 0 ? $"파일 {h.FileCount}개" : "글";
            _sent.Items.Add(new ListViewItem(new[] { "완료", what, h.At.LocalDateTime.ToString("yyyy-MM-dd HH:mm:ss") }));
        }
        UpdateButtons();
    }

    private void UpdateButtons()
    {
        var item = Selected;
        _resend.Enabled = item is { State: ItemState.Unknown or ItemState.Rejected };
        _discard.Enabled = item != null && item.State != ItemState.Sending;
    }

    private void Resend()
    {
        if (Selected is not { } item) return;
        var warn = item.State == ItemState.Unknown
            ? "서버에 이미 저장됐을 수 있어요. 다시 보내면 같은 파일이 바구니에 두 번 생길 수 있어요.\n먼저 바구니를 열어 확인하셨나요? 그래도 다시 보낼까요?"
            : "다시 보낼까요?";
        if (MessageBox.Show(this, warn, "다시 보내기", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
        _processor.Resend(item.Id);
        _kick();
        Fill();
    }

    private void Discard()
    {
        if (Selected is not { } item) return;
        if (MessageBox.Show(this, "이 항목을 버릴까요? PC에 둔 사본도 지워지고 되돌릴 수 없어요.", "버리기", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) return;
        _processor.Discard(item.Id);
        Fill();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _timer.Dispose();
        base.Dispose(disposing);
    }
}
