using System.Diagnostics;

namespace Frameloss.Sidecar.Sensors;

/// <summary>
/// Загрузка GPU и занятая видеопамять через счётчики производительности Windows.
/// </summary>
/// <remarks>
/// Единственный источник, который работает у любого вендора и без прав
/// администратора. Температур и частот он не даёт — для них нужен вендорский
/// API. Это осознанный минимум, а не заглушка: знать, что GPU занят на 99%,
/// уже достаточно, чтобы отличить упор в GPU от упора в CPU.
/// </remarks>
public sealed class PdhSensorSource : IGpuSensorSource
{
    private const string EngineCategory = "GPU Engine";
    private const string EngineCounter = "Utilization Percentage";
    private const string MemoryCategory = "GPU Adapter Memory";
    private const string MemoryCounter = "Dedicated Usage";

    /// <summary>Движок 3D — тот, что занят рендером игры.</summary>
    private const string RenderEngineMarker = "engtype_3D";

    private readonly Dictionary<string, PerformanceCounter> _engineCounters = new(StringComparer.Ordinal);
    private PerformanceCounterCategory? _engineCategory;
    private PerformanceCounterCategory? _memoryCategory;

    public string Name => "pdh";

    public bool TryInitialize(out string? reason)
    {
        try
        {
            if (!PerformanceCounterCategory.Exists(EngineCategory))
            {
                reason = $"Категория счётчиков «{EngineCategory}» недоступна.";
                return false;
            }

            _engineCategory = new PerformanceCounterCategory(EngineCategory);
            _memoryCategory = PerformanceCounterCategory.Exists(MemoryCategory)
                ? new PerformanceCounterCategory(MemoryCategory)
                : null;

            // Счётчик загрузки — скоростной: первое чтение всегда даёт ноль и
            // нужно лишь для того, чтобы было с чем сравнивать следующее.
            _ = ReadUtilizationByAdapter();

            reason = null;
            return true;
        }
        catch (Exception ex) when (ex is InvalidOperationException or UnauthorizedAccessException)
        {
            reason = $"Счётчики производительности недоступны: {ex.Message}";
            return false;
        }
    }

    public IReadOnlyList<GpuSensorReading> Read()
    {
        Dictionary<string, double> utilization = ReadUtilizationByAdapter();
        Dictionary<string, long> memory = ReadDedicatedMemoryByAdapter();

        var adapters = new SortedSet<string>(StringComparer.Ordinal);
        adapters.UnionWith(utilization.Keys);
        adapters.UnionWith(memory.Keys);

        var readings = new List<GpuSensorReading>(adapters.Count);
        foreach (string adapter in adapters)
        {
            readings.Add(new GpuSensorReading
            {
                AdapterName = adapter,
                Vendor = "unknown",
                Source = "pdh",
                UtilizationPercent = utilization.TryGetValue(adapter, out double percent)
                    ? Math.Round(percent, 1)
                    : null,
                MemoryUsedBytes = memory.TryGetValue(adapter, out long used) ? used : null,
            });
        }
        return readings;
    }

    /// <summary>
    /// Суммирует загрузку 3D-движка по всем процессам, раскладывая по адаптерам.
    /// </summary>
    /// <remarks>
    /// Экземпляры счётчика появляются и исчезают вместе с процессами, поэтому
    /// список перечитывается каждый раз. Уже созданные счётчики переиспользуются:
    /// заново созданный отдал бы ноль, потому что сравнивать ему не с чем.
    /// </remarks>
    private Dictionary<string, double> ReadUtilizationByAdapter()
    {
        var totals = new Dictionary<string, double>(StringComparer.Ordinal);
        if (_engineCategory is null)
        {
            return totals;
        }

        string[] instances;
        try
        {
            instances = _engineCategory.GetInstanceNames();
        }
        catch (InvalidOperationException)
        {
            return totals;
        }

        var alive = new HashSet<string>(StringComparer.Ordinal);
        foreach (string instance in instances)
        {
            if (!instance.Contains(RenderEngineMarker, StringComparison.Ordinal))
            {
                continue;
            }
            alive.Add(instance);

            if (!_engineCounters.TryGetValue(instance, out PerformanceCounter? counter))
            {
                counter = new PerformanceCounter(EngineCategory, EngineCounter, instance, readOnly: true);
                _engineCounters[instance] = counter;
            }

            try
            {
                string adapter = AdapterKeyOf(instance);
                totals[adapter] = totals.GetValueOrDefault(adapter) + counter.NextValue();
            }
            catch (InvalidOperationException)
            {
                // Процесс завершился между перечислением и чтением — обычное дело.
            }
        }

        DropDeadCounters(alive);
        return totals;
    }

    private void DropDeadCounters(HashSet<string> alive)
    {
        List<string> dead = _engineCounters.Keys.Where(key => !alive.Contains(key)).ToList();
        foreach (string key in dead)
        {
            _engineCounters[key].Dispose();
            _engineCounters.Remove(key);
        }
    }

    private Dictionary<string, long> ReadDedicatedMemoryByAdapter()
    {
        var result = new Dictionary<string, long>(StringComparer.Ordinal);
        if (_memoryCategory is null)
        {
            return result;
        }

        try
        {
            foreach (string instance in _memoryCategory.GetInstanceNames())
            {
                using var counter = new PerformanceCounter(
                    MemoryCategory, MemoryCounter, instance, readOnly: true);
                result[AdapterKeyOf(instance)] = (long)counter.NextValue();
            }
        }
        catch (InvalidOperationException)
        {
            return result;
        }
        return result;
    }

    /// <summary>
    /// Вытаскивает идентификатор адаптера из имени экземпляра.
    /// </summary>
    /// <remarks>
    /// Имена выглядят как <c>pid_1234_luid_0x00000000_0x0000A1B2_phys_0_eng_0_engtype_3D</c>.
    /// Человеческого названия карты в счётчиках нет — только LUID, поэтому
    /// адаптер здесь и остаётся LUID-ом. Сопоставление с именем появится, когда
    /// добавим DXGI.
    /// </remarks>
    private static string AdapterKeyOf(string instanceName)
    {
        int luidAt = instanceName.IndexOf("luid_", StringComparison.Ordinal);
        if (luidAt < 0)
        {
            return instanceName;
        }

        string tail = instanceName[luidAt..];
        int engAt = tail.IndexOf("_eng_", StringComparison.Ordinal);
        return engAt < 0 ? tail : tail[..engAt];
    }

    public void Dispose()
    {
        foreach (PerformanceCounter counter in _engineCounters.Values)
        {
            counter.Dispose();
        }
        _engineCounters.Clear();
    }
}
