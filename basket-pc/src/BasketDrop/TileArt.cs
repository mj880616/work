using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace BasketDrop.App;

/// <summary>What the desktop tile shows right now.</summary>
internal readonly record struct TileLook(bool DragOver, bool Busy);

/// <summary>
/// S69-35: draws the desktop tile ("WORK ON+로" card) as one picture with see-through edges, for <see cref="LayeredWindow"/>.
/// The card is drawn on an opaque ground (so Windows draws the words with its usual sharp ClearType), then a smooth
/// rounded mask decides each pixel's alpha (no stepped corners), with a faint shadow in a 2-pixel band around it.
/// Everything is laid out from the 118 × 96 layout at 100% and scaled to the real screen pixels
/// (<see cref="DesktopTileGeometry.ContentScale"/>), and the icon frame is chosen for the real size, so it stays sharp at
/// every screen scale and every size the user drags the tile to.
/// </summary>
internal static class TileArt
{
    internal static readonly Color Paper = CornerDropForm.Paper;
    internal static readonly Color PaperOver = Color.FromArgb(0xE4, 0xE1, 0xD7);
    internal static readonly Color Navy = CornerDropForm.Ink;
    internal static readonly Color Muted = Color.FromArgb(0x6B, 0x6E, 0x72);
    internal static readonly Color Edge = Color.FromArgb(0xCF, 0xCB, 0xC0);

    private const float ShadowStrength = 0.20f;

    private static readonly Dictionary<int, Bitmap> Frames = new();

    /// <summary>Gap between the window edge and the card (holds the shadow), in screen pixels.</summary>
    public static int Margin(int dpi) => Math.Max(1, CornerGeometry.Scale(2, dpi));

    public static Bitmap Render(Size size, int dpi, TileLook look)
    {
        int w = Math.Max(8, size.Width), h = Math.Max(8, size.Height);
        var k = DesktopTileGeometry.ContentScale(new Size(w, h));
        int S(float v) => (int)Math.Round(v * k);
        var m = Margin(dpi);
        var card = new RectangleF(m, m, w - 2 * m, h - 2 * m);
        var radius = Math.Max(3f, 10f * k);
        var border = Math.Max(1f, (float)Math.Round(k));

        using var face = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(face))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.CompositingQuality = CompositingQuality.HighQuality;
            // The edge colour fills everything; the ground is drawn inside it, so the mask's soft edge pixels are border, not ground.
            g.Clear(look.DragOver ? Navy : Edge);
            using (var ground = new SolidBrush(look.DragOver ? PaperOver : Paper))
            using (var inner = RoundRect(RectangleF.Inflate(card, -border, -border), Math.Max(1f, radius - border)))
                g.FillPath(ground, inner);
            if (look.DragOver)
            {
                using var pen = new Pen(Navy, Math.Max(1f, 1.5f * k)) { DashStyle = DashStyle.Dash };
                using var dash = RoundRect(RectangleF.Inflate(card, -4 * k, -4 * k), Math.Max(1f, radius - 4 * k));
                g.DrawPath(pen, dash);
            }

            // Icon 32, gap 4, title 20, gap 2, line 16 = 74 at 100%, centred in the card.
            var top = (int)Math.Round(card.Top + (card.Height - 74 * k) / 2);
            var iconSize = Math.Max(8, S(32));
            var frame = FrameFor(iconSize);
            var iconRect = new Rectangle((int)Math.Round(card.Left + (card.Width - iconSize) / 2), top, iconSize, iconSize);
            g.DrawImage(frame, iconRect);

            var title = look.Busy ? "담는 중…" : "WORK ON+로";
            using var big = new Font("Malgun Gothic", Math.Max(6, S(13)), FontStyle.Bold, GraphicsUnit.Pixel);
            using var small = new Font("Malgun Gothic", Math.Max(6, S(10)), GraphicsUnit.Pixel);
            const TextFormatFlags centered = TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine
                                             | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPadding;
            var left = (int)Math.Round(card.Left) + S(4);
            var width = (int)Math.Round(card.Width) - S(8);
            var titleBox = new Rectangle(left, iconRect.Bottom + S(4), width, S(20));
            var subBox = new Rectangle(left, titleBox.Bottom + S(2), width, S(16));
            var ground2 = look.DragOver ? PaperOver : Paper;
            TextRenderer.DrawText(g, title, big, titleBox, Navy, ground2, centered);
            if (!look.Busy) TextRenderer.DrawText(g, look.DragOver ? "놓으면 올려요" : "끌어 놓기", small, subBox, Muted, ground2, centered);
        }

        var shape = Mask(w, h, card, radius);
        var shadow = Blur(Mask(w, h, new RectangleF(card.X, card.Y + Math.Max(1, m / 2f), card.Width, card.Height), radius), w, h, m);
        return Compose(face, shape, shadow, w, h);
    }

    private static Bitmap FrameFor(int pixels)
    {
        var size = IconFrames.Pick(pixels, IconFrames.InAppIcon);
        lock (Frames)
        {
            if (!Frames.TryGetValue(size, out var bmp))
            {
                using var icon = AppIcon.ForSize(size);
                bmp = icon.ToBitmap();
                Frames[size] = bmp;
            }
            return bmp;
        }
    }

    internal static GraphicsPath RoundRect(RectangleF r, float radius)
    {
        var path = new GraphicsPath();
        var d = Math.Max(1f, Math.Min(radius * 2, Math.Min(r.Width, r.Height)));
        path.AddArc(r.Left, r.Top, d, d, 180, 90);
        path.AddArc(r.Right - d, r.Top, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        path.AddArc(r.Left, r.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    /// <summary>Coverage (0..255) of a smooth rounded rectangle for every pixel.</summary>
    private static byte[] Mask(int w, int h, RectangleF r, float radius)
    {
        using var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.Clear(Color.Transparent);
            using var path = RoundRect(r, radius);
            using var white = new SolidBrush(Color.White);
            g.FillPath(white, path);
        }
        var bytes = Read(bmp, PixelFormat.Format32bppArgb);
        var a = new byte[w * h];
        for (var i = 0; i < a.Length; i++) a[i] = bytes[i * 4 + 3];
        return a;
    }

    /// <summary>Two passes of a box blur, so the shadow fades out softly over <paramref name="radius"/> pixels.</summary>
    private static byte[] Blur(byte[] a, int w, int h, int radius)
    {
        if (radius <= 0) return a;
        var tmp = new byte[a.Length];
        var outp = new byte[a.Length];
        for (var pass = 0; pass < 2; pass++)
        {
            for (var y = 0; y < h; y++)
                for (var x = 0; x < w; x++)
                {
                    int sum = 0, n = 0;
                    for (var dx = -radius; dx <= radius; dx++)
                    {
                        var xx = x + dx;
                        if (xx < 0 || xx >= w) { n++; continue; }
                        sum += a[y * w + xx]; n++;
                    }
                    tmp[y * w + x] = (byte)(sum / n);
                }
            for (var y = 0; y < h; y++)
                for (var x = 0; x < w; x++)
                {
                    int sum = 0, n = 0;
                    for (var dy = -radius; dy <= radius; dy++)
                    {
                        var yy = y + dy;
                        if (yy < 0 || yy >= h) { n++; continue; }
                        sum += tmp[yy * w + x]; n++;
                    }
                    outp[y * w + x] = (byte)(sum / n);
                }
            Array.Copy(outp, a, a.Length);
        }
        return a;
    }

    /// <summary>
    /// Card colour × shape coverage, over a black shadow. Premultiplied output. Every pixel keeps at least alpha 1 (invisible),
    /// so the whole rectangle still takes clicks, drops and the resize band, also in the see-through corners.
    /// </summary>
    private static Bitmap Compose(Bitmap face, byte[] shape, byte[] shadow, int w, int h)
    {
        var src = Read(face, PixelFormat.Format32bppArgb);
        var dst = new byte[w * h * 4];
        for (var i = 0; i < w * h; i++)
        {
            var a = shape[i] / 255f;
            var s = shadow[i] / 255f * ShadowStrength;
            var alpha = a + s * (1 - a);
            var o = i * 4;
            if (alpha * 255f < 1f)
            {
                dst[o + 3] = 1;
                continue;
            }
            dst[o] = (byte)Math.Round(src[o] * a);
            dst[o + 1] = (byte)Math.Round(src[o + 1] * a);
            dst[o + 2] = (byte)Math.Round(src[o + 2] * a);
            dst[o + 3] = (byte)Math.Round(alpha * 255f);
        }
        var result = new Bitmap(w, h, PixelFormat.Format32bppPArgb);
        var data = result.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppPArgb);
        try
        {
            for (var y = 0; y < h; y++) Marshal.Copy(dst, y * w * 4, data.Scan0 + y * data.Stride, w * 4);
        }
        finally { result.UnlockBits(data); }
        return result;
    }

    private static byte[] Read(Bitmap bmp, PixelFormat format)
    {
        int w = bmp.Width, h = bmp.Height;
        var bytes = new byte[w * h * 4];
        var data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, format);
        try
        {
            for (var y = 0; y < h; y++) Marshal.Copy(data.Scan0 + y * data.Stride, bytes, y * w * 4, w * 4);
        }
        finally { bmp.UnlockBits(data); }
        return bytes;
    }
}
