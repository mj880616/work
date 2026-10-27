using System.Text.Json;
using System.Text.Json.Serialization;

namespace BasketDrop;

internal static class Json
{
    public static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() },
    };
}

internal static class AtomicFile
{
    /// <summary>Writes to a temp file then replaces, so a crash never leaves a half-written list.</summary>
    public static void WriteJson<T>(string path, T value)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(value, Json.Options));
        File.Move(tmp, path, true);
    }

    public static T? ReadJson<T>(string path) where T : class
    {
        try
        {
            return File.Exists(path) ? JsonSerializer.Deserialize<T>(File.ReadAllText(path), Json.Options) : null;
        }
        catch (Exception e) when (e is JsonException or IOException)
        {
            return null;
        }
    }
}
