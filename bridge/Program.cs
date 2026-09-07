using AssetStudio;
using AssetStudioCLI;
using AssetStudioCLI.Options;
using System.Collections.Concurrent;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Runtime.Loader;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

// stdout is exclusively a versioned JSON-lines protocol, never CLI output.
internal static class Program
{
    private static readonly TextWriter Wire = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
    private static readonly object WriteLock = new();
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public static void Send(object value)
    {
        lock (WriteLock) Wire.WriteLine(JsonSerializer.Serialize(value, JsonOptions));
    }

    public static void Main()
    {
        CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;
        AssemblyLoadContext.Default.ResolvingUnmanagedDll += (assembly, name) =>
        {
            var dir = Path.Combine(AppContext.BaseDirectory, "runtimes", RuntimeInformation.RuntimeIdentifier, "native");
            string[] names = OperatingSystem.IsWindows() ? [name, name + ".dll"] :
                OperatingSystem.IsMacOS() ? [name, "lib" + name + ".dylib"] : [name, "lib" + name + ".so"];
            foreach (var candidate in names)
            {
                var file = Path.Combine(dir, candidate);
                if (File.Exists(file)) return NativeLibrary.Load(file);
            }
            return IntPtr.Zero;
        };
        Console.SetOut(TextWriter.Null);
        Send(new { type = "ready", protocol = 1, pid = Environment.ProcessId });
        // One request at a time: upstream uses static state. Separate workers allow parallelism.
        string line;
        while ((line = Console.ReadLine()) != null)
        {
            string id = null;
            object response;
            var initialized = false;
            var logger = new PipeLogger(() => id);
            Logger.Default = logger;
            try
            {
                using var document = JsonDocument.Parse(line);
                var request = document.RootElement;
                id = request.GetProperty("id").GetString();
                if (string.IsNullOrEmpty(id)) throw new ArgumentException("Missing request id");
                var method = request.GetProperty("method").GetString();
                if (method is not ("inspect" or "export")) throw new ArgumentException("Unsupported method");
                var input = Path.GetFullPath(request.GetProperty("input").GetString());
                if (!File.Exists(input) && !Directory.Exists(input)) throw new FileNotFoundException("Input does not exist", input);
                var output = method == "export" ? Path.GetFullPath(request.GetProperty("output").GetString()) : "";
                try { CLIOptions.Configure(input, output, request.GetProperty("config"), method == "inspect"); }
                catch (Exception ex) { throw new ArgumentException($"Invalid configuration: {ex.Message}", ex); }
                Studio.assetsManager = new AssetsManager();
                initialized = true;
                Studio.assetsManager.OptionLoaders.Clear();
                Studio.assetsManager.LoadViaTypeTree = !CLIOptions.f_avoidLoadingViaTypetree.Value;
                Studio.assetsManager.Options.CustomUnityVersion = CLIOptions.o_unityVersion.Value;
                Studio.assetsManager.Options.BundleOptions.CustomBlockInfoCompression = CLIOptions.o_bundleBlockInfoCompression.Value;
                Studio.assetsManager.Options.BundleOptions.CustomBlockCompression = CLIOptions.o_bundleBlockCompression.Value;
                Studio.assetsManager.Options.BundleOptions.DecompressToDisk = CLIOptions.f_decompressToDisk.Value;
                if (CLIOptions.o_assemblyPath.Value != "") Studio.assemblyLoader.Load(CLIOptions.o_assemblyPath.Value);
                else Studio.assemblyLoader.Loaded = true;
                var progress = new PipeProgress(id);
                AssetStudio.Progress.Default = progress;
                Studio.ExportProgress = (completed, total) => Send(new { type = "progress", id, phase = "export", completed, total,
                    percent = total == 0 ? 100 : (int)(100L * completed / total) });
                var mode = CLIOptions.o_workMode.Value;
                if (mode != WorkMode.Info) Directory.CreateDirectory(output);
                if (mode == WorkMode.Extract)
                {
                    progress.Phase = "extract";
                    Studio.ExtractBundles();
                }
                else
                {
                    progress.Report(0);
                    if (!Studio.LoadAssets()) throw new InvalidDataException("No Unity serialized files could be loaded");
                    progress.Phase = "parse";
                    Studio.ParseAssets();
                    if (CLIOptions.filterBy != FilterBy.None) Studio.Filter();
                    // Never continue exporting a partially failed load without telling the caller.
                    if (!logger.Errors.IsEmpty) throw new InvalidDataException("Asset loading or parsing failed");
                    if (mode != WorkMode.Info && CLIOptions.o_exportAssetList.Value != ExportListType.None) Studio.ExportAssetList();
                    progress.Phase = "export";
                    switch (mode)
                    {
                        case WorkMode.Info: break;
                        case WorkMode.Live2D: Studio.ExportLive2D(); break;
                        case WorkMode.SplitObjects: Studio.ExportSplitObjects(); break;
                        case WorkMode.Animator: Studio.ExportAnimator(); break;
                        default: Studio.ExportAssets(); break;
                    }
                }
                if (!logger.Errors.IsEmpty) throw new InvalidDataException("One or more assets could not be processed");
                response = new { type = "result", id, result = new {
                    loadedFiles = Studio.assetsManager.AssetsFileList.Count,
                    assetCount = Studio.parsedAssetsList.Count,
                    exportedCount = mode == WorkMode.Info ? 0 : mode == WorkMode.Live2D ? (int?)null : Studio.ExportedCount,
                    output = mode == WorkMode.Info ? null : output,
                    assets = Studio.parsedAssetsList.Select(a => new {
                        name = a.Text, type = a.TypeString, pathId = a.m_PathID.ToString(CultureInfo.InvariantCulture),
                        container = a.Container, size = a.FullSize, source = a.SourceFile.fileName,
                    }).ToArray(),
                }};
            }
            catch (Exception ex)
            {
                response = new { type = "error", id, error = new {
                    code = ex is ArgumentException or JsonException or InvalidOperationException ? "INVALID_CONFIG" :
                        ex is FileNotFoundException ? "INPUT_NOT_FOUND" : "ASSET_PROCESSING_ERROR",
                    message = ex.Message, details = logger.Errors.ToArray(),
                }};
            }
            finally
            {
                // Reset static collections, caches and readers before acknowledging completion.
                if (initialized)
                {
                    Studio.Clear();
                    Studio.ExportProgress = (_, _) => { };
                }
                AssetStudio.Progress.Default = new SilentProgress();
                Logger.Default = new DummyLogger();
            }
            Send(response);
        }
    }

    private sealed class PipeLogger(Func<string> getId) : ILogger
    {
        public ConcurrentQueue<string> Errors { get; } = new();
        public void Log(LoggerEvent level, string message, bool ignoreLevel = false)
        {
            message = Regex.Replace(message, @"\x1b\[[0-9;]*m", "");
            if (level == LoggerEvent.Error && Errors.Count < 100) Errors.Enqueue(message);
            if (level < CLIOptions.o_logLevel.Value && !ignoreLevel) return;
            Send(new { type = "log", id = getId(), level = level.ToString().ToLowerInvariant(), message });
        }
    }
    private sealed class PipeProgress(string id) : IProgress<int>
    {
        public string Phase { get; set; } = "load";
        public void Report(int value) => Send(new { type = "progress", id, phase = Phase, percent = value });
    }
    private sealed class SilentProgress : IProgress<int> { public void Report(int value) { } }
}
