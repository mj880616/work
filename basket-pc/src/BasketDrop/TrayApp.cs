using System.Diagnostics;

namespace BasketDrop.App;

/// <summary>
/// The program's single owner: tray icon, login, auto start, update, 'WORK ON+에서 이 PC 보기', the two drop boxes
/// (screen-corner box and desktop tile, back in S69-31) and the queue pump. Everything dropped goes through
/// <see cref="Submit"/>, so limits, the program-file question and the duplicate question are asked in one place, and it
/// is sent by the one existing queue path (<see cref="QueueProcessor"/>). The clipboard hotkey and right-click Send to
/// stay removed (S54-13). S69-35 (사용자 11/24): a double click on either box opens a small input window
/// (<see cref="PasteForm"/>) that sends through the same <see cref="Submit"/>; there is no hotkey for it.
/// </summary>
internal sealed class TrayApp : ApplicationContext
{
    private readonly NotifyIcon _tray;
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
    // S63-09 PC도우미구분: [WORK ON+ 열기] (the web app in the browser; S68-21 name) and the helper window.
    private readonly ToolStripMenuItem _openNojoPlusItem = new("WORK ON+ 열기");
    private readonly EventWaitHandle _helperSignal = HelperSignal.Create();
    private RegisteredWaitHandle? _helperWait;
    private readonly ToolStripMenuItem _loginStatusItem = new("로그인 상태") { Enabled = false };
    private readonly ToolStripMenuItem _signInItem = new("구글로 로그인");
    private readonly ToolStripMenuItem _signOutItem = new("로그아웃");
    private readonly ToolStripMenuItem _statusItem = new("대기 중인 항목 보기");
    private readonly ToolStripMenuItem _autoStartItem = new("윈도우를 켤 때 자동 실행");
    private readonly ToolStripMenuItem _cornerMenu = new("화면 구석 칸");
    private readonly ToolStripMenuItem _desktopTileItem = new("바탕화면 칸");
    private readonly ToolStripMenuItem _doorItem = new("WORK ON+에서 이 PC 보기");
    private readonly ToolStripMenuItem _restartForUpdateItem = new("새 버전으로 다시 시작") { Visible = false };
    private readonly SettingsStore _settings = new(AppPaths.Settings);
    private readonly AutoStartManager _autoStart;
    private readonly UpdateService _updates;
    private readonly CornerWatcher _cornerWatcher;
    private readonly DesktopTile _desktopTile;
    // 'WORK ON+에서 이 PC 보기' (docs/design/files-pc-drive.md): closed unless the menu turned it on and this app is signed in.
    private readonly HttpWebUserVerifier _webUsers = new();
    private readonly CachedWebUserVerifier _webUsersCached;
    private PcDoor? _door;
    private CancellationTokenSource? _signInCts;
    private StatusForm? _status;
    private PasteForm? _paste;
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
        _webUsersCached = new CachedWebUserVerifier(_webUsers);
        _processor.Finished += f => Ui(() => OnFinished(f));
        _processor.Changed += () => Ui(RefreshTray);

        if (_store.RecoverInterrupted() > 0) _log.Write(LogCode.QueueRecovered);

        _tray = new NotifyIcon { Icon = AppIcon.ForTray(), Visible = true, Text = TrayStatus.Name };
        _tray.ContextMenuStrip = BuildMenu();
        _tray.DoubleClick += (_, _) => HelperForm.ShowOrFocus();
        _helperWait = ThreadPool.RegisterWaitForSingleObject(_helperSignal, (_, _) => Ui(HelperForm.ShowOrFocus), null, Timeout.Infinite, false);

        // S69-31: an update from a version without the boxes shows both once (an older "off" does not carry over).
        var settings = _settings.Load();
        if (DropBoxDefaults.RestoreOnce(settings))
        {
            try { _settings.Save(settings); }
            catch (IOException) { _log.Write(LogCode.Error); }
        }
        _cornerWatcher = new CornerWatcher(this, CornerChoices.FromId(settings.Corner));
        RefreshCornerMenu();
        _desktopTile = new DesktopTile(this, _settings, _log, settings.DesktopTile);
        _desktopTileItem.Checked = _desktopTile.On;

        _autoStart = new AutoStartManager(new RegistryStartup(), _settings, UpdateService.IsInstalled ? Environment.ProcessPath : null);
        SyncAutoStart();
        _updates = new UpdateService(_log);
        _ = Task.Run(UpdateLoopAsync);

        LegacyEntries.CleanOnce(_settings, _store, AppPaths.History, _log);
        if (UpdateService.IsInstalled)
        {
            LegacyEntries.RemoveRenamedShortcuts(_log);
            ShellIcons.RefreshOnce(_settings, _log);
        }
        _log.Write(LogCode.Started);
        _ = Task.Run(PumpAsync);
        _wake.Release();
        RefreshTray();
        if (LaunchArgs.StartedByUser()) HelperForm.ShowOrFocus();
        var left = _store.List().Count;
        var stale = _store.Stale(DateTimeOffset.Now).Count;
        if (stale > 0) Balloon($"7일 넘게 못 보낸 항목이 {stale}건 있어요. 트레이 메뉴의 [대기 중인 항목 보기]에서 보내거나 버려 주세요.", ToolTipIcon.Info);
        else if (left > 0) Balloon($"보내지 못한 항목 {left}건이 남아 있어요. 로그인하면 자동으로 보내요. 트레이 메뉴의 [대기 중인 항목 보기]에서 확인할 수 있어요.", ToolTipIcon.Info);
    }

    // ---- menu ----

    private ContextMenuStrip BuildMenu()
    {
        var menu = new ContextMenuStrip();
        _openNojoPlusItem.Click += (_, _) => HelperForm.OpenNojoPlus();
        menu.Items.Add(_openNojoPlusItem);
        menu.Items.Add(new ToolStripSeparator());
        // Shown only while something is still waiting in the queue.
        _statusItem.Visible = false;
        _statusItem.Click += (_, _) => ShowStatus();
        menu.Items.Add(_statusItem);
        menu.Items.Add(_loginStatusItem);
        _signInItem.Click += (_, _) => _ = SignInAsync();
        _signOutItem.Click += (_, _) => _ = SignOutAsync();
        menu.Items.Add(_signInItem);
        menu.Items.Add(_signOutItem);
        menu.Items.Add(new ToolStripSeparator());
        foreach (var corner in new[] { CornerChoice.TopRight, CornerChoice.BottomRight, CornerChoice.Off })
        {
            var item = new ToolStripMenuItem(CornerChoices.Label(corner)) { Tag = corner };
            item.Click += (_, _) => ChangeCorner(corner);
            _cornerMenu.DropDownItems.Add(item);
        }
        menu.Items.Add(_cornerMenu);
        _desktopTileItem.Click += (_, _) => ToggleDesktopTile();
        menu.Items.Add(_desktopTileItem);
        _doorItem.Click += (_, _) => ToggleDoor();
        menu.Items.Add(_doorItem);
        _autoStartItem.Click += (_, _) => ToggleAutoStart();
        menu.Items.Add(_autoStartItem);
        _restartForUpdateItem.Click += (_, _) => RestartForUpdate();
        menu.Items.Add(_restartForUpdateItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("종료", null, (_, _) => Quit());
        return menu;
    }

    // ---- screen-corner box ----

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
            ? "화면 구석 칸을 껐어요. 트레이 메뉴에서 다시 켤 수 있어요."
            : $"화면 {CornerChoices.Label(corner)} 구석에 마우스를 잠깐 대면 칸이 나타나요.");
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

    // ---- WORK ON+에서 이 PC 보기 ----

    private void ToggleDoor()
    {
        var s = _settings.Load();
        s.WebDoor = !s.WebDoor;
        try { _settings.Save(s); }
        catch (IOException) { _log.Write(LogCode.Error); return; }
        SyncDoor(notify: true);
        if (!s.WebDoor) ToastForm.Show("WORK ON+에서 이 PC 보기를 껐어요.");
        else if (_door != null) ToastForm.Show("WORK ON+ [파일]에서 이 PC를 볼 수 있어요. 이 PC의 브라우저에서만 보여요.");
        else if (_auth.State != AuthState.SignedIn) ToastForm.Show("로그인하면 WORK ON+에서 이 PC를 볼 수 있어요.");
    }

    /// <summary>The one place the door opens or closes: wanted in the menu and signed in. Called whenever either may change.</summary>
    private void SyncDoor(bool notify = false)
    {
        var wanted = _settings.Load().WebDoor;
        var open = wanted && _auth.State == AuthState.SignedIn && !_stop.IsCancellationRequested;
        if (open && _door == null)
        {
            try
            {
                var files = new PcFiles(AppPaths.Root);
                _door = PcDoor.Open(files, new PcShell(), _webUsersCached,
                    ct => PcDoor.OwnUserIdAsync(_auth, ct), _log, typeof(TrayApp).Assembly.GetName().Version?.ToString(3) ?? "0",
                    transfer: new PcTransfer(files, AppPaths.Root), pins: new PcPins(Path.Combine(AppPaths.Root, "pc-pins.json"), AppPaths.Root),
                    edit: new PcEdit(files, AppPaths.Root));
                _log.Write(LogCode.DoorOn);
            }
            catch (PortsBusyException)
            {
                _log.Write(LogCode.DoorPortsBusy);
                if (notify) ToastForm.Show("이 PC 보기 문을 열지 못했어요. 다른 프로그램이 같은 번호를 쓰고 있어요.", true);
            }
        }
        else if (!open && _door != null)
        {
            CloseDoor();
        }
        _doorItem.Checked = wanted;
        _doorItem.Text = wanted && _auth.State != AuthState.SignedIn ? "WORK ON+에서 이 PC 보기 (로그인하면 열려요)" : "WORK ON+에서 이 PC 보기";
    }

    private void CloseDoor()
    {
        if (_door == null) return;
        _door.Dispose();
        _door = null;
        _webUsersCached.Clear();
        _log.Write(LogCode.DoorOff);
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
        _cornerWatcher.Dispose();
        _desktopTile.Dispose();
        _paste?.Dispose();
        CloseDoor();
        _tray.Visible = false;
        _log.Write(LogCode.Stopped);
        _updates.ApplyAndRestart();
        ExitThread();
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
                ToastForm.Show("이 구글 계정은 WORK ON+ 소유자가 아니에요. 평소 WORK ON+에 쓰는 계정으로 다시 로그인해 주세요. 아무것도 보내지 않았어요.", true);
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
        _cornerWatcher.Dispose();
        _desktopTile.Dispose();
        _paste?.Dispose();
        CloseDoor();
        _tray.Visible = false;
        _log.Write(LogCode.Stopped);
        ExitThread();
    }

    // ---- the drop boxes ----

    /// <summary>A click on a drop box: pick files with the usual Windows window, then the same gate as a drop.</summary>
    public void PickFiles(IWin32Window? owner)
    {
        using var dialog = new OpenFileDialog { Multiselect = true, Title = "WORK ON+로 올릴 파일 선택", CheckFileExists = true };
        if (dialog.ShowDialog(owner) != DialogResult.OK || dialog.FileNames.Length == 0) return;
        if (Submit(dialog.FileNames.Select(DropSource.FromPath).ToList(), "", owner))
            ShowQueued($"파일 {dialog.FileNames.Length}개");
    }

    /// <summary>
    /// S69-35: a double click on a drop box opens the input window next to it. One window for the whole program; what was
    /// typed or pasted stays in it (in memory only) while it is closed, until it is sent or the program quits.
    /// </summary>
    public void OpenPaste(Rectangle anchor, int dpi)
    {
        if (_paste == null || _paste.IsDisposed) _paste = new PasteForm(this);
        _paste.ShowNear(anchor, dpi);
    }

    /// <summary>The small notice after a drop: sending now, or waiting for the login.</summary>
    public void ShowQueued(string what)
    {
        if (_auth.State == AuthState.SignedIn) ToastForm.Show($"WORK ON+로 보내는 중 ({what})");
        else ToastForm.Show($"담아 뒀어요 ({what}). 트레이 메뉴에서 로그인하면 보내요.", true);
    }

    /// <summary>The one gate both drop boxes use. Returns true when something was queued.</summary>
    public bool Submit(IReadOnlyList<DropSource> sources, string text, IWin32Window? owner)
    {
        var title = TrayStatus.Name;
        var plan = _drop.Inspect(sources, text);
        if (plan.Problems.Count > 0)
        {
            var lines = string.Join("\n", plan.Problems.Select(Messages.Problem));
            if (!plan.CanCommit)
            {
                MessageBox.Show(owner, lines, title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return false;
            }
            if (MessageBox.Show(owner, lines + "\n\n나머지만 보낼까요?", title, MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes)
                return false;
        }
        if (plan.Risky.Count > 0 && MessageBox.Show(owner,
                "프로그램 파일로 보이는 것이 있어요:\n" + string.Join("\n", plan.Risky) + "\n\n그래도 보낼까요?",
                title, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes)
            return false;
        if (plan.Duplicates.Count > 0 && MessageBox.Show(owner,
                "이미 보낸 파일이에요:\n" + string.Join("\n", plan.Duplicates) + "\n\n또 보낼까요?",
                title, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes)
            return false;

        IReadOnlyList<QueueItem> items;
        try { items = _drop.Commit(plan); }
        catch (IOException)
        {
            MessageBox.Show(owner, "대기열에 담지 못했어요. 디스크 공간을 확인해 주세요.", title, MessageBoxButtons.OK, MessageBoxIcon.Error);
            _log.Write(LogCode.Error);
            return false;
        }
        _log.Write(LogCode.Enqueued, items.Count);
        Kick();
        RefreshTray();
        return items.Count > 0;
    }

    // ---- waiting items ----

    public void ShowStatus()
    {
        if (_status is { IsDisposed: false }) { _status.Activate(); return; }
        _status = new StatusForm(_store, _history, _processor, Kick);
        _status.Show();
        _status.Activate();
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
        _statusItem.Visible = _store.List().Count > 0;
        _tray.Text = status.Tooltip;
        ShowTrayPicture(status.Picture);
        SyncDoor();
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
        _tray.BalloonTipTitle = TrayStatus.Name;
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
            _helperWait?.Unregister(null);
            _helperSignal.Dispose();
            _tray.Dispose();
            _ui.Dispose();
            _api.Dispose();
            _authClient.Dispose();
            _door?.Dispose();
            _webUsers.Dispose();
        }
        base.Dispose(disposing);
    }
}
