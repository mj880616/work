using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace BasketDrop.App;

/// <summary>
/// S69-35: shows a picture with its own see-through edge pixels as a window (a "layered" window, UpdateLayeredWindow).
/// Cutting a window to a rounded shape (a window Region) has only fully in or fully out pixels, so round corners look
/// stepped; with per-pixel alpha the corner pixels are partly see-through and the edge looks smooth on Windows 10 and 11.
/// The window must have WS_EX_LAYERED and is never painted by WM_PAINT; the owner calls <see cref="Show"/> after every change.
/// </summary>
internal static class LayeredWindow
{
    public const int WsExLayered = 0x00080000;
    private const int UlwAlpha = 2;
    private const byte AcSrcOver = 0, AcSrcAlpha = 1;

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeSize { public int Cx; public int Cy; }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    private struct BlendFunction { public byte Op; public byte Flags; public byte SourceConstantAlpha; public byte AlphaFormat; }

    [StructLayout(LayoutKind.Sequential)]
    private struct BitmapInfoHeader
    {
        public int Size; public int Width; public int Height; public short Planes; public short BitCount;
        public int Compression; public int SizeImage; public int XPels; public int YPels; public int ClrUsed; public int ClrImportant;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst, IntPtr pptDst, ref NativeSize psize, IntPtr hdcSrc,
        ref NativePoint pptSrc, int crKey, ref BlendFunction pblend, int flags);

    [DllImport("user32.dll")]
    private static extern IntPtr GetDC(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern int ReleaseDC(IntPtr hwnd, IntPtr hdc);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateCompatibleDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    private static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr obj);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateDIBSection(IntPtr hdc, ref BitmapInfoHeader info, uint usage, out IntPtr bits, IntPtr section, uint offset);

    /// <summary>Puts <paramref name="picture"/> (any 32-bit format; read as premultiplied) on the window at its current place, at the picture's size.</summary>
    public static void Show(IntPtr hwnd, Bitmap picture)
    {
        if (hwnd == IntPtr.Zero) return;
        int w = picture.Width, h = picture.Height;
        var header = new BitmapInfoHeader
        {
            Size = Marshal.SizeOf<BitmapInfoHeader>(), Width = w, Height = -h /* top-down */, Planes = 1, BitCount = 32,
        };
        var screen = GetDC(IntPtr.Zero);
        var mem = CreateCompatibleDC(screen);
        var dib = CreateDIBSection(screen, ref header, 0, out var bits, IntPtr.Zero, 0);
        if (dib == IntPtr.Zero || bits == IntPtr.Zero)
        {
            DeleteDC(mem);
            ReleaseDC(IntPtr.Zero, screen);
            return;
        }
        var old = SelectObject(mem, dib);
        try
        {
            var data = picture.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppPArgb);
            try
            {
                var row = new byte[w * 4];
                for (var y = 0; y < h; y++)
                {
                    Marshal.Copy(data.Scan0 + y * data.Stride, row, 0, row.Length);
                    Marshal.Copy(row, 0, bits + y * w * 4, row.Length);
                }
            }
            finally { picture.UnlockBits(data); }
            var size = new NativeSize { Cx = w, Cy = h };
            var source = new NativePoint();
            var blend = new BlendFunction { Op = AcSrcOver, Flags = 0, SourceConstantAlpha = 255, AlphaFormat = AcSrcAlpha };
            UpdateLayeredWindow(hwnd, screen, IntPtr.Zero, ref size, mem, ref source, 0, ref blend, UlwAlpha);
        }
        finally
        {
            SelectObject(mem, old);
            DeleteObject(dib);
            DeleteDC(mem);
            ReleaseDC(IntPtr.Zero, screen);
        }
    }
}
