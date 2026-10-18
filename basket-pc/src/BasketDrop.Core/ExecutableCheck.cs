namespace BasketDrop;

public static class ExecutableCheck
{
    private static readonly HashSet<string> Risky = new(StringComparer.OrdinalIgnoreCase)
    {
        ".exe", ".msi", ".bat", ".cmd", ".com", ".scr", ".ps1", ".vbs", ".js", ".jse", ".wsf", ".lnk", ".jar", ".dll", ".reg",
    };

    public static bool IsRisky(string fileName) => Risky.Contains(Path.GetExtension(fileName));
}
