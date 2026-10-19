namespace BasketDrop;

public enum AuthState
{
    SignedOut,
    SignedIn,
    /// <summary>The saved login no longer works (revoked or expired). The queue is kept; signing in again resumes it.</summary>
    ReloginNeeded,
}

public enum SignInOutcome { Ok, NotOwner, PortsBusy, BrowserFailed, Denied, TimedOut, Cancelled, Unavailable, Failed }

/// <param name="LocalLoginRemoved">False when the saved login could not be deleted from this PC: it is then still active and would be signed in again at the next start.</param>
public sealed record SignOutResult(bool ServerSessionEnded, bool LocalLoginRemoved = true);

/// <summary>
/// Google sign-in through the system browser (PKCE + loopback), refresh-token rotation and sign-out.
/// Only one object touches the tokens, and every change goes through one gate, so a refresh token is never
/// spent twice at the same time. Only the refresh token is stored (Credential Manager); the access token lives in memory.
/// Permission is never decided here: the owner check below is a courtesy so a wrong account gets a clear message,
/// while the real decision stays on the server (row security and the basket-files owner check).
/// </summary>
public sealed class SupabaseAuthProvider : IAuthProvider
{
    /// <summary>Refresh this long before the access token expires.</summary>
    public static readonly TimeSpan RefreshMargin = TimeSpan.FromSeconds(60);
    public static readonly TimeSpan SignInTimeout = TimeSpan.FromMinutes(2);

    private readonly IAuthClient _client;
    private readonly ITokenStore _store;
    private readonly IBasketApi _api;
    private readonly ILog _log;
    private readonly Func<DateTimeOffset> _clock;
    private readonly IReadOnlyList<int>? _ports;
    private readonly TimeSpan _signInTimeout;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private string? _access;
    /// <summary>The newest refresh token when it could not be saved: kept in memory so the next renewal does not reuse the old, spent one.</summary>
    private string? _unsavedRefresh;
    private DateTimeOffset _expires;
    private volatile AuthState _state;

    public event Action<AuthState>? StateChanged;

    public AuthState State => _state;

    public SupabaseAuthProvider(IAuthClient client, ITokenStore store, IBasketApi api, ILog? log = null,
        Func<DateTimeOffset>? clock = null, IReadOnlyList<int>? ports = null, TimeSpan? signInTimeout = null)
    {
        _client = client;
        _store = store;
        _api = api;
        _log = log ?? new NullLog();
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
        _ports = ports;
        _signInTimeout = signInTimeout ?? SignInTimeout;
        _state = HasSavedLogin() ? AuthState.SignedIn : AuthState.SignedOut;
    }

    private bool HasSavedLogin()
    {
        try { return _store.Load() != null; }
        catch (TokenStoreException) { _log.Write(LogCode.Error); return false; }
    }

    private void SetState(AuthState state)
    {
        if (_state == state) return;
        _state = state;
        StateChanged?.Invoke(state);
    }

    public void MarkAccessTokenRejected() => _expires = DateTimeOffset.MinValue;

    public async Task<string?> GetAccessTokenAsync(CancellationToken ct)
    {
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            return await CurrentTokenLockedAsync(ct).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Caller holds the gate. Concurrent callers queue behind one refresh and then reuse its result.</summary>
    private async Task<string?> CurrentTokenLockedAsync(CancellationToken ct)
    {
        if (_access != null && _expires - _clock() > RefreshMargin) return _access;

        string? refresh;
        try { refresh = _unsavedRefresh ?? _store.Load(); }
        catch (TokenStoreException) { _log.Write(LogCode.Error); return null; }
        if (refresh == null)
        {
            _access = null;
            return null;
        }

        AuthTokens tokens;
        try
        {
            tokens = await _client.RefreshAsync(refresh, ct).ConfigureAwait(false);
        }
        catch (AuthRejectedException)
        {
            // The saved login is dead. Drop it; the queue stays on this PC as "login needed".
            _access = null;
            _unsavedRefresh = null;
            try { _store.Delete(); } catch (TokenStoreException) { _log.Write(LogCode.Error); }
            _log.Write(LogCode.ReloginNeeded);
            SetState(AuthState.ReloginNeeded);
            return null;
        }
        // AuthUnavailableException is left to the caller: the login itself is fine, the network is not.

        Accept(tokens);
        return _access;
    }

    /// <summary>Remembers the rotated refresh token first; the old one stops working after its short grace period.</summary>
    private void Accept(AuthTokens tokens)
    {
        try
        {
            _store.Save(tokens.RefreshToken);
            _unsavedRefresh = null;
        }
        catch (TokenStoreException)
        {
            // The server already retired the old token, so the new one must not be lost; the next save attempt retries.
            _unsavedRefresh = tokens.RefreshToken;
            _log.Write(LogCode.Error);
        }
        _access = tokens.AccessToken;
        _expires = tokens.ExpiresAt;
        SetState(AuthState.SignedIn);
    }

    /// <summary>
    /// Opens the browser (through <paramref name="openBrowser"/>), waits for the single return, exchanges the code,
    /// checks the account and only then saves the login. Nothing secret reaches the address passed to the browser.
    /// </summary>
    public async Task<SignInOutcome> SignInAsync(Func<Uri, bool> openBrowser, CancellationToken ct)
    {
        var verifier = Pkce.NewVerifier();
        var state = Pkce.NewState();
        string code;
        LoopbackReceiver receiver;
        try { receiver = LoopbackReceiver.Start(state, _ports); }
        catch (PortsBusyException) { return Fail(SignInOutcome.PortsBusy); }

        using (receiver)
        {
            if (!openBrowser(_client.BuildAuthorizeUrl(receiver.RedirectUri, Pkce.Challenge(verifier))))
                return Fail(SignInOutcome.BrowserFailed);
            CallbackResult? result;
            try { result = await receiver.WaitAsync(_signInTimeout, ct).ConfigureAwait(false); }
            catch (OperationCanceledException) { return Fail(SignInOutcome.Cancelled); }
            if (result == null) return Fail(SignInOutcome.TimedOut);
            if (result.Kind == CallbackKind.Denied) return Fail(SignInOutcome.Denied);
            code = result.Code!;
        }

        AuthTokens tokens;
        try { tokens = await _client.ExchangeCodeAsync(code, verifier, ct).ConfigureAwait(false); }
        catch (AuthRejectedException) { return Fail(SignInOutcome.Failed); }
        catch (AuthUnavailableException) { return Fail(SignInOutcome.Unavailable); }
        catch (OperationCanceledException) { return Fail(SignInOutcome.Cancelled); }

        // Owner check before anything is saved. A wrong account is signed out again (its own new session only).
        // A cancel from here on still ends the session just created, so none is left behind on the server.
        ApiResult owner;
        try { owner = await _api.CheckOwnerAsync(tokens.AccessToken, ct).ConfigureAwait(false); }
        catch (OperationCanceledException)
        {
            await EndSessionAfterCancelAsync(tokens.AccessToken).ConfigureAwait(false);
            return Fail(SignInOutcome.Cancelled);
        }
        if (owner.Outcome != ApiOutcome.Ok)
        {
            await TryEndSessionAsync(tokens.AccessToken, ct).ConfigureAwait(false);
            _log.Write(owner.Outcome == ApiOutcome.Rejected ? LogCode.NotOwner : LogCode.SignInFailed);
            return owner.Outcome == ApiOutcome.Rejected ? SignInOutcome.NotOwner : SignInOutcome.Unavailable;
        }

        try { await _gate.WaitAsync(ct).ConfigureAwait(false); }
        catch (OperationCanceledException)
        {
            await EndSessionAfterCancelAsync(tokens.AccessToken).ConfigureAwait(false);
            return Fail(SignInOutcome.Cancelled);
        }
        try
        {
            Accept(tokens);
            if (_store.Load() == null) return Unsaved();
        }
        catch (TokenStoreException)
        {
            return Unsaved();
        }
        finally
        {
            _gate.Release();
        }
        _log.Write(LogCode.SignInOk);
        return SignInOutcome.Ok;
    }

    /// <summary>The login could not be remembered, so it is not kept at all (it would be lost at the next start).</summary>
    private SignInOutcome Unsaved()
    {
        _access = null;
        _unsavedRefresh = null;
        SetState(AuthState.SignedOut);
        return Fail(SignInOutcome.Failed);
    }

    private SignInOutcome Fail(SignInOutcome outcome)
    {
        _log.Write(LogCode.SignInFailed);
        return outcome;
    }

    /// <summary>
    /// Deletes the saved login on this PC first (always), then ends only this program's session on the server.
    /// The server call is skipped unless the token names its own session: without a session id the server's logout
    /// would end every session of the account, including other devices and the reading app.
    /// </summary>
    public async Task<SignOutResult> SignOutAsync(CancellationToken ct)
    {
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            string? access = null;
            try { access = await CurrentTokenLockedAsync(ct).ConfigureAwait(false); }
            catch (AuthUnavailableException) { }

            try { _store.Delete(); }
            catch (TokenStoreException)
            {
                // The login is still saved and still works, so say so: nothing is cleared and the server session stays,
                // otherwise the next start would sign in again with a login that looks ended.
                _log.Write(LogCode.Error);
                return new SignOutResult(false, false);
            }
            _access = null;
            _unsavedRefresh = null;
            _expires = DateTimeOffset.MinValue;
            SetState(AuthState.SignedOut);
            _log.Write(LogCode.SignedOut);

            return new SignOutResult(access != null && await TryEndSessionAsync(access, ct).ConfigureAwait(false));
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>The caller's token is already cancelled, so the cleanup call gets its own short time limit.</summary>
    private async Task EndSessionAfterCancelAsync(string accessToken)
    {
        using var limit = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        await TryEndSessionAsync(accessToken, limit.Token).ConfigureAwait(false);
    }

    private async Task<bool> TryEndSessionAsync(string accessToken, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(Jwt.StringClaim(accessToken, "session_id"))) return false;
        try
        {
            await _client.LogoutLocalAsync(accessToken, ct).ConfigureAwait(false);
            return true;
        }
        catch (Exception e) when (e is AuthRejectedException or AuthUnavailableException) { return false; }
    }
}
