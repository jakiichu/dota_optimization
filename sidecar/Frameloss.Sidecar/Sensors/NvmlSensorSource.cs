using System.Runtime.InteropServices;
using System.Text;

namespace Frameloss.Sidecar.Sensors;

/// <summary>
/// Показания NVIDIA через NVML — библиотеку, которая приезжает с драйвером.
/// </summary>
/// <remarks>
/// NVML читает данные пассивно и не требует прав администратора. Это осознанная
/// альтернатива LibreHardwareMonitor: тот грузит кернел-драйвер WinRing0, который
/// числится в списке уязвимых драйверов Microsoft и ломает совместимость с
/// античитами. Диагностический инструмент не должен создавать пользователю
/// проблему крупнее той, что он ищет.
/// </remarks>
public sealed class NvmlSensorSource : IGpuSensorSource
{
    private const string Library = "nvml.dll";
    private const int Success = 0;
    private const int NameBufferSize = 96;

    private const uint TemperatureSensorGpu = 0;
    private const uint ClockGraphics = 0;
    private const uint ClockMemory = 2;

    private bool _initialized;

    public string Name => "nvml";

    public bool TryInitialize(out string? reason)
    {
        try
        {
            int status = nvmlInit_v2();
            if (status != Success)
            {
                reason = $"nvmlInit вернул {status}.";
                return false;
            }
        }
        catch (DllNotFoundException)
        {
            reason = "nvml.dll не найдена — драйвер NVIDIA не установлен.";
            return false;
        }
        catch (EntryPointNotFoundException ex)
        {
            reason = $"Несовместимая nvml.dll: {ex.Message}";
            return false;
        }

        _initialized = true;
        reason = null;
        return true;
    }

    public IReadOnlyList<GpuSensorReading> Read()
    {
        if (!_initialized)
        {
            return [];
        }

        if (nvmlDeviceGetCount_v2(out uint count) != Success)
        {
            return [];
        }

        var readings = new List<GpuSensorReading>((int)count);
        for (uint index = 0; index < count; index++)
        {
            if (nvmlDeviceGetHandleByIndex_v2(index, out IntPtr handle) != Success)
            {
                continue;
            }
            readings.Add(ReadDevice(handle, index));
        }
        return readings;
    }

    private static GpuSensorReading ReadDevice(IntPtr handle, uint index)
    {
        return new GpuSensorReading
        {
            AdapterName = ReadName(handle, index),
            Vendor = "nvidia",
            Source = "nvml",
            TemperatureC = ReadUInt(
                () => nvmlDeviceGetTemperature(handle, TemperatureSensorGpu, out uint value) == Success
                    ? value
                    : null),
            CoreClockMhz = ReadUInt(
                () => nvmlDeviceGetClockInfo(handle, ClockGraphics, out uint value) == Success
                    ? value
                    : null),
            MemoryClockMhz = ReadUInt(
                () => nvmlDeviceGetClockInfo(handle, ClockMemory, out uint value) == Success
                    ? value
                    : null),
            PowerWatts = ReadMilliwatts(
                () => nvmlDeviceGetPowerUsage(handle, out uint value) == Success ? value : null),
            PowerLimitWatts = ReadMilliwatts(
                () => nvmlDeviceGetEnforcedPowerLimit(handle, out uint value) == Success
                    ? value
                    : null),
            MemoryUsedBytes = ReadMemory(handle, memory => (long)memory.Used),
            MemoryTotalBytes = ReadMemory(handle, memory => (long)memory.Total),
            UtilizationPercent =
                nvmlDeviceGetUtilizationRates(handle, out NvmlUtilization utilization) == Success
                    ? utilization.Gpu
                    : null,
            ThrottleReasons = ReadThrottleReasons(handle),
        };
    }

    private static string ReadName(IntPtr handle, uint index)
    {
        var buffer = new StringBuilder(NameBufferSize);
        return nvmlDeviceGetName(handle, buffer, NameBufferSize) == Success
            ? buffer.ToString()
            : $"NVIDIA GPU {index}";
    }

    private static int? ReadUInt(Func<uint?> read)
    {
        uint? value = read();
        return value is null ? null : (int)value.Value;
    }

    private static double? ReadMilliwatts(Func<uint?> read)
    {
        uint? value = read();
        return value is null ? null : value.Value / 1000.0;
    }

    private static long? ReadMemory(IntPtr handle, Func<NvmlMemory, long> select)
    {
        return nvmlDeviceGetMemoryInfo(handle, out NvmlMemory memory) == Success
            ? select(memory)
            : null;
    }

    /// <summary>
    /// Биты причин троттлинга. Ради них NVML и нужен: без них падение частот
    /// видно, а объяснить его нечем.
    /// </summary>
    private static readonly (ulong Bit, string Reason)[] ThrottleBits =
    [
        (0x0000000000000004UL, "программный лимит мощности"),
        (0x0000000000000008UL, "аппаратное замедление"),
        (0x0000000000000020UL, "программный троттлинг по температуре"),
        (0x0000000000000040UL, "аппаратный троттлинг по температуре"),
        (0x0000000000000080UL, "просадка питания (power brake)"),
        (0x0000000000000002UL, "частоты зафиксированы приложением"),
    ];

    private static IReadOnlyList<string> ReadThrottleReasons(IntPtr handle)
    {
        if (nvmlDeviceGetCurrentClocksThrottleReasons(handle, out ulong mask) != Success)
        {
            return [];
        }

        var reasons = new List<string>();
        foreach ((ulong bit, string reason) in ThrottleBits)
        {
            if ((mask & bit) != 0)
            {
                reasons.Add(reason);
            }
        }
        return reasons;
    }

    public void Dispose()
    {
        if (_initialized)
        {
            _ = nvmlShutdown();
            _initialized = false;
        }
    }

    // --- P/Invoke ---------------------------------------------------------

    [StructLayout(LayoutKind.Sequential)]
    private struct NvmlMemory
    {
        public ulong Total;
        public ulong Free;
        public ulong Used;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NvmlUtilization
    {
        public uint Gpu;
        public uint Memory;
    }

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern int nvmlInit_v2();

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern int nvmlShutdown();

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern int nvmlDeviceGetCount_v2(out uint count);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern int nvmlDeviceGetHandleByIndex_v2(uint index, out IntPtr device);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    private static extern int nvmlDeviceGetName(IntPtr device, StringBuilder name, uint length);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern int nvmlDeviceGetTemperature(IntPtr device, uint sensorType, out uint temp);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern int nvmlDeviceGetClockInfo(IntPtr device, uint type, out uint clock);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern int nvmlDeviceGetPowerUsage(IntPtr device, out uint milliwatts);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern int nvmlDeviceGetEnforcedPowerLimit(IntPtr device, out uint milliwatts);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern int nvmlDeviceGetMemoryInfo(IntPtr device, out NvmlMemory memory);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern int nvmlDeviceGetUtilizationRates(IntPtr device, out NvmlUtilization utilization);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern int nvmlDeviceGetCurrentClocksThrottleReasons(IntPtr device, out ulong reasons);
}
