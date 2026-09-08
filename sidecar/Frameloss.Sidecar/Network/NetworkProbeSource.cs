using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace Frameloss.Sidecar.Network;

/// <summary>
/// Замеряет задержку до шлюза и до интернета.
/// </summary>
/// <remarks>
/// Меряем не игровой сервер: его адрес без разбора трафика игры не узнать, а
/// лезть в чужой процесс мы не будем. Зато пара «шлюз и интернет» отвечает на
/// главный вопрос — проблема внутри квартиры или за роутером. Для Wi-Fi это и
/// есть основной подозреваемый.
///
/// `Ping` из .NET на Windows идёт через IcmpSendEcho2 и прав администратора не
/// требует — в отличие от сырых сокетов.
/// </remarks>
public sealed class NetworkProbeSource : IDisposable
{
    private const string GatewayLabel = "шлюз";
    private const string InternetLabel = "интернет";

    /// <summary>Ждать ответа дольше нет смысла: это уже потеря для игры.</summary>
    private const int TimeoutMs = 1000;

    private readonly List<(IPAddress Address, string Label)> _targets = [];
    private readonly Ping _ping = new();

    /// <summary>Больше трёх шлюзов опрашивать незачем, а пингов жалко.</summary>
    private const int MaxGateways = 3;

    public NetworkProbeSource(string? internetAnchor)
    {
        IPAddress? outbound = FindOutboundAddress(internetAnchor);

        // Меряем все шлюзы, а не только тот, через который идёт трафик. На машине
        // с прокси или VPN их два: виртуальный отвечает через десятки
        // миллисекунд с того конца туннеля, физический — за единицы. Разница
        // между ними и есть цена туннеля, и увидеть её можно только измерив оба.
        foreach ((IPAddress address, string adapter, bool isDefault) in FindGateways(outbound))
        {
            string suffix = isDefault ? ", основной" : "";
            _targets.Add((address, $"{GatewayLabel} {adapter}{suffix}"));
        }

        if (!string.IsNullOrWhiteSpace(internetAnchor)
            && IPAddress.TryParse(internetAnchor, out IPAddress? anchor))
        {
            _targets.Add((anchor, InternetLabel));
        }
    }

    public bool HasTargets => _targets.Count > 0;

    public IReadOnlyList<string> Describe()
    {
        return _targets.Select(target => $"{target.Label}: {target.Address}").ToList();
    }

    /// <summary>
    /// Опрашивает узлы последовательно.
    /// </summary>
    /// <remarks>
    /// Один <see cref="Ping"/> не выдерживает параллельных вызовов, а заводить
    /// по объекту на узел ради двух адресов незачем.
    /// </remarks>
    public async Task<IReadOnlyList<NetworkProbeReading>> ProbeAsync()
    {
        var readings = new List<NetworkProbeReading>(_targets.Count);

        foreach ((IPAddress address, string label) in _targets)
        {
            readings.Add(await ProbeOneAsync(address, label));
        }

        return readings;
    }

    private async Task<NetworkProbeReading> ProbeOneAsync(IPAddress address, string label)
    {
        try
        {
            PingReply reply = await _ping.SendPingAsync(address, TimeoutMs);
            bool success = reply.Status == IPStatus.Success;

            return new NetworkProbeReading
            {
                Target = address.ToString(),
                Label = label,
                RoundTripMs = success ? reply.RoundtripTime : null,
                Success = success,
                Status = success ? null : reply.Status.ToString(),
            };
        }
        catch (Exception ex) when (ex is PingException or InvalidOperationException)
        {
            return new NetworkProbeReading
            {
                Target = address.ToString(),
                Label = label,
                RoundTripMs = null,
                Success = false,
                Status = ex.Message,
            };
        }
    }

    /// <summary>
    /// Все шлюзы работающих адаптеров, с пометкой того, через который идёт трафик.
    /// </summary>
    private static List<(IPAddress Address, string Adapter, bool IsDefault)> FindGateways(
        IPAddress? outboundAddress)
    {
        var found = new List<(IPAddress, string, bool)>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        foreach (NetworkInterface adapter in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (adapter.OperationalStatus != OperationalStatus.Up) continue;
            if (adapter.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;

            IPInterfaceProperties properties = adapter.GetIPProperties();
            bool carriesTraffic = outboundAddress is not null
                && properties.UnicastAddresses.Any(
                    address => address.Address.Equals(outboundAddress));

            foreach (GatewayIPAddressInformation gateway in properties.GatewayAddresses)
            {
                if (gateway.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                if (gateway.Address.Equals(IPAddress.Any)) continue;
                if (!seen.Add(gateway.Address.ToString())) continue;

                found.Add((gateway.Address, adapter.Name, carriesTraffic));
                if (found.Count >= MaxGateways) return found;
            }
        }

        return found;
    }

    /// <summary>Локальный адрес, который система выберет для выхода наружу.</summary>
    private static IPAddress? FindOutboundAddress(string? anchor)
    {
        try
        {
            using var socket = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp);
            IPAddress target = anchor is not null && IPAddress.TryParse(anchor, out IPAddress? parsed)
                ? parsed
                : IPAddress.Parse("1.1.1.1");
            // Порт произвольный: соединение UDP не отправляет ничего, а только
            // заставляет систему выбрать маршрут.
            socket.Connect(target, 53);
            return (socket.LocalEndPoint as IPEndPoint)?.Address;
        }
        catch (SocketException)
        {
            return null;
        }
    }

    public void Dispose()
    {
        _ping.Dispose();
    }
}
