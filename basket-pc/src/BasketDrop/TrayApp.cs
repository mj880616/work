using System.Diagnostics;

namespace BasketDrop.App;

/// <summary>
/// The program's single owner: tray icon, login, auto start, update, 'Web2에서 이 PC 보기', and the queue pump that
/// only sends what older versions left waiting. Nothing new is queued any more: the send entrances (clipboard
/// hotkey and paste window, right-click Send to, screen-corner box, desktop tile) were removed.
/// </summary>
internal sealed class TrayApp : ApplicationContext
{
    private readonly NotifyIcon _tray;
    private readonly ILog _log = new FileLog(AppPaths.Log);
    private readonly QueueStore _store = new(AppPaths.Queue);
    private readonly HistoryStore _history = new(AppPaths.History);
    private readonly QueueProcessor _processor;
    private readonly HttpBasketApi _api = new();
    private readonly HttpAuthClient _authClient = new();
    private readonly CancellationTokenSource _stop = new();
    private readonly SemaphoreSlim _wake = new(0);
    // Hidden control whose handle lives on the UI thread; background threads hop onto the UI through it.
    private readonly Control _ui = new();
    private readonly ToolStripMenuItem _loginStatusItem = new("로그인 상태") { Enabled = false };
    private readonly ToolStripMenuItem _signInItem = new("구글로 로그인");
    private readonly ToolStripMenuItem _signOutItem = new("로그아웃");
    private readonly ToolStripMenuItem _statusItem = new("예전에 담아 둔 항목 보기");
    private readonly ToolStripMenuItem _autoStartItem = new("윈도우를 켤 때 자동 실행");
    private readonly ToolStripMenuItem _doorItem = new("웹2에서 이 PC 보기");
    private readonly ToolStripMenuItem _restartForUpdateItem = new("새 버전으로 다시 시작") { Visible = false };
    private readonly SettingsStore _settings = new(AppPaths.Settings);
    private readonly AutoStartManager _autoStart;
    private readonly UpdateService _updates;
    // 'Web2에서 이 PC 보기' (docs/design/files-pc-drive.md): closed unless the menu turned it on and this app is signed in.
    private readonly HttpWebUserVerifier _webUsers = new();
    private readonly CachedWebUserVerifier _webUsersCached;
    private PcDoor? _door;
    private CancellationTokenSource? _signInCts;
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
        _auth = new SupabaseAuthProvider(_authClient, new CredentialManagerTokenStore(), _api, _log);
        _auth.StateChanged += s => Ui(() => OnAuthStateChanged(s));
        _processor = new QueueProcessor(_store, _history, _api, _auth, _log);
        _webUsersCached = new CachedWebUserVerifier(_webUsers);
        _processor.Finished += f => Ui(() => OnFinished(f));
        _processor.Changed += () => Ui(RefreshTray);

        if (_store.RecoverInterrupted() > 0) _log.Write(LogCode.QueueRecovered);

        _tray = new NotifyIcon { Icon = AppIcon.ForTray(), Visible = true, Text = TrayStatus.Name };
        _tray.ContextMenuStrip = BuildMenu();

        _autoStart = new AutoStartManager(new RegistryStartup(), _settings, UpdateService.IsInstalled ? Environment.ProcessPath : null);
        SyncAutoStart();
        _updates = new UpdateService(_log);
        _ = Task.Run(UpdateLoopAsync);

        LegacyEntries.CleanOnce(_settings, _store, AppPaths.History, _log);
        _log.Write(LogCode.Started);
        _ = Task.Run(PumpAsync);
        _wake.Release();
        RefreshTray();
        var left = _store.List().Count;
        var stale = _store.Stale(DateTimeOffset.Now).Count;
        if (stale > 0) Balloon($"7일 넘게 못 보낸 항목이 {stale}건 있어요. 트레이 메뉴의 [예전에 담아 둔 항목 보기]에서 보내거나 버려 주세요.", ToolTipIcon.Info);
        else if (left > 0) Balloon($"예전 버전에서 담아 둔 항목 {left}건이 남아 있어요. 로그인하면 자동으로 보내요. 트레이 메뉴의 [예전에 담아 둔 항목 보기]에서 확인할 수 있어요.", ToolTipIcon.Info);
    }

    // ---- menu ----

    private ContextMenuStrip BuildMenu()
    {
        var menu = new ContextMenuStrip();
        // Shown only while something older versions left in the queue is still waiting.
        _statusItem.Visible = false;
        _statusItem.Click += (_, _) => ShowStatus();
        menu.Items.Add(_statusItem);
        menu.Items.Add(_loginStatusItem);
        _signInItem.Click += (_, _) => _ = SignInAsync();
        _signOutItem.Click += (_, _) => _ = SignOutAsync();
        menu.Items.Add(_signInItem);
        menu.Items.Add(_signOutItem);
        menu.Items.Add(new ToolStripSeparator());
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

    // ---- Web2에서 이 PC 보기 ----

    private void ToggleDoor()
    {
        var s = _settings.Load();
        s.WebDoor = !s.WebDoor;
        try { _settings.Save(s); }
        catch (IOException) { _log.Write(LogCode.Error); return; }
        SyncDoor(notify: true);
        if (!s.WebDoor) ToastForm.Show("웹2에서 이 PC 보기를 껐어요.");
        else if (_door != null) ToastForm.Show("웹2 [파일]에서 이 PC를 볼 수 있어요. 이 PC의 브라우저에서만 보여요.");
        else if (_auth.State != AuthState.SignedIn) ToastForm.Show("로그인하면 웹2에서 이 PC를 볼 수 있어요.");
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
        _doorItem.Text = wanted && _auth.State != AuthState.SignedIn ? "웹2에서 이 PC 보기 (로그인하면 열려요)" : "웹2에서 이 PC 보기";
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
        CloseDoor();
        _tray.Visible = false;
        _log.Write(LogCode.Stopped);
        ExitThread();
    }

    // ---- waiting items from older versions ----

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
            _api.Dispose();
            _authClient.Dispose();
            _door?.Dispose();
            _webUsers.Dispose();
        }
        base.Dispose(disposing);
    }
}
