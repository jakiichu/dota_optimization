using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Frameloss.Sidecar.Sensors;

namespace Frameloss.Sidecar;

/// <summary>
/// Сайдкар: всё, чего нельзя достать из Node и PowerShell.
/// </summary>
/// <remarks>
/// Обмен — обычный JSON: одиночный замер в файл (<c>probe</c>) или поток
/// построчного JSON в stdout (<c>stream</c>). Никакого RPC-фреймворка: процесс
/// запускается родительским приложением и живёт ровно столько, сколько нужно.
/// </remarks>
public static class Program
{
    private const int ExitOk = 0;
    private const int ExitUsage = 2;
    private const int DefaultIntervalMs = 250;
    private const int MinIntervalMs = 16;

    /// <summary>
    /// Пауза перед первым замером: счётчик загрузки GPU скоростной, и без
    /// второго чтения он показывает ноль.
    /// </summary>
    private const int PrimingDelayMs = 300;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
        WriteIndented = false,
    };

    private const string Usage = """
        frameloss-sidecar — сбор показаний, недоступных из Node и PowerShell.

          probe --output <путь>        один замер, JSON в файл
          stream [--interval-ms 250]   поток замеров, по одному JSON на строку в stdout

        Дополнительно:
          --ping [адрес]               мерить задержку до шлюза и до указанного узла

        Строка stdout всегда UTF-8 вне зависимости от кодовой страницы консоли.
        """;

    public static async Task<int> Main(string[] args)
    {
        // Консоль Windows живёт в локальной кодовой странице; кириллица в именах
        // адаптеров через неё не проходит. Кодировку задаём явно.
        Console.OutputEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);

        string? command = args.Length > 0 ? args[0] : null;

        return command switch
        {
            "probe" => await RunProbeAsync(args),
            "stream" => await RunStreamAsync(args),
            null or "--help" or "-h" => Write(Usage, ExitOk),
            _ => Write($"Неизвестная команда: {command}\n\n{Usage}", ExitUsage),
        };
    }

    private static async Task<int> RunProbeAsync(string[] args)
    {
        string? outputPath = ValueAfter(args, "--output");
        if (outputPath is null)
        {
            return Write($"probe требует --output <путь>.\n\n{Usage}", ExitUsage);
        }

        using SensorProbe probe = SensorProbe.CreateDefault();
        ConfigureNetwork(probe, args);
        await Task.Delay(PrimingDelayMs);

        string json = JsonSerializer.Serialize(await probe.SampleAsync(), JsonOptions);
        await File.WriteAllTextAsync(outputPath, json, new UTF8Encoding(false));
        return ExitOk;
    }

    private static async Task<int> RunStreamAsync(string[] args)
    {
        int intervalMs = ParseInterval(ValueAfter(args, "--interval-ms"));

        using SensorProbe probe = SensorProbe.CreateDefault();
        ConfigureNetwork(probe, args);
        using var cancellation = new CancellationTokenSource();
        Console.CancelKeyPress += (_, eventArgs) =>
        {
            eventArgs.Cancel = true;
            cancellation.Cancel();
        };

        // Родитель ушёл — уходим следом. Иначе процесс переживает приложение и
        // остаётся висеть: замечено, когда сервер убили извне, а сайдкар
        // продолжил работать и держать файлы.
        _ = Task.Run(async () =>
        {
            await Console.In.ReadToEndAsync();
            await cancellation.CancelAsync();
        });

        await Task.Delay(PrimingDelayMs, CancellationToken.None);

        try
        {
            while (!cancellation.IsCancellationRequested)
            {
                SensorSample sample = await probe.SampleAsync();
                Console.Out.WriteLine(JsonSerializer.Serialize(sample, JsonOptions));
                await Console.Out.FlushAsync(cancellation.Token);
                await Task.Delay(intervalMs, cancellation.Token);
            }
        }
        catch (OperationCanceledException)
        {
            // Штатное завершение по Ctrl+C или по закрытию родителем.
        }

        return ExitOk;
    }

    /// <summary>
    /// Включает замеры сети, если попросили.
    /// </summary>
    /// <remarks>
    /// По умолчанию выключены: ICMP наружу — это трафик, о котором пользователь
    /// должен знать, а не побочный эффект запуска диагностики.
    /// </remarks>
    private static void ConfigureNetwork(SensorProbe probe, string[] args)
    {
        int index = Array.IndexOf(args, "--ping");
        if (index < 0) return;

        string? anchor = index + 1 < args.Length && !args[index + 1].StartsWith('-')
            ? args[index + 1]
            : null;
        probe.EnableNetwork(anchor);
    }

    private static int ParseInterval(string? raw)
    {
        if (raw is null || !int.TryParse(raw, out int parsed))
        {
            return DefaultIntervalMs;
        }
        return Math.Max(MinIntervalMs, parsed);
    }

    private static string? ValueAfter(string[] args, string flag)
    {
        int index = Array.IndexOf(args, flag);
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }

    private static int Write(string message, int exitCode)
    {
        TextWriter target = exitCode == ExitOk ? Console.Out : Console.Error;
        target.WriteLine(message);
        return exitCode;
    }
}
