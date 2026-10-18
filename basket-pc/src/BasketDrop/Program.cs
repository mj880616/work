using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;

namespace BasketDrop.App;

internal static class Program
{
    private const string MutexName = @"Local\BasketDrop.SingleInstance.v1";
    private const int MaxPathChars = 4096;

    // The pipe is limited to the current Windows user. Only file paths travel through it, never tokens.
    private static string PipeName => "BasketDrop.Send.v1." + WindowsIdentity.GetCurrent().User?.Value;

    [STAThread]
    private static void Main(string[] args)
    {
        using var mutex = new Mutex(true, MutexName, out var isFirst);
        var paths = args.Where(a => a.Length is > 0 and <= MaxPathChars && Path.IsPathRooted(a) && (File.Exists(a) || Directory.Exists(a))).ToList();

        if (!isFirst)
        {
            Forward(paths);
            return;
        }

        ApplicationConfiguration.Initialize();
        using var app = new TrayApp();
        Application.ThreadException += (_, _) => app.LogError();
        var listener = new Thread(() => Listen(app)) { IsBackground = true };
        listener.Start();
        if (paths.Count > 0) app.ReceivePaths(paths);
        Application.Run(app);
    }

    private static void Listen(TrayApp app)
    {
        var security = new PipeSecurity();
        security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User!, PipeAccessRights.FullControl, AccessControlType.Allow));
        while (!app.IsClosing)
        {
            try
            {
                using var server = NamedPipeServerStreamAcl.Create(PipeName, PipeDirection.In, 1,
                    PipeTransmissionMode.Byte, PipeOptions.None, 0, 0, security);
                server.WaitForConnection();
                using var reader = new StreamReader(server, Encoding.UTF8);
                var paths = new List<string>();
                while (reader.ReadLine() is { } line)
                {
                    // Re-checked here: the sender is trusted only as far as "a path that exists".
                    if (line.Length is > 0 and <= MaxPathChars && Path.IsPathRooted(line) && (File.Exists(line) || Directory.Exists(line)))
                        paths.Add(line);
                }
                if (paths.Count > 0) app.ReceivePaths(paths);
            }
            catch (IOException)
            {
                Thread.Sleep(250);
            }
        }
    }

    private static void Forward(List<string> paths)
    {
        if (paths.Count == 0) return;
        try
        {
            using var client = new NamedPipeClientStream(".", PipeName, PipeDirection.Out);
            client.Connect(2000);
            using var writer = new StreamWriter(client, Encoding.UTF8) { AutoFlush = true };
            foreach (var p in paths) writer.WriteLine(p);
        }
        catch (Exception e) when (e is IOException or TimeoutException)
        {
            // The running program may still be starting; the user can send again.
        }
    }
}
