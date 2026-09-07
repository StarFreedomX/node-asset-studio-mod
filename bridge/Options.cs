using AssetStudio;
using CubismLive2DExtractor;
using System.Text.Json;

// Typed settings for the linked export helpers. No command-line parser is used.
namespace AssetStudioCLI.Options;

internal enum WorkMode { Extract, Export, ExportRaw, Dump, Info, Live2D, SplitObjects, Animator }
internal enum AssetGroupOption { None, TypeName, ContainerPath, ContainerPathFull, SourceFileName, SceneHierarchy }
internal enum FilenameFormat { AssetName, AssetName_PathID, PathID }
internal enum ExportListType { None, XML }
internal enum AudioFormat { None, Wav }
internal enum FilterBy { None, Name, Container, PathID, NameOrContainer, NameAndContainer }
internal enum AnimationExportMode { Auto, Skip, All }

internal sealed class Option<T>(T value)
{
    public T Value { get; set; } = value;
    public T DefaultValue { get; } = value;
    public override string ToString() => Value?.ToString() ?? "";
}

internal static class CLIOptions
{
    public static List<string> inputPathList = [];
    public static FilterBy filterBy;
    public static Option<WorkMode> o_workMode = new(WorkMode.Export);
    public static Option<List<ClassIDType>> o_exportAssetTypes = new([]);
    public static Option<AssetGroupOption> o_groupAssetsBy = new(AssetGroupOption.ContainerPath);
    public static Option<FilenameFormat> o_filenameFormat = new(FilenameFormat.AssetName);
    public static Option<string> o_outputFolder = new("");
    public static Option<bool> f_overwriteExisting = new(false);
    public static Option<LoggerEvent> o_logLevel = new(LoggerEvent.Info);
    public static bool convertTexture = true;
    public static Option<ImageFormat> o_imageFormat = new(ImageFormat.Png);
    public static Option<AudioFormat> o_audioFormat = new(AudioFormat.Wav);
    public static Option<Live2DModelGroupOption> o_l2dGroupOption = new(Live2DModelGroupOption.ContainerPath);
    public static Option<bool> f_l2dAssetSearchByFilename = new(false);
    public static Option<Live2DMotionMode> o_l2dMotionMode = new(Live2DMotionMode.MonoBehaviour);
    public static Option<bool> f_l2dForceBezier = new(false);
    public static Option<float> o_fbxScaleFactor = new(1);
    public static Option<int> o_fbxBoneSize = new(10);
    public static Option<AnimationExportMode> o_fbxAnimMode = new(AnimationExportMode.Auto);
    public static Option<bool> f_fbxUvsAsDiffuseMaps = new(false);
    public static Option<List<string>> o_filterByName = new([]);
    public static Option<List<string>> o_filterByContainer = new([]);
    public static Option<List<string>> o_filterByPathID = new([]);
    public static Option<List<string>> o_filterByText = new([]);
    public static Option<bool> f_filterWithRegex = new(false);
    public static Option<CompressionType> o_bundleBlockInfoCompression = new(CompressionType.Auto);
    public static Option<CompressionType> o_bundleBlockCompression = new(CompressionType.Auto);
    public static Option<int> o_maxParallelExportTasks = new(Environment.ProcessorCount);
    public static Option<ExportListType> o_exportAssetList = new(ExportListType.None);
    public static Option<string> o_assemblyPath = new("");
    public static Option<UnityVersion> o_unityVersion = new(null);
    public static Option<bool> f_decompressToDisk = new(false);
    public static Option<bool> f_notRestoreExtensionName = new(false);
    public static Option<bool> f_avoidLoadingViaTypetree = new(false);
    public static Option<bool> f_loadAllAssets = new(false);

    private static readonly Dictionary<string, ClassIDType> AssetTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        ["tex2d"] = ClassIDType.Texture2D, ["tex2dArray"] = ClassIDType.Texture2DArray,
        ["sprite"] = ClassIDType.Sprite, ["textasset"] = ClassIDType.TextAsset,
        ["monobehaviour"] = ClassIDType.MonoBehaviour, ["font"] = ClassIDType.Font,
        ["shader"] = ClassIDType.Shader, ["movietexture"] = ClassIDType.MovieTexture,
        ["audio"] = ClassIDType.AudioClip, ["video"] = ClassIDType.VideoClip,
        ["mesh"] = ClassIDType.Mesh, ["animator"] = ClassIDType.Animator,
    };

    private static readonly HashSet<string> KnownOptions =
    [
        "mode", "assetType", "group", "filenameFormat", "overwrite", "logLevel",
        "logOutput", "imageFormat", "audioFormat", "l2dGroupOption", "l2dMotionMode", "l2dSearchByFilename",
        "l2dForceBezier", "fbxScaleFactor", "fbxBoneSize", "fbxAnimation", "fbxUVsAsDiffuse", "filterByName",
        "filterByContainer", "filterByPathID", "filterByText", "filterWithRegex", "blockinfoComp", "blockComp",
        "maxExportTasks", "exportAssetList", "assemblyFolder", "unityVersion", "decompressToDisk", "notRestoreExtension",
        "ignoreTypetree", "loadAll",
    ];

    public static void Configure(string input, string output, JsonElement config, bool inspect)
    {
        if (config.ValueKind != JsonValueKind.Object) throw new ArgumentException("config must be an object");
        foreach (var property in config.EnumerateObject())
            if (!KnownOptions.Contains(property.Name)) throw new ArgumentException($"Unknown option: {property.Name}");
        string S(string key, string fallback = "") => config.TryGetProperty(key, out var v) ? v.GetString() : fallback;
        bool B(string key) => config.TryGetProperty(key, out var v) && v.GetBoolean();
        T E<T>(string key, T fallback) where T : struct, Enum
        {
            if (!config.TryGetProperty(key, out var v)) return fallback;
            if (Enum.TryParse<T>(v.GetString(), true, out var result) && Enum.IsDefined(result)) return result;
            throw new ArgumentException($"Unsupported {key}: {v}");
        }
        List<string> F(string key) => string.IsNullOrEmpty(S(key)) ? [] :
            B("filterWithRegex") ? [S(key)] : S(key).Split([',', ';'], StringSplitOptions.RemoveEmptyEntries).ToList();
        inputPathList = [input];
        o_outputFolder.Value = output;
        o_workMode.Value = inspect ? WorkMode.Info : E("mode", WorkMode.Export);
        o_logLevel.Value = E("logLevel", LoggerEvent.Info);
        if (S("logOutput", "console") != "console")
            throw new ArgumentException("Use onEvent to route structured logs; logOutput must be console or omitted.");
        o_exportAssetTypes = new(AssetTypes.Values.ToList());
        if (config.TryGetProperty("assetType", out var types))
        {
            var names = types.ValueKind == JsonValueKind.Array
                ? types.EnumerateArray().Select(x => x.GetString()).ToArray() : [types.GetString()];
            if (names.Length == 0) throw new ArgumentException("assetType cannot be empty");
            if (!names.Contains("all"))
                o_exportAssetTypes.Value = names.Select(x => AssetTypes.TryGetValue(x, out var t)
                    ? t : throw new ArgumentException($"Unsupported assetType: {x}")).Distinct().ToList();
        else if (names.Length != 1) throw new ArgumentException("all cannot be combined with other asset types");
        }
        // These modes require supporting animation/mesh objects, not just the user's export types.
        if (o_workMode.Value == WorkMode.Live2D)
            o_exportAssetTypes = new([ClassIDType.Animation, ClassIDType.AnimationClip,
                ClassIDType.AnimatorController, ClassIDType.MonoBehaviour, ClassIDType.Texture2D]);
        else if (o_workMode.Value is WorkMode.Animator or WorkMode.SplitObjects)
            o_exportAssetTypes = new([ClassIDType.Animator, ClassIDType.Mesh, ClassIDType.Texture2D]);
        o_groupAssetsBy.Value = S("group", "container") switch
        {
            "none" => AssetGroupOption.None, "type" => AssetGroupOption.TypeName,
            "container" => AssetGroupOption.ContainerPath, "containerFull" => AssetGroupOption.ContainerPathFull,
            "fileName" => AssetGroupOption.SourceFileName, "sceneHierarchy" => AssetGroupOption.SceneHierarchy,
            _ => throw new ArgumentException("Unsupported group"),
        };
        o_filenameFormat.Value = E("filenameFormat", FilenameFormat.AssetName);
        f_overwriteExisting.Value = B("overwrite");
        convertTexture = S("imageFormat", "png") != "none";
        o_imageFormat.Value = S("imageFormat", "png") switch
        {
            "none" or "png" => ImageFormat.Png, "jpg" => ImageFormat.Jpeg,
            "bmp" => ImageFormat.Bmp, "tga" => ImageFormat.Tga, "webp" => ImageFormat.Webp,
            _ => throw new ArgumentException("Unsupported imageFormat"),
        };
        o_audioFormat.Value = E("audioFormat", AudioFormat.Wav);
        o_l2dGroupOption.Value = S("l2dGroupOption", "container") switch
        {
            "container" => Live2DModelGroupOption.ContainerPath, "fileName" => Live2DModelGroupOption.SourceFileName,
            "modelName" => Live2DModelGroupOption.ModelName, _ => throw new ArgumentException("Unsupported l2dGroupOption"),
        };
        o_l2dMotionMode.Value = S("l2dMotionMode", "monoBehaviour") switch
        {
            "monoBehaviour" => Live2DMotionMode.MonoBehaviour, "animationClip" => Live2DMotionMode.AnimationClipV2,
            _ => throw new ArgumentException("Unsupported l2dMotionMode"),
        };
        f_l2dAssetSearchByFilename.Value = B("l2dSearchByFilename");
        f_l2dForceBezier.Value = B("l2dForceBezier");
        o_fbxScaleFactor.Value = config.TryGetProperty("fbxScaleFactor", out var scale) ? scale.GetSingle() : 1;
        o_fbxBoneSize.Value = config.TryGetProperty("fbxBoneSize", out var bone) ? bone.GetInt32() : 10;
        if (o_fbxScaleFactor.Value < 0 || o_fbxScaleFactor.Value > 100 || o_fbxBoneSize.Value < 0 || o_fbxBoneSize.Value > 100)
            throw new ArgumentException("FBX scale and bone size must be between 0 and 100");
        o_fbxAnimMode.Value = E("fbxAnimation", AnimationExportMode.Auto);
        f_fbxUvsAsDiffuseMaps.Value = B("fbxUVsAsDiffuse");
        o_filterByName.Value = F("filterByName");
        o_filterByContainer.Value = F("filterByContainer");
        o_filterByPathID.Value = F("filterByPathID");
        o_filterByText.Value = F("filterByText");
        f_filterWithRegex.Value = B("filterWithRegex");
        filterBy = o_filterByText.Value.Count > 0 ? FilterBy.NameOrContainer :
            o_filterByPathID.Value.Count > 0 ? FilterBy.PathID :
            o_filterByName.Value.Count > 0 && o_filterByContainer.Value.Count > 0 ? FilterBy.NameAndContainer :
            o_filterByName.Value.Count > 0 ? FilterBy.Name : o_filterByContainer.Value.Count > 0 ? FilterBy.Container : FilterBy.None;
        o_bundleBlockInfoCompression.Value = E("blockinfoComp", CompressionType.Auto);
        o_bundleBlockCompression.Value = E("blockComp", CompressionType.Auto);
        o_maxParallelExportTasks.Value = config.TryGetProperty("maxExportTasks", out var tasks) ? tasks.GetInt32() : Environment.ProcessorCount;
        if (o_maxParallelExportTasks.Value < 1 || o_maxParallelExportTasks.Value > Environment.ProcessorCount)
            throw new ArgumentException($"maxExportTasks must be between 1 and {Environment.ProcessorCount}");
        o_exportAssetList.Value = E("exportAssetList", ExportListType.None);
        o_assemblyPath.Value = S("assemblyFolder");
        o_unityVersion.Value = string.IsNullOrEmpty(S("unityVersion")) ? null : new UnityVersion(S("unityVersion"));
        if (o_unityVersion.Value != null && string.IsNullOrEmpty(o_unityVersion.Value.BuildType))
            throw new ArgumentException("unityVersion must include the build suffix, for example 2022.3.62f1");
        f_decompressToDisk.Value = B("decompressToDisk");
        f_notRestoreExtensionName.Value = B("notRestoreExtension");
        f_avoidLoadingViaTypetree.Value = B("ignoreTypetree");
        f_loadAllAssets.Value = B("loadAll");
    }
}
