namespace Frameloss.Sidecar.Sensors;

/// <summary>
/// Показания одного видеоадаптера.
/// </summary>
/// <remarks>
/// Каждое поле nullable, и <c>null</c> означает «не прочитали», а не «ноль».
/// То же соглашение, что и в снимке конфигурации: инструмент обязан уметь
/// сказать «не знаю», иначе он врёт уверенным тоном.
/// </remarks>
public sealed record GpuSensorReading
{
    public required string AdapterName { get; init; }

    /// <summary>nvidia, amd, intel или unknown.</summary>
    public required string Vendor { get; init; }

    /// <summary>Откуда взяты показания: nvml, pdh.</summary>
    public required string Source { get; init; }

    public int? TemperatureC { get; init; }
    public int? CoreClockMhz { get; init; }
    public int? MemoryClockMhz { get; init; }
    public double? PowerWatts { get; init; }
    public double? PowerLimitWatts { get; init; }
    public long? MemoryUsedBytes { get; init; }
    public long? MemoryTotalBytes { get; init; }
    public double? UtilizationPercent { get; init; }

    /// <summary>Почему карта не идёт на полных частотах — пусто, если причин нет.</summary>
    public IReadOnlyList<string> ThrottleReasons { get; init; } = [];
}

/// <summary>Один замер по всем найденным адаптерам.</summary>
public sealed record SensorSample
{
    public required string CapturedAt { get; init; }

    /// <summary>Монотонные часы: только по ним можно сшивать с кадрами PresentMon.</summary>
    public required long QpcTimestamp { get; init; }

    public required long QpcFrequency { get; init; }

    public required IReadOnlyList<GpuSensorReading> Gpus { get; init; }

    /// <summary>
    /// Замеры сети в тот же момент.
    /// </summary>
    /// <remarks>
    /// Здесь же, а не отдельным потоком: сопоставить рывок с сетью можно только
    /// по общей оси времени, а она у замера одна.
    /// </remarks>
    public IReadOnlyList<Frameloss.Sidecar.Network.NetworkProbeReading> Network { get; init; } = [];

    /// <summary>Что делал процессор в тот же момент. <c>null</c> — не прочитали.</summary>
    public CpuSensorReading? Cpu { get; init; }

    /// <summary>
    /// Кто ещё занимал процессор.
    /// </summary>
    /// <remarks>
    /// <c>null</c> — в этот замер процессы не читались: у них своё разрешение,
    /// примерно секунда, и сходиться с шагом остальных счётчиков они не обязаны.
    /// Пустой список — читали, и никто не был занят. Это разные вещи.
    /// </remarks>
    public IReadOnlyList<ProcessSensorReading>? Processes { get; init; }

    public IReadOnlyList<string> Errors { get; init; } = [];
}
