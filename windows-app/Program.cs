using System.IO.Pipes;
using System.Text;

namespace KPTUWork;

internal static class Program
{
    private const string MutexName = @"Local\KPTUWork.SingleInstance.v1";
    private const string PipeName = "KPTUWork.Activation.v1";

    [STAThread]
    private static void Main(string[] args)
    {
        using var mutex = new Mutex(true, MutexName, out var isFirstInstance);
        var activation = args.FirstOrDefault();

        if (!isFirstInstance)
        {
            ForwardActivation(activation);
            return;
        }

        ApplicationConfiguration.Initialize();
        var form = new MainForm(activation);
        _ = Task.Run(() => ListenForActivationsAsync(form));
        Application.Run(form);
    }

    private static async Task ListenForActivationsAsync(MainForm form)
    {
        while (!form.IsDisposed)
        {
            try
            {
                await using var server = new NamedPipeServerStream(
                    PipeName,
                    PipeDirection.In,
                    1,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous);

                await server.WaitForConnectionAsync();
                using var reader = new StreamReader(server, Encoding.UTF8);
                var activation = await reader.ReadLineAsync();

                if (!string.IsNullOrWhiteSpace(activation) && !form.IsDisposed)
                {
                    form.BeginInvoke(new Action(() => form.HandleActivation(activation)));
                }
            }
            catch
            {
                if (form.IsDisposed) return;
                await Task.Delay(250);
            }
        }
    }

    private static void ForwardActivation(string? activation)
    {
        if (string.IsNullOrWhiteSpace(activation)) return;

        try
        {
            using var client = new NamedPipeClientStream(".", PipeName, PipeDirection.Out);
            client.Connect(1800);
            using var writer = new StreamWriter(client, Encoding.UTF8) { AutoFlush = true };
            writer.WriteLine(activation);
        }
        catch
        {
            // The existing app may still be starting. The user can invoke the link again.
        }
    }
}
