<#
.SYNOPSIS
    Собирает снимок игровой конфигурации Windows в один JSON-файл.

.DESCRIPTION
    Скрипт только читает: ни одна ветка реестра и ни одна настройка не меняется.
    Всё, что не удалось прочитать, возвращается как $null и попадает в
    collectionErrors — правило аудита обязано отличать «выключено» от «не знаю».

    Результат пишется в файл, а не в stdout: консоль Windows живёт в локальной
    кодовой странице, и русские имена адаптеров через неё не проходят целыми.

.PARAMETER OutputPath
    Куда записать JSON (UTF-8).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$OutputPath
)

Set-StrictMode -Version 1.0
$ErrorActionPreference = 'Stop'

$script:CollectionErrors = New-Object System.Collections.ArrayList

function Add-CollectionError {
    param([string]$Context, [System.Management.Automation.ErrorRecord]$ErrorRecord)
    $null = $script:CollectionErrors.Add("$Context : $($ErrorRecord.Exception.Message)")
}

function Get-RegistryValue {
    param([string]$Path, [string]$Name)
    try {
        $item = Get-ItemProperty -Path $Path -Name $Name -ErrorAction Stop
        return $item.$Name
    } catch {
        return $null
    }
}

function Get-GpuVendor {
    param([string]$PnpDeviceId)
    if ([string]::IsNullOrEmpty($PnpDeviceId)) { return 'unknown' }
    $upper = $PnpDeviceId.ToUpperInvariant()
    if ($upper -like '*VEN_10DE*') { return 'nvidia' }
    if ($upper -like '*VEN_1002*' -or $upper -like '*VEN_1022*') { return 'amd' }
    if ($upper -like '*VEN_8086*') { return 'intel' }
    return 'unknown'
}

# --- Права ------------------------------------------------------------------

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

# --- ОС и процессор ---------------------------------------------------------

$os = $null
$cpu = $null
try {
    $osInfo = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
    $os = [ordered]@{
        caption     = [string]$osInfo.Caption
        version     = [string]$osInfo.Version
        buildNumber = [string]$osInfo.BuildNumber
        locale      = [string]$osInfo.Locale
    }
} catch {
    Add-CollectionError 'Win32_OperatingSystem' $_
    $os = [ordered]@{ caption = 'unknown'; version = 'unknown'; buildNumber = 'unknown'; locale = $null }
}

try {
    $cpuInfo = @(Get-CimInstance -ClassName Win32_Processor -ErrorAction Stop)[0]
    $cpu = [ordered]@{
        name          = [string]$cpuInfo.Name
        physicalCores = [int]$cpuInfo.NumberOfCores
        logicalCores  = [int]$cpuInfo.NumberOfLogicalProcessors
    }
} catch {
    Add-CollectionError 'Win32_Processor' $_
    $cpu = [ordered]@{ name = 'unknown'; physicalCores = $null; logicalCores = $null }
}

# --- Видеоадаптеры ----------------------------------------------------------

$gpus = @()
try {
    $controllers = @(Get-CimInstance -ClassName Win32_VideoController -ErrorAction Stop)
    foreach ($controller in $controllers) {
        $driverDate = $null
        if ($null -ne $controller.DriverDate) {
            $driverDate = ([datetime]$controller.DriverDate).ToString('yyyy-MM-dd')
        }
        $gpus += [ordered]@{
            name          = [string]$controller.Name
            vendor        = Get-GpuVendor ([string]$controller.PNPDeviceID)
            driverVersion = [string]$controller.DriverVersion
            driverDate    = $driverDate
            pnpDeviceId   = [string]$controller.PNPDeviceID
        }
    }
} catch {
    Add-CollectionError 'Win32_VideoController' $_
}

# --- Режимы вывода ----------------------------------------------------------
# Win32_VideoController.MaxRefreshRate возвращает максимум текущего режима, а не
# возможности панели, и на ноутбуках регулярно показывает 60 при 165-герцевом
# экране. Поэтому спрашиваем сам GDI: EnumDisplaySettings перечисляет все режимы,
# которые драйвер готов выставить.

$displays = @()
try {
    if (-not ('FrameLoss.DisplayApi' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace FrameLoss {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DisplayDevice {
        public int cb;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString;
        public int StateFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DevMode {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
        public short dmSpecVersion;
        public short dmDriverVersion;
        public short dmSize;
        public short dmDriverExtra;
        public int dmFields;
        public int dmPositionX;
        public int dmPositionY;
        public int dmDisplayOrientation;
        public int dmDisplayFixedOutput;
        public short dmColor;
        public short dmDuplex;
        public short dmYResolution;
        public short dmTTOption;
        public short dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
        public short dmLogPixels;
        public int dmBitsPerPel;
        public int dmPelsWidth;
        public int dmPelsHeight;
        public int dmDisplayFlags;
        public int dmDisplayFrequency;
        public int dmICMMethod;
        public int dmICMIntent;
        public int dmMediaType;
        public int dmDitherType;
        public int dmReserved1;
        public int dmReserved2;
        public int dmPanningWidth;
        public int dmPanningHeight;
    }

    public static class DisplayApi {
        public const int AttachedToDesktop = 0x1;
        public const int CurrentSettings = -1;

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern bool EnumDisplayDevices(string device, uint index, ref DisplayDevice info, uint flags);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern bool EnumDisplaySettings(string deviceName, int modeNum, ref DevMode mode);

        public static DisplayDevice NewDevice() {
            DisplayDevice device = new DisplayDevice();
            device.cb = Marshal.SizeOf(typeof(DisplayDevice));
            return device;
        }

        public static DevMode NewMode() {
            DevMode mode = new DevMode();
            mode.dmSize = (short)Marshal.SizeOf(typeof(DevMode));
            return mode;
        }
    }
}
'@
    }

    $adapterIndex = 0
    while ($true) {
        $adapter = [FrameLoss.DisplayApi]::NewDevice()
        # PowerShell подменяет $null пустой строкой при привязке к [string]-параметру,
        # а EnumDisplayDevices на пустое имя отвечает отказом. Нужен настоящий NULL.
        if (-not [FrameLoss.DisplayApi]::EnumDisplayDevices([NullString]::Value, $adapterIndex, [ref]$adapter, 0)) { break }
        $adapterIndex++

        if (($adapter.StateFlags -band [FrameLoss.DisplayApi]::AttachedToDesktop) -eq 0) { continue }

        $current = [FrameLoss.DisplayApi]::NewMode()
        if (-not [FrameLoss.DisplayApi]::EnumDisplaySettings($adapter.DeviceName, [FrameLoss.DisplayApi]::CurrentSettings, [ref]$current)) { continue }

        # Максимум считаем только среди режимов с тем же разрешением: 240 Гц в
        # 720p не повод объявлять проблемой 60 Гц в 1440p.
        $maxRefresh = $current.dmDisplayFrequency
        $modeIndex = 0
        while ($true) {
            $mode = [FrameLoss.DisplayApi]::NewMode()
            if (-not [FrameLoss.DisplayApi]::EnumDisplaySettings($adapter.DeviceName, $modeIndex, [ref]$mode)) { break }
            $modeIndex++
            if ($mode.dmPelsWidth -ne $current.dmPelsWidth) { continue }
            if ($mode.dmPelsHeight -ne $current.dmPelsHeight) { continue }
            if ($mode.dmBitsPerPel -lt $current.dmBitsPerPel) { continue }
            if ($mode.dmDisplayFrequency -gt $maxRefresh) { $maxRefresh = $mode.dmDisplayFrequency }
        }

        # Имя панели читаем вторым вызовом: у самого адаптера его нет.
        $monitorName = $adapter.DeviceName
        $monitor = [FrameLoss.DisplayApi]::NewDevice()
        if ([FrameLoss.DisplayApi]::EnumDisplayDevices($adapter.DeviceName, 0, [ref]$monitor, 0)) {
            if (-not [string]::IsNullOrWhiteSpace($monitor.DeviceString)) {
                $monitorName = "$($monitor.DeviceString) ($($adapter.DeviceName))"
            }
        }

        $displays += [ordered]@{
            adapterName          = $monitorName
            horizontalResolution = [int]$current.dmPelsWidth
            verticalResolution   = [int]$current.dmPelsHeight
            currentRefreshHz     = [int]$current.dmDisplayFrequency
            maxRefreshHz         = [int]$maxRefresh
        }
    }
} catch {
    Add-CollectionError 'EnumDisplaySettings' $_
}

# --- Электропитание ---------------------------------------------------------
# Читаем реестр, а не powercfg: вывод powercfg локализован и разбирать его
# текстом на русской Windows нельзя.

$SCHEMES_ROOT = 'HKLM:\SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes'
$SUBGROUP_PROCESSOR = '54533251-82be-4824-96c1-47b60b740d00'
$SETTING_MIN_CORES = '0cc5b647-c1df-4637-891a-dec35c318583'

$KNOWN_SCHEMES = @{
    '381b4222-f694-41f0-9685-ff5bb260df2e' = 'Сбалансированная'
    '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c' = 'Высокая производительность'
    'a1841308-3541-4fab-bc81-f71556f20b4a' = 'Экономия энергии'
    'e9a42b02-d5df-448d-aa00-03f14749eb61' = 'Максимальная производительность'
}

$activeSchemeGuid = Get-RegistryValue $SCHEMES_ROOT 'ActivePowerScheme'
$activeSchemeName = $null
$minCores = $null
if ($null -ne $activeSchemeGuid) {
    $key = $activeSchemeGuid.ToString().ToLowerInvariant()
    if ($KNOWN_SCHEMES.ContainsKey($key)) { $activeSchemeName = $KNOWN_SCHEMES[$key] }
    $settingPath = "$SCHEMES_ROOT\$activeSchemeGuid\$SUBGROUP_PROCESSOR\$SETTING_MIN_CORES"
    $acIndex = Get-RegistryValue $settingPath 'ACSettingIndex'
    if ($null -ne $acIndex) { $minCores = [int]$acIndex }
}

$isLaptop = $null
$onBattery = $null
try {
    $batteries = @(Get-CimInstance -ClassName Win32_Battery -ErrorAction Stop)
    $isLaptop = $batteries.Count -gt 0
    if ($batteries.Count -gt 0) {
        # BatteryStatus 2 = питание от сети.
        $onBattery = [int]$batteries[0].BatteryStatus -ne 2
    }
} catch {
    Add-CollectionError 'Win32_Battery' $_
}

$activeSchemeGuidText = $null
if ($null -ne $activeSchemeGuid) { $activeSchemeGuidText = [string]$activeSchemeGuid }

$power = [ordered]@{
    activeSchemeGuid           = $activeSchemeGuidText
    activeSchemeName           = $activeSchemeName
    minProcessorCoresPercentAc = $minCores
    isLaptop                   = $isLaptop
    onBattery                  = $onBattery
}

# --- Графические настройки --------------------------------------------------

$graphics = [ordered]@{
    hwSchMode                 = Get-RegistryValue 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers' 'HwSchMode'
    hwSchState                = Get-RegistryValue 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers' 'HwSchState'
    overlayTestMode           = Get-RegistryValue 'HKLM:\SOFTWARE\Microsoft\Windows\Dwm' 'OverlayTestMode'
    gameDvrEnabled            = Get-RegistryValue 'HKCU:\System\GameConfigStore' 'GameDVR_Enabled'
    allowGameDvr              = Get-RegistryValue 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\GameDVR' 'AllowGameDVR'
    autoGameModeEnabled       = Get-RegistryValue 'HKCU:\SOFTWARE\Microsoft\GameBar' 'AutoGameModeEnabled'
    directXUserGlobalSettings = Get-RegistryValue 'HKCU:\SOFTWARE\Microsoft\DirectX\UserGpuPreferences' 'DirectXUserGlobalSettings'
}

# --- Изоляция ядра ----------------------------------------------------------

$security = [ordered]@{
    virtualizationBasedSecurityEnabled       = Get-RegistryValue 'HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard' 'EnableVirtualizationBasedSecurity'
    hypervisorEnforcedCodeIntegrityEnabled   = Get-RegistryValue 'HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity' 'Enabled'
}

# --- Сетевые адаптеры -------------------------------------------------------

$networkAdapters = @()
try {
    $adapters = @(Get-NetAdapter -ErrorAction Stop | Where-Object { -not $_.Virtual })
    foreach ($adapter in $adapters) {
        $allowTurnOff = $null
        try {
            $pm = Get-NetAdapterPowerManagement -Name $adapter.Name -ErrorAction Stop
            if ($null -ne $pm.AllowComputerToTurnOffDevice) {
                $allowTurnOff = ($pm.AllowComputerToTurnOffDevice.ToString() -eq 'Enabled')
            }
        } catch {
            # Управление питанием поддерживают не все адаптеры — это не ошибка.
            $allowTurnOff = $null
        }

        $linkSpeedMbps = $null
        if ($null -ne $adapter.Speed -and $adapter.Speed -gt 0) {
            $linkSpeedMbps = [int]($adapter.Speed / 1000000)
        }

        $media = [string]$adapter.PhysicalMediaType
        $networkAdapters += [ordered]@{
            name                        = [string]$adapter.Name
            interfaceDescription        = [string]$adapter.InterfaceDescription
            status                      = [string]$adapter.Status
            isWireless                  = ($media -like '*802.11*')
            linkSpeedMbps               = $linkSpeedMbps
            allowComputerToTurnOffDevice = $allowTurnOff
        }
    }
} catch {
    Add-CollectionError 'Get-NetAdapter' $_
}

# --- Настройки совместимости для конкретных .exe ----------------------------

$appCompat = @()
$LAYERS_PATH = 'HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers'
try {
    if (Test-Path $LAYERS_PATH) {
        $layersKey = Get-Item -Path $LAYERS_PATH -ErrorAction Stop
        foreach ($valueName in $layersKey.GetValueNames()) {
            if ([string]::IsNullOrEmpty($valueName)) { continue }
            $appCompat += [ordered]@{
                executablePath = $valueName
                layers         = [string]$layersKey.GetValue($valueName)
            }
        }
    }
} catch {
    Add-CollectionError 'AppCompatFlags\Layers' $_
}

# --- Сборка результата ------------------------------------------------------

$snapshot = [ordered]@{
    schemaVersion     = 1
    capturedAt        = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    machineName       = $env:COMPUTERNAME
    collectedAsAdmin  = $isAdmin
    os                = $os
    cpu               = $cpu
    gpus              = $gpus
    displays          = $displays
    power             = $power
    graphics          = $graphics
    security          = $security
    networkAdapters   = $networkAdapters
    appCompat         = $appCompat
    collectionErrors  = @($script:CollectionErrors)
}

$json = $snapshot | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($OutputPath, $json, (New-Object System.Text.UTF8Encoding($false)))
