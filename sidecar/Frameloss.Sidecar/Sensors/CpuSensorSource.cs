using System.Diagnostics;

namespace Frameloss.Sidecar.Sensors;

/// <summary>
/// Загрузка процессора и то, на каких частотах он на самом деле работает.
/// </summary>
/// <remarks>
/// Категория «Processor Information», а не «Processor»: только в ней есть
/// «% Processor Performance» — отношение фактической частоты к базовой. Ниже
/// ста процентов под нагрузкой означает, что процессор сбрасывает частоты, и на
/// ноутбуке это происходит куда чаще, чем на видеокарте.
///
/// Загрузка берётся счётчиком «% Processor Time», а не «% Processor Utility».
/// Второй считает работу относительно базовой частоты и на разгоне спокойно
/// показывает 180% — величина осмысленная, но человек читает её как поломку.
/// Частоту мы и так отдаём отдельным числом, и мешать одно с другим незачем.
///
/// Загрузка отдельных ядер тоже читается, но выводы по ней делать нельзя:
/// Windows перекидывает поток между ядрами, и однопоточная нагрузка выглядит как
/// половина на двух ядрах, а не как сто процентов на одном. Отдаём как есть, а
/// толкует их домен вместе с разбивкой кадра.
/// </remarks>
public sealed class CpuSensorSource : IDisposable
{
    private const string Category = "Processor Information";
    private const string TimeCounter = "% Processor Time";
    private const string PerformanceCounterName = "% Processor Performance";

    /// <summary>Итоговая строка по всем ядрам.</summary>
    private const string TotalInstance = "_Total";

    private readonly List<PerformanceCounter> _perCore = [];
    private PerformanceCounter? _total;
    private PerformanceCounter? _performance;

    public string Name => "cpu";

    public bool TryInitialize(out string? reason)
    {
        try
        {
            if (!PerformanceCounterCategory.Exists(Category))
            {
                reason = $"Категория счётчиков «{Category}» недоступна.";
                return false;
            }

            var category = new PerformanceCounterCategory(Category);
            string[] instances = category.GetInstanceNames();

            _total = new PerformanceCounter(Category, TimeCounter, TotalInstance, readOnly: true);
            _performance = new PerformanceCounter(
                Category,
                PerformanceCounterName,
                TotalInstance,
                readOnly: true);

            foreach (string instance in instances)
            {
                // Кроме _Total в списке бывают строки вида «0,_Total» — сводка по
                // группе процессоров. Нам нужны только сами ядра.
                if (instance.Contains(TotalInstance, StringComparison.Ordinal)) continue;
                _perCore.Add(new PerformanceCounter(Category, TimeCounter, instance, readOnly: true));
            }

            // Скоростные счётчики: первое чтение всегда даёт ноль и нужно лишь
            // затем, чтобы было с чем сравнивать следующее.
            Warm();

            reason = null;
            return true;
        }
        catch (Exception ex) when (ex is InvalidOperationException or UnauthorizedAccessException)
        {
            reason = $"Счётчики процессора недоступны: {ex.Message}";
            return false;
        }
    }

    public CpuSensorReading Read()
    {
        var cores = new List<double>(_perCore.Count);
        foreach (PerformanceCounter counter in _perCore)
        {
            cores.Add(Math.Round(counter.NextValue(), 1));
        }

        return new CpuSensorReading
        {
            UtilizationPercent = _total is null ? null : Math.Round(_total.NextValue(), 1),
            // Выше ста процентов — не ошибка, а разгон: счётчик меряет
            // отношение к базовой частоте, а не к максимальной.
            PerformancePercent = _performance is null ? null : Math.Round(_performance.NextValue(), 1),
            CoreUtilizationPercent = cores,
        };
    }

    private void Warm()
    {
        _ = _total?.NextValue();
        _ = _performance?.NextValue();
        foreach (PerformanceCounter counter in _perCore)
        {
            _ = counter.NextValue();
        }
    }

    public void Dispose()
    {
        _total?.Dispose();
        _total = null;
        _performance?.Dispose();
        _performance = null;
        foreach (PerformanceCounter counter in _perCore)
        {
            counter.Dispose();
        }
        _perCore.Clear();
    }
}
