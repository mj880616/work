using System.Diagnostics;
using System.Drawing.Drawing2D;

namespace BasketDrop.App;

/// <summary>
/// The program's single owner: tray icon, hotkey, queue pump and every entry point (paste window, hotkey, Send to).
/// Sending always goes through <see cref="Submit"/>, so limits, the program-file question and the duplicate
/// question are asked in one place.
/// </summary>
internal sealed class TrayApp : ApplicationContext
{
    private readonly NotifyIcon _tray;
    private readonly HotkeyWindow _hotkey;
    private readonly ILog _log = new FileLog(AppPaths.Log);
    private readonly QueueStore _store = new(AppPaths.Queue);
    private readonly HistoryStore _history = new(AppPaths.History);
    private readonly DropService _drop;
    private readonly QueueProcessor _processor;
    private readonly HttpBasketApi _api = new();
    private readonly CancellationTokenSource _stop = new();
    private readonly SemaphoreSlim _wake = new(0);
    // Hidden control whose handle lives on the UI thread; background threads hop onto the UI through it.
    private readonly Control _ui = new();
    private readonly System.Windows.Forms.Timer _batchTimer = new() { Interval = 700 };
    private readonly List<string> _batchPaths = new();
    private readonly object _batchGate = new();
    private readonly ToolStripMenuItem _sendToItem = new("우클릭 [보내기] 메뉴에 넣기");
    private PasteForm? _paste;
    private StatusForm? _status;

    private void Ui(Action action)
    {
        if (_ui.IsDisposed) return;
        try { _ui.BeginInvoke(action); } catch (InvalidOperationException) { }
    }

    public bool IsClosing => _stop.IsCancellationRequested;

    // Step B replaces this with the Google sign-in provider. Until then nothing can leave the PC.
    private readonly IAuthProvider _auth = new NotSignedInAuthProvider();

    public TrayApp()
    {
        _ = _ui.Handle;
        _drop = new DropService(_store, _history);
        _processor = new QueueProcessor(_store, _history, _api, _auth, _log);
        _processor.Finished += f => Ui(() => OnFinished(f));
        _processor.Changed += () => Ui(RefreshTray);

        if (_store.RecoverInterrupted() > 0) _log.Write(LogCode.QueueRecovered);

        _tray = new NotifyIcon { Icon = MakeIcon(), Visible = true, Text = "바구니 PC드롭" };
        _tray.ContextMenuStrip = BuildMenu();
        _tray.DoubleClick += (_, _) => ShowPaste();

        _hotkey = new HotkeyWindow();
        _hotkey.Pressed += OnHotkey;
        if (!_hotkey.Registered)
        {
            _log.Write(LogCode.HotkeyFailed);
            Balloon("Ctrl+Shift+B를 등록하지 못했어요. 다른 프로그램이 쓰고 있어요. 트레이 메뉴의 붙여넣기 창은 그대로 쓸 수 있어요.", ToolTipIcon.Warning);
        }
        else _log.Write(LogCode.HotkeyOk);

        _batchTimer.Tick += (_, _) => FlushBatch();
        _log.Write(LogCode.Started);
        _ = Task.Run(PumpAsync);
        _wake.Release();
        RefreshTray();
        var stale = _store.Stale(DateTimeOffset.Now).Count;
        if (stale > 0) Balloon($"7일 넘게 못 보낸 항목이 {stale}건 있어요. 기록 창에서 보내거나 버려 주세요.", ToolTipIcon.Info);
    }

    // ---- menu ----

    private ContextMenuStrip BuildMenu()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("붙여넣기 창 열기", null, (_, _) => ShowPaste());
        menu.Items.Add("지금 복사한 것 바로 보내기 (Ctrl+Shift+B)", null, (_, _) => OnHotkey());
        menu.Items.Add("보낸 기록·대기열", null, (_, _) => ShowStatus());
        menu.Items.Add(new ToolStripSeparator());
        _sendToItem.CheckOnClick = false;
        _sendToItem.Checked = SendToShortcut.Exists;
        _sendToItem.Click += (_, _) => ToggleSendTo();
        menu.Items.Add(_sendToItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("종료", null, (_, _) => Quit());
        return menu;
    }

    private void ToggleSendTo()
    {
        try
        {
            if (SendToShortcut.Exists) SendToShortcut.Remove(); else SendToShortcut.Install();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidOperationException or System.Runtime.InteropServices.COMException)
        {
            Balloon("[보내기] 메뉴를 바꾸지 못했어요.", ToolTipIcon.Warning);
        }
        _sendToItem.Checked = SendToShortcut.Exists;
    }

    private void Quit()
    {
        _stop.Cancel();
        _hotkey.Dispose();
        _tray.Visible = false;
        _log.Write(LogCode.Stopped);
        ExitThread();
    }

    // ---- entry points ----

    private void ShowPaste()
    {
        if (_paste is { IsDisposed: false }) { _paste.Activate(); return; }
        _paste = new PasteForm(this);
        _paste.Show();
        _paste.Activate();
    }

    public void ShowStatus()
    {
        if (_status is { IsDisposed: false }) { _status.Activate(); return; }
        _status = new StatusForm(_store, _history, _processor, Kick);
        _status.Show();
        _status.Activate();
    }

    /// <summary>Hotkey: read the clipboard now (and only now), queue it, tell the user with a small notice.</summary>
    private void OnHotkey()
    {
        ClipboardContent c;
        try { c = ClipboardReader.Read(); }
        catch (System.Runtime.InteropServices.ExternalException)
        {
            ToastForm.Show("클립보드를 읽지 못했어요. 다른 프로그램이 쓰는 중일 수 있어요. 잠시 뒤 다시 눌러 주세요.", true);
            return;
        }
        if (c.IsEmpty)
        {
            ToastForm.Show(c.HasUnsupported
                ? "이 형식은 보낼 수 없어요. 글·사진·파일만 보낼 수 있어요."
                : "클립보드가 비어 있어요. 보낼 글·사진·파일을 먼저 복사해 주세요.", true);
            return;
        }
        if (Submit(ToSources(c), c.Text ?? "", null)) ToastForm.Show("대기열에 담았어요 (" + Describe(c) + ")");
    }

    private static string Describe(ClipboardContent c) =>
        c.Files.Count > 0 ? $"파일 {c.Files.Count}개" : c.Text != null ? "글" : "사진";

    public static List<DropSource> ToSources(ClipboardContent c)
    {
        var list = c.Files.Select(DropSource.FromPath).ToList();
        if (c.Png != null) list.Add(DropSource.FromBytes(c.Png, ClipboardReader.PictureName(DateTime.Now)));
        return list;
    }

    /// <summary>Send to: several selected files arrive together; wait briefly so they become one memo.</summary>
    public void ReceivePaths(IEnumerable<string> paths)
    {
        lock (_batchGate) _batchPaths.AddRange(paths);
        Ui(() => { _batchTimer.Stop(); _batchTimer.Start(); });
    }

    private void FlushBatch()
    {
        _batchTimer.Stop();
        List<string> paths;
        lock (_batchGate) { paths = _batchPaths.ToList(); _batchPaths.Clear(); }
        if (paths.Count > 0) Submit(paths.Select(DropSource.FromPath).ToList(), "", null);
    }

    /// <summary>The one gate every entry uses. Returns true when something was queued.</summary>
    public bool Submit(IReadOnlyList<DropSource> sources, string text, IWin32Window? owner)
    {
        var plan = _drop.Inspect(sources, text);
        if (plan.Problems.Count > 0)
        {
            var lines = string.Join("\n", plan.Problems.Select(Messages.Problem));
            if (!plan.CanCommit)
            {
                MessageBox.Show(owner, lines, "바구니 PC드롭", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return false;
            }
            if (MessageBox.Show(owner, lines + "\n\n나머지만 보낼까요?", "바구니 PC드롭", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes)
                return false;
        }
        if (plan.Risky.Count > 0 && MessageBox.Show(owner,
                "프로그램 파일로 보이는 것이 있어요:\n" + string.Join("\n", plan.Risky) + "\n\n그래도 바구니에 보낼까요?",
                "바구니 PC드롭", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes)
            return false;
        if (plan.Duplicates.Count > 0 && MessageBox.Show(owner,
                "이미 보낸 파일이에요:\n" + string.Join("\n", plan.Duplicates) + "\n\n또 보낼까요?",
                "바구니 PC드롭", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes)
            return false;

        IReadOnlyList<QueueItem> items;
        try { items = _drop.Commit(plan); }
        catch (IOException)
        {
            MessageBox.Show(owner, "대기열에 담지 못했어요. 디스크 공간을 확인해 주세요.", "바구니 PC드롭", MessageBoxButtons.OK, MessageBoxIcon.Error);
            _log.Write(LogCode.Error);
            return false;
        }
        _log.Write(LogCode.Enqueued, items.Count);
        Kick();
        RefreshTray();
        return items.Count > 0;
    }

    // ---- sending ----

    public void Kick() => _wake.Release();

    private async Task PumpAsync()
    {
        var delay = TimeSpan.FromSeconds(60);
        while (!_stop.IsCancellationRequested)
        {
            try
            {
                await _wake.WaitAsync(delay, _stop.Token).ConfigureAwait(false);
                var next = await _processor.RunOnceAsync(_stop.Token).ConfigureAwait(false);
                delay = next ?? TimeSpan.FromSeconds(60);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidOperationException)
            {
                _log.Write(LogCode.Error);
                delay = TimeSpan.FromSeconds(60);
            }
        }
    }

    private void OnFinished(ItemFinished f)
    {
        switch (f.Kind)
        {
            case FinishKind.Sent:
                Balloon(f.FileCount > 0 ? $"바구니에 담았어요 · 파일 {f.FileCount}개" : "바구니에 담았어요 · 글 1개", ToolTipIcon.Info);
                break;
            case FinishKind.NeedsCheck:
                Balloon("저장됐는지 확인이 필요해요. 바구니를 열어 보고 기록 창에서 정해 주세요.", ToolTipIcon.Warning);
                break;
            default:
                Balloon("보내지 못했어요. 기록 창에서 이유를 확인해 주세요.", ToolTipIcon.Warning);
                break;
        }
    }

    private void RefreshTray()
    {
        var items = _store.List();
        var waiting = items.Count(i => i.State is ItemState.Pending or ItemState.Sending or ItemState.NotReached or ItemState.LoginRequired);
        var check = items.Count(i => i.State is ItemState.Unknown or ItemState.Rejected);
        var text = $"바구니 PC드롭 · 대기 {waiting} · 확인 필요 {check}";
        _tray.Text = text.Length > 63 ? text[..63] : text;
    }

    private void Balloon(string text, ToolTipIcon icon)
    {
        _tray.BalloonTipTitle = "바구니 PC드롭";
        _tray.BalloonTipText = text;
        _tray.BalloonTipIcon = icon;
        _tray.ShowBalloonTip(4000);
    }

    public void LogError() => _log.Write(LogCode.Error);

    public static void OpenBasket()
    {
        Process.Start(new ProcessStartInfo(AppPaths.BasketUrl) { UseShellExecute = true });
    }

    private static Icon MakeIcon()
    {
        using var bmp = new Bitmap(32, 32);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using var back = new SolidBrush(Color.FromArgb(37, 99, 235));
            g.FillEllipse(back, 1, 1, 30, 30);
            using var font = new Font("Segoe UI", 15, FontStyle.Bold, GraphicsUnit.Pixel);
            using var fmt = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
            g.DrawString("B", font, Brushes.White, new RectangleF(0, 1, 32, 32), fmt);
        }
        return Icon.FromHandle(bmp.GetHicon());
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _stop.Cancel();
            _tray.Dispose();
            _ui.Dispose();
            _batchTimer.Dispose();
            _api.Dispose();
        }
        base.Dispose(disposing);
    }
}
