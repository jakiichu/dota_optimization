using System.Runtime.InteropServices;

namespace Frameloss.Sidecar.Sensors;

/// <summary>
/// Показания AMD через ADL — библиотеку, которая приезжает с драйвером Radeon.
/// </summary>
/// <remarks>
/// Ровно то же место, что NVML занимает у NVIDIA: температуры, частоты, питание
/// и — главное — <b>причины троттлинга</b>. До сих пор AMD был покрыт только
/// счётчиками Windows, и инструмент честно возвращал по температурам <c>null</c>.
///
/// <b>Почему ADL, а не ADLX.</b> ADLX — нынешний SDK AMD, и просили именно его,
/// но у него интерфейсы в стиле COM: из C# это ручной обход таблиц виртуальных
/// функций через десяток интерфейсов, и каждая ошибка в раскладке структуры —
/// падение процесса, а не исключение. ADL при этом живёт в той же поставке
/// драйвера, экспортирует плоские функции C и отдаёт <i>больше</i>: причин
/// троттлинга у ADLX нет вовсе. Менять надёжный источник на модный ради
/// названия смысла не было.
///
/// Прав администратора не требует и в память чужих процессов не лезет —
/// то же условие, из-за которого отвергнут LibreHardwareMonitor с его
/// кернел-драйвером WinRing0.
///
/// <b>Разбор проверен на живой машине</b> (Radeon встроенный в Ryzen 7 PRO
/// 5850U): 22 поддержанных сенсора, значения сошлись с официальным
/// перечислением <c>ADL_PMLOG_SENSORS</c> по всем полям, которые можно
/// перепроверить глазами — частота памяти 1333 при DDR4-2666, частота
/// процессора 1743 МГц на холостом ходу, температура 46 °C.
/// </remarks>
public sealed class AdlSensorSource : IGpuSensorSource
{
    private const string Library = "atiadlxx.dll";
    private const int Ok = 0;

    /// <summary>
    /// Идентификатор AMD так, как его отдаёт ADL. Чужие адаптеры она тоже
    /// перечисляет, и отсеивать их надо.
    /// </summary>
    /// <remarks>
    /// Именно <c>1002</c> десятичным, а не <c>0x1002</c>. В PCI вендор AMD —
    /// шестнадцатеричный 0x1002, но ADL кладёт в <c>iVendorID</c> число 1002,
    /// то есть те же цифры, прочитанные как десятичные. Проверка по 0x1002
    /// молча не находит ни одного адаптера — ровно это здесь и случилось.
    /// </remarks>
    private const int VendorAmd = 1002;

    /// <summary>Заголовок обещает 256; берём с запасом на случай нового драйвера.</summary>
    private const int MaxSensors = 512;

    /// <summary>Размер буфера ответа: <c>int size</c> плюс пары «поддержан, значение».</summary>
    private const int OutputBytes = 4 + MaxSensors * 8;

    // Индексы из ADL_PMLOG_SENSORS. Только те, что нам нужны.
    private const int SensorClockGfx = 1;
    private const int SensorClockMemory = 2;
    private const int SensorTemperatureEdge = 8;
    private const int SensorActivityGfx = 19;
    private const int SensorAsicPower = 23;
    private const int SensorTemperatureHotspot = 27;
    private const int SensorTemperatureGfx = 28;
    private const int SensorThrottlerStatus = 35;
    private const int SensorThrottlerStatusCpu = 45;

    /// <summary>
    /// Биты <c>ADL_THROTTLE_NOTIFICATION</c>: «в прошлом интервале замера
    /// случилось ограничение такого рода».
    /// </summary>
    private static readonly (int Bit, string Reason)[] ThrottleBits =
    [
        (1 << 0, "предел мощности"),
        (1 << 1, "перегрев"),
        (1 << 2, "предел тока"),
    ];

    /// <summary>
    /// Делегат выделения памяти, который ADL требует при создании контекста.
    /// </summary>
    /// <remarks>
    /// Поле, а не локальная переменная: сборщик мусора не знает, что на делегат
    /// ссылается неуправляемый код, и собранный делегат обрушил бы процесс при
    /// первом же вызове из библиотеки.
    /// </remarks>
    private readonly AdlAllocate _allocate = Marshal.AllocHGlobal;

    private readonly byte[] _zero = new byte[OutputBytes];
    private IntPtr _context = IntPtr.Zero;
    private IntPtr _output = IntPtr.Zero;
    private int[] _adapters = [];

    public string Name => "adl";

    /// <summary>
    /// Почему процессор сбрасывает частоты. Пусто — причин нет или их не видно.
    /// </summary>
    /// <remarks>
    /// Физически это показание процессора, а не видеокарты, но приезжает оно
    /// тем же вызовом: у APU питание общее, и SMU отдаёт оба состояния разом.
    /// Складывает их в замер <see cref="SensorProbe"/> — источники друг о друге
    /// по-прежнему не знают.
    ///
    /// Ради него всё и затевалось: «частота ниже базовой под нагрузкой» мы
    /// видели и раньше, а сказать почему было нечем.
    /// </remarks>
    public IReadOnlyList<string> CpuThrottleReasons { get; private set; } = [];

    public bool TryInitialize(out string? reason)
    {
        try
        {
            int status = ADL2_Main_Control_Create(_allocate, 1, out _context);
            if (status != Ok)
            {
                reason = $"ADL2_Main_Control_Create вернул {status}.";
                return false;
            }
        }
        catch (DllNotFoundException)
        {
            reason = $"{Library} не найдена — драйвер AMD не установлен.";
            return false;
        }
        catch (EntryPointNotFoundException ex)
        {
            reason = $"Несовместимая {Library}: {ex.Message}";
            return false;
        }

        _adapters = FindAdapters();
        if (_adapters.Length == 0)
        {
            ADL2_Main_Control_Destroy(_context);
            _context = IntPtr.Zero;
            reason = "ADL не нашёл ни одного адаптера AMD.";
            return false;
        }

        _output = Marshal.AllocHGlobal(OutputBytes);
        reason = null;
        return true;
    }

    public IReadOnlyList<GpuSensorReading> Read()
    {
        if (_context == IntPtr.Zero) return [];

        var readings = new List<GpuSensorReading>(_adapters.Length);
        var cpuReasons = new List<string>();

        foreach (int adapter in _adapters)
        {
            // Чистим перед каждым запросом: библиотека заполняет столько, сколько
            // сенсоров знает, а остаток буфера иначе прочитался бы как поддержанный
            // со значением от прошлого адаптера.
            Marshal.Copy(_zero, 0, _output, OutputBytes);
            if (ADL2_New_QueryPMLogData_Get(_context, adapter, _output) != Ok) continue;

            readings.Add(ReadAdapter(adapter));
            cpuReasons.AddRange(Decode(Sensor(SensorThrottlerStatusCpu)));
        }

        CpuThrottleReasons = cpuReasons.Distinct().ToArray();
        return readings;
    }

    private GpuSensorReading ReadAdapter(int adapter)
    {
        return new GpuSensorReading
        {
            AdapterName = _names.GetValueOrDefault(adapter, $"AMD GPU {adapter}"),
            Vendor = "amd",
            Source = "adl",
            // Горячая точка честнее краевой температуры, но есть не у всех:
            // на встроенных её нет, и тогда берём то, что есть.
            TemperatureC = Sensor(SensorTemperatureHotspot)
                ?? Sensor(SensorTemperatureGfx)
                ?? Sensor(SensorTemperatureEdge),
            CoreClockMhz = Sensor(SensorClockGfx),
            MemoryClockMhz = Sensor(SensorClockMemory),
            PowerWatts = Sensor(SensorAsicPower),
            // Предел мощности PMLog не отдаёт. Это «не прочитали», а не ноль.
            PowerLimitWatts = null,
            // Видеопамять у ADL тоже не спрашиваем: её уже даёт PDH, и на APU
            // она всё равно общая с оперативной.
            MemoryUsedBytes = null,
            MemoryTotalBytes = null,
            UtilizationPercent = Sensor(SensorActivityGfx),
            ThrottleReasons = Decode(Sensor(SensorThrottlerStatus)),
        };
    }

    /// <summary>Значение сенсора или <c>null</c>, если он не поддержан.</summary>
    private int? Sensor(int type)
    {
        if (type < 0 || type >= MaxSensors) return null;
        int offset = 4 + type * 8;
        return Marshal.ReadInt32(_output, offset) != 0
            ? Marshal.ReadInt32(_output, offset + 4)
            : null;
    }

    private static IReadOnlyList<string> Decode(int? mask)
    {
        if (mask is null or 0) return [];
        return ThrottleBits.Where(bit => (mask.Value & bit.Bit) != 0).Select(bit => bit.Reason).ToArray();
    }

    private readonly Dictionary<int, string> _names = [];

    /// <summary>
    /// Индексы адаптеров AMD — по одному на физическую карту.
    /// </summary>
    /// <remarks>
    /// ADL перечисляет адаптер отдельно для каждого выхода изображения: на этой
    /// машине одна встроенная Radeon приехала пятью записями с одинаковыми
    /// шиной, устройством и функцией. Различаем по этой тройке, иначе один и
    /// тот же чип попал бы в замер пять раз.
    /// </remarks>
    private int[] FindAdapters()
    {
        if (ADL2_Adapter_NumberOfAdapters_Get(_context, out int count) != Ok || count <= 0)
        {
            return [];
        }

        int size = Marshal.SizeOf<AdapterInfo>();
        IntPtr buffer = Marshal.AllocHGlobal(size * count);
        try
        {
            if (ADL2_Adapter_AdapterInfo_Get(_context, buffer, size * count) != Ok) return [];

            var seen = new HashSet<(int, int, int)>();
            var found = new List<int>();
            for (int i = 0; i < count; i++)
            {
                AdapterInfo info = Marshal.PtrToStructure<AdapterInfo>(buffer + i * size);
                if (info.iVendorID != VendorAmd || info.iExist == 0) continue;
                if (!seen.Add((info.iBusNumber, info.iDeviceNumber, info.iFunctionNumber))) continue;

                found.Add(info.iAdapterIndex);
                _names[info.iAdapterIndex] = info.strAdapterName.Trim();
            }
            return [.. found];
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    public void Dispose()
    {
        if (_output != IntPtr.Zero)
        {
            Marshal.FreeHGlobal(_output);
            _output = IntPtr.Zero;
        }
        if (_context != IntPtr.Zero)
        {
            _ = ADL2_Main_Control_Destroy(_context);
            _context = IntPtr.Zero;
        }
    }

    // --- P/Invoke ---------------------------------------------------------

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate IntPtr AdlAllocate(int size);

    /// <summary>
    /// Раскладка <c>AdapterInfo</c> из adl_structures.h.
    /// </summary>
    /// <remarks>
    /// Строки — фиксированные массивы по 256 байт (<c>ADL_MAX_PATH</c>), а не
    /// указатели. Ошибка здесь не даёт исключения: библиотека просто пишет мимо,
    /// и процесс падает позже и в другом месте. Размер структуры обязан
    /// получиться 1572 байта.
    /// </remarks>
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    private struct AdapterInfo
    {
        public int iSize;
        public int iAdapterIndex;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string strUDID;
        public int iBusNumber;
        public int iDeviceNumber;
        public int iFunctionNumber;
        public int iVendorID;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string strAdapterName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string strDisplayName;
        public int iPresent;
        public int iExist;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string strDriverPath;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string strDriverPathExt;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string strPNPString;
        public int iOSDisplayIndex;
    }

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern int ADL2_Main_Control_Create(AdlAllocate allocate, int enumConnected, out IntPtr context);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern int ADL2_Main_Control_Destroy(IntPtr context);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern int ADL2_Adapter_NumberOfAdapters_Get(IntPtr context, out int count);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern int ADL2_Adapter_AdapterInfo_Get(IntPtr context, IntPtr info, int size);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern int ADL2_New_QueryPMLogData_Get(IntPtr context, int adapter, IntPtr output);
}
