namespace BasketDrop;

/// <summary>
/// Where the access token comes from. Implementations hold the access token in memory only.
/// </summary>
public interface IAuthProvider
{
    /// <summary>
    /// Returns a valid access token, or null when signed out or the session must be renewed by signing in again.
    /// Throws <see cref="AuthUnavailableException"/> when the auth server could not be reached (nothing is wrong with the login).
    /// Never log the value.
    /// </summary>
    Task<string?> GetAccessTokenAsync(CancellationToken ct);

    /// <summary>The server answered 401 for the current access token: do not hand it out again, renew it first.</summary>
    void MarkAccessTokenRejected();
}

public sealed class NotSignedInAuthProvider : IAuthProvider
{
    public Task<string?> GetAccessTokenAsync(CancellationToken ct) => Task.FromResult<string?>(null);
    public void MarkAccessTokenRejected() { }
}
