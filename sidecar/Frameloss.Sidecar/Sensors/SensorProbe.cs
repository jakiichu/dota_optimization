using System.Diagnostics;

namespace Frameloss.Sidecar.Sensors;

/// <summary>
/// Собирает показания со всех источников, которые завелись на этой машине.
/// </summary>
/// <remarks>
/// Источники не исключают друг друга: PDH знает загрузку любого адаптера, NVML —
/// температуры и причины троттлинга своего. Пусть в выдаче будут оба, а разбирать
/// их сопоставление будет тот, кто знает про конкретную машину.
/// </remarks>
public sealed class SensorProbe : IDisposable
{
    private readonly List<IGpuSensorSource> _active = [];
    private readonly List<string> _errors = [];

    public SensorProbe(IEnumerable<IGpuSensorSource> sources)
    {
        foreach (IGpuSensorSource source in sources)
        {
            if (source.TryInitialize(out string? reason))
            {
                _active.Add(source);
            }
            else
            {
                _errors.Add($"{source.Name}: {reason}");
                source.Dispose();
            }
        }
    }

    public static SensorProbe CreateDefault()
    {
        return new SensorProbe([new NvmlSensorSource(), new PdhSensorSource()]);
    }

    public SensorSample Sample()
    {
        var readings = new List<GpuSensorReading>();
        var errors = new List<string>(_errors);

        foreach (IGpuSensorSource source in _active)
        {
            try
            {
                readings.AddRange(source.Read());
            }
            catch (Exception ex)
            {
                // Отвалившийся источник не должен уносить с собой остальные.
                errors.Add($"{source.Name}: {ex.Message}");
            }
        }

        return new SensorSample
        {
            CapturedAt = DateTimeOffset.UtcNow.ToString("o"),
            QpcTimestamp = Stopwatch.GetTimestamp(),
            QpcFrequency = Stopwatch.Frequency,
            Gpus = readings,
            Errors = errors,
        };
    }

    public void Dispose()
    {
        foreach (IGpuSensorSource source in _active)
        {
            source.Dispose();
        }
        _active.Clear();
    }
}
