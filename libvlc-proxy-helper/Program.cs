using LibVLCSharp.Shared;

var streamUrl = Environment.GetEnvironmentVariable("IPTV_PROXY_SOURCE_URL");
var portText = Environment.GetEnvironmentVariable("IPTV_PROXY_PORT");

if (string.IsNullOrWhiteSpace(streamUrl) ||
    !int.TryParse(portText, out var port) ||
    port <= 0)
{
    Console.Error.WriteLine("Missing IPTV_PROXY_SOURCE_URL or IPTV_PROXY_PORT.");
    return 2;
}

using var stopSignal = new ManualResetEventSlim(false);

Console.CancelKeyPress += (_, e) =>
{
    e.Cancel = true;
    stopSignal.Set();
};

try
{
    Core.Initialize();

    var libVlcOptions = new List<string>
    {
        "--avcodec-hw=any",
        "--http-reconnect",
        "--http-continuous",
        "--http-host=127.0.0.1",
        "--network-caching=2500",
        "--live-caching=2500",
        "--file-caching=1000",
        "--clock-jitter=0",
        "--clock-synchro=0",
        "--no-video-title-show"
    };

    if (Environment.GetEnvironmentVariable("IPTV_PROXY_DEBUG") == "1")
    {
        libVlcOptions.Add("--verbose=2");
    }

    using var libVlc = new LibVLC(libVlcOptions.ToArray());
    libVlc.Log += (sender, e) => {
        if (e.Level == LibVLCSharp.Shared.LogLevel.Error || e.Level == LibVLCSharp.Shared.LogLevel.Warning) {
            Console.WriteLine($"[VLC {e.Level}] {e.Module}: {e.Message}");
        }
    };


    using var mediaPlayer = new MediaPlayer(libVlc);
    using var media = new Media(libVlc, new Uri(streamUrl));

    var destination = $":{port}/stream";
    // Transcode audio only. Pass through the original video track without x264 encoder. Mux as TS.
    media.AddOption($":sout=#transcode{{acodec=mp4a,ab=192,channels=2,samplerate=48000}}:std{{access=http{{mime=video/MP2T}},mux=ts,dst={destination}}}");
    media.AddOption(":sout-keep");
    media.AddOption(":network-caching=3000");
    media.AddOption(":live-caching=3000");
    media.AddOption(":avcodec-hw=any");
    media.AddOption(":http-user-agent=VLC/3.0.18 LibVLC/3.0.18");
    media.AddOption(":http-reconnect");
    media.AddOption(":http-continuous");
    media.AddOption(":no-video-title-show");
    
    mediaPlayer.EncounteredError += (_, _) =>
    {
        Console.Error.WriteLine("LibVLC encountered a playback error.");
        stopSignal.Set();
    };

    mediaPlayer.EndReached += (_, _) =>
    {
        Console.Error.WriteLine("LibVLC stream ended.");
        stopSignal.Set();
    };

    if (!mediaPlayer.Play(media))
    {
        Console.Error.WriteLine("LibVLC refused to start playback.");
        return 3;
    }

    Console.WriteLine("LibVLC proxy started.");

    var stdinMonitor = Task.Run(() =>
    {
        try
        {
            while (Console.In.Read() >= 0)
            {
                // Keep reading until the parent process closes stdin.
            }
        }
        catch
        {
            // Treat stdin errors as parent shutdown.
        }

        stopSignal.Set();
    });

    stopSignal.Wait();
    mediaPlayer.Stop();
    await stdinMonitor.WaitAsync(TimeSpan.FromSeconds(1)).ConfigureAwait(false);
    return 0;
}
catch (TimeoutException)
{
    return 0;
}
catch (Exception ex)
{
    Console.Error.WriteLine(ex);
    return 1;
}
