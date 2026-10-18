namespace BasketDrop.App;

internal static class AppPaths
{
    public static readonly string Root = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BasketDrop");

    public static string Queue => Path.Combine(Root, "queue");
    public static string History => Path.Combine(Root, "history.json");
    public static string Log => Path.Combine(Root, "log.txt");

    /// <summary>The basket lives in Web2; this only opens the page, nothing is passed in the address.</summary>
    public const string BasketUrl = "https://desk.bokdoong.com/";
}
