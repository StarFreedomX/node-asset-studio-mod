using AssetStudio;

internal static class SharedResourceReaders
{
    public static void Prepare(AssetsManager manager)
    {
        // ObjectReader instances share a file stream, but ResourceReader locks the
        // BinaryReader, not that stream. Give inline resources one common reader
        // before starting any parallel work so seeking and reading are atomic.
        foreach (var file in manager.AssetsFileList)
        {
            ResourceReader Rebind(ResourceReader resource) => resource == null ? null :
                new ResourceReader(file.reader, resource.Offset, resource.Size);
            void Texture(Texture2D texture)
            {
                if (string.IsNullOrEmpty(texture.m_StreamData?.path))
                    texture.image_data = Rebind(texture.image_data);
            }
            foreach (var asset in file.Objects)
            {
                switch (asset)
                {
                    case Texture2D texture:
                        Texture(texture);
                        break;
                    case Texture2DArray array:
                        if (string.IsNullOrEmpty(array.m_StreamData?.path))
                            array.image_data = Rebind(array.image_data);
                        if (array.TextureList != null)
                            foreach (var layer in array.TextureList) Texture(layer);
                        break;
                    case AudioClip audio when string.IsNullOrEmpty(audio.m_Source):
                        audio.m_AudioData = Rebind(audio.m_AudioData);
                        break;
                }
            }
        }
    }
}
