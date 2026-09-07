using AssetStudio;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

// Adapted from AssetStudioUtility/Texture2DExtensions.cs; see vendor/AssetStudioCLI/LICENSE.
// Own the decoded buffer until the image encoder has finished reading it.
internal sealed class DecodedTexture : IDisposable
{
    public Image<Bgra32> Image { get; private set; }
    private byte[] buffer;

    public static DecodedTexture Create(Texture2D texture)
    {
        var converter = new Texture2DConverter(texture);
        // Keep upstream cropping/deswizzling behavior for Switch textures.
        if (converter.UsesSwitchSwizzle)
        {
            var image = texture.ConvertToImage(flip: true);
            return image == null ? null : new DecodedTexture { Image = image };
        }
        var decoded = new DecodedTexture();
        try
        {
            decoded.buffer = BigArrayPool<byte>.Shared.Rent(converter.OutputDataSize);
            if (!converter.DecodeTexture2D(decoded.buffer))
            {
                decoded.Dispose();
                return null;
            }
            decoded.Image = SixLabors.ImageSharp.Image.WrapMemory<Bgra32>(
                decoded.buffer.AsMemory(0, converter.OutputDataSize), texture.m_Width, texture.m_Height);
            decoded.Image.Mutate(x => x.Flip(FlipMode.Vertical));
            return decoded;
        }
        catch
        {
            decoded.Dispose();
            throw;
        }
    }

    public void Dispose()
    {
        Image?.Dispose();
        Image = null;
        if (buffer != null)
        {
            BigArrayPool<byte>.Shared.Return(buffer, clearArray: true);
            buffer = null;
        }
    }
}
