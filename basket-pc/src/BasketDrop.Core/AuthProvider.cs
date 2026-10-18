namespace BasketDrop;

/// <summary>
/// Where the access token comes from. Step A ships only <see cref="NotSignedInAuthProvider"/>;
/// the Google sign-in (step B) implements this interface. Implementations hold the token in memory only.
/// </summary>
public interface IAuthProvider
{
    /// <summary>Returns a valid access token, or null when signed out. Never log the value.</summary>
    Task<string?> GetAccessTokenAsync(CancellationToken ct);
}

public sealed class NotSignedInAuthProvider : IAuthProvider
{
    public Task<string?> GetAccessTokenAsync(CancellationToken ct) => Task.FromResult<string?>(null);
}
