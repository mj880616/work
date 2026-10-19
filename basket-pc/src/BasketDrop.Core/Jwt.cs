using System.Text.Json;

namespace BasketDrop;

internal static class Jwt
{
    /// <summary>
    /// Reads one string claim without verifying the signature. Only for filtering a query or deciding which
    /// logout call is safe; the server (row security, Edge checks) is what actually decides access.
    /// </summary>
    public static string? StringClaim(string token, string name)
    {
        try
        {
            var parts = token.Split('.');
            if (parts.Length != 3) return null;
            var payload = parts[1].Replace('-', '+').Replace('_', '/');
            payload = payload.PadRight(payload.Length + (4 - payload.Length % 4) % 4, '=');
            using var doc = JsonDocument.Parse(Convert.FromBase64String(payload));
            return doc.RootElement.TryGetProperty(name, out var s) && s.ValueKind == JsonValueKind.String ? s.GetString() : null;
        }
        catch (Exception e) when (e is FormatException or JsonException) { return null; }
    }
}
