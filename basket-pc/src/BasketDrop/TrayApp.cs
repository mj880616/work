using System.Diagnostics;

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
    private readonly HttpAuthClient _authClient = new();
    private readonly CancellationTokenSource _stop = new();
    private readonly SemaphoreSlim _wake = new(0);
    // Hidden control whose handle lives on the UI thread; background threads hop onto the UI through it.
    private readonly Control _ui = new();
    private readonly System.Windows.Forms.Timer _batchTimer = new() { Interval = 700 };
    private readonly List<string> _batchPaths = new();
    private readonly object _batchGate = new();
    private readonly ToolStripMenuItem _sendToItem = new("우클릭 [보내기] 메뉴에 넣기");
    private readonly ToolStripMenuItem _loginStatusItem = new("로그인 상태") { Enabled = false };
    private readonly ToolStripMenuItem _signInItem = new("구글로 로그인");
    private readonly ToolStripMenuItem _signOutItem = new("로그아웃");
    private readonly ToolStripMenuItem _sendNowItem = new();
    private readonly ToolStripMenuItem _hotkeyMenu = new("단축키 바꾸기");
    private readonly ToolStripMenuItem _autoStartItem = new("윈도우를 켤 때 자동 실행");
    private readonly ToolStripMenuItem _cornerMenu = new("화면 구석 던지기 칸");
    private readonly ToolStripMenuItem _desktopTileItem = new("바탕화면 칸");
    private readonly ToolStripMenuItem _restartForUpdateItem = new("새 버전으로 다시 시작") { Visible = false };
    private readonly SettingsStore _settings = new(AppPaths.Settings);
    private readonly AutoStartManager _autoStart;
    private readonly UpdateService _updates;
    private readonly CornerWatcher _cornerWatcher;
    private readonly DesktopTile _desktopTile;
    private CancellationTokenSource? _signInCts;
    private PasteForm? _paste;
    private StatusForm? _status;
    private TrayPicture _trayPicture = TrayPicture.Normal;

    private void Ui(Action action)
    {
        if (_ui.IsDisposed) return;
        try { _ui.BeginInvoke(action); } catch (InvalidOperationException) { }
    }

    public bool IsClosing => _stop.IsCancellationRequested;

    // The only object that touches tokens (refresh token in Credential Manager, access token in memory).
    private readonly SupabaseAuthProvider _auth;

    public TrayApp()
    {
        _ = _ui.Handle;
        _drop = new DropService(_store, _history);
        _auth = new SupabaseAuthProvider(_authClient, new CredentialManagerTokenStore(), _api, _log);
        _auth.StateChanged += s => Ui(() => OnAuthStateChanged(s));
        _processor = new QueueProcessor(_store, _history, _api, _auth, _log);
        _processor.Finished += f => Ui(() => OnFinished(f));
        _processor.Changed += () => Ui(RefreshTray);

        if (_store.RecoverInterrupted() > 0) _log.Write(LogCode.QueueRecovered);

        _tray = new NotifyIcon { Icon = AppIcon.ForTray(), Visible = true, Text = TrayStatus.Name };
        _tray.ContextMenuStrip = BuildMenu();
        _tray.DoubleClick += (_, _) => ShowPaste();

        var wanted = HotkeyChoice.FromId(_settings.Load().Hotkey);
        _hotkey = new HotkeyWindow(wanted);
        _hotkey.Pressed += OnHotkey;
        if (!_hotkey.Registered)
        {
            _log.Write(LogCode.HotkeyFailed);
            Balloon($"{wanted.Label}를 등록하지 못했어요. 다른 프로그램이 쓰고 있어요. 트레이 메뉴의 [단축키 바꾸기]로 다른 키를 고르거나, 붙여넣기 창을 쓰세요.", ToolTipIcon.Warning);
        }
        else _log.Write(LogCode.HotkeyOk);
        RefreshHotkeyMenu();

        _cornerWatcher = new CornerWatcher(this, CornerChoices.FromId(_settings.Load().Corner));
        RefreshCornerMenu();

        _desktopTile = new DesktopTile(this, _settings, _log, _settings.Load().DesktopTile);
        _desktopTileItem.Checked = _desktopTile.On;

        _autoStart = new AutoStartManager(new RegistryStartup(), _settings, UpdateService.IsInstalled ? Environment.ProcessPath : null);
        SyncAutoStart();
        _updates = new UpdateService(_log);
        _ = Task.Run(UpdateLoopAsync);

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
        _sendNowItem.Click += (_, _) => OnHotkey();
        menu.Items.Add(_sendNowItem);
        menu.Items.Add("보낸 기록·대기열", null, (_, _) => ShowStatus());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(_loginStatusItem);
        _signInItem.Click += (_, _) => _ = SignInAsync();
        _signOutItem.Click += (_, _) => _ = SignOutAsync();
        menu.Items.Add(_signInItem);
        menu.Items.Add(_signOutItem);
        menu.Items.Add(new ToolStripSeparator());
        _sendToItem.CheckOnClick = false;
        _sendToItem.Checked = SendToShortcut.Exists;
        _sendToItem.Click += (_, _) => ToggleSendTo();
        menu.Items.Add(_sendToItem);
        foreach (var choice in HotkeyChoice.All)
        {
            var item = new ToolStripMenuItem(choice.Label) { Tag = choice };
            item.Click += (_, _) => ChangeHotkey(choice);
            _hotkeyMenu.DropDownItems.Add(item);
        }
        menu.Items.Add(_hotkeyMenu);
        foreach (var corner in new[] { CornerChoice.TopRight, CornerChoice.BottomRight, CornerChoice.Off })
        {
            var item = new ToolStripMenuItem(CornerChoices.Label(corner)) { Tag = corner };
            item.Click += (_, _) => ChangeCorner(corner);
            _cornerMenu.DropDownItems.Add(item);
        }
        menu.Items.Add(_cornerMenu);
        _desktopTileItem.Click += (_, _) => ToggleDesktopTile();
        menu.Items.Add(_desktopTileItem);
        _autoStartItem.Click += (_, _) => ToggleAutoStart();
        menu.Items.Add(_autoStartItem);
        _restartForUpdateItem.Click += (_, _) => RestartForUpdate();
        menu.Items.Add(_restartForUpdateItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("종료", null, (_, _) => Quit());
        return menu;
    }

    // ---- hotkey ----

    private void RefreshHotkeyMenu()
    {
        var current = _hotkey.Current;
        _sendNowItem.Text = current == null ? "지금 복사한 것 바로 보내기" : $"지금 복사한 것 바로 보내기 ({current.Label})";
        foreach (ToolStripMenuItem item in _hotkeyMenu.DropDownItems) item.Checked = Equals(item.Tag, current);
    }

    /// <summary>The previous key stays when Windows refuses the new one, and nothing is saved.</summary>
    private void ChangeHotkey(HotkeyChoice choice)
    {
        var before = _hotkey.Current;
        if (_hotkey.TryChange(choice))
        {
            var s = _settings.Load();
            s.Hotkey = choice.Id;
            try { _settings.Save(s); }
            catch (IOException) { _log.Write(LogCode.Error); }
            _log.Write(LogCode.HotkeyOk);
            ToastForm.Show($"단축키를 {choice.Label}(으)로 바꿨어요.");
        }
        else
        {
            _log.Write(LogCode.HotkeyFailed);
            Balloon(before == null
                ? $"{choice.Label}를 등록하지 못했어요. 다른 프로그램이 쓰고 있어요. 다른 키를 골라 주세요."
                : $"{choice.Label}를 등록하지 못했어요. 다른 프로그램이 쓰고 있어요. 지금 단축키 {before.Label}는 그대로 쓸 수 있어요.", ToolTipIcon.Warning);
        }
        RefreshHotkeyMenu();
    }

    // ---- hot corner ----

    private void RefreshCornerMenu()
    {
        foreach (ToolStripMenuItem item in _cornerMenu.DropDownItems) item.Checked = Equals(item.Tag, _cornerWatcher.Corner);
    }

    private void ChangeCorner(CornerChoice corner)
    {
        _cornerWatcher.Apply(corner);
        var s = _settings.Load();
        s.Corner = corner.ToString();
        try { _settings.Save(s); }
        catch (IOException) { _log.Write(LogCode.Error); }
        RefreshCornerMenu();
        ToastForm.Show(corner == CornerChoice.Off
            ? "화면 구석 던지기 칸을 껐어요. 트레이 메뉴에서 다시 켤 수 있어요."
            : $"화면 {CornerChoices.Label(corner)} 구석에 마우스를 잠깐 대면 던지기 칸이 나타나요.");
    }

    // ---- desktop tile ----

    private void ToggleDesktopTile()
    {
        var on = !_desktopTile.On;
        _desktopTile.Apply(on);
        var s = _settings.Load();
        s.DesktopTile = on;
        try { _settings.Save(s); }
        catch (IOException) { _log.Write(LogCode.Error); }
        _desktopTileItem.Checked = on;
        ToastForm.Show(on
            ? "바탕화면 칸을 켰어요. 눌러서 끌면 위치를 옮길 수 있어요."
            : "바탕화면 칸을 껐어요. 트레이 메뉴에서 다시 켤 수 있어요.");
    }

    // ---- start with Windows ----

    private void SyncAutoStart()
    {
        AutoStartState state;
        try { state = _autoStart.Sync(); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Security.SecurityException)
        {
            _log.Write(LogCode.Error);
            return;
        }
        ShowAutoStart(state);
    }

    private void ToggleAutoStart()
    {
        var wasOn = _autoStartItem.Checked;
        if (_autoStartItem.Tag is AutoStartState.DisabledInWindows)
        {
            ToastForm.Show("윈도우 설정의 [앱 > 시작 프로그램]에서 꺼져 있어요. 거기서 켜 주세요.", true);
            return;
        }
        AutoStartState state;
        try { state = _autoStart.SetEnabled(!wasOn); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Security.SecurityException)
        {
            _log.Write(LogCode.Error);
            ToastForm.Show("자동 실행 설정을 바꾸지 못했어요.", true);
            return;
        }
        ShowAutoStart(state);
    }

    private void ShowAutoStart(AutoStartState state)
    {
        _autoStartItem.Tag = state;
        _autoStartItem.Checked = state == AutoStartState.On;
        _autoStartItem.Enabled = state != AutoStartState.NotInstalled;
        _autoStartItem.Text = state switch
        {
            AutoStartState.DisabledInWindows => "윈도우를 켤 때 자동 실행 (윈도우 설정에서 꺼져 있어요)",
            AutoStartState.NotInstalled => "윈도우를 켤 때 자동 실행 (설치한 프로그램에서만)",
            _ => "윈도우를 켤 때 자동 실행",
        };
    }

    // ---- updates ----

    private async Task UpdateLoopAsync()
    {
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(20), _stop.Token).ConfigureAwait(false);
            while (!_stop.IsCancellationRequested)
            {
                var outcome = await _updates.CheckAsync(_stop.Token).ConfigureAwait(false);
                if (outcome == UpdateOutcome.NotInstalled) return;
                if (outcome == UpdateOutcome.Downloaded)
                {
                    Ui(() =>
                    {
                        _restartForUpdateItem.Visible = true;
                        ToastForm.Show($"새 버전 {_updates.PendingVersion}을 받았어요. 다음에 프로그램을 켤 때 적용돼요. 지금 쓰려면 트레이 메뉴의 [새 버전으로 다시 시작]을 눌러 주세요.");
                    });
                    return;
                }
                await Task.Delay(TimeSpan.FromHours(12), _stop.Token).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
        }
    }

    private void RestartForUpdate()
    {
        _signInCts?.Cancel();
        _stop.Cancel();
        _hotkey.Dispose();
        _cornerWatcher.Dispose();
        _desktopTile.Dispose();
        _tray.Visible = false;
        _log.Write(LogCode.Stopped);
        _updates.ApplyAndRestart();
        ExitThread();
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

    // ---- sign-in / sign-out ----

    private async Task SignInAsync()
    {
        // A new click replaces an attempt that is still waiting for the browser.
        _signInCts?.Cancel();
        var cts = _signInCts = new CancellationTokenSource();
        ToastForm.Show("브라우저에서 구글 로그인을 마쳐 주세요.");
        SignInOutcome outcome;
        try
        {
            outcome = await _auth.SignInAsync(OpenInBrowser, cts.Token);
        }
        catch (Exception e) when (e is IOException or InvalidOperationException or OperationCanceledException)
        {
            outcome = SignInOutcome.Failed;
        }
        if (outcome == SignInOutcome.Cancelled && !ReferenceEquals(_signInCts, cts)) return;
        switch (outcome)
        {
            case SignInOutcome.Ok:
                ToastForm.Show("로그인됐어요. 기다리던 항목을 보냅니다.");
                Kick();
                break;
            case SignInOutcome.NotOwner:
                ToastForm.Show("이 구글 계정은 Web2 소유자가 아니에요. 평소 Web2에 쓰는 계정으로 다시 로그인해 주세요. 아무것도 보내지 않았어요.", true);
                break;
            case SignInOutcome.PortsBusy:
                ToastForm.Show("로그인 연결 창구를 열지 못했어요. 이전 로그인 창이 남아 있으면 닫고 잠시 뒤 다시 시도해 주세요.", true);
                break;
            case SignInOutcome.TimedOut:
                ToastForm.Show("로그인이 2분 안에 끝나지 않았어요. 다시 시도해 주세요.", true);
                break;
            case SignInOutcome.Denied:
                ToastForm.Show("로그인하지 않았어요.", true);
                break;
            case SignInOutcome.Unavailable:
                ToastForm.Show("서버에 연결하지 못했어요. 인터넷을 확인하고 다시 시도해 주세요.", true);
                break;
            case SignInOutcome.Cancelled:
                break;
            default:
                ToastForm.Show("로그인하지 못했어요. 다시 시도해 주세요.", true);
                break;
        }
        RefreshTray();
    }

    /// <summary>The address holds only public values (the challenge and the loopback return), so it is safe as a process argument.</summary>
    private static bool OpenInBrowser(Uri url)
    {
        try
        {
            Process.Start(new ProcessStartInfo(url.AbsoluteUri) { UseShellExecute = true });
            return true;
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            return false;
        }
    }

    private async Task SignOutAsync()
    {
        _signInCts?.Cancel();
        SignOutResult result;
        try { result = await _auth.SignOutAsync(_stop.Token); }
        catch (OperationCanceledException) { return; }
        ToastForm.Show(!result.LocalLoginRemoved
            ? "로그아웃하지 못했어요. 저장된 로그인을 지우지 못해서 아직 로그인된 상태예요. 다시 시도해 주세요."
            : result.ServerSessionEnded
                ? "로그아웃했어요. 대기 중인 항목은 PC에 남아 있어요."
                : "이 PC에서는 로그아웃했어요. 서버 쪽 정리는 하지 못했어요. 대기 중인 항목은 PC에 남아 있어요.");
        RefreshTray();
    }

    private void OnAuthStateChanged(AuthState state)
    {
        if (state == AuthState.ReloginNeeded)
            ToastForm.Show("로그인이 만료됐어요. 트레이 메뉴에서 다시 로그인해 주세요. 대기 중인 항목은 그대로예요.", true);
        RefreshTray();
    }

    private static string LoginText(AuthState state) => state switch
    {
        AuthState.SignedIn => "로그인됨",
        AuthState.ReloginNeeded => "다시 로그인 필요",
        _ => "로그아웃",
    };

    private void Quit()
    {
        _signInCts?.Cancel();
        _stop.Cancel();
        _hotkey.Dispose();
        _cornerWatcher.Dispose();
        _desktopTile.Dispose();
        _tray.Visible = false;
        _log.Write(LogCode.Stopped);
        ExitThread();
    }

    // ---- entry points ----

    public void ShowPaste()
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
                ToastForm.Show(f.FileCount > 0 ? $"바구니에 담았어요 · 파일 {f.FileCount}개" : "바구니에 담았어요 · 글 1개");
                break;
            case FinishKind.NeedsCheck:
                ToastForm.Show("저장됐는지 확인이 필요해요. 바구니를 열어 보고 기록 창에서 정해 주세요.", true);
                break;
            default:
                ToastForm.Show("보내지 못했어요. 기록 창에서 이유를 확인해 주세요.", true);
                break;
        }
    }

    private void RefreshTray()
    {
        var status = TrayStatus.From(_store.List().Select(i => i.State), _auth.State);
        _loginStatusItem.Text = "로그인 상태: " + LoginText(_auth.State);
        _signInItem.Visible = _auth.State != AuthState.SignedIn;
        _signOutItem.Visible = _auth.State != AuthState.SignedOut;
        _tray.Text = status.Tooltip;
        ShowTrayPicture(status.Picture);
    }

    /// <summary>Swaps the tray picture only when it changes, and frees the one it replaces.</summary>
    private void ShowTrayPicture(TrayPicture picture)
    {
        if (picture == _trayPicture) return;
        var old = _tray.Icon;
        _tray.Icon = AppIcon.ForTray(picture);
        _trayPicture = picture;
        old?.Dispose();
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

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _stop.Cancel();
            _tray.Dispose();
            _ui.Dispose();
            _batchTimer.Dispose();
            _api.Dispose();
            _authClient.Dispose();
        }
        base.Dispose(disposing);
    }
}
