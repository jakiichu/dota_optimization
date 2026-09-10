namespace Frameloss.Sidecar.Sensors;

/// <summary>
/// Что процессор делал в момент замера.
/// </summary>
/// <remarks>
/// <c>null</c> означает «не прочитали», а не ноль: соглашение то же, что у
/// видеоадаптеров. Нулевая загрузка и недоступный счётчик — разные вещи, и
/// путать их нельзя.
/// </remarks>
public sealed record CpuSensorReading
{
    /// <summary>Загрузка всех ядер вместе, проценты.</summary>
    public double? UtilizationPercent { get; init; }

    /// <summary>
    /// Фактическая частота в процентах от базовой.
    /// </summary>
    /// <remarks>
    /// Ниже ста под нагрузкой — процессор сбрасывает частоты: нагрев, предел
    /// питания или схема электропитания. Выше ста — обычный разгон, а не ошибка.
    /// </remarks>
    public double? PerformancePercent { get; init; }

    /// <summary>
    /// Загрузка каждого ядра.
    /// </summary>
    /// <remarks>
    /// Судить по ней об однопоточности нельзя: Windows перекидывает поток между
    /// ядрами, и одна занятая нить выглядит как половина на двух ядрах.
    /// </remarks>
    public IReadOnlyList<double> CoreUtilizationPercent { get; init; } = [];
}
