using System.Runtime.InteropServices;
using System.Text;

namespace BasketDrop;

/// <summary>Holds the refresh token, the only secret this program keeps. Never a file, log, argument or variable.</summary>
public interface ITokenStore
{
    string? Load();
    void Save(string refreshToken);
    void Delete();
}

public sealed class TokenStoreException : Exception
{
    public TokenStoreException(string message) : base(message) { }
}

/// <summary>
/// Windows Credential Manager (generic credential, this Windows user, this PC). Like any per-user store it does not
/// stop other programs running as the same Windows user (design 4.4, risk R1).
/// </summary>
public sealed class CredentialManagerTokenStore : ITokenStore
{
    public const string DefaultTarget = "BasketDrop/Supabase";
    private const uint TypeGeneric = 1;
    private const uint PersistLocalMachine = 2;
    private const int ErrorNotFound = 1168;
    private readonly string _target;

    public CredentialManagerTokenStore(string target = DefaultTarget) { _target = target; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Credential
    {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string? Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string? TargetAlias;
        public string? UserName;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CredWriteW")]
    private static extern bool CredWrite(ref Credential credential, uint flags);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CredReadW")]
    private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CredDeleteW")]
    private static extern bool CredDelete(string target, uint type, uint flags);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern void CredFree(IntPtr buffer);

    private static void RequireWindows()
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
    }

    public string? Load()
    {
        RequireWindows();
        if (!CredRead(_target, TypeGeneric, 0, out var ptr))
        {
            if (Marshal.GetLastWin32Error() == ErrorNotFound) return null;
            throw new TokenStoreException("read failed");
        }
        try
        {
            var cred = Marshal.PtrToStructure<Credential>(ptr);
            if (cred.CredentialBlobSize == 0 || cred.CredentialBlob == IntPtr.Zero) return null;
            var bytes = new byte[cred.CredentialBlobSize];
            Marshal.Copy(cred.CredentialBlob, bytes, 0, bytes.Length);
            try { return Encoding.UTF8.GetString(bytes); }
            finally { Array.Clear(bytes); }
        }
        finally { CredFree(ptr); }
    }

    public void Save(string refreshToken)
    {
        RequireWindows();
        var bytes = Encoding.UTF8.GetBytes(refreshToken);
        var blob = Marshal.AllocHGlobal(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, blob, bytes.Length);
            var cred = new Credential
            {
                Type = TypeGeneric, TargetName = _target, CredentialBlobSize = (uint)bytes.Length,
                CredentialBlob = blob, Persist = PersistLocalMachine, UserName = "BasketDrop",
            };
            if (!CredWrite(ref cred, 0)) throw new TokenStoreException("write failed");
        }
        finally
        {
            for (var i = 0; i < bytes.Length; i++) Marshal.WriteByte(blob, i, 0);
            Array.Clear(bytes);
            Marshal.FreeHGlobal(blob);
        }
    }

    public void Delete()
    {
        RequireWindows();
        if (!CredDelete(_target, TypeGeneric, 0) && Marshal.GetLastWin32Error() != ErrorNotFound)
            throw new TokenStoreException("delete failed");
    }
}
