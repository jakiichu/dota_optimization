using System.Diagnostics;
using Frameloss.Sidecar.Network;

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
    private NetworkProbeSource? _network;
    private CpuSensorSource? _cpu;

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

        // Процессор отдельно от видеоадаптеров: у него своя форма замера, и
        // притворяться адаптером ради общего списка он не должен.
        var cpu = new CpuSensorSource();
        if (cpu.TryInitialize(out string? cpuReason))
        {
            _cpu = cpu;
        }
        else
        {
            _errors.Add($"{cpu.Name}: {cpuReason}");
            cpu.Dispose();
        }
    }

    public static SensorProbe CreateDefault()
    {
        return new SensorProbe([new NvmlSensorSource(), new PdhSensorSource()]);
    }

    /// <summary>Включает замеры сети. Без вызова они не делаются вовсе.</summary>
    public void EnableNetwork(string? internetAnchor)
    {
        var source = new NetworkProbeSource(internetAnchor);
        if (!source.HasTargets)
        {
            _errors.Add("network: не найден шлюз по умолчанию — сеть не измеряется.");
            source.Dispose();
            return;
        }
        _network = source;
    }

    public async Task<SensorSample> SampleAsync()
    {
        SensorSample sample = Sample();
        if (_network is null) return sample;

        return sample with { Network = await _network.ProbeAsync() };
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

        CpuSensorReading? cpu = null;
        try
        {
            cpu = _cpu?.Read();
        }
        catch (Exception ex)
        {
            errors.Add($"cpu: {ex.Message}");
        }

        return new SensorSample
        {
            CapturedAt = DateTimeOffset.UtcNow.ToString("o"),
            QpcTimestamp = Stopwatch.GetTimestamp(),
            QpcFrequency = Stopwatch.Frequency,
            Gpus = readings,
            Cpu = cpu,
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
        _network?.Dispose();
        _network = null;
        _cpu?.Dispose();
        _cpu = null;
    }
}
