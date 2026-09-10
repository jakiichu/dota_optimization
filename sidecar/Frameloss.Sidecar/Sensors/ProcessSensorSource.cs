using System.Diagnostics;

namespace Frameloss.Sidecar.Sensors;

/// <summary>
/// Кто ещё занимал процессор, пока шла игра.
/// </summary>
/// <remarks>
/// Ради одной улики: «кадр ждал». Она значит, что кадр не работал ни на CPU, ни
/// на GPU, — то есть работу делал кто-то другой, и в счётчиках самой игры этого
/// не видно вовсе. Без списка процессов эта улика — тупик: инструмент называет
/// симптом и умолкает.
///
/// Считаем по разнице <see cref="Process.TotalProcessorTime"/>, а не через PDH
/// «Process». У PDH имена экземпляров вида <c>chrome#3</c>, порядок которых
/// меняется при каждом запуске, и сопоставить их с процессом можно лишь через
/// отдельный счётчик идентификатора. Разница процессорного времени — то же
/// число, но с настоящим pid и без этой возни.
///
/// Часть процессов недоступна и администратору: защищённые процессы Windows и
/// системные идентификаторы. Отказ по одному не должен уносить остальные,
/// поэтому каждый читается отдельно, а недоступные просто отсутствуют — это
/// честнее нуля.
/// </remarks>
public sealed class ProcessSensorSource : IDisposable
{
    /// <summary>Сколько программ попадает в замер.</summary>
    /// <remarks>
    /// Не «все». Полный список процессов — это опись того, что на машине
    /// установлено и запущено, а запись потом уезжает на чужой компьютер и в
    /// письма. Виновника рывка среди восьми самых прожорливых видно, а
    /// остальные триста ничего не объясняют.
    /// </remarks>
    private const int TopCount = 8;

    /// <summary>Ниже этого программа в замер не попадает.</summary>
    /// <remarks>
    /// Процент — это шум планировщика, а не работа. Отсутствие в замере домен
    /// читает как «меньше процента», и опираться на это можно: порог объявлен
    /// здесь и один для всех замеров.
    /// </remarks>
    private const double MinReportedPercent = 1.0;

    /// <summary>
    /// Короче этого интервала замер не делается.
    /// </summary>
    /// <remarks>
    /// Процессорное время процесса обновляется не мгновенно, и на окне в
    /// четверть секунды разница вырождается в шум: процесс, получивший один
    /// квант, выглядит как занявший десятки процентов. Секунда — честное
    /// разрешение этой улики, и в формулировках оно так и звучит: «в ту же
    /// секунду», а не «в тот же кадр».
    /// </remarks>
    private const double MinWindowMs = 900;

    /// <summary>Простой — это не работа, и в списке занятых ему не место.</summary>
    private const string IdleProcess = "Idle";

    /// <summary>
    /// Себя в замер не берём.
    /// </summary>
    /// <remarks>
    /// Прибор не должен появляться в собственных показаниях. Наша доля
    /// процессора существует только потому, что идёт замер, и назвать её
    /// причиной чужого рывка нельзя — у такой строки есть честное имя, и это
    /// «накладные расходы измерения», а не «фоновый процесс».
    /// </remarks>
    private static readonly int SelfProcessId = Environment.ProcessId;

    private readonly Dictionary<int, long> _previousCpuTicks = [];
    private readonly int _processorCount = Math.Max(1, Environment.ProcessorCount);
    private long _previousQpc;
    private bool _primed;

    public string Name => "processes";

    public bool TryInitialize(out string? reason)
    {
        int seen = Prime();
        if (seen == 0)
        {
            reason = "Процессорное время процессов недоступно.";
            return false;
        }

        _primed = true;
        reason = null;
        return true;
    }

    /// <summary>
    /// Замер, если с прошлого прошло достаточно времени.
    /// </summary>
    /// <returns>
    /// <c>null</c> — в этот раз не мерили. Это не «никто не занят»: пустой
    /// список значит именно второе, и путать их нельзя.
    /// </returns>
    public IReadOnlyList<ProcessSensorReading>? Read()
    {
        if (!_primed) return null;

        long now = Stopwatch.GetTimestamp();
        double elapsedMs = (now - _previousQpc) * 1000.0 / Stopwatch.Frequency;
        if (elapsedMs < MinWindowMs) return null;

        var byName = new Dictionary<string, (double Percent, int Count)>(StringComparer.OrdinalIgnoreCase);
        var current = new Dictionary<int, long>(_previousCpuTicks.Count);

        foreach (Process process in Process.GetProcesses())
        {
            using (process)
            {
                if (!TryReadCpuTicks(process, out long ticks)) continue;
                current[process.Id] = ticks;

                if (!_previousCpuTicks.TryGetValue(process.Id, out long before)) continue;

                // Отрицательная разница означает, что pid переиспользован под
                // другой процесс. Считать её нельзя, а гадать не нужно: через
                // секунду будет честный замер.
                long delta = ticks - before;
                if (delta <= 0) continue;

                double percent = delta / TimeSpan.TicksPerMillisecond / elapsedMs
                    * 100.0 / _processorCount;

                (double Percent, int Count) sum = byName.GetValueOrDefault(process.ProcessName);
                byName[process.ProcessName] = (sum.Percent + percent, sum.Count + 1);
            }
        }

        _previousCpuTicks.Clear();
        foreach ((int pid, long ticks) in current)
        {
            _previousCpuTicks[pid] = ticks;
        }
        _previousQpc = now;

        // Порог применяется к сумме, а не к отдельному процессу: дюжина вкладок
        // по полпроцента — это шесть процентов чужой работы, и отбрасывать их
        // поодиночке значит не увидеть её вовсе.
        List<ProcessSensorReading> busy = byName
            .Where(entry => entry.Value.Percent >= MinReportedPercent)
            .OrderByDescending(entry => entry.Value.Percent)
            .Take(TopCount)
            .Select(entry => new ProcessSensorReading
            {
                Name = entry.Key,
                CpuPercent = Math.Round(entry.Value.Percent, 1),
                ProcessCount = entry.Value.Count,
            })
            .ToList();

        return busy;
    }

    private int Prime()
    {
        _previousCpuTicks.Clear();
        foreach (Process process in Process.GetProcesses())
        {
            using (process)
            {
                if (TryReadCpuTicks(process, out long ticks))
                {
                    _previousCpuTicks[process.Id] = ticks;
                }
            }
        }

        _previousQpc = Stopwatch.GetTimestamp();
        return _previousCpuTicks.Count;
    }

    private static bool TryReadCpuTicks(Process process, out long ticks)
    {
        ticks = 0;
        try
        {
            if (process.Id == SelfProcessId) return false;
            if (process.ProcessName == IdleProcess) return false;
            ticks = process.TotalProcessorTime.Ticks;
            return true;
        }
        catch (Exception ex) when (ex is InvalidOperationException
            or UnauthorizedAccessException
            or System.ComponentModel.Win32Exception
            or NotSupportedException)
        {
            // Процесс успел закрыться между перечислением и чтением, либо он
            // защищённый. И то и другое — обычное дело, а не сбой замера.
            return false;
        }
    }

    public void Dispose()
    {
        _previousCpuTicks.Clear();
        _primed = false;
    }
}
