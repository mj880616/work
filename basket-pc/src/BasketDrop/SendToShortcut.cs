namespace BasketDrop.App;

/// <summary>The right-click "Send to" entry: a shortcut in the user's SendTo folder that starts this program with file paths.</summary>
internal static class SendToShortcut
{
    private static string LinkPath =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.SendTo), "바구니 PC드롭.lnk");

    public static bool Exists => File.Exists(LinkPath);

    public static void Install()
    {
        var exe = Environment.ProcessPath ?? throw new InvalidOperationException();
        var type = Type.GetTypeFromProgID("WScript.Shell") ?? throw new InvalidOperationException();
        dynamic shell = Activator.CreateInstance(type)!;
        dynamic link = shell.CreateShortcut(LinkPath);
        link.TargetPath = exe;
        link.Description = "바구니 PC드롭으로 보내기";
        link.Save();
    }

    public static void Remove()
    {
        if (File.Exists(LinkPath)) File.Delete(LinkPath);
    }
}
