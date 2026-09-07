using AssetStudio;
using System.Runtime.CompilerServices;

// Model inline resources: different BinaryReaders share one seekable file stream.
var bytes = Enumerable.Range(1, 6).SelectMany(i => Enumerable.Repeat((byte)i, 256)).ToArray();
using var stream = new YieldingStream(bytes);
using var reader = new FileReader("shared-stream-test", stream);
// Only reader/Objects are used here; no synthetic serialized-file header is needed.
var file = (SerializedFile)RuntimeHelpers.GetUninitializedObject(typeof(SerializedFile));
file.reader = reader;
file.Objects = [];
var manager = new AssetsManager();
manager.AssetsFileList.Add(file);
ResourceReader Inline(int index) => new(new BinaryReader(stream), index * 256, 256);
var a = new Texture2D { assetsFile = file, image_data = Inline(0) };
var b = new Texture2D { assetsFile = file, image_data = Inline(1) };
var layer = new Texture2D { assetsFile = file, image_data = Inline(2) };
var array = new Texture2DArray { assetsFile = file, image_data = Inline(3), TextureList = [layer] };
var audio = (AudioClip)RuntimeHelpers.GetUninitializedObject(typeof(AudioClip));
audio.assetsFile = file;
audio.m_AudioData = Inline(4);
var externalReader = new ResourceReader("external.resS", file, 0, 256);
var external = new Texture2D { assetsFile = file, m_StreamData = new StreamingInfo { path = "external.resS" }, image_data = externalReader };
file.Objects.AddRange([a, b, array, audio, external]);
SharedResourceReaders.Prepare(manager);
if (!ReferenceEquals(external.image_data, externalReader)) throw new Exception("External resource was rebound");
ResourceReader[] resources = [a.image_data, b.image_data, layer.image_data, array.image_data, audio.m_AudioData];
stream.YieldOnSeek = true;
Parallel.For(0, 200, new ParallelOptions { MaxDegreeOfParallelism = 8 }, i =>
{
    int index = i % resources.Length;
    byte[] actual;
    if (i % 2 == 0) actual = resources[index].GetData();
    else
    {
        actual = new byte[256];
        if (resources[index].GetData(actual) != actual.Length) throw new Exception("Short resource read");
    }
    if (actual.Length != 256 || actual.Any(value => value != index + 1))
        throw new Exception($"Inline resource {index} read another resource's bytes");
});
Console.WriteLine("Shared file reader: 200 concurrent reads match; array layers/audio covered; external resource preserved.");

sealed class YieldingStream(byte[] bytes) : MemoryStream(bytes)
{
    public bool YieldOnSeek;
    public override long Position
    {
        get => base.Position;
        set { base.Position = value; if (YieldOnSeek) Thread.Sleep(1); }
    }
}
