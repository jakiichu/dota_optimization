namespace Frameloss.Sidecar.Sensors;

/// <summary>
/// Источник показаний по видеоадаптерам.
/// </summary>
/// <remarks>
/// Источников несколько, и доступность каждого зависит от машины: NVML есть
/// только с драйвером NVIDIA, счётчики производительности — везде. Композицией
/// занимается <see cref="SensorProbe"/>, сами источники друг о друге не знают.
/// </remarks>
public interface IGpuSensorSource : IDisposable
{
    /// <summary>Короткое имя для диагностики: nvml, pdh.</summary>
    string Name { get; }

    /// <summary>
    /// Готов ли источник работать на этой машине. Вызывается один раз до чтения.
    /// </summary>
    bool TryInitialize(out string? reason);

    IReadOnlyList<GpuSensorReading> Read();
}
