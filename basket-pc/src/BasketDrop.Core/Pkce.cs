using System.Security.Cryptography;
using System.Text;

namespace BasketDrop;

/// <summary>PKCE (RFC 7636) values. All are base64url, so none contains "." or "/" (Supabase treats those as separators).</summary>
public static class Pkce
{
    public static string NewVerifier() => Base64Url(RandomNumberGenerator.GetBytes(32));

    public static string NewState() => Base64Url(RandomNumberGenerator.GetBytes(24));

    public static string Challenge(string verifier) => Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
